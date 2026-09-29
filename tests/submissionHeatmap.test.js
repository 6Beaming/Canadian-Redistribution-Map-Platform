import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import { getCommissionerSubmissionHeatmap } from "../server/lib/submissions/submissionHeatmapQuery.js";

jest.unstable_mockModule("../src/services/workspaceApi.js", () => ({ getSubmissionHeatmap: jest.fn() }));
const { buildSubmissionHeatmapFillExpression, hasSubmissionHeatmapData } = await import("../src/lib/map/heatmap.js");

test("heatmap includes older rows beyond the first page and counts each area once per submission", async () => {
  const calls = [];
  const batches = [
    [{ id: "1", dguid: "right", neighboring_dguid: "right", created_at: "2020-01-01" }],
    [{ id: "2", dguid: "right", neighboring_dguid: "left" }],
    [{ id: "3", dguid: "right" }],
    [],
  ];
  const supabase = {
    from(table) {
      assert.equal(table, "submissions");
      const query = {};
      for (const method of ["select", "eq", "in", "order", "limit", "gt"]) {
        query[method] = (...args) => { calls.push([method, ...args]); return query; };
      }
      query.then = (resolve) => Promise.resolve({ data: batches.shift(), error: null }).then(resolve);
      return query;
    },
  };
  assert.deepEqual(await getCommissionerSubmissionHeatmap(supabase, { actorProfile: { province: "YT" } }), {
    countsByDguid: { right: 3, left: 1 },
    operatingPruid: "60",
  });
  assert.equal(batches.length, 0);
  assert.deepEqual(calls.filter(([method]) => method === "gt"), [
    ["gt", "id", "1"], ["gt", "id", "2"], ["gt", "id", "3"],
  ]);
  assert.equal(calls.filter(([method, field, value]) => method === "eq" && field === "submission_scope_pruids.pruid" && value === "60").length, 4);
  for (const call of calls.filter(([method]) => method === "in")) {
    assert.deepEqual(call, ["in", "status", ["pending", "archive-request"]]);
  }
});

test("heatmap rejects missing scope and database failures instead of reporting zero", async () => {
  await assert.rejects(getCommissionerSubmissionHeatmap({}, { actorProfile: {} }), { statusCode: 403 });
  const query = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) query[method] = () => query;
  query.then = (resolve) => Promise.resolve({ error: new Error("Database unavailable") }).then(resolve);
  await assert.rejects(getCommissionerSubmissionHeatmap({ from: () => query }, {
    actorProfile: { province: "YT" },
  }), /Database unavailable/);
});

test("MapLibre heatmap distinguishes zero from three and keeps colors stable with outliers", () => {
  function color(counts, dguid) {
    const result = createExpression(buildSubmissionHeatmapFillExpression(counts, "60"), { type: "color" });
    assert.equal(result.result, "success", JSON.stringify(result.value));
    return result.value.evaluate({}, { properties: { DGUID: dguid, fed_num: "60001" } }).toString();
  }
  assert.notEqual(color({ right: 3 }, "right"), color({ right: 3 }, "empty"));
  assert.equal(color({ right: 3 }, "right"), color({ right: 3, hotspot: 10000 }, "right"));
  assert.notEqual(color({ right: 1 }, "right"), color({}, "right"));
  assert.equal(hasSubmissionHeatmapData({ countsByDguid: {} }), true);
  assert.equal(hasSubmissionHeatmapData(null), false);
});

test("heatmap shades only the assigned province, including for cross-province counts", () => {
  const result = createExpression(buildSubmissionHeatmapFillExpression({ crossBorder: 3 }, "60"), { type: "color" });
  assert.equal(result.result, "success");
  const evaluate = (properties) => result.value.evaluate({}, { properties });
  assert.equal(evaluate({ DGUID: "crossBorder", fed_num: "60001" }).a, 1);
  assert.equal(evaluate({ DGUID: "crossBorder", fed_num: "61001" }).a, 0);
  assert.equal(evaluate({ DGUID: "empty", fed_num: "61001" }).a, 0);
  assert.equal(evaluate({ DGUID: "empty", fed_num: "60001" }).a, 1);
  assert.equal(evaluate({ DGUID: "crossBorder", FED_NUM: 61001 }).a, 0);
  assert.equal(evaluate({ DGUID: "crossBorder" }).a, 0);
  assert.equal(buildSubmissionHeatmapFillExpression({ crossBorder: 3 }), "rgba(0,0,0,0)");
});

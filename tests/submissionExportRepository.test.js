import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  iterateCommissionerExportRows,
  normalizeSubmissionExportRequest,
} from "../server/lib/submissions/submissionExportRepository.js";

test("export request normalizes commissioner filters and type toggles", () => {
  const request = normalizeSubmissionExportRequest({
    filters: {
      createdFrom: "2026-08-01",
      createdTo: "2026-08-31",
      query: "Whitehorse",
    },
    types: {
      comments: true,
      objections: false,
      counterproposal: true,
    },
    submissionIds: ["submission-1", "submission-1"],
  });

  assert.equal(request.filters.createdFrom, "2026-08-01");
  assert.equal(request.filters.query, "Whitehorse");
  assert.equal(request.types.objections, false);
  assert.deepEqual([...request.submissionIdSet], ["submission-1"]);
});

test("export iterator applies community query and type filters", async () => {
  const rows = [
    {
      id: "submission-1",
      type: "feedback",
      created_at: "2026-08-02T12:00:00.000Z",
      dissemination_areas: { community_name: "Whitehorse North" },
    },
    {
      id: "submission-2",
      type: "objection",
      created_at: "2026-08-02T12:00:00.000Z",
      dissemination_areas: { community_name: "Whitehorse South" },
    },
    {
      id: "submission-3",
      type: "counter-proposal",
      created_at: "2026-08-02T12:00:00.000Z",
      dissemination_areas: { community_name: "Dawson City" },
    },
  ];

  const supabase = {
    rpc: async () => ({
      data: {
        items: rows.map((row) => ({
          ...row,
          status: "pending",
          visible_status: "pending",
          user_id: "public-1",
          scope_pruids: ["10"],
          profile: { id: "public-1", email: "public@example.com" },
        })),
        page: { pageSize: 100, nextCursor: null, hasMore: false },
      },
      error: null,
    }),
    from(table) {
      if (table === "submission_scope_pruids") {
        return {
          select() { return this; },
          eq() { return this; },
          insert() { return this; },
          then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
        };
      }
      if (table === "workspace_archive_requests") {
        return {
          select() { return this; },
          in() { return this; },
          order() { return this; },
          async then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  const actorProfile = { id: "commissioner-1", role: "commissioner", province: "NL" };
  const exported = [];
  for await (const row of iterateCommissionerExportRows(supabase, {
    actorProfile,
    filters: {
      query: "",
      createdFrom: "",
      createdTo: "",
      type: "",
      status: "",
      sort: "newest",
    },
    types: {
      comments: true,
      objections: false,
      counterproposal: false,
    },
    submissionIdSet: null,
  })) {
    exported.push(row.id);
  }

  assert.deepEqual(exported, ["submission-1"]);
});

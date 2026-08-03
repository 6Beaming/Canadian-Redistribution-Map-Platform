import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  buildScopeProjection,
  deriveEligibilityPruids,
  filterSubmissionsForCommissionerScope,
  setResourceScopeTestDoubles,
} from "../server/lib/authorization/resourceScopeGuard.js";
import {
  formatCrossProvinceWarning,
  resolveCommissionerPruid,
  resolvePruidFromProvinceCode,
} from "../server/lib/authorization/provinceCatalog.js";

afterEach(() => setResourceScopeTestDoubles(null));

test("province catalog maps commissioner letter codes to PRUIDs", () => {
  assert.equal(resolvePruidFromProvinceCode("mb"), "46");
  assert.equal(resolvePruidFromProvinceCode("SK"), "47");
  assert.equal(resolveCommissionerPruid({ province: "ON" }), "35");
  assert.equal(resolveCommissionerPruid({ province: null }), null);
});

test("cross-province warning uses canonical province names", () => {
  assert.equal(
    formatCrossProvinceWarning(["47", "46"]),
    "You are processing a boundary between Manitoba and Saskatchewan.",
  );
  assert.equal(formatCrossProvinceWarning(["46"]), null);
});

test("eligibility derivation uses canonical DA profiles", async () => {
  setResourceScopeTestDoubles({
    getProfileForDguid: async (dguid) => {
      if (dguid === "2021S051246050041") return { pruid: "46" };
      if (dguid === "2021S051247010151") return { pruid: "47" };
      return null;
    },
  });

  const pruids = await deriveEligibilityPruids(
    "2021S051246050041",
    "2021S051247010151",
  );
  assert.deepEqual(pruids, ["46", "47"]);

  const projection = buildScopeProjection(pruids, "46");
  assert.equal(projection.isEligible, true);
  assert.equal(projection.isCrossProvince, true);
  assert.equal(projection.operatingPruid, "46");
  assert.match(projection.crossProvinceWarning, /Manitoba and Saskatchewan/);
});

test("commissioner scope filter hides unrelated-province rows", async () => {
  setResourceScopeTestDoubles({
    getProfileForDguid: async (dguid) => {
      if (String(dguid).includes("460")) return { pruid: "46" };
      if (String(dguid).includes("350")) return { pruid: "35" };
      return { pruid: "10" };
    },
  });

  const rows = await filterSubmissionsForCommissionerScope(
    [
      { id: "mb-1", dguid: "x4601", neighboring_dguid: null },
      { id: "on-1", dguid: "x3501", neighboring_dguid: null },
      { id: "nl-1", dguid: "x1001", neighboring_dguid: null },
    ],
    { province: "MB" },
  );

  assert.deepEqual(rows.map((row) => row.id), ["mb-1"]);
  assert.deepEqual(rows[0].scope_pruids, ["46"]);
});

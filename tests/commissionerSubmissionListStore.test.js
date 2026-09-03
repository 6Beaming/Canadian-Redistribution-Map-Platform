import assert from "node:assert/strict";
import { subDays, subMonths } from "date-fns";
import { test } from "@jest/globals";

import { filterCommissionerSubmissionsForTable } from "../src/lib/submissions/commissionerSubmissionListFilters.js";

test("table filters apply client-side on cached commissioner items", () => {
  const now = new Date();
  const recent = {
    id: "recent",
    type: "feedback",
    created_at: now.toISOString(),
    dissemination_areas: { community_name: "Toronto" },
  };
  const older = {
    id: "older",
    type: "feedback",
    created_at: subMonths(now, 2).toISOString(),
    dissemination_areas: { community_name: "Ottawa" },
  };

  const filtered = filterCommissionerSubmissionsForTable(
    [recent, older],
    {
      createdFrom: subDays(now, 30).toISOString().slice(0, 10),
      createdTo: now.toISOString().slice(0, 10),
      query: "tor",
    },
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "recent");
});

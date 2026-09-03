import assert from "node:assert/strict";
import { addDays, format, subMonths } from "date-fns";
import { test } from "@jest/globals";

import {
  COMMISSIONER_TABLE_DEFAULT_END_PAD_DAYS,
  createDefaultCommissionerTableFilters,
  filterCommissionerSubmissionsForTable,
} from "../src/lib/submissions/commissionerSubmissionListFilters.js";
import {
  CommissionerSubmissionListStore,
  isCommissionerListSurface,
} from "../src/lib/submissions/commissionerSubmissionListStore.js";

test("default commissioner filters pad the end date by two days and keep today visible", () => {
  const now = new Date();
  const defaults = createDefaultCommissionerTableFilters(now);
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

  assert.equal(
    format(defaults.dateEnd, "yyyy-MM-dd"),
    format(addDays(now, COMMISSIONER_TABLE_DEFAULT_END_PAD_DAYS), "yyyy-MM-dd"),
  );
  assert.equal(defaults.createdTo, format(defaults.dateEnd, "yyyy-MM-dd"));

  const filtered = filterCommissionerSubmissionsForTable(
    [recent, older],
    {
      createdFrom: defaults.createdFrom,
      createdTo: defaults.createdTo,
      query: "tor",
    },
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "recent");
});

test("commissioner list cache is only live on table and workspace surfaces", () => {
  assert.equal(isCommissionerListSurface("/dashboard"), false);
  assert.equal(isCommissionerListSurface("/dashboard/archivedTree"), false);
  assert.equal(isCommissionerListSurface("/dashboard/submissionsTable"), true);
  assert.equal(isCommissionerListSurface("/dashboard/graphs"), true);
  assert.equal(isCommissionerListSurface("/dashboard/workspace"), true);
  assert.equal(isCommissionerListSurface("/dashboard/workspace/submission-1"), true);
});

test("invalidate drops cached rows without bootstrapping", () => {
  const store = new CommissionerSubmissionListStore();
  store.invalidate();
  assert.deepEqual(store.getItems(), []);
  assert.equal(store.cache.fullyLoaded, false);
});

test("remote row upsert and delete patch the commissioner list cache", () => {
  const store = new CommissionerSubmissionListStore();
  store.upsertItem({ id: "row-1", created_at: new Date().toISOString(), status: "pending" });
  assert.equal(store.getItems()[0].id, "row-1");
  store.removeItem("row-1");
  assert.deepEqual(store.getItems(), []);
});

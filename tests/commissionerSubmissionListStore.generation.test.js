import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";

test("invalidate discards in-flight list pages so Home cannot keep a stale seed", async () => {
  jest.resetModules();

  let resolvePage;
  const pagePromise = new Promise((resolve) => {
    resolvePage = resolve;
  });

  jest.unstable_mockModule("../src/services/submissionListsApi.js", () => ({
    applyCommissionerStatusVisibility: (item) => item,
    getCommissionerSubmissionTableRows: jest.fn(() => pagePromise),
  }));

  const { CommissionerSubmissionListStore } = await import(
    "../src/lib/submissions/commissionerSubmissionListStore.js"
  );
  const store = new CommissionerSubmissionListStore();
  const boot = store.ensureBootstrapped();
  store.invalidate();
  resolvePage({
    items: [{ id: "stale", created_at: new Date().toISOString() }],
    page: { hasMore: false, nextCursor: null },
  });
  await boot;

  assert.deepEqual(store.getItems(), []);
});

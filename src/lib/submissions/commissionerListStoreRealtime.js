import { getCommissionerSubmissionListStore } from "@/lib/submissions/commissionerSubmissionListStore.js";
import { getRealtimeSubmissionId } from "@/lib/realtime/workspaceRealtime.js";
import {
  getWorkspaceSubmission,
  subscribeWorkspaceListState,
} from "@/services/workspaceApi.js";

/**
 * Keep the shared commissioner list store live for the whole Workspace layout
 * (tree + review). Refresh only on submission invalidation events — not on
 * focus/visibility recover, filter toggles, or tree remounts.
 */
export function subscribeCommissionerListStoreToWorkspaceEvents() {
  const store = getCommissionerSubmissionListStore();
  void store.ensureBootstrapped();

  return subscribeWorkspaceListState({
    onInvalidate: async ({ event, hints, resync }) => {
      const submissionId = getRealtimeSubmissionId({ event, hints });
      if (resync || !submissionId) {
        await store.reset({ notifyOnInvalidate: store.getItems().length === 0 });
        return;
      }

      if (event?.entity === "submission" && event.operation === "delete") {
        store.removeItem(submissionId);
        return;
      }

      const submission = await getWorkspaceSubmission(submissionId, { hydrateGeometry: false });
      if (submission) {
        store.upsertItem(submission);
      } else {
        store.removeItem(submissionId);
      }
    },
    // Focus/visibility must not re-seed the same workspace list.
    onRecover: () => {},
  });
}

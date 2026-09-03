import {
  applyCommissionerStatusVisibility,
  getCommissionerSubmissionTableRows,
} from "@/services/submissionListsApi.js";
import { buildCommissionerListFiltersKey } from "@/lib/submissions/commissionerListPaging.js";
import { SubmissionListPrefetchController } from "@/lib/submissions/submissionListPrefetch.js";

export class CommissionerListPrefetchController extends SubmissionListPrefetchController {
  constructor({ onUpdate } = {}) {
    super({
      fetchPage: getCommissionerSubmissionTableRows,
      mapItem: applyCommissionerStatusVisibility,
      buildFiltersKey: buildCommissionerListFiltersKey,
      onUpdate,
    });
  }
}

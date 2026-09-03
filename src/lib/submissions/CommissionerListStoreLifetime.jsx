import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  invalidateCommissionerSubmissionListStore,
  isCommissionerListSurface,
} from "@/lib/submissions/commissionerSubmissionListStore.js";

export function CommissionerListStoreLifetime() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (isCommissionerListSurface(pathname)) return;
    invalidateCommissionerSubmissionListStore();
  }, [pathname]);

  return null;
}

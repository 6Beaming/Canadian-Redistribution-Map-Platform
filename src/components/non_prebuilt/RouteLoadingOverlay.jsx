import { useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

// Fixed transition durations. Keep the full scale explicit so route timings can
// be tuned without coupling the animation to API, MapLibre, or React render
// completion.
const ROUTE_LOADING_DURATION_MS = Object.freeze({
  INSTANT: 100,
  BRIEF: 300,
  STANDARD: 500,
  EXTENDED: 1000,
  SUBMISSIONS: 2500,
  WORKSPACE: 2500,
  MAP_HANDOFF: 2000,
});

function isWorkspaceOrArchivePath(pathname) {
  return pathname.startsWith("/dashboard/workspace")
    || pathname.startsWith("/dashboard/archivedTree");
}

function isWorkspaceOrArchiveMapPath(pathname) {
  return /^\/dashboard\/workspace\/[^/]+$/.test(pathname)
    || /^\/dashboard\/archivedTree\/[^/]+\/difference$/.test(pathname);
}

function isSubmissionListPath(pathname) {
  return pathname === "/submissions"
    || pathname.startsWith("/submissions/")
    || pathname === "/dashboard/submissionsTable";
}

function getRouteLoadingDuration(fromPathname, toPathname) {
  // Workspace and Archived Tree use this handoff both before returning to the
  // Commissioner map and when a tree/list item opens its MapCanvas review or
  // archived-difference child page, regardless of request readiness.
  if (
    isWorkspaceOrArchivePath(fromPathname)
    && (toPathname === "/dashboard" || isWorkspaceOrArchiveMapPath(toPathname))
  ) {
    return ROUTE_LOADING_DURATION_MS.MAP_HANDOFF;
  }

  // Public My Submissions and Commissioner User Submissions always use the
  // same explicit list-loading treatment.
  if (isSubmissionListPath(toPathname)) {
    return ROUTE_LOADING_DURATION_MS.SUBMISSIONS;
  }

  // Entering the Workspace tree uses a separate, equally long transition. Map
  // review/difference child routes retain the dedicated 2000 ms map handoff.
  if (toPathname === "/dashboard/workspace") {
    return ROUTE_LOADING_DURATION_MS.WORKSPACE;
  }

  return 0;
}

/**
 * Fixed-duration navigation feedback for the explicitly selected Commissioner
 * transitions. It deliberately has no relationship with data fetch or map
 * readiness so page loading cannot extend or shorten the animation.
 */
export function RouteLoadingOverlay() {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const previousPathnameRef = useRef(location.pathname);
  const hasObservedInitialLocationRef = useRef(false);
  const timerRef = useRef(null);

  useLayoutEffect(() => {
    const fromPathname = previousPathnameRef.current;
    const toPathname = location.pathname;
    previousPathnameRef.current = toPathname;

    if (!hasObservedInitialLocationRef.current) {
      hasObservedInitialLocationRef.current = true;
      return undefined;
    }

    window.clearTimeout(timerRef.current);
    const duration = getRouteLoadingDuration(fromPathname, toPathname);

    if (!duration) {
      setIsVisible(false);
      return undefined;
    }

    setIsVisible(true);
    timerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      timerRef.current = null;
    }, duration);

    return () => window.clearTimeout(timerRef.current);
  }, [location.key, location.pathname]);

  if (!isVisible) return null;

  return (
    <div className="route-loading-overlay" role="status" aria-live="polite" aria-label="Loading page">
      <div className="route-loading-overlay__indicator">
        <span className="route-loading-overlay__spinner" aria-hidden="true" />
        <span>Loading page...</span>
      </div>
    </div>
  );
}

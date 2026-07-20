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
  SUBMISSION_TABLE: 1500,
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

  // The submissions table itself and its handoff into a Workspace review both
  // use the longer table-transition treatment.
  if (toPathname === "/dashboard/submissionsTable") {
    return ROUTE_LOADING_DURATION_MS.SUBMISSION_TABLE;
  }

  if (
    fromPathname === "/dashboard/submissionsTable"
    && toPathname.startsWith("/dashboard/workspace")
  ) {
    return ROUTE_LOADING_DURATION_MS.SUBMISSION_TABLE;
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

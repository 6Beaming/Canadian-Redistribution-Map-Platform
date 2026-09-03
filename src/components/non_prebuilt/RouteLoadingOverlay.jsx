import { useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRouteLoading } from "@/contexts/RouteLoadingContext.jsx";

// Fixed transition durations. MAP_HANDOFF uses a max cap but dismisses as soon as
// the destination page signals route readiness.
const ROUTE_LOADING_DURATION_MS = Object.freeze({
  INSTANT: 100,
  BRIEF: 300,
  STANDARD: 500,
  EXTENDED: 1000,
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

  // Public My Submissions, Commissioner User Submissions, and the Workspace tree
  // rely on page-level loaders and real request/cache completion instead of a
  // fixed-duration route overlay.
  if (isSubmissionListPath(toPathname) || toPathname === "/dashboard/workspace") {
    return 0;
  }

  return 0;
}

/**
 * Navigation feedback for data-heavy transitions. MAP_HANDOFF routes dismiss as
 * soon as the destination signals readiness, with MAP_HANDOFF ms as a fallback cap.
 */
export function RouteLoadingOverlay() {
  const location = useLocation();
  const routeLoading = useRouteLoading();
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
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setIsVisible(false);
      timerRef.current = null;
    };

    const isMapHandoff = duration === ROUTE_LOADING_DURATION_MS.MAP_HANDOFF;
    const unsubscribe = isMapHandoff && routeLoading?.subscribeRouteReady
      ? routeLoading.subscribeRouteReady(finish)
      : () => {};

    timerRef.current = window.setTimeout(finish, duration);

    return () => {
      finished = true;
      unsubscribe();
      window.clearTimeout(timerRef.current);
    };
  }, [location.key, location.pathname, routeLoading]);

  if (!isVisible) return null;

  return (
    <div className="route-loading-overlay" role="status" aria-live="polite" aria-label="Loading">
      <div className="route-loading-overlay__indicator">
        <span className="route-loading-overlay__spinner" aria-hidden="true" />
        <span>Loading...</span>
      </div>
    </div>
  );
}

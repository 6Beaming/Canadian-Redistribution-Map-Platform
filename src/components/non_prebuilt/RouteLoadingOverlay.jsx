import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

const ROUTE_LOADING_READY_EVENT = "crmp:route-loading-ready";
// Keep a brief transition cue without covering a page that has already
// completed its first render.
const MINIMUM_ROUTE_LOADING_MS = 100;
const DEFAULT_ROUTE_FAILSAFE_MS = 650;
const DATA_ROUTE_FAILSAFE_MS = 6000;

function isDataRoute(pathname) {
  return pathname === "/"
    || pathname === "/users"
    || pathname === "/dashboard"
    || pathname.startsWith("/dashboard/workspace")
    || pathname.startsWith("/dashboard/archivedTree");
}

/**
 * Marks the current route as ready after its first meaningful data render.
 * Data-heavy pages use this instead of relying on a guessed loading duration.
 */
export function notifyRouteReady() {
  window.dispatchEvent(new Event(ROUTE_LOADING_READY_EVENT));
}

/**
 * Global client-side route transition feedback. BrowserRouter ultimately uses
 * History API mutations for useNavigate(), so this also covers existing pages
 * without requiring each caller to adopt a custom navigation wrapper.
 */
export function RouteLoadingOverlay() {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const hasObservedInitialLocationRef = useRef(false);
  const transitionIdRef = useRef(0);
  const transitionStartedAtRef = useRef(0);
  const completionTimerRef = useRef(null);
  const failsafeTimerRef = useRef(null);

  const clearTransitionTimers = useCallback(() => {
    window.clearTimeout(completionTimerRef.current);
    window.clearTimeout(failsafeTimerRef.current);
    completionTimerRef.current = null;
    failsafeTimerRef.current = null;
  }, []);

  const finishTransition = useCallback((transitionId = transitionIdRef.current) => {
    if (transitionId !== transitionIdRef.current) return;

    window.clearTimeout(failsafeTimerRef.current);
    failsafeTimerRef.current = null;

    const remainingDuration = Math.max(
      0,
      MINIMUM_ROUTE_LOADING_MS - (Date.now() - transitionStartedAtRef.current),
    );

    window.clearTimeout(completionTimerRef.current);
    completionTimerRef.current = window.setTimeout(() => {
      if (transitionId === transitionIdRef.current) {
        setIsVisible(false);
      }
    }, remainingDuration);
  }, []);

  const beginTransition = useCallback((pathname = window.location.pathname) => {
    clearTransitionTimers();
    const transitionId = transitionIdRef.current + 1;
    transitionIdRef.current = transitionId;
    transitionStartedAtRef.current = Date.now();
    setIsVisible(true);

    const failsafeDuration = isDataRoute(pathname)
      ? DATA_ROUTE_FAILSAFE_MS
      : DEFAULT_ROUTE_FAILSAFE_MS;
    failsafeTimerRef.current = window.setTimeout(
      () => finishTransition(transitionId),
      failsafeDuration,
    );
  }, [clearTransitionTimers, finishTransition]);

  useEffect(() => {
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    function wrapHistoryMethod(method) {
      return function wrappedHistoryMethod(...args) {
        beginTransition();
        return method.apply(window.history, args);
      };
    }

    window.history.pushState = wrapHistoryMethod(originalPushState);
    window.history.replaceState = wrapHistoryMethod(originalReplaceState);
    const handlePopState = () => beginTransition(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    window.addEventListener(ROUTE_LOADING_READY_EVENT, finishTransition);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener(ROUTE_LOADING_READY_EVENT, finishTransition);
      clearTransitionTimers();
    };
  }, [beginTransition, clearTransitionTimers, finishTransition]);

  useEffect(() => {
    if (!hasObservedInitialLocationRef.current) {
      hasObservedInitialLocationRef.current = true;
      return;
    }

    // Covers router redirects and recalculates the fallback for the target
    // page (for example, a Workspace route gets the longer safety window).
    beginTransition(location.pathname);
  }, [beginTransition, location.key, location.pathname]);

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

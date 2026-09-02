import { createContext, useCallback, useContext, useMemo, useRef } from "react";

const RouteLoadingContext = createContext(null);

export function RouteLoadingProvider({ children }) {
  const readyListenersRef = useRef(new Set());

  const subscribeRouteReady = useCallback((listener) => {
    readyListenersRef.current.add(listener);
    return () => {
      readyListenersRef.current.delete(listener);
    };
  }, []);

  const signalRouteReady = useCallback(() => {
    for (const listener of readyListenersRef.current) {
      listener();
    }
  }, []);

  const value = useMemo(
    () => ({ subscribeRouteReady, signalRouteReady }),
    [subscribeRouteReady, signalRouteReady],
  );

  return (
    <RouteLoadingContext.Provider value={value}>
      {children}
    </RouteLoadingContext.Provider>
  );
}

export function useRouteLoading() {
  return useContext(RouteLoadingContext);
}

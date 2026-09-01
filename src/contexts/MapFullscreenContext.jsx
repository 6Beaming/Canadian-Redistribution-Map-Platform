import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";

const MapFullscreenContext = createContext(null);

export function MapFullscreenProvider({ children }) {
  const location = useLocation();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const returnFocusRef = useRef(null);
  const routeRef = useRef(location.pathname);

  const enter = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setIsFullscreen(true);
  }, []);

  const exit = useCallback(({ restoreFocus = true } = {}) => {
    setIsFullscreen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => returnFocusRef.current?.focus?.());
    }
  }, []);

  const toggle = useCallback(() => {
    setIsFullscreen((current) => {
      if (!current) {
        returnFocusRef.current = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      } else {
        window.requestAnimationFrame(() => returnFocusRef.current?.focus?.());
      }
      return !current;
    });
  }, []);

  useEffect(() => {
    if (routeRef.current !== location.pathname) {
      routeRef.current = location.pathname;
      setIsFullscreen(false);
      returnFocusRef.current = null;
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!isFullscreen) return undefined;

    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        exit();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
  }, [exit, isFullscreen]);

  const value = useMemo(() => ({
    enter,
    exit,
    isFullscreen,
    toggle,
  }), [enter, exit, isFullscreen, toggle]);

  return (
    <MapFullscreenContext.Provider value={value}>
      {children}
    </MapFullscreenContext.Provider>
  );
}

export function useMapFullscreen() {
  const value = useContext(MapFullscreenContext);
  if (!value) {
    throw new Error("useMapFullscreen must be used within MapFullscreenProvider.");
  }
  return value;
}

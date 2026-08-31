import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const TOGGLE_SIZE = 54;
const TOGGLE_DRAG_THRESHOLD = 2;
const MOBILE_MEDIA_QUERY = "(max-width: 576px)";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getMapRegionAnchor() {
  if (typeof window === "undefined") {
    return null;
  }

  const node = document.querySelector(".map-region-selector");
  if (!node) {
    return null;
  }

  const rect = node.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.bottom + 15,
  };
}

function getMobileFloatingWidth() {
  if (typeof window === "undefined") {
    return 320;
  }

  return window.innerWidth * 0.8;
}

function getDefaultFloatingState() {
  if (typeof window === "undefined") {
    return { x: 16, y: 132, width: 320 };
  }

  const width = getMobileFloatingWidth();
  const anchor = getMapRegionAnchor();

  if (!anchor) {
    return { x: 16, y: 132, width };
  }

  return {
    x: Math.min(anchor.x, window.innerWidth - width - 8),
    y: anchor.y,
    width,
  };
}

function clampToggleState(nextState) {
  if (typeof window === "undefined") {
    return nextState;
  }

  const minX = 8;
  const maxX = Math.max(minX, window.innerWidth - TOGGLE_SIZE - 8);
  const minY = 76;
  const maxY = Math.max(minY, window.innerHeight - TOGGLE_SIZE - 8);

  return {
    x: clamp(nextState.x, minX, maxX),
    y: clamp(nextState.y, minY, maxY),
  };
}

function getDefaultToggleState(floatingState = getDefaultFloatingState()) {
  const anchor = getMapRegionAnchor();

  if (anchor) {
    return clampToggleState(anchor);
  }

  return clampToggleState({
    x: floatingState.x,
    y: floatingState.y,
  });
}

export function MapInfoPanelShell({
  children,
  className = "",
  ariaLabel = "Map details",
  isOpen = true,
}) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 576,
  );
  const [floatingState, setFloatingState] = useState(() => getDefaultFloatingState());
  const [toggleState, setToggleState] = useState(() => getDefaultToggleState());
  const [isCollapsed, setIsCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 576,
  );
  const [isInteracting, setIsInteracting] = useState(false);
  const interactionRef = useRef(null);
  const suppressClickUntilRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handleChange = (event) => {
      setIsMobile(event.matches);
    };

    setIsMobile(mediaQuery.matches);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  useEffect(() => {
    if (!isMobile) {
      interactionRef.current = null;
      setIsCollapsed(false);
      setIsInteracting(false);
      return undefined;
    }

    const applyDefaults = () => {
      const nextFloatingState = getDefaultFloatingState();
      const nextToggleState = getDefaultToggleState(nextFloatingState);

      setFloatingState(nextFloatingState);
      setToggleState(nextToggleState);
      setIsCollapsed(true);
    };

    const animationFrame = window.requestAnimationFrame(applyDefaults);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) {
      return undefined;
    }

    const handleResize = () => {
      setFloatingState((current) => ({
        ...current,
        width: getMobileFloatingWidth(),
      }));
      setToggleState((current) => clampToggleState(current));
    };

    const animationFrame = window.requestAnimationFrame(handleResize);
    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
    };
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) {
      suppressClickUntilRef.current = 0;
      return undefined;
    }

    const suppressSyntheticClick = (event) => {
      if (performance.now() > suppressClickUntilRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("click", suppressSyntheticClick, true);

    return () => {
      window.removeEventListener("click", suppressSyntheticClick, true);
    };
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) {
      return undefined;
    }

    const handlePointerMove = (event) => {
      const interaction = interactionRef.current;

      if (!interaction) {
        return;
      }

      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;

      if (interaction.type === "toggle") {
        const hasMoved =
          interaction.moved ||
          Math.abs(deltaX) > TOGGLE_DRAG_THRESHOLD ||
          Math.abs(deltaY) > TOGGLE_DRAG_THRESHOLD;
        const nextState = clampToggleState({
          x: interaction.originX + deltaX,
          y: interaction.originY + deltaY,
        });

        interactionRef.current = {
          ...interaction,
          moved: hasMoved,
          currentX: nextState.x,
          currentY: nextState.y,
        };

        if (hasMoved) {
          setToggleState(nextState);
        }

        return;
      }

      interactionRef.current = {
        ...interaction,
        moved: true,
        currentX: interaction.originX + deltaX,
        currentY: interaction.originY + deltaY,
      };

      setFloatingState((current) => ({
        ...current,
        x: interaction.originX + deltaX,
        y: interaction.originY + deltaY,
      }));
    };

    const handlePointerUp = () => {
      const interaction = interactionRef.current;

      if (!interaction) {
        return;
      }

      if (interaction.type === "toggle" && !interaction.moved) {
        const width = getMobileFloatingWidth();

        suppressClickUntilRef.current = performance.now() + 360;
        setFloatingState((current) => ({
          ...current,
          x: interaction.originX,
          y: interaction.originY,
          width,
        }));
        setIsCollapsed(false);
      }

      interactionRef.current = null;
      setIsInteracting(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isMobile]);

  function beginDrag(event) {
    if (!isMobile) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsInteracting(true);
    interactionRef.current = {
      type: "drag",
      startX: event.clientX,
      startY: event.clientY,
      originX: floatingState.x,
      originY: floatingState.y,
      moved: false,
    };
  }

  function beginToggleInteraction(event) {
    if (!isMobile) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsInteracting(true);
    interactionRef.current = {
      type: "toggle",
      startX: event.clientX,
      startY: event.clientY,
      originX: toggleState.x,
      originY: toggleState.y,
      currentX: toggleState.x,
      currentY: toggleState.y,
      moved: false,
    };
  }

  function handleCollapse(event) {
    event.preventDefault();
    event.stopPropagation();
    suppressClickUntilRef.current = performance.now() + 360;
    setToggleState(
      clampToggleState({
        x: floatingState.x,
        y: floatingState.y,
      }),
    );
    setIsCollapsed(true);
  }

  const panelClassName = [
    "map-info-panel",
    isOpen ? "map-info-panel--open" : "",
    isMobile ? "map-info-panel--floating" : "",
    isMobile && isCollapsed ? "map-info-panel--collapsed" : "",
    isInteracting ? "map-info-panel--interacting" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <>
      {isMobile ? (
        <button
          type="button"
          className={`map-info-panel__floating-toggle${isCollapsed ? " map-info-panel__floating-toggle--visible" : ""}${isInteracting ? " map-info-panel__floating-toggle--interacting" : ""}`}
          aria-label="Open details panel"
          style={{
            left: `${toggleState.x}px`,
            top: `${toggleState.y}px`,
          }}
          onPointerDown={beginToggleInteraction}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      ) : null}

      <aside
        className={panelClassName}
        aria-label={ariaLabel}
        style={
          isMobile
            ? {
              left: `${floatingState.x}px`,
              top: `${floatingState.y}px`,
              width: `${floatingState.width}px`,
            }
            : undefined
        }
        onPointerDown={(event) => event.stopPropagation()}
      >
        {isMobile ? (
          <div className="map-info-panel__mobile-toolbar">
            <button
              type="button"
              className="map-info-panel__collapse-toggle"
              aria-label="Collapse details panel"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={handleCollapse}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="map-info-panel__drag-handle"
              aria-label="Drag details panel"
              onPointerDown={beginDrag}
            >
              <span className="map-info-panel__drag-pill" />
            </button>
          </div>
        ) : null}

        {children}
      </aside>
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import UserViewStatistics from "@/pages/UserViewStatistics.jsx";
import UserMakeComments from "@/pages/UserMakeComments.jsx";
import UserMakeObjection from "@/pages/UserMakeObjection.jsx";
import UserMakeCounterProposal from "@/pages/UserMakeCounterProposal.jsx";
import { CommissionerSubmissionCollections } from "@/components/non_prebuilt/CommissionerSubmissionCollections.jsx";
import {
  getRolloutAccentColor,
  getRolloutAreas,
  getRolloutCategory,
} from "@/lib/map/rolloutPlan.js";

const TOGGLE_SIZE = 54;
const TOGGLE_DRAG_THRESHOLD = 2;

export const USER_PANEL_VIEWS = [
  { id: "statistics", label: "View Statistics" },
  { id: "comments", label: "Make Comments" },
  { id: "objection", label: "Make an Objection to Boundaries" },
  { id: "counter-proposal", label: "Make a Counter-Proposal" },
];

export const COMMISSIONER_PANEL_VIEWS = [
  { id: "comments", label: "Comments" },
  { id: "boundaries-objections", label: "Boundaries Objections" },
  { id: "counter-proposal", label: "Counter-Proposal" },
];

export function getPanelViews(variant) {
  return variant === "commissioner" ? COMMISSIONER_PANEL_VIEWS : USER_PANEL_VIEWS;
}

export function getDefaultPanelView(variant) {
  return variant === "commissioner" ? "comments" : "statistics";
}

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

function RolloutCategoryPanel({ categoryId }) {
  const category = getRolloutCategory(categoryId);
  const areas = useMemo(() => getRolloutAreas(categoryId), [categoryId]);
  const [selectedFedNum, setSelectedFedNum] = useState(areas[0]?.fedNum ?? "");

  useEffect(() => {
    setSelectedFedNum(areas[0]?.fedNum ?? "");
  }, [areas]);

  const activeArea =
    areas.find((area) => area.fedNum === selectedFedNum) ??
    areas[0] ??
    null;

  return (
    <>
      <header className="map-info-panel__header">
        <h2 className="map-info-panel__title map-info-panel__title--centered">
          {category.label}
        </h2>
      </header>
      <div className="map-info-panel__body map-info-panel__body--stacked">
        <div
          className="map-info-panel__rollout-badge"
          style={{
            backgroundColor: getRolloutAccentColor(categoryId),
            borderColor: category.color,
            color: category.id === "planned-in-developing" ? "#7a6331" : category.color,
          }}
        >
          {category.description}
        </div>

        <label className="map-info-panel__field">
          <span className="map-info-panel__field-label">Areas</span>
          <select
            className="map-info-panel__select"
            value={selectedFedNum}
            onChange={(event) => setSelectedFedNum(event.target.value)}
          >
            {areas.map((area) => (
              <option key={area.fedNum} value={area.fedNum}>
                {area.name}
              </option>
            ))}
          </select>
        </label>

        {activeArea ? (
          <dl className="map-info-panel__details">
            <dt>Area count</dt>
            <dd>{areas.length}</dd>

            <dt>Focused area</dt>
            <dd>{activeArea.name}</dd>

            <dt>FED</dt>
            <dd>
              <code>{activeArea.fedNum}</code>
            </dd>

            <dt>Province / Territory</dt>
            <dd>{activeArea.provinceCode.toUpperCase()}</dd>
          </dl>
        ) : (
          <p className="map-info-panel__empty">No areas are available for this rollout state.</p>
        )}
      </div>
    </>
  );
}

export function MapInfoPanel({
  selection,
  profilesByDguid,
  panelView,
  variant = "user",
  rolloutEnabled = false,
  rolloutCategoryId,
}) {
  const hasSelection = Boolean(selection?.type);
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 576px)");
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
    setToggleState(
      clampToggleState({
        x: floatingState.x,
        y: floatingState.y,
      }),
    );
    setIsCollapsed(true);
  }

  function renderPanelContent() {
    if (rolloutEnabled && rolloutCategoryId) {
      return <RolloutCategoryPanel categoryId={rolloutCategoryId} />;
    }

    if (variant === "user") {
      if (!hasSelection) {
        return (
          <UserViewStatistics
            selection={selection}
            profilesByDguid={profilesByDguid}
          />
        );
      }

      switch (panelView) {
        case "comments":
          return (
            <div className="map-info-panel__embedded">
              <UserMakeComments />
            </div>
          );
        case "objection":
          return (
            <div className="map-info-panel__embedded">
              <UserMakeObjection />
            </div>
          );
        case "counter-proposal":
          return (
            <div className="map-info-panel__embedded">
              <UserMakeCounterProposal />
            </div>
          );
        case "statistics":
        default:
          return (
            <UserViewStatistics
              selection={selection}
              profilesByDguid={profilesByDguid}
            />
          );
      }
    }

    return (
      <CommissionerSubmissionCollections
        panelView={panelView}
        selection={selection}
        profilesByDguid={profilesByDguid}
      />
    );
  }

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
          onClick={(event) => event.stopPropagation()}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      ) : null}

      <aside
        className={`map-info-panel${hasSelection ? " map-info-panel--open" : ""}${isMobile ? " map-info-panel--floating" : ""}${isMobile && isCollapsed ? " map-info-panel--collapsed" : ""}${isInteracting ? " map-info-panel--interacting" : ""}`}
        aria-label="Map details"
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

        <div className="map-info-panel__content">{renderPanelContent()}</div>
      </aside>
    </>
  );
}

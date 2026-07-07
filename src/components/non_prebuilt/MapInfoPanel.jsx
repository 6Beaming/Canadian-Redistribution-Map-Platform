import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import UserViewStatistics from "@/pages/UserViewStatistics.jsx";
import UserMakeComments from "@/pages/UserMakeComments.jsx";
import UserMakeObjection from "@/pages/UserMakeObjection.jsx";
import UserMakeCounterProposal from "@/pages/UserMakeCounterProposal.jsx";
import { CommissionerSubmissionCollections } from "@/components/non_prebuilt/CommissionerSubmissionCollections.jsx";
import { MVP_FED_NUM } from "@/lib/map/constants.js";
import { getDaPanelTitle } from "@/lib/map/profileUtils.js";
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

function buildEffectedDaItems(profilesByDguid) {
  return Array.from(profilesByDguid.entries())
    .map(([dguid, profile]) => ({
      dguid,
      fedNum: MVP_FED_NUM,
      label: getDaPanelTitle(profile).text,
      sortLabel: String(profile?.panel_title || profile?.community_display || profile?.da_code || dguid),
      daCode: String(profile?.da_code || ""),
    }))
    .sort((left, right) => {
      const labelCompare = left.sortLabel.localeCompare(right.sortLabel, undefined, {
        numeric: true,
        sensitivity: "base",
      });

      if (labelCompare !== 0) {
        return labelCompare;
      }

      return left.daCode.localeCompare(right.daCode, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
}

function RolloutCategoryPanel({
  categoryId,
  profilesByDguid,
  onHoverTargetChange,
  onSelectTarget,
}) {
  const category = getRolloutCategory(categoryId);
  const areas = useMemo(() => getRolloutAreas(categoryId), [categoryId]);
  const effectedDaItems = useMemo(
    () => (categoryId === "effected" ? buildEffectedDaItems(profilesByDguid) : []),
    [categoryId, profilesByDguid],
  );
  const areaItems = useMemo(
    () =>
      areas.map((area) => ({
        ...area,
        daItems:
          categoryId === "effected" && area.fedNum === MVP_FED_NUM
            ? effectedDaItems
            : [],
      })),
    [areas, categoryId, effectedDaItems],
  );
  const [selectedFedNum, setSelectedFedNum] = useState(areaItems[0]?.fedNum ?? "");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [submenuFedNum, setSubmenuFedNum] = useState("");
  const pickerRef = useRef(null);
  const submenuModeRef = useRef("none");

  useEffect(() => {
    setSelectedFedNum(areaItems[0]?.fedNum ?? "");
  }, [areaItems]);

  useEffect(() => {
    if (!isMenuOpen) {
      setSubmenuFedNum("");
      submenuModeRef.current = "none";
      onHoverTargetChange?.(null);
      return undefined;
    }

    function handlePointerDown(event) {
      if (!pickerRef.current?.contains(event.target)) {
        setIsMenuOpen(false);
        setSubmenuFedNum("");
        submenuModeRef.current = "none";
        onHoverTargetChange?.(null);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        setSubmenuFedNum("");
        submenuModeRef.current = "none";
        onHoverTargetChange?.(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen, onHoverTargetChange]);

  useEffect(() => {
    return () => {
      onHoverTargetChange?.(null);
    };
  }, [onHoverTargetChange]);

  const activeArea =
    areaItems.find((area) => area.fedNum === selectedFedNum) ??
    areaItems[0] ??
    null;

  function handleFedHover(area) {
    setSelectedFedNum(area.fedNum);
    submenuModeRef.current = area.daItems.length ? "hover" : "none";
    setSubmenuFedNum(area.daItems.length ? area.fedNum : "");
    onHoverTargetChange?.({
      type: "fed",
      fedNum: area.fedNum,
      fedName: area.name,
    });
  }

  function handleFedSelect(area) {
    setSelectedFedNum(area.fedNum);
    setIsMenuOpen(false);
    setSubmenuFedNum("");
    submenuModeRef.current = "none";
    onHoverTargetChange?.(null);
    onSelectTarget?.({
      type: "fed",
      fedNum: area.fedNum,
      fedName: area.name,
    });
  }

  function handleFedItemClick(area) {
    setSelectedFedNum(area.fedNum);

    if (area.daItems.length) {
      if (submenuFedNum !== area.fedNum) {
        submenuModeRef.current = "locked";
        setSubmenuFedNum(area.fedNum);
        onHoverTargetChange?.({
          type: "fed",
          fedNum: area.fedNum,
          fedName: area.name,
        });
        return;
      }

      if (submenuModeRef.current === "hover") {
        submenuModeRef.current = "locked";
        setSubmenuFedNum(area.fedNum);
        onHoverTargetChange?.({
          type: "fed",
          fedNum: area.fedNum,
          fedName: area.name,
        });
        return;
      }

      if (submenuModeRef.current === "locked") {
        handleFedSelect(area);
        return;
      }
    }

    handleFedSelect(area);
  }

  function handleDaSelect(dguid) {
    setIsMenuOpen(false);
    setSubmenuFedNum("");
    submenuModeRef.current = "none";
    onHoverTargetChange?.(null);
    onSelectTarget?.({
      type: "da",
      dguid,
    });
  }

  return (
    <>
      <header className="map-info-panel__header">
        <h2 className="map-info-panel__title map-info-panel__title--centered">
          {category.label}
        </h2>
      </header>
      <div className="map-info-panel__body map-info-panel__body--stacked map-info-panel__body--rollout">
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
          <div ref={pickerRef} className="map-info-panel__area-picker">
            <button
              type="button"
              className={`map-info-panel__area-trigger${isMenuOpen ? " map-info-panel__area-trigger--open" : ""}`}
              onClick={() => setIsMenuOpen((current) => !current)}
            >
              <span>{activeArea?.name ?? "Select Area"}</span>
              <ChevronDown className="h-4 w-4" />
            </button>

            {isMenuOpen ? (
              <div className="map-info-panel__area-menu">
                {areaItems.map((area) => (
                  <div
                    key={area.fedNum}
                    className="map-info-panel__area-item-wrap"
                    onMouseEnter={() => handleFedHover(area)}
                    onMouseLeave={() => {
                      submenuModeRef.current = "none";
                      setSubmenuFedNum("");
                      onHoverTargetChange?.(null);
                    }}
                  >
                    <button
                      type="button"
                      className={`map-info-panel__area-item${selectedFedNum === area.fedNum ? " map-info-panel__area-item--active" : ""}`}
                      onClick={() => handleFedItemClick(area)}
                    >
                      <span>{area.name}</span>
                      {area.daItems.length ? <ChevronLeft className="h-4 w-4" /> : null}
                    </button>

                    {area.daItems.length && submenuFedNum === area.fedNum ? (
                      <div className="map-info-panel__area-submenu">
                        {area.daItems.map((da) => (
                          <button
                            key={da.dguid}
                            type="button"
                            className="map-info-panel__area-subitem"
                            onMouseEnter={() =>
                              onHoverTargetChange?.({
                                type: "da",
                                dguid: da.dguid,
                              })
                            }
                            onMouseLeave={() =>
                              onHoverTargetChange?.({
                                type: "fed",
                                fedNum: area.fedNum,
                                fedName: area.name,
                              })
                            }
                            onClick={() => handleDaSelect(da.dguid)}
                          >
                            {da.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </label>

        {activeArea ? (
          <dl className="map-info-panel__details">
            <dt>Area count</dt>
            <dd>{areaItems.length}</dd>

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
  onRolloutHoverChange,
  onRolloutSelect,
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
  const suppressClickUntilRef = useRef(0);

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

  function renderPanelContent() {
    if (rolloutEnabled && rolloutCategoryId) {
      return (
        <RolloutCategoryPanel
          categoryId={rolloutCategoryId}
          profilesByDguid={profilesByDguid}
          onHoverTargetChange={onRolloutHoverChange}
          onSelectTarget={onRolloutSelect}
        />
      );
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
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
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

        <div className="map-info-panel__content">{renderPanelContent()}</div>
      </aside>
    </>
  );
}

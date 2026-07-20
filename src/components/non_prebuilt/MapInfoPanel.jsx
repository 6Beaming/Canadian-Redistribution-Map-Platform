import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  GitCompareArrows,
  MessageSquareText,
} from "lucide-react";
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
  isDataBlockedFed,
} from "@/lib/map/rolloutPlan.js";

const TOGGLE_SIZE = 54;
const TOGGLE_DRAG_THRESHOLD = 2;

export const USER_PANEL_VIEWS = [
  { id: "statistics", label: "View Statistics" },
  { id: "comments", label: "Write a Comment" },
  { id: "objection", label: "File Boundary Objection" },
  { id: "counter-proposal", label: "Draw Counter-Proposal" },
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

const PANEL_VIEW_ICONS = {
  statistics: BarChart3,
  comments: MessageSquareText,
  objection: Flag,
  "boundaries-objections": Flag,
  "counter-proposal": GitCompareArrows,
};

function PanelModeSelector({ activeView, onViewChange, variant, workflowLocked = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef(null);
  const views = getPanelViews(variant);
  const activeOption =
    views.find((view) => view.id === activeView) ?? views[0];
  const ActiveIcon = PANEL_VIEW_ICONS[activeOption.id];

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!selectorRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (workflowLocked) {
      setIsOpen(false);
    }
  }, [workflowLocked]);

  function handleSelect(nextView) {
    if (workflowLocked) return;
    setIsOpen(false);
    onViewChange?.(nextView);
  }

  return (
    <div className="map-info-panel__mode-selector">
      <div ref={selectorRef} className="map-info-panel__mode-control relative">
        <button
          type="button"
          className="map-info-panel__mode-trigger"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label={workflowLocked ? "Workflow selector is locked until you return to step 1" : undefined}
          disabled={workflowLocked}
          title={workflowLocked ? "Use the workflow's Back controls to return to step 1 before changing activities." : undefined}
          onClick={() => setIsOpen((current) => !current)}
        >
          <ActiveIcon className="map-info-panel__mode-icon" aria-hidden="true" />
          <span>{activeOption.label}</span>
          <ChevronDown
            className={`map-info-panel__mode-chevron${isOpen ? " map-info-panel__mode-chevron--open" : ""}`}
            aria-hidden="true"
          />
        </button>

        {isOpen && !workflowLocked ? (
          <div
            className="map-info-panel__mode-menu absolute left-0 top-full z-20 w-full"
            role="menu"
            aria-label="Choose workflow mode"
          >
            {views.filter((view) => view.id !== activeOption.id).map(
              (view) => {
                const Icon = PANEL_VIEW_ICONS[view.id];

                return (
                  <button
                    key={view.id}
                    type="button"
                    role="menuitem"
                    className="map-info-panel__mode-option"
                    onClick={() => handleSelect(view.id)}
                  >
                    <Icon className="map-info-panel__mode-icon" aria-hidden="true" />
                    <span>{view.label}</span>
                  </button>
                );
              },
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
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

function buildEnabledDaItemsByFed(profilesByDguid) {
  const itemsByFed = new Map();

  Array.from(profilesByDguid.entries()).forEach(([dguid, profile]) => {
    const fedNum = String(profile?.fed_num || MVP_FED_NUM);
    const items = itemsByFed.get(fedNum) ?? [];
    const panelTitle = getDaPanelTitle(profile);
    const daCode = String(profile?.da_code || "").trim();
    const menuLabel = panelTitle.text.startsWith("Unnamed DA: DA ")
      ? `DA ${daCode || dguid}`
      : panelTitle.text;
    items.push({
      dguid,
      fedNum,
      label: menuLabel,
      sortLabel: String(
        profile?.panel_title || profile?.community_display || profile?.geo_name || profile?.da_code || dguid,
      ),
      daCode,
    });
    itemsByFed.set(fedNum, items);
  });

  itemsByFed.forEach((items, fedNum) => {
    items.sort((left, right) => {
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

    itemsByFed.set(fedNum, items);
  });

  return itemsByFed;
}

function RolloutCategoryPanel({
  categoryId,
  profilesByDguid,
  onHoverTargetChange,
  onSelectTarget,
}) {
  const category = getRolloutCategory(categoryId);
  const areas = useMemo(() => getRolloutAreas(categoryId), [categoryId]);
  const enabledDaItemsByFed = useMemo(
    () => (categoryId === "enabled" ? buildEnabledDaItemsByFed(profilesByDguid) : new Map()),
    [categoryId, profilesByDguid],
  );
  const areaItems = useMemo(
    () =>
      areas.map((area) => ({
        ...area,
        daItems: categoryId === "enabled" ? enabledDaItemsByFed.get(String(area.fedNum)) ?? [] : [],
      })),
    [areas, categoryId, enabledDaItemsByFed],
  );
  const [selectedFedNum, setSelectedFedNum] = useState(areaItems[0]?.fedNum ?? "");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [submenuFedNum, setSubmenuFedNum] = useState("");
  const [submenuAnchor, setSubmenuAnchor] = useState(null);
  const pickerRef = useRef(null);
  const submenuModeRef = useRef("none");

  useEffect(() => {
    setSelectedFedNum(areaItems[0]?.fedNum ?? "");
  }, [areaItems]);

  useEffect(() => {
    if (!isMenuOpen) {
      setSubmenuFedNum("");
      setSubmenuAnchor(null);
      submenuModeRef.current = "none";
      onHoverTargetChange?.(null);
      return undefined;
    }

    function handlePointerDown(event) {
      if (!pickerRef.current?.contains(event.target)) {
        setIsMenuOpen(false);
        setSubmenuFedNum("");
        setSubmenuAnchor(null);
        submenuModeRef.current = "none";
        onHoverTargetChange?.(null);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        setSubmenuFedNum("");
        setSubmenuAnchor(null);
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

  const submenuArea =
    areaItems.find((area) => area.fedNum === submenuFedNum && area.daItems.length) ?? null;

  function updateSubmenuAnchor(anchorNode) {
    if (typeof window === "undefined" || !anchorNode) {
      setSubmenuAnchor(null);
      return;
    }

    const rect = anchorNode.getBoundingClientRect();
    const width = 240;
    const gap = 10;
    const maxHeight = Math.min(320, Math.max(160, window.innerHeight - rect.top - 20));
    const top = Math.min(rect.top, Math.max(8, window.innerHeight - maxHeight - 8));
    const left = Math.max(8, rect.left - width - gap);

    setSubmenuAnchor({
      top,
      left,
      width,
      maxHeight,
    });
  }

  function handleFedHover(area, anchorNode) {
    setSelectedFedNum(area.fedNum);
    submenuModeRef.current = area.daItems.length ? "hover" : "none";
    setSubmenuFedNum(area.daItems.length ? area.fedNum : "");
    updateSubmenuAnchor(area.daItems.length ? anchorNode : null);
    if (!area.daItems.length) {
      onHoverTargetChange?.({
        type: "fed",
        fedNum: area.fedNum,
        fedName: area.name,
      });
    } else {
      onHoverTargetChange?.(null);
    }
  }

  function handleFedItemLeave(area, event) {
    const relatedTarget = event.relatedTarget;

    if (
      submenuModeRef.current === "locked" &&
      submenuFedNum === area.fedNum
    ) {
      return;
    }

    if (relatedTarget && pickerRef.current?.contains(relatedTarget)) {
      return;
    }

    submenuModeRef.current = "none";
    setSubmenuFedNum("");
    setSubmenuAnchor(null);
    onHoverTargetChange?.(null);
  }

  function handleFedSelect(area) {
    setSelectedFedNum(area.fedNum);
    setIsMenuOpen(false);
    setSubmenuFedNum("");
    setSubmenuAnchor(null);
    submenuModeRef.current = "none";
    onHoverTargetChange?.(null);
    onSelectTarget?.({
      type: "fed",
      fedNum: area.fedNum,
      fedName: area.name,
    });
  }

  function handleFedItemClick(area, anchorNode) {
    setSelectedFedNum(area.fedNum);

    if (area.daItems.length) {
      updateSubmenuAnchor(anchorNode);

      if (submenuFedNum !== area.fedNum) {
        submenuModeRef.current = "locked";
        setSubmenuFedNum(area.fedNum);
        onHoverTargetChange?.(null);
        return;
      }

      if (submenuModeRef.current === "hover") {
        submenuModeRef.current = "locked";
        setSubmenuFedNum(area.fedNum);
        onHoverTargetChange?.(null);
        return;
      }

      if (submenuModeRef.current === "locked") {
        submenuModeRef.current = "none";
        setSubmenuFedNum("");
        setSubmenuAnchor(null);
        onHoverTargetChange?.(null);
        return;
      }
    }

    handleFedSelect(area);
  }

  function handleDaSelect(dguid) {
    setIsMenuOpen(false);
    setSubmenuFedNum("");
    setSubmenuAnchor(null);
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
            color: category.id === "data-blocked" ? "#7a6331" : category.color,
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
                    onMouseEnter={(event) => handleFedHover(area, event.currentTarget)}
                    onMouseLeave={(event) => handleFedItemLeave(area, event)}
                  >
                    <button
                      type="button"
                      className={`map-info-panel__area-item${selectedFedNum === area.fedNum ? " map-info-panel__area-item--active" : ""}`}
                      onClick={(event) => handleFedItemClick(area, event.currentTarget)}
                    >
                      <span>{area.name}</span>
                      {area.daItems.length ? <ChevronLeft className="h-4 w-4" /> : null}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {isMenuOpen && submenuArea && submenuAnchor ? (
              <div
                className="map-info-panel__area-submenu map-info-panel__area-submenu--floating"
                style={{
                  top: `${submenuAnchor.top}px`,
                  left: `${submenuAnchor.left}px`,
                  width: `${submenuAnchor.width}px`,
                  maxHeight: `${submenuAnchor.maxHeight}px`,
                }}
                onMouseEnter={() => {
                  submenuModeRef.current = "locked";
                  setSubmenuFedNum(submenuArea.fedNum);
                }}
              >
                {submenuArea.daItems.map((da) => (
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
                        fedNum: submenuArea.fedNum,
                        fedName: submenuArea.name,
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

function DataBlockedFedPanel({ fedNum, fedName }) {
  return (
    <>
      <header className="map-info-panel__header">
        <h2 className="map-info-panel__title map-info-panel__title--centered">
          {fedName || `FED ${fedNum}`}
        </h2>
      </header>
      <div className="map-info-panel__body map-info-panel__body--stacked">
        <section className="map-info-panel__blocked-notice" role="status">
          <h3>Data currently blocked</h3>
          <p>
            DA-level data for this federal electoral district is not currently
            available. Use the Toggle in the upper-left corner to view areas
            with active data.
          </p>
        </section>
      </div>
    </>
  );
}

export function MapInfoPanel({
  selection,
  profilesByDguid,
  panelView,
  onPanelViewChange,
  variant = "user",
  rolloutEnabled = false,
  rolloutCategoryId,
  objectionGeometryIndex,
  objectionWorkflow,
  onObjectionBackStep,
  onObjectionConfirmReview,
  counterProposalWorkflow,
  onCounterProposalBackStep,
  onCounterProposalConfirmEdit,
  onRolloutHoverChange,
  onRolloutSelect,
}) {
  const hasSelection = Boolean(selection?.type);
  const isDataBlockedFedSelection =
    selection?.type === "fed" && isDataBlockedFed(selection.fedNum);
  const isWorkflowSelectorLocked =
    variant === "user" && (
      (panelView === "objection" && (objectionWorkflow?.step ?? 1) >= 2)
      || (panelView === "counter-proposal" && (counterProposalWorkflow?.step ?? 1) >= 2)
    );
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

    const profile = profilesByDguid.get(selection?.dguid);

    const dguid = selection?.dguid;
    const fedNum = profile?.fed_num;

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

    if (isDataBlockedFedSelection) {
      return <DataBlockedFedPanel fedNum={selection.fedNum} fedName={selection.fedName} />;
    }

    if (variant === "user") {
      if (!hasSelection && panelView === "statistics") {
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
              <UserMakeComments
                proposalId={null}
                fedNum={selection?.fedNum ?? fedNum}
                dguid={dguid}
                daName={profile ? getDaPanelTitle(profile).text : ""}
                hasSelection={hasSelection}
              />
            </div>
          );
        case "objection":
          return (
            <div className="map-info-panel__embedded">
              <UserMakeObjection
              proposalId={null}
                fedNum={fedNum}
                dguid={objectionWorkflow?.firstDguid ?? dguid}
                neighboring_dguid={objectionWorkflow?.secondDguid ?? null}
                onBackStep={onObjectionBackStep}
                onConfirmReview={onObjectionConfirmReview}
                profilesByDguid={profilesByDguid}
                workflow={objectionWorkflow}
              />
            </div>
          );
        case "counter-proposal":
          return (
            <div className="map-info-panel__embedded">
              <UserMakeCounterProposal
                geometryIndex={objectionGeometryIndex}
                onBackStep={onCounterProposalBackStep}
                onConfirmEdit={onCounterProposalConfirmEdit}
                profilesByDguid={profilesByDguid}
                workflow={counterProposalWorkflow}
              />
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

        {!isDataBlockedFedSelection ? (
          <PanelModeSelector
            activeView={panelView}
            onViewChange={onPanelViewChange}
            variant={variant}
            workflowLocked={isWorkflowSelectorLocked}
          />
        ) : null}

        <div className="map-info-panel__content">{renderPanelContent()}</div>
      </aside>
    </>
  );
}

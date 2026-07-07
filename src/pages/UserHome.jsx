import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HorizontalTabs } from "@/components/ui/horizontal-tabs";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { MapInfoPanel, getDefaultPanelView, getPanelViews } from "@/components/non_prebuilt/MapInfoPanel.jsx";
import { MapRegionSelector } from "@/components/non_prebuilt/MapRegionSelector.jsx";
import UserMenuLeft from "@/components/non_prebuilt/UserMenuLeft.jsx";
import {
  areDaNeighbours,
  buildDaObjectionIndex,
  emptyBoundaryFeatureCollection,
  getSharedBoundaryFeatureCollection,
} from "@/lib/map/objectionWorkflow.js";
import {
  buildCounterProposalCache,
  clearCounterProposalStorage,
  commitCounterProposalCacheHistory,
  createInitialCounterProposalWorkflow,
  emptyCounterProposalFeatureCollection,
  previewCounterProposalHandleMove,
  redoCounterProposalCache,
  selectCounterProposalHandle,
  undoCounterProposalCache,
  writeCounterProposalStorage,
} from "@/lib/map/counterProposalWorkflow.js";
import { DEFAULT_ROLLOUT_CATEGORY_ID } from "@/lib/map/rolloutPlan.js";
import { mapApi } from "@/services/mapApi.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import "@/styles/map.css";

function createInitialObjectionWorkflow(overrides = {}) {
  return {
    step: 1,
    firstDguid: null,
    secondDguid: null,
    boundaryGeoJson: emptyBoundaryFeatureCollection(),
    error: "",
    ...overrides,
  };
}

export default function UserHome() {
  const [status, setStatus] = useState("Loading map...");
  const [selection, setSelection] = useState(null);
  const [rolloutHoverSelection, setRolloutHoverSelection] = useState(null);
  const [profilesByDguid, setProfilesByDguid] = useState(new Map());
  const [objectionGeometryIndex, setObjectionGeometryIndex] = useState(null);
  const [objectionWorkflow, setObjectionWorkflow] = useState(() =>
    createInitialObjectionWorkflow(),
  );
  const [counterProposalWorkflow, setCounterProposalWorkflow] = useState(() =>
    createInitialCounterProposalWorkflow(),
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelView, setPanelView] = useState(getDefaultPanelView("user"));
  const [isRolloutOpen, setIsRolloutOpen] = useState(false);
  const [rolloutCategoryId, setRolloutCategoryId] = useState(DEFAULT_ROLLOUT_CATEGORY_ID);
  const counterProposalDragFrameRef = useRef(0);
  const pendingCounterProposalDragRef = useRef(null);
  const views = useMemo(() => getPanelViews("user"), []);
  const tabItems = useMemo(
    () =>
      views.map((item) => ({
        ...item,
        disabled:
          !selection &&
          item.id !== "statistics" &&
          item.id !== "comments" &&
          item.id !== "objection" &&
          item.id !== "counter-proposal",
      })),
    [selection, views],
  );

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      mapApi.getDaProfiles(),
      mapApi.fetchAssetJson("single_fed_das.geojson"),
    ])
      .then(([payload, daGeojson]) => {
        if (!isMounted) {
          return;
        }

        const { index } = buildProfileIndex(payload);
        setProfilesByDguid(index);
        setObjectionGeometryIndex(buildDaObjectionIndex(daGeojson));
      })
      .catch((error) => {
        if (isMounted) {
          setStatus(`Error: ${error.message}`);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  useEffect(() => {
    clearCounterProposalStorage();

    function handleBeforeUnload() {
      clearCounterProposalStorage();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearCounterProposalStorage();
    };
  }, []);

  useEffect(() => {
    if (counterProposalWorkflow.dragBaselineSnapshot) {
      return;
    }

    writeCounterProposalStorage(counterProposalWorkflow);
  }, [counterProposalWorkflow]);

  useEffect(() => () => {
    if (counterProposalDragFrameRef.current) {
      window.cancelAnimationFrame(counterProposalDragFrameRef.current);
      counterProposalDragFrameRef.current = 0;
    }
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!isRolloutOpen) {
      setRolloutHoverSelection(null);
    }
  }, [isRolloutOpen]);

  const handleDaSelect = useCallback((dguid) => {
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);

    if (panelView === "objection") {
      let nextSelection = null;

      setObjectionWorkflow((current) => {
        if (current.step === 1 || !current.firstDguid) {
          nextSelection = { type: "da", dguid };
          return createInitialObjectionWorkflow({
            step: 2,
            firstDguid: dguid,
          });
        }

        if (current.step === 2) {
          nextSelection = { type: "da", dguid };

          if (
            !objectionGeometryIndex ||
            current.firstDguid === dguid ||
            !areDaNeighbours(objectionGeometryIndex, current.firstDguid, dguid)
          ) {
            return createInitialObjectionWorkflow({
              error:
                "The second DA must be adjacent to the first one. Please select the first DA again.",
            });
          }

          return createInitialObjectionWorkflow({
            step: 3,
            firstDguid: current.firstDguid,
            secondDguid: dguid,
            boundaryGeoJson: getSharedBoundaryFeatureCollection(
              objectionGeometryIndex,
              current.firstDguid,
              dguid,
            ),
          });
        }

        return current;
      });

      if (nextSelection) {
        setSelection(nextSelection);
      }
      return;
    }

    if (panelView === "counter-proposal") {
      let nextSelection = null;

      setCounterProposalWorkflow((current) => {
        if (current.step === 1 || !current.firstDguid) {
          nextSelection = { type: "da", dguid };
          return createInitialCounterProposalWorkflow({
            step: 2,
            firstDguid: dguid,
            previewMode: "proposal",
          });
        }

        if (current.step === 2) {
          nextSelection = { type: "da", dguid };

          if (
            !objectionGeometryIndex ||
            current.firstDguid === dguid ||
            !areDaNeighbours(objectionGeometryIndex, current.firstDguid, dguid)
          ) {
            return createInitialCounterProposalWorkflow({
              error:
                "The second DA must be adjacent to the first one. Please select the first DA again.",
            });
          }

          const cache = buildCounterProposalCache(
            objectionGeometryIndex,
            profilesByDguid,
            current.firstDguid,
            dguid,
          );

          return createInitialCounterProposalWorkflow({
            step: 3,
            firstDguid: current.firstDguid,
            secondDguid: dguid,
            previewMode: "proposal",
            cache,
          });
        }

        return current;
      });

      if (nextSelection) {
        setSelection(nextSelection);
      }
      return;
    }

    setSelection({ type: "da", dguid });
  }, [objectionGeometryIndex, panelView, profilesByDguid]);

  const handleFedSelect = useCallback((fedNum, fedName) => {
    setSelection({ type: "fed", fedNum, fedName });
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);
  }, []);

  const handleStatusChange = useCallback((message) => {
    setStatus(message);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((current) => !current);
  }, []);

  const handleRolloutHoverChange = useCallback((nextHoverSelection) => {
    setRolloutHoverSelection(nextHoverSelection);
  }, []);

  const handleRolloutSelect = useCallback((nextSelection) => {
    setSelection(nextSelection);
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);
  }, []);

  const handleObjectionBackStep = useCallback(() => {
    setObjectionWorkflow((current) => {
      if (current.step <= 1) {
        return createInitialObjectionWorkflow();
      }

      if (current.step === 2) {
        return createInitialObjectionWorkflow();
      }

      if (current.step === 3) {
        return createInitialObjectionWorkflow({
          step: 2,
          firstDguid: current.firstDguid,
        });
      }

      return createInitialObjectionWorkflow({
        step: 3,
        firstDguid: current.firstDguid,
        secondDguid: current.secondDguid,
        boundaryGeoJson: current.boundaryGeoJson,
      });
    });
  }, []);

  const handleObjectionConfirmReview = useCallback(() => {
    setObjectionWorkflow((current) => {
      if (current.step !== 3 || !current.firstDguid || !current.secondDguid) {
        return current;
      }

      return {
        ...current,
        step: 4,
      };
    });
  }, []);

  const handleCounterProposalBackStep = useCallback(() => {
    setCounterProposalWorkflow((current) => {
      if (current.step <= 1) {
        return createInitialCounterProposalWorkflow();
      }

      if (current.step === 2) {
        return createInitialCounterProposalWorkflow();
      }

      if (current.step === 3) {
        return createInitialCounterProposalWorkflow({
          step: 2,
          firstDguid: current.firstDguid,
          previewMode: "proposal",
        });
      }

      if (current.step === 4) {
        return {
          ...current,
          step: 3,
          previewMode: "proposal",
        };
      }

      if (current.step === 5) {
        return {
          ...current,
          step: 4,
          previewMode: "proposal",
        };
      }

      return {
        ...current,
        step: 5,
      };
    });
  }, []);

  const handleCounterProposalConfirmCache = useCallback(() => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache || current.step !== 3) {
        return current;
      }

      return {
        ...current,
        step: 4,
        previewMode: "proposal",
      };
    });
  }, []);

  const handleCounterProposalConfirmEdit = useCallback(() => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache || current.step !== 4) {
        return current;
      }

      return {
        ...current,
        step: 5,
      };
    });
  }, []);

  const handleCounterProposalConfirmPreview = useCallback(() => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache || current.step !== 5) {
        return current;
      }

      return {
        ...current,
        step: 6,
      };
    });
  }, []);

  const handleCounterProposalSelectHandle = useCallback((handleId) => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache) {
        return current;
      }

      return {
        ...current,
        cache: selectCounterProposalHandle(current.cache, handleId),
      };
    });
  }, []);

  const handleCounterProposalDragStart = useCallback((handleId) => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache) {
        return current;
      }

      const nextCache = selectCounterProposalHandle(current.cache, handleId);

      return {
        ...current,
        cache: nextCache,
        dragBaselineSnapshot: nextCache.currentFeatures,
      };
    });
  }, []);

  const handleCounterProposalDragMove = useCallback((handleId, nextCoordinate) => {
    pendingCounterProposalDragRef.current = {
      handleId,
      nextCoordinate,
    };

    if (counterProposalDragFrameRef.current) {
      return;
    }

    counterProposalDragFrameRef.current = window.requestAnimationFrame(() => {
      counterProposalDragFrameRef.current = 0;
      const pending = pendingCounterProposalDragRef.current;
      pendingCounterProposalDragRef.current = null;

      if (!pending) {
        return;
      }

      setCounterProposalWorkflow((current) => {
        if (!current.cache) {
          return current;
        }

        return {
          ...current,
          cache: previewCounterProposalHandleMove(
            current.cache,
            pending.handleId,
            pending.nextCoordinate,
          ),
        };
      });
    });
  }, []);

  const handleCounterProposalDragEnd = useCallback(() => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache) {
        return current;
      }

      let nextCache = current.cache;
      const pending = pendingCounterProposalDragRef.current;

      if (counterProposalDragFrameRef.current) {
        window.cancelAnimationFrame(counterProposalDragFrameRef.current);
        counterProposalDragFrameRef.current = 0;
      }

      pendingCounterProposalDragRef.current = null;

      if (pending) {
        nextCache = previewCounterProposalHandleMove(
          nextCache,
          pending.handleId,
          pending.nextCoordinate,
        );
      }

      return {
        ...current,
        cache: commitCounterProposalCacheHistory(
          nextCache,
          current.dragBaselineSnapshot,
        ),
        dragBaselineSnapshot: null,
      };
    });
  }, []);

  const handleCounterProposalUndo = useCallback(() => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache) {
        return current;
      }

      return {
        ...current,
        cache: undoCounterProposalCache(current.cache),
      };
    });
  }, []);

  const handleCounterProposalRedo = useCallback(() => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache) {
        return current;
      }

      return {
        ...current,
        cache: redoCounterProposalCache(current.cache),
      };
    });
  }, []);

  const handleCounterProposalPreviewModeChange = useCallback((nextPreviewMode) => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache) {
        return current;
      }

      return {
        ...current,
        previewMode: nextPreviewMode === "original" ? "original" : "proposal",
      };
    });
  }, []);

  const objectionPreview = useMemo(() => {
    if (panelView !== "objection" || objectionWorkflow.step < 3) {
      return null;
    }

    return {
      boundaryGeoJson: objectionWorkflow.boundaryGeoJson,
    };
  }, [objectionWorkflow.boundaryGeoJson, objectionWorkflow.step, panelView]);

  const counterProposalPreview = useMemo(() => {
    if (panelView !== "counter-proposal" || !counterProposalWorkflow.cache) {
      return null;
    }

    const showProposal = counterProposalWorkflow.previewMode === "proposal";
    const showEditor = showProposal && counterProposalWorkflow.step >= 4;

    return {
      featureCollection: showProposal
        ? counterProposalWorkflow.cache.currentFeatureCollection
        : emptyCounterProposalFeatureCollection(),
      boundaryGeoJson: showEditor
        ? counterProposalWorkflow.cache.sharedBoundaryGeoJson
        : emptyBoundaryFeatureCollection(),
      handleFeatureCollection: showEditor
        ? counterProposalWorkflow.cache.handleFeatureCollection
        : emptyCounterProposalFeatureCollection(),
      selectedHandleId: counterProposalWorkflow.cache.selectedHandleId,
      editable: showEditor,
    };
  }, [counterProposalWorkflow, panelView]);

  return (
    <div className="map-page">
      <div className="map-workspace">
        <UserMenuLeft />
        <div
          className={`map-dashboard${isFullscreen ? " map-dashboard--fullscreen" : ""}`}
        >
          <section className="map-dashboard__main" aria-label="Map workspace">
            {!isFullscreen ? (
              <div className="map-dashboard__spacer" aria-hidden="true" />
            ) : null}

            <div className="map-dashboard__tabs-wrap">
              <HorizontalTabs
                items={tabItems}
                value={panelView}
                onValueChange={setPanelView}
                className="map-dashboard__tabs"
                listClassName="map-dashboard__tabs-list"
              />
            </div>

            <div className="map-dashboard__map-wrap">
              <div className="sr-only" aria-live="polite">
                {status}
              </div>
              <MapRegionSelector
                isOpen={isRolloutOpen}
                onOpenChange={setIsRolloutOpen}
                value={rolloutCategoryId}
                onValueChange={setRolloutCategoryId}
              />
              <MapCanvas
                isFullscreen={isFullscreen}
                selection={selection}
                externalHoverSelection={rolloutHoverSelection}
                objectionPreview={objectionPreview}
                counterProposalPreview={counterProposalPreview}
                onCounterProposalDragEnd={handleCounterProposalDragEnd}
                onCounterProposalDragMove={handleCounterProposalDragMove}
                onCounterProposalDragStart={handleCounterProposalDragStart}
                onCounterProposalHandleSelect={handleCounterProposalSelectHandle}
                onDaSelect={handleDaSelect}
                onFedSelect={handleFedSelect}
                onStatusChange={handleStatusChange}
                onToggleFullscreen={handleToggleFullscreen}
                rolloutEnabled={isRolloutOpen}
                rolloutCategoryId={rolloutCategoryId}
              />
            </div>
          </section>

          <MapInfoPanel
            variant="user"
            selection={selection}
            profilesByDguid={profilesByDguid}
            panelView={panelView}
            rolloutEnabled={isRolloutOpen}
            rolloutCategoryId={rolloutCategoryId}
            objectionGeometryIndex={objectionGeometryIndex}
            objectionWorkflow={objectionWorkflow}
            onObjectionBackStep={handleObjectionBackStep}
            onObjectionConfirmReview={handleObjectionConfirmReview}
            counterProposalWorkflow={counterProposalWorkflow}
            onCounterProposalBackStep={handleCounterProposalBackStep}
            onCounterProposalConfirmCache={handleCounterProposalConfirmCache}
            onCounterProposalConfirmEdit={handleCounterProposalConfirmEdit}
            onCounterProposalConfirmPreview={handleCounterProposalConfirmPreview}
            onCounterProposalPreviewModeChange={handleCounterProposalPreviewModeChange}
            onCounterProposalRedo={handleCounterProposalRedo}
            onCounterProposalUndo={handleCounterProposalUndo}
            onRolloutHoverChange={handleRolloutHoverChange}
            onRolloutSelect={handleRolloutSelect}
          />
        </div>
      </div>
    </div>
  );
}

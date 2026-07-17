import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { CounterProposalMapToolbar } from "@/components/non_prebuilt/CounterProposalMapToolbar.jsx";
import { MapInfoPanel, getDefaultPanelView } from "@/components/non_prebuilt/MapInfoPanel.jsx";
import { MapRegionSelector } from "@/components/non_prebuilt/MapRegionSelector.jsx";
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
import {
  getMetadataGeojsonPathsForFed,
  getFallbackDaAssetManifest,
  normalizeDaAssetManifest,
} from "@/lib/map/daAssetManifest.js";
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
  const [assetManifest, setAssetManifest] = useState(() => getFallbackDaAssetManifest());
  const [profilesByDguid, setProfilesByDguid] = useState(new Map());
  const [objectionGeometryIndex, setObjectionGeometryIndex] = useState(null);
  const [objectionGeometryFedNum, setObjectionGeometryFedNum] = useState("");
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
  const metadataIndexCacheRef = useRef(new Map());
  const counterProposalDragFrameRef = useRef(0);
  const pendingCounterProposalDragRef = useRef(null);
  useEffect(() => {
    let isMounted = true;

    Promise.all([
      mapApi.getDaProfiles(),
      mapApi.getDaAssetManifest().catch(() => getFallbackDaAssetManifest()),
    ])
      .then(([payload, assetManifestPayload]) => {
        if (!isMounted) {
          return;
        }

        const normalizedManifest = normalizeDaAssetManifest(assetManifestPayload);
        const { index } = buildProfileIndex(payload);
        setAssetManifest(normalizedManifest);
        setProfilesByDguid(index);
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

  const getFedNumForDguid = useCallback(
    (dguid) => String(profilesByDguid.get(String(dguid))?.fed_num ?? "").trim(),
    [profilesByDguid],
  );

  const ensureMetadataIndexForFed = useCallback(
    async (fedNum) => {
      const normalizedFedNum = String(fedNum ?? "").trim();

      if (!normalizedFedNum) {
        return null;
      }

      if (metadataIndexCacheRef.current.has(normalizedFedNum)) {
        return metadataIndexCacheRef.current.get(normalizedFedNum);
      }

      const metadataGeojsonPaths = getMetadataGeojsonPathsForFed(
        assetManifest,
        normalizedFedNum,
      );

      if (!metadataGeojsonPaths.length) {
        throw new Error(`No metadata GeoJSON is available for FED ${normalizedFedNum}.`);
      }

      const metadataGeojsons = await Promise.all(
        metadataGeojsonPaths.map((path) => mapApi.fetchAssetJson(path)),
      );
      const mergedMetadataGeojson = {
        type: "FeatureCollection",
        features: metadataGeojsons.flatMap((payload) => payload?.features ?? []),
      };
      const nextIndex = buildDaObjectionIndex(mergedMetadataGeojson);
      metadataIndexCacheRef.current.set(normalizedFedNum, nextIndex);
      return nextIndex;
    },
    [assetManifest],
  );

  useEffect(() => {
    if (panelView !== "objection" && panelView !== "counter-proposal") {
      setObjectionGeometryIndex(null);
      setObjectionGeometryFedNum("");
      return;
    }

    const activeFirstDguid =
      panelView === "objection"
        ? objectionWorkflow.firstDguid
        : counterProposalWorkflow.firstDguid;
    const activeFedNum = getFedNumForDguid(activeFirstDguid);

    if (!activeFirstDguid || !activeFedNum) {
      setObjectionGeometryIndex(null);
      setObjectionGeometryFedNum("");
      return;
    }

    let isCancelled = false;
    setObjectionGeometryIndex(null);
    setObjectionGeometryFedNum(activeFedNum);

    ensureMetadataIndexForFed(activeFedNum)
      .then((nextIndex) => {
        if (isCancelled) {
          return;
        }

        setObjectionGeometryIndex(nextIndex);
        setObjectionGeometryFedNum(activeFedNum);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        setObjectionGeometryIndex(null);
        setStatus(`Error: ${error.message}`);
      });

    return () => {
      isCancelled = true;
    };
  }, [
    counterProposalWorkflow.firstDguid,
    ensureMetadataIndexForFed,
    getFedNumForDguid,
    objectionWorkflow.firstDguid,
    panelView,
  ]);

  const handleDaSelect = useCallback((dguid) => {
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);

    if (panelView === "objection") {
      let nextSelection = null;
      const currentFedNum = getFedNumForDguid(dguid);

      setObjectionWorkflow((current) => {
        if (current.step === 1 || !current.firstDguid) {
          nextSelection = { type: "da", dguid };
          return createInitialObjectionWorkflow({
            step: 2,
            firstDguid: dguid,
            error: currentFedNum
              ? ""
              : "No FED assignment is available for the selected DA.",
          });
        }

        if (current.step === 2) {
          nextSelection = { type: "da", dguid };
          const firstFedNum = getFedNumForDguid(current.firstDguid);

          if (!objectionGeometryIndex || !firstFedNum || objectionGeometryFedNum !== firstFedNum) {
            return createInitialObjectionWorkflow({
              step: 2,
              firstDguid: current.firstDguid,
              error:
                "The selected FED geometry is still loading. Please wait a moment and pick the neighbouring DA again.",
            });
          }

          if (
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
      const currentFedNum = getFedNumForDguid(dguid);

      setCounterProposalWorkflow((current) => {
        if (current.step === 1 || !current.firstDguid) {
          nextSelection = { type: "da", dguid };
          return createInitialCounterProposalWorkflow({
            step: 2,
            firstDguid: dguid,
            previewMode: "proposal",
            error: currentFedNum
              ? ""
              : "No FED assignment is available for the selected DA.",
          });
        }

        if (current.step === 2) {
          nextSelection = { type: "da", dguid };
          const firstFedNum = getFedNumForDguid(current.firstDguid);

          if (!objectionGeometryIndex || !firstFedNum || objectionGeometryFedNum !== firstFedNum) {
            return createInitialCounterProposalWorkflow({
              step: 2,
              firstDguid: current.firstDguid,
              previewMode: "proposal",
              error:
                "The selected FED geometry is still loading. Please wait a moment and pick the neighbouring DA again.",
            });
          }

          if (
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
  }, [
    getFedNumForDguid,
    objectionGeometryFedNum,
    objectionGeometryIndex,
    panelView,
    profilesByDguid,
  ]);

  const handleFedSelect = useCallback((fedNum, fedName) => {
    setSelection({ type: "fed", fedNum, fedName });
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);
  }, []);

  const handleStatusChange = useCallback((message) => {
    setStatus(message);
  }, []);

  const handlePanelViewChange = useCallback((nextView) => {
    const selectedDguid = selection?.type === "da" ? selection.dguid : null;

    if (selectedDguid) {
      const selectedFedNum = getFedNumForDguid(selectedDguid);
      const error = selectedFedNum
        ? ""
        : "No FED assignment is available for the selected DA.";

      if (nextView === "objection") {
        setObjectionWorkflow((current) =>
          current.step === 1 || !current.firstDguid
            ? createInitialObjectionWorkflow({
                step: 2,
                firstDguid: selectedDguid,
                error,
              })
            : current,
        );
      }

      if (nextView === "counter-proposal") {
        setCounterProposalWorkflow((current) =>
          current.step === 1 || !current.firstDguid
            ? createInitialCounterProposalWorkflow({
                step: 2,
                firstDguid: selectedDguid,
                previewMode: "proposal",
                error,
              })
            : current,
        );
      }
    }

    setPanelView(nextView);
    setIsRolloutOpen(false);
  }, [getFedNumForDguid, selection]);

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

      return current;
    });
  }, []);

  const handleCounterProposalConfirmEdit = useCallback(() => {
    setCounterProposalWorkflow((current) => {
      if (!current.cache || current.step !== 3) {
        return current;
      }

      return {
        ...current,
        step: 4,
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

      startTransition(() => {
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
    });
  }, []);

  const handleCounterProposalDragEnd = useCallback(() => {
    startTransition(() => {
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
    const showEditor = showProposal && counterProposalWorkflow.step >= 3;

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
      <div className="map-workspace map-workspace--single-column">
        <div
          className={`map-dashboard map-dashboard--user${isFullscreen ? " map-dashboard--fullscreen" : ""}`}
        >
          <section className="map-dashboard__main" aria-label="Map workspace">
            {!isFullscreen ? (
              <div className="map-dashboard__spacer" aria-hidden="true" />
            ) : null}

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
              <CounterProposalMapToolbar
                isVisible={panelView === "counter-proposal" && counterProposalWorkflow.step >= 3}
                onPreviewModeChange={handleCounterProposalPreviewModeChange}
                onRedo={handleCounterProposalRedo}
                onUndo={handleCounterProposalUndo}
                workflow={counterProposalWorkflow}
              />
            </div>
          </section>

          <MapInfoPanel
            variant="user"
            selection={selection}
            profilesByDguid={profilesByDguid}
            panelView={panelView}
            onPanelViewChange={handlePanelViewChange}
            rolloutEnabled={isRolloutOpen}
            rolloutCategoryId={rolloutCategoryId}
            objectionGeometryIndex={objectionGeometryIndex}
            objectionWorkflow={objectionWorkflow}
            onObjectionBackStep={handleObjectionBackStep}
            onObjectionConfirmReview={handleObjectionConfirmReview}
            counterProposalWorkflow={counterProposalWorkflow}
            onCounterProposalBackStep={handleCounterProposalBackStep}
            onCounterProposalConfirmEdit={handleCounterProposalConfirmEdit}
            onRolloutHoverChange={handleRolloutHoverChange}
            onRolloutSelect={handleRolloutSelect}
          />
        </div>
      </div>
    </div>
  );
}

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { CounterProposalMapToolbar } from "@/components/non_prebuilt/CounterProposalMapToolbar.jsx";
import { MapInfoPanel, getDefaultPanelView } from "@/components/non_prebuilt/MapInfoPanel.jsx";
import { MapRegionSelector } from "@/components/non_prebuilt/MapRegionSelector.jsx";
import {
  areDaNeighbours,
  buildDaObjectionIndex,
  emptyBoundaryFeatureCollection,
  getPairOuterBoundaryFeatureCollection,
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
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import { mapApi } from "@/services/mapApi.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import { useAuth } from "@/contexts/AuthContext.jsx";
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

export default function UserHome({ mapSearchTarget = null, onClearMapSearchTarget }) {
  const { sessionStatus, user } = useAuth();
  const [status, setStatus] = useState("Loading map...");
  const [selection, setSelection] = useState(null);
  const [rolloutHoverSelection, setRolloutHoverSelection] = useState(null);
  const [assetManifest, setAssetManifest] = useState(() => getFallbackDaAssetManifest());
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
  const metadataIndexCacheRef = useRef(new Map());
  const counterProposalDragFrameRef = useRef(0);
  const pendingCounterProposalDragRef = useRef(null);
  const profileMapTarget = useMemo(() => {
    const latitude = Number(user?.mapCenter?.latitude);
    const longitude = Number(user?.mapCenter?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return {
      label: "your postal code",
      location: [longitude, latitude],
      showMarker: false,
      zoom: 12,
    };
  }, [user?.mapCenter?.latitude, user?.mapCenter?.longitude]);
  const effectiveMapSearchTarget = mapSearchTarget || profileMapTarget;

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

  const ensureMetadataIndexForFeds = useCallback(
    async (fedNums) => {
      const normalizedFedNums = [...new Set(
        (fedNums ?? []).map((fedNum) => String(fedNum ?? "").trim()).filter(Boolean),
      )].sort();
      const cacheKey = `pair:${normalizedFedNums.join("|")}`;

      if (!normalizedFedNums.length) {
        return null;
      }

      if (metadataIndexCacheRef.current.has(cacheKey)) {
        return metadataIndexCacheRef.current.get(cacheKey);
      }

      const indexes = await Promise.all(
        normalizedFedNums.map((fedNum) => ensureMetadataIndexForFed(fedNum)),
      );
      const merged = buildDaObjectionIndex({
        type: "FeatureCollection",
        features: indexes.flatMap((index) => Array.from(index.featureByDguid.values())),
      });
      metadataIndexCacheRef.current.set(cacheKey, merged);
      return merged;
    },
    [ensureMetadataIndexForFed],
  );

  useEffect(() => {
    if (panelView !== "objection" && panelView !== "counter-proposal") {
      setObjectionGeometryIndex(null);
      return;
    }

    const activeFirstDguid =
      panelView === "objection"
        ? objectionWorkflow.firstDguid
        : counterProposalWorkflow.firstDguid;
    const activeWorkflowStep =
      panelView === "objection"
        ? objectionWorkflow.step
        : counterProposalWorkflow.step;
    const activeFedNum = getFedNumForDguid(activeFirstDguid);

    if (activeWorkflowStep >= 3) {
      return;
    }

    if (!activeFirstDguid || !activeFedNum) {
      setObjectionGeometryIndex(null);
      return;
    }

    let isCancelled = false;
    setObjectionGeometryIndex(null);

    ensureMetadataIndexForFed(activeFedNum)
      .then((nextIndex) => {
        if (isCancelled) {
          return;
        }

        setObjectionGeometryIndex(nextIndex);
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
    counterProposalWorkflow.step,
    ensureMetadataIndexForFed,
    getFedNumForDguid,
    objectionWorkflow.firstDguid,
    objectionWorkflow.step,
    panelView,
  ]);

  const handleDaSelect = useCallback(async (dguid) => {
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);

    if (panelView === "objection") {
      const currentFedNum = getFedNumForDguid(dguid);

      if (objectionWorkflow.step === 1 || !objectionWorkflow.firstDguid) {
        setSelection({ type: "da", dguid });
        setObjectionWorkflow(createInitialObjectionWorkflow({
          step: 2,
          firstDguid: dguid,
          error: currentFedNum ? "" : "No FED assignment is available for the selected DA.",
        }));
        return;
      }

      if (objectionWorkflow.step !== 2 || objectionWorkflow.firstDguid === dguid) {
        return;
      }

      setSelection({ type: "da", dguid });
      const firstDguid = objectionWorkflow.firstDguid;
      const firstFedNum = getFedNumForDguid(firstDguid);

      try {
        const pairIndex = await ensureMetadataIndexForFeds([firstFedNum, currentFedNum]);
        setObjectionGeometryIndex(pairIndex);
        setObjectionWorkflow((current) => {
          if (current.step !== 2 || current.firstDguid !== firstDguid) return current;
          if (!areDaNeighbours(pairIndex, firstDguid, dguid)) {
            return createInitialObjectionWorkflow({
              error: "The second DA must be adjacent to the first one. Please select the first DA again.",
            });
          }
          return createInitialObjectionWorkflow({
            step: 3,
            firstDguid,
            secondDguid: dguid,
            boundaryGeoJson: getSharedBoundaryFeatureCollection(pairIndex, firstDguid, dguid),
          });
        });
      } catch (error) {
        setObjectionWorkflow((current) => createInitialObjectionWorkflow({
          step: 2,
          firstDguid: current.firstDguid,
          error: `Could not load the neighbouring FED geometry: ${error.message}`,
        }));
      }
      return;
    }

    if (panelView === "counter-proposal") {
      const currentFedNum = getFedNumForDguid(dguid);

      if (counterProposalWorkflow.step === 1 || !counterProposalWorkflow.firstDguid) {
        setSelection({ type: "da", dguid });
        setCounterProposalWorkflow(createInitialCounterProposalWorkflow({
          step: 2,
          firstDguid: dguid,
          previewMode: "proposal",
          error: currentFedNum ? "" : "No FED assignment is available for the selected DA.",
        }));
        return;
      }

      if (counterProposalWorkflow.step !== 2 || counterProposalWorkflow.firstDguid === dguid) {
        return;
      }

      setSelection({ type: "da", dguid });
      const firstDguid = counterProposalWorkflow.firstDguid;
      const firstFedNum = getFedNumForDguid(firstDguid);

      try {
        const pairIndex = await ensureMetadataIndexForFeds([firstFedNum, currentFedNum]);
        setObjectionGeometryIndex(pairIndex);
        setCounterProposalWorkflow((current) => {
          if (current.step !== 2 || current.firstDguid !== firstDguid) return current;
          if (!areDaNeighbours(pairIndex, firstDguid, dguid)) {
            return createInitialCounterProposalWorkflow({
              error: "The second DA must be adjacent to the first one. Please select the first DA again.",
            });
          }
          const cache = buildCounterProposalCache(pairIndex, profilesByDguid, firstDguid, dguid);

          if (!cache || cache.sourceGeometryIssues?.length) {
            const issue = cache?.sourceGeometryIssues?.[0]?.reason ?? "The selected DA geometry is unavailable.";
            return createInitialCounterProposalWorkflow({
              step: 2,
              firstDguid,
              previewMode: "proposal",
              error: `This neighbouring pair cannot be normalized safely: ${issue}`,
            });
          }

          return createInitialCounterProposalWorkflow({
            step: 3,
            firstDguid,
            secondDguid: dguid,
            previewMode: "proposal",
            cache,
          });
        });
      } catch (error) {
        setCounterProposalWorkflow((current) => createInitialCounterProposalWorkflow({
          step: 2,
          firstDguid: current.firstDguid,
          previewMode: "proposal",
          error: `Could not load the neighbouring FED geometry: ${error.message}`,
        }));
      }
      return;
    }

    setSelection((current) =>
      current?.type === "da" && String(current.dguid) === String(dguid)
        ? null
        : { type: "da", dguid },
    );
  }, [
    counterProposalWorkflow.firstDguid,
    counterProposalWorkflow.step,
    getFedNumForDguid,
    objectionWorkflow.firstDguid,
    objectionWorkflow.step,
    panelView,
    profilesByDguid,
    ensureMetadataIndexForFeds,
  ]);

  const handleFedSelect = useCallback((fedNum, fedName) => {
    setSelection((current) =>
      current?.type === "fed" && String(current.fedNum) === String(fedNum)
        ? null
        : { type: "fed", fedNum, fedName },
    );
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);
  }, []);

  const handleStatusChange = useCallback((message) => {
    setStatus(message);
  }, []);

  const handlePanelViewChange = useCallback((nextView) => {
    const activePairWorkflowLocksNavigation =
      (panelView === "objection" && objectionWorkflow.step >= 2)
      || (panelView === "counter-proposal" && counterProposalWorkflow.step >= 2);

    // Pair workflows own focused GeoJSON, PMTiles feature-state exclusion, and
    // map interaction mode together. Leaving midway used to detach that state
    // and could restore only the shared boundary on return. The selector is
    // disabled as UX; this guard keeps the invariant true for future callers.
    if (activePairWorkflowLocksNavigation && nextView !== panelView) {
      return;
    }

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
  }, [counterProposalWorkflow.step, getFedNumForDguid, objectionWorkflow.step, panelView, selection]);

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
    if (objectionWorkflow.step === 2) {
      setSelection(null);
    } else if (objectionWorkflow.step === 3 && objectionWorkflow.firstDguid) {
      setSelection({ type: "da", dguid: objectionWorkflow.firstDguid });
    }

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
  }, [objectionWorkflow.firstDguid, objectionWorkflow.step]);

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
    if (counterProposalWorkflow.step === 2) {
      setSelection(null);
    } else if (
      counterProposalWorkflow.step === 3
      && counterProposalWorkflow.firstDguid
    ) {
      setSelection({ type: "da", dguid: counterProposalWorkflow.firstDguid });
    }

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
  }, [counterProposalWorkflow.firstDguid, counterProposalWorkflow.step]);

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

  const handleCounterProposalSubmitSuccess = useCallback(() => {
    clearCounterProposalStorage();
    setCounterProposalWorkflow(createInitialCounterProposalWorkflow());
    setSelection(null);
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

  useEffect(() => {
    if (panelView !== "counter-proposal" || counterProposalWorkflow.step < 3) {
      return undefined;
    }

    function handleCounterProposalShortcut(event) {
      if (
        !event.ctrlKey
        || event.altKey
        || event.metaKey
        || event.shiftKey
      ) {
        return;
      }

      const target = event.target;
      const isEditableTarget = target instanceof HTMLElement
        && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));

      if (isEditableTarget) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "z") {
        event.preventDefault();
        handleCounterProposalUndo();
      } else if (key === "y") {
        event.preventDefault();
        handleCounterProposalRedo();
      }
    }

    window.addEventListener("keydown", handleCounterProposalShortcut);

    return () => {
      window.removeEventListener("keydown", handleCounterProposalShortcut);
    };
  }, [
    counterProposalWorkflow.step,
    handleCounterProposalRedo,
    handleCounterProposalUndo,
    panelView,
  ]);

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

    const dguids = [objectionWorkflow.firstDguid, objectionWorkflow.secondDguid]
      .filter(Boolean);

    return {
      boundaryGeoJson: objectionWorkflow.boundaryGeoJson,
      featureCollection: {
        type: "FeatureCollection",
        features: dguids
          .map((dguid) => objectionGeometryIndex?.featureByDguid.get(String(dguid)))
          .filter(Boolean),
      },
      outerBoundaryGeoJson: getPairOuterBoundaryFeatureCollection(
        objectionGeometryIndex,
        dguids,
      ),
    };
  }, [objectionGeometryIndex, objectionWorkflow, panelView]);

  const counterProposalPreview = useMemo(() => {
    if (panelView !== "counter-proposal" || !counterProposalWorkflow.cache) {
      return null;
    }

    const showProposal = counterProposalWorkflow.previewMode === "proposal";
    const showBoundary = counterProposalWorkflow.step >= 3;
    const showHandles = showProposal && counterProposalWorkflow.step === 3;
    const originalFeatureCollection = {
      type: "FeatureCollection",
      features: counterProposalWorkflow.cache.originalFeatures ?? [],
    };
    const originalPairIndex = buildDaObjectionIndex(originalFeatureCollection);
    const originalBoundaryGeoJson = getSharedBoundaryFeatureCollection(
      originalPairIndex,
      counterProposalWorkflow.firstDguid,
      counterProposalWorkflow.secondDguid,
    );
    const visibleFeatureCollection = showProposal
      ? counterProposalWorkflow.cache.currentFeatureCollection
      : originalFeatureCollection;
    const visiblePairIndex = showProposal
      ? counterProposalWorkflow.cache.pairIndex
      : originalPairIndex;
    const dguids = [counterProposalWorkflow.firstDguid, counterProposalWorkflow.secondDguid]
      .filter(Boolean);

    return {
      featureCollection: visibleFeatureCollection,
      boundaryGeoJson: showBoundary
        ? showProposal
          ? counterProposalWorkflow.cache.sharedBoundaryGeoJson
          : originalBoundaryGeoJson
        : emptyBoundaryFeatureCollection(),
      outerBoundaryGeoJson: showBoundary
        ? getPairOuterBoundaryFeatureCollection(visiblePairIndex, dguids)
        : emptyBoundaryFeatureCollection(),
      handleFeatureCollection: showHandles
        ? counterProposalWorkflow.cache.handleFeatureCollection
        : emptyCounterProposalFeatureCollection(),
      selectedHandleId: counterProposalWorkflow.cache.selectedHandleId,
      editable: showHandles,
    };
  }, [counterProposalWorkflow, panelView]);

  const interactionMode = useMemo(() => {
    if (panelView === "objection") {
      return objectionWorkflow.step >= 3
        ? MAP_INTERACTION_MODE.OBJECTION_FOCUS
        : MAP_INTERACTION_MODE.PAIR_SELECT;
    }

    if (panelView === "counter-proposal") {
      if (counterProposalWorkflow.step >= 3) {
        return counterProposalWorkflow.previewMode === "proposal"
          ? MAP_INTERACTION_MODE.COUNTER_EDIT
          : MAP_INTERACTION_MODE.COUNTER_REVIEW;
      }
      return MAP_INTERACTION_MODE.PAIR_SELECT;
    }

    return MAP_INTERACTION_MODE.BROWSE;
  }, [counterProposalWorkflow.previewMode, counterProposalWorkflow.step, objectionWorkflow.step, panelView]);

  const workflowFocusDguids = useMemo(() => {
    if (panelView === "objection" && objectionWorkflow.step >= 3) {
      return [objectionWorkflow.firstDguid, objectionWorkflow.secondDguid].filter(Boolean);
    }

    if (panelView === "counter-proposal" && counterProposalWorkflow.step >= 3) {
      return [counterProposalWorkflow.firstDguid, counterProposalWorkflow.secondDguid].filter(Boolean);
    }

    return [];
  }, [counterProposalWorkflow.firstDguid, counterProposalWorkflow.secondDguid, counterProposalWorkflow.step, objectionWorkflow.firstDguid, objectionWorkflow.secondDguid, objectionWorkflow.step, panelView]);

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
                mapSearchTarget={effectiveMapSearchTarget}
                recenterTarget={sessionStatus === "signed-out" ? null : undefined}
                postalAreaTarget={profileMapTarget}
                onPostalAreaActivate={onClearMapSearchTarget}
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
                interactionMode={interactionMode}
                workflowFocusDguids={workflowFocusDguids}
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
            onCounterProposalSubmitSuccess={handleCounterProposalSubmitSuccess}
            onRolloutHoverChange={handleRolloutHoverChange}
            onRolloutSelect={handleRolloutSelect}
          />
        </div>
      </div>
    </div>
  );
}

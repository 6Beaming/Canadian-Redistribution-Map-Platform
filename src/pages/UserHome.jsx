import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { CounterProposalMapToolbar } from "@/components/non_prebuilt/CounterProposalMapToolbar.jsx";
import { MapInfoPanel, getDefaultPanelView } from "@/components/non_prebuilt/MapInfoPanel.jsx";
import { MapRegionSelector } from "@/components/non_prebuilt/MapRegionSelector.jsx";
import {
  buildDaObjectionIndex,
  emptyBoundaryFeatureCollection,
  getPairOuterBoundaryFeatureCollection,
  getSharedBoundaryFeatureCollection,
} from "@/lib/map/objectionWorkflow.js";
import {
  applyCounterProposalWorkerCommit,
  clearCounterProposalStorage,
  createInitialCounterProposalWorkflow,
  emptyCounterProposalFeatureCollection,
  readCounterProposalStorage,
  restoreCounterProposalCacheFromDraft,
  previewCounterProposalDragState,
  redoCounterProposalCache,
  selectCounterProposalHandle,
  undoCounterProposalCache,
  writeCounterProposalStorage,
} from "@/lib/map/counterProposalWorkflow.js";
import {
  areReleaseDaNeighbours,
  loadCounterProposalPair,
  loadDisplayDaIndex,
  loadDisplayPairIndex,
} from "@/lib/map/releasePairLoader.js";
import { createCounterProposalWorkerClient } from "@/services/counterProposalWorkerClient.js";
import { DEFAULT_ROLLOUT_CATEGORY_ID } from "@/lib/map/rolloutPlan.js";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import { mapApi } from "@/services/mapApi.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { useMapFullscreen } from "@/contexts/MapFullscreenContext.jsx";
import { useMapCameraCommands } from "@/hooks/useMapCameraCommands.js";
import { RouteLoadingPage } from "@/components/non_prebuilt/RouteLoadingPage.jsx";
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
  const { isFullscreen, toggle: handleToggleFullscreen } = useMapFullscreen();
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
  const [panelView, setPanelView] = useState(getDefaultPanelView("user"));
  const [isRolloutOpen, setIsRolloutOpen] = useState(false);
  const [rolloutCategoryId, setRolloutCategoryId] = useState(DEFAULT_ROLLOUT_CATEGORY_ID);
  const [initialLoad, setInitialLoad] = useState({ ready: false, error: "" });
  const pendingCounterProposalDragRef = useRef(null);
  const counterProposalDragTimerRef = useRef(0);
  const counterProposalWorkerRef = useRef(null);
  const counterProposalWorkerInitRef = useRef(Promise.resolve());
  const counterProposalWorkerSkipSyncRef = useRef(false);
  const counterProposalCacheRef = useRef(null);
  const counterProposalDraggingRef = useRef(false);
  const counterProposalPreviewVersionRef = useRef(0);
  const counterProposalDraftRef = useRef(readCounterProposalStorage());
  const counterProposalDraftPendingRef = useRef(Boolean(counterProposalDraftRef.current));
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
  const { cameraCommand, search: searchCamera, recenter: recenterCamera } = useMapCameraCommands({
    initialTarget: profileMapTarget,
  });

  useEffect(() => {
    if (!mapSearchTarget) return;
    searchCamera(mapSearchTarget);
  }, [mapSearchTarget, searchCamera]);

  useEffect(() => {
    let isMounted = true;

    mapApi
      .getDaProfiles()
      .then((payload) => {
        if (!isMounted) {
          return;
        }

        const { index } = buildProfileIndex(payload);
        setProfilesByDguid(index);
        setInitialLoad({ ready: true, error: "" });
      })
      .catch((error) => {
        if (isMounted) {
          setStatus(`Error: ${error.message}`);
          setInitialLoad({ ready: false, error: error.message || "Unable to load map data." });
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
    if (counterProposalDraftPendingRef.current) return;
    if (counterProposalWorkflow.dragBaselineSnapshot) {
      return;
    }
    const timer = window.setTimeout(() => writeCounterProposalStorage(counterProposalWorkflow), 300);
    return () => window.clearTimeout(timer);
  }, [counterProposalWorkflow]);

  counterProposalCacheRef.current = counterProposalWorkflow.cache;

  useEffect(() => {
    const client = createCounterProposalWorkerClient();
    counterProposalWorkerRef.current = client;
    return () => {
      if (counterProposalDragTimerRef.current) window.clearTimeout(counterProposalDragTimerRef.current);
      client?.terminate();
      counterProposalWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const client = counterProposalWorkerRef.current;
    if (!client || !counterProposalWorkflow.cache || counterProposalDraggingRef.current) {
      return;
    }
    if (counterProposalWorkerSkipSyncRef.current) {
      counterProposalWorkerSkipSyncRef.current = false;
      return;
    }
    counterProposalWorkerInitRef.current = client.init(counterProposalWorkflow.cache).catch(() => undefined);
  }, [counterProposalWorkflow.cache]);

  useEffect(() => {
    if (!isRolloutOpen) {
      setRolloutHoverSelection(null);
    }
  }, [isRolloutOpen]);

  const getFedNumForDguid = useCallback(
    (dguid) => String(profilesByDguid.get(String(dguid))?.fed_num ?? "").trim(),
    [profilesByDguid],
  );

  useEffect(() => {
    const draft = counterProposalDraftRef.current;
    if (!draft || !initialLoad.ready || !profilesByDguid.size) return undefined;
    let cancelled = false;
    const firstDguid = String(draft.firstDguid ?? "");
    const secondDguid = String(draft.secondDguid ?? "");

    loadCounterProposalPair(firstDguid, secondDguid, profilesByDguid).then(({ index, cache: baseCache }) => {
      if (cancelled) return;
      const cache = restoreCounterProposalCacheFromDraft(baseCache, draft);
      if (cache === baseCache && draft.cache?.history?.length) {
        throw new Error("The saved Counter-Proposal baseline has changed.");
      }
      setObjectionGeometryIndex(index);
      setPanelView("counter-proposal");
      setSelection({ type: "da", dguid: secondDguid });
      setCounterProposalWorkflow(createInitialCounterProposalWorkflow({
        step: Math.max(3, Math.min(4, Number(draft.step) || 3)),
        firstDguid,
        secondDguid,
        previewMode: draft.previewMode === "original" ? "original" : "proposal",
        cache,
      }));
    }).catch((error) => {
      if (!cancelled) {
        clearCounterProposalStorage();
        setStatus(`Saved Counter-Proposal was discarded: ${error.message}`);
      }
    }).finally(() => {
      if (!cancelled) {
        counterProposalDraftPendingRef.current = false;
        counterProposalDraftRef.current = null;
      }
    });

    return () => { cancelled = true; };
  }, [
    initialLoad.ready,
    profilesByDguid,
  ]);

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

    if (!activeFirstDguid) {
      setObjectionGeometryIndex(null);
      return;
    }

    let isCancelled = false;
    setObjectionGeometryIndex(null);

    loadDisplayDaIndex(activeFirstDguid)
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

      try {
        const isNeighbour = await areReleaseDaNeighbours(firstDguid, dguid);
        const pairIndex = await loadDisplayPairIndex(firstDguid, dguid);
        setObjectionGeometryIndex(pairIndex);
        setObjectionWorkflow((current) => {
          if (current.step !== 2 || current.firstDguid !== firstDguid) return current;
          if (!isNeighbour) {
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
          error: `Could not load the neighbouring DA geometry: ${error.message}`,
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

      try {
        const isNeighbour = await areReleaseDaNeighbours(firstDguid, dguid);
        const { index: pairIndex, cache } = await loadCounterProposalPair(
          firstDguid,
          dguid,
          profilesByDguid,
        );
        setObjectionGeometryIndex(pairIndex);
        setCounterProposalWorkflow((current) => {
          if (current.step !== 2 || current.firstDguid !== firstDguid) return current;
          if (!isNeighbour) {
            return createInitialCounterProposalWorkflow({
              error: "The second DA must be adjacent to the first one. Please select the first DA again.",
            });
          }

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
          error: `Could not load the neighbouring DA geometry: ${error.message}`,
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

  const handleSubmissionComplete = useCallback((dguid) => {
    setObjectionWorkflow(createInitialObjectionWorkflow());
    setCounterProposalWorkflow(createInitialCounterProposalWorkflow());
    setPanelView(getDefaultPanelView("user"));
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);

    if (dguid) {
      setSelection({ type: "da", dguid: String(dguid) });
      return;
    }

    setSelection(null);
  }, []);

  const handleCommentSubmitSuccess = useCallback((dguid) => {
    handleSubmissionComplete(dguid);
  }, [handleSubmissionComplete]);

  const handleObjectionSubmitSuccess = useCallback((dguid) => {
    handleSubmissionComplete(dguid);
  }, [handleSubmissionComplete]);

  const handleCounterProposalSubmitSuccess = useCallback((dguid) => {
    handleSubmissionComplete(dguid);
  }, [handleSubmissionComplete]);

  const handlePostalAreaActivate = useCallback(() => {
    onClearMapSearchTarget?.();
    setSelection(null);
    setPanelView(getDefaultPanelView("user"));
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);
    if (profileMapTarget) {
      recenterCamera(profileMapTarget);
    }
  }, [onClearMapSearchTarget, profileMapTarget, recenterCamera]);

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
      counterProposalDraggingRef.current = true;
      counterProposalPreviewVersionRef.current += 1;
      counterProposalCacheRef.current = nextCache;
      const client = counterProposalWorkerRef.current;
      counterProposalWorkerInitRef.current = client
        ? client.init(nextCache).catch(() => undefined)
        : Promise.resolve();

      return {
        ...current,
        cache: nextCache,
        dragBaselineSnapshot: nextCache.currentFeatures,
        dragPreviewImpacts: null,
        dragPreviewCoordinate: null,
        dragPreviewFeatureCollection: null,
        dragPreviewBoundaryGeoJson: null,
        dragPreviewOverlaySegments: null,
        dragValidating: false,
        error: "",
      };
    });
  }, []);

  const handleCounterProposalDragMove = useCallback((handleId, nextCoordinate) => {
    pendingCounterProposalDragRef.current = {
      handleId,
      nextCoordinate,
    };

    if (counterProposalDragTimerRef.current) {
      return;
    }

    counterProposalDragTimerRef.current = window.setTimeout(async () => {
      counterProposalDragTimerRef.current = 0;
      const pending = pendingCounterProposalDragRef.current;
      if (!pending || !counterProposalWorkerRef.current) return;
      try {
        const previewVersion = ++counterProposalPreviewVersionRef.current;
        await counterProposalWorkerInitRef.current;
        const result = await counterProposalWorkerRef.current.preview(
          pending.handleId,
          pending.nextCoordinate,
        );
        if (
          !counterProposalDraggingRef.current
          || previewVersion !== counterProposalPreviewVersionRef.current
          || result?.type !== "PREVIEW_RESULT"
        ) {
          return;
        }
        startTransition(() => setCounterProposalWorkflow((current) => ({
          ...current,
          dragPreviewImpacts: result.impacts,
        })));
      } catch {
        // Preview failure is non-fatal; commit remains worker-only and restores the baseline on failure.
      }
    }, 150);
  }, []);

  const handleCounterProposalDragEnd = useCallback(async (handleId, finalCoordinate) => {
    if (counterProposalDragTimerRef.current) {
      window.clearTimeout(counterProposalDragTimerRef.current);
      counterProposalDragTimerRef.current = 0;
    }
    pendingCounterProposalDragRef.current = null;
    counterProposalPreviewVersionRef.current += 1;
    setCounterProposalWorkflow((current) => ({ ...current, dragValidating: true }));
    try {
      await counterProposalWorkerInitRef.current;
      const cache = counterProposalCacheRef.current;
      const dragState = cache
        ? previewCounterProposalDragState(cache, handleId, finalCoordinate)
        : null;
      const constrainedCoordinate = dragState?.coordinate ?? finalCoordinate;
      const result = counterProposalWorkerRef.current
        ? await counterProposalWorkerRef.current.commit(handleId, constrainedCoordinate)
        : null;
      if (result?.type !== "COMMIT_RESULT" || !result.valid || !result.committedPatch) {
        throw new Error(result?.rejectionReason || "Worker commit unavailable.");
      }
      counterProposalWorkerSkipSyncRef.current = true;
      const nextCache = applyCounterProposalWorkerCommit(cache, result.committedPatch);
      counterProposalCacheRef.current = nextCache;
      startTransition(() => setCounterProposalWorkflow((current) => ({
        ...current,
        cache: nextCache,
        dragBaselineSnapshot: null,
        dragPreviewImpacts: null,
        dragPreviewCoordinate: null,
        dragPreviewFeatureCollection: null,
        dragPreviewBoundaryGeoJson: null,
        dragPreviewOverlaySegments: null,
        dragValidating: false,
        error: "",
      })));
    } catch (error) {
      const baselineCache = counterProposalCacheRef.current;
      setCounterProposalWorkflow((current) => ({
        ...current,
        cache: baselineCache,
        dragBaselineSnapshot: null,
        dragPreviewImpacts: null,
        dragPreviewCoordinate: null,
        dragPreviewFeatureCollection: null,
        dragPreviewBoundaryGeoJson: null,
        dragPreviewOverlaySegments: null,
        dragValidating: false,
        error: `The boundary move was not committed: ${error.message}`,
      }));
    } finally {
      counterProposalDraggingRef.current = false;
    }
  }, []);

  const handleCounterProposalUndo = useCallback(async () => {
    const currentCache = counterProposalCacheRef.current;
    if (!currentCache?.history?.length || !counterProposalWorkerRef.current) {
      return;
    }
    try {
      await counterProposalWorkerInitRef.current;
      const result = await counterProposalWorkerRef.current.undo();
      if (result?.type !== "COMMIT_RESULT") {
        throw new Error("Worker undo unavailable.");
      }
      counterProposalWorkerSkipSyncRef.current = true;
      const nextCache = undoCounterProposalCache(currentCache);
      counterProposalCacheRef.current = nextCache;
      startTransition(() => setCounterProposalWorkflow((current) => ({
        ...current,
        cache: nextCache,
        impacts: result.impacts ?? nextCache?.impacts ?? null,
        error: "",
      })));
    } catch (error) {
      setCounterProposalWorkflow((current) => ({
        ...current,
        error: `Undo was not applied: ${error.message}`,
      }));
    }
  }, []);

  const handleCounterProposalRedo = useCallback(async () => {
    const currentCache = counterProposalCacheRef.current;
    if (!currentCache?.future?.length || !counterProposalWorkerRef.current) {
      return;
    }
    try {
      await counterProposalWorkerInitRef.current;
      const result = await counterProposalWorkerRef.current.redo();
      if (result?.type !== "COMMIT_RESULT") {
        throw new Error("Worker redo unavailable.");
      }
      counterProposalWorkerSkipSyncRef.current = true;
      const nextCache = redoCounterProposalCache(currentCache);
      counterProposalCacheRef.current = nextCache;
      startTransition(() => setCounterProposalWorkflow((current) => ({
        ...current,
        cache: nextCache,
        impacts: result.impacts ?? nextCache?.impacts ?? null,
        error: "",
      })));
    } catch (error) {
      setCounterProposalWorkflow((current) => ({
        ...current,
        error: `Redo was not applied: ${error.message}`,
      }));
    }
  }, []);

  const handleCounterProposalExportOperations = useCallback(async () => {
    await counterProposalWorkerInitRef.current;
    if (!counterProposalWorkerRef.current) {
      throw new Error("Counter-Proposal worker is unavailable.");
    }
    return counterProposalWorkerRef.current.exportSubmissionOperations();
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
      cache: counterProposalWorkflow.cache,
      editable: showHandles,
    };
  }, [
    counterProposalWorkflow.cache?.currentFeatureCollection,
    counterProposalWorkflow.cache?.handleFeatureCollection,
    counterProposalWorkflow.cache?.originalFeatures,
    counterProposalWorkflow.cache?.pairIndex,
    counterProposalWorkflow.cache?.selectedHandleId,
    counterProposalWorkflow.cache?.sharedBoundaryGeoJson,
    counterProposalWorkflow.firstDguid,
    counterProposalWorkflow.previewMode,
    counterProposalWorkflow.secondDguid,
    counterProposalWorkflow.step,
    panelView,
  ]);

  const counterProposalPanelWorkflow = useMemo(() => {
    if (!counterProposalWorkflow.dragPreviewImpacts || !counterProposalWorkflow.cache) {
      return counterProposalWorkflow;
    }
    return {
      ...counterProposalWorkflow,
      cache: {
        ...counterProposalWorkflow.cache,
        impacts: counterProposalWorkflow.dragPreviewImpacts,
      },
    };
  }, [counterProposalWorkflow]);

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

  if (!initialLoad.ready && initialLoad.error) {
    return <RouteLoadingPage error={initialLoad.error} />;
  }

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
                cameraCommand={cameraCommand}
                recenterTarget={sessionStatus === "signed-out" ? null : undefined}
                postalAreaTarget={profileMapTarget}
                onPostalAreaActivate={handlePostalAreaActivate}
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
            onCommentSubmitSuccess={handleCommentSubmitSuccess}
            onObjectionSubmitSuccess={handleObjectionSubmitSuccess}
            counterProposalWorkflow={counterProposalPanelWorkflow}
            onCounterProposalBackStep={handleCounterProposalBackStep}
            onCounterProposalConfirmEdit={handleCounterProposalConfirmEdit}
            onCounterProposalSubmitSuccess={handleCounterProposalSubmitSuccess}
            exportCounterProposalOperations={handleCounterProposalExportOperations}
            onRolloutHoverChange={handleRolloutHoverChange}
            onRolloutSelect={handleRolloutSelect}
          />
        </div>
      </div>
    </div>
  );
}

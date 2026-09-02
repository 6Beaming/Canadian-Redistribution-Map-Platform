import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { MapInfoPanel, getDefaultPanelView } from "@/components/non_prebuilt/MapInfoPanel.jsx";
import { ArchivedMapInfoPanel, ARCHIVED_MAP_PANEL_VIEWS } from "@/components/non_prebuilt/ArchivedMapInfoPanel.jsx";
import { MapRegionSelector } from "@/components/non_prebuilt/MapRegionSelector.jsx";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { useMapFullscreen } from "@/contexts/MapFullscreenContext.jsx";
import { useMapCameraCommands } from "@/hooks/useMapCameraCommands.js";
import { DEFAULT_ROLLOUT_CATEGORY_ID } from "@/lib/map/rolloutPlan.js";
import { WORKSPACE_LIST_INVALIDATION_KEYS } from "@/lib/realtime/workspaceRealtime.js";
import { getProvinceMapView } from "@/lib/map/provinceView.js";
import { mapApi } from "@/services/mapApi.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import { loadSubmissionHeatmap } from "@/lib/map/heatmap.js";
import { loadArchivedMapEffect } from "@/lib/map/archivedMapEffect.js";
import {
  clearArchivedMapProjectionCache,
  clearDashboardAreaContextCache,
  subscribeWorkspaceState,
} from "@/services/workspaceApi";
import { RouteLoadingPage } from "@/components/non_prebuilt/RouteLoadingPage.jsx";
import "@/styles/map.css";

export default function DashboardHome({ mapSearchTarget = null }) {
  const { user } = useAuth();
  const { isFullscreen, toggle: handleToggleFullscreen } = useMapFullscreen();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("Loading map...");
  const [selection, setSelection] = useState(null);
  const [rolloutHoverSelection, setRolloutHoverSelection] = useState(null);
  const [profilesByDguid, setProfilesByDguid] = useState(new Map());
  const [panelView, setPanelView] = useState(getDefaultPanelView("commissioner"));
  const [isRolloutOpen, setIsRolloutOpen] = useState(false);
  const [rolloutCategoryId, setRolloutCategoryId] = useState(DEFAULT_ROLLOUT_CATEGORY_ID);
  const [heatmap, setHeatmap] = useState(null);
  const [archivedMap, setArchivedMap] = useState(null);
  const [initialLoad, setInitialLoad] = useState({ ready: false, error: "" });
  const initialArchivedMapEnabled = searchParams.get("archivedMap") === "1";
  const [archivedMapEnabled, setArchivedMapEnabled] = useState(initialArchivedMapEnabled);
  const [archivedPanelView, setArchivedPanelView] = useState(ARCHIVED_MAP_PANEL_VIEWS[0].id);
  const commissionerProvinceView = useMemo(
    () => getProvinceMapView(user?.province),
    [user?.province],
  );
  const { cameraCommand, search: searchCamera } = useMapCameraCommands({
    initialTarget: commissionerProvinceView?.mapTarget ?? null,
  });

  useEffect(() => {
    if (!mapSearchTarget) return;
    searchCamera(mapSearchTarget);
  }, [mapSearchTarget, searchCamera]);

  useEffect(() => {
    let isMounted = true;

    const loadHeatmap = () => loadSubmissionHeatmap()
      .then((nextHeatmap) => {
        if (isMounted) {
          setHeatmap(nextHeatmap);
        }
      })
      .catch(() => {
        // The Commissioner map remains usable when the optional visualization
        // data is unavailable.
      });

    loadHeatmap();
    const unsubscribe = subscribeWorkspaceState(loadHeatmap, WORKSPACE_LIST_INVALIDATION_KEYS);

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    setArchivedMapEnabled(initialArchivedMapEnabled);
  }, [initialArchivedMapEnabled]);

  useEffect(() => {
    if (!profilesByDguid.size) return undefined;
    let isMounted = true;
    const load = () => loadArchivedMapEffect(profilesByDguid, { enabled: true })
      .then((nextArchivedMap) => {
        if (isMounted) setArchivedMap(nextArchivedMap);
      })
      .catch(() => {
        if (isMounted) setArchivedMap(null);
      });
    load();
    const unsubscribe = subscribeWorkspaceState(() => {
      clearArchivedMapProjectionCache();
      load();
    }, "workspace:archive:*");
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [profilesByDguid]);

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
          setInitialLoad({ ready: false, error: error.message || "Unable to load commissioner map." });
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
    if (!isRolloutOpen) {
      setRolloutHoverSelection(null);
    }
  }, [isRolloutOpen]);

  const handleDaSelect = useCallback((dguid) => {
    setSelection((current) =>
      current?.type === "da" && String(current.dguid) === String(dguid)
        ? null
        : { type: "da", dguid },
    );
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);
  }, []);

  const handleFedSelect = useCallback((fedNum, fedName) => {
    setSelection((current) =>
      current?.type === "fed" && String(current.fedNum) === String(fedNum)
        ? null
        : { type: "fed", fedNum, fedName },
    );
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);
  }, []);

  const handleArchivedMapEnabledChange = useCallback((enabled) => {
    setArchivedMapEnabled(enabled);
    if (enabled) {
      clearDashboardAreaContextCache();
    } else {
      clearArchivedMapProjectionCache();
    }
  }, []);

  const handleStatusChange = useCallback((message) => {
    setStatus(message);
  }, []);

  const handleRolloutHoverChange = useCallback((nextHoverSelection) => {
    setRolloutHoverSelection(nextHoverSelection);
  }, []);

  const handleRolloutSelect = useCallback((nextSelection) => {
    setSelection(nextSelection);
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);
  }, []);

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
                recenterTarget={commissionerProvinceView?.mapTarget ?? null}
                highlightedProvincePrUid={commissionerProvinceView?.pruid ?? null}
                selection={selection}
                externalHoverSelection={rolloutHoverSelection}
                onDaSelect={handleDaSelect}
                onFedSelect={handleFedSelect}
                onStatusChange={handleStatusChange}
                onToggleFullscreen={handleToggleFullscreen}
                rolloutEnabled={isRolloutOpen}
                rolloutCategoryId={rolloutCategoryId}
                heatmap={heatmap}
                archivedMap={archivedMap}
                archivedMapEnabled={archivedMapEnabled}
                onArchivedMapEnabledChange={handleArchivedMapEnabledChange}
                initialArchivedMapEnabled={initialArchivedMapEnabled}
              />
            </div>
          </section>

          {archivedMapEnabled ? (
            <ArchivedMapInfoPanel
              key="archived-map-panel"
              selection={selection}
              profilesByDguid={profilesByDguid}
              panelView={archivedPanelView}
              onPanelViewChange={setArchivedPanelView}
            />
          ) : (
            <MapInfoPanel
              key="live-map-panel"
              variant="commissioner"
              selection={selection}
              profilesByDguid={profilesByDguid}
              panelView={panelView}
              onPanelViewChange={setPanelView}
              rolloutEnabled={isRolloutOpen}
              rolloutCategoryId={rolloutCategoryId}
              onRolloutHoverChange={handleRolloutHoverChange}
              onRolloutSelect={handleRolloutSelect}
              onSelectDguid={handleDaSelect}
            />
          )}
        </div>
      </div>
    </div>
  );
}

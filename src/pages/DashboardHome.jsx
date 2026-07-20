import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { MapInfoPanel, getDefaultPanelView } from "@/components/non_prebuilt/MapInfoPanel.jsx";
import { MapRegionSelector } from "@/components/non_prebuilt/MapRegionSelector.jsx";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { DEFAULT_ROLLOUT_CATEGORY_ID } from "@/lib/map/rolloutPlan.js";
import { getProvinceMapView } from "@/lib/map/provinceView.js";
import { mapApi } from "@/services/mapApi.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import { loadSubmissionHeatmap } from "@/lib/map/heatmap.js";
import { loadArchivedMapEffect } from "@/lib/map/archivedMapEffect.js";
import { subscribeWorkspaceState } from "@/services/tempWorkspace.js";
import "@/styles/map.css";

export default function DashboardHome({ mapSearchTarget = null }) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("Loading map...");
  const [selection, setSelection] = useState(null);
  const [rolloutHoverSelection, setRolloutHoverSelection] = useState(null);
  const [profilesByDguid, setProfilesByDguid] = useState(new Map());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelView, setPanelView] = useState(getDefaultPanelView("commissioner"));
  const [isRolloutOpen, setIsRolloutOpen] = useState(false);
  const [rolloutCategoryId, setRolloutCategoryId] = useState(DEFAULT_ROLLOUT_CATEGORY_ID);
  const [heatmap, setHeatmap] = useState(null);
  const [archivedMap, setArchivedMap] = useState(null);
  const initialArchivedMapEnabled = searchParams.get("archivedMap") === "1";
  const commissionerProvinceView = useMemo(
    () => getProvinceMapView(user?.province),
    [user?.province],
  );
  const activeMapTarget = mapSearchTarget ?? commissionerProvinceView?.mapTarget ?? null;

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
    const unsubscribe = subscribeWorkspaceState(loadHeatmap);

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profilesByDguid.size) return undefined;
    let isMounted = true;
    const load = () => loadArchivedMapEffect(profilesByDguid)
      .then((nextArchivedMap) => {
        if (isMounted) setArchivedMap(nextArchivedMap);
      })
      .catch(() => {
        if (isMounted) setArchivedMap(null);
      });
    load();
    const unsubscribe = subscribeWorkspaceState(load);
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
                mapSearchTarget={activeMapTarget}
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
                initialArchivedMapEnabled={initialArchivedMapEnabled}
              />
            </div>
          </section>

          <MapInfoPanel
            variant="commissioner"
            selection={selection}
            profilesByDguid={profilesByDguid}
            panelView={panelView}
            onPanelViewChange={setPanelView}
            rolloutEnabled={isRolloutOpen}
            rolloutCategoryId={rolloutCategoryId}
            onRolloutHoverChange={handleRolloutHoverChange}
            onRolloutSelect={handleRolloutSelect}
          />
        </div>
      </div>
    </div>
  );
}

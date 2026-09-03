import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useMatch } from "react-router-dom";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { PanelLoadingOverlay } from "@/components/non_prebuilt/LoadingIndicator.jsx";
import { ArchivedMapLayoutContext } from "@/contexts/ArchivedMapLayoutContext.jsx";
import { useMapFullscreen } from "@/contexts/MapFullscreenContext.jsx";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import ArchivedTree from "@/pages/ArchivedTree.jsx";
import "@/styles/map.css";
import "@/styles/workspace-review.css";
import "@/styles/archive-tree.css";
import "@/styles/archived-map-layout.css";

const EMPTY_MAP_CONFIG = {
  objectionPreview: null,
  counterProposalPreview: null,
  focusGeoJson: null,
  workflowFocusDguids: [],
  presentationReadyKey: null,
  status: "",
  mapControls: null,
  onPresentationReady: null,
};

export default function ArchivedMapLayout() {
  const isDetail = Boolean(useMatch("/dashboard/archivedTree/:submissionId/difference"));
  const { isFullscreen, toggle: toggleFullscreen } = useMapFullscreen();
  const [mapActivated, setMapActivated] = useState(false);
  const [mapFetching, setMapFetching] = useState(false);
  const [mapConfig, setMapConfig] = useState(EMPTY_MAP_CONFIG);
  const [mapPresentationReady, setMapPresentationReady] = useState(false);

  const handleInitialPresentationReady = useCallback(() => {
    setMapPresentationReady(true);
    mapConfig.onPresentationReady?.();
  }, [mapConfig]);

  const updateMap = useCallback((patch) => {
    if (patch?.enabled) {
      setMapActivated(true);
    }
    setMapConfig((current) => ({
      ...current,
      ...patch,
    }));
  }, []);

  const contextValue = useMemo(() => ({
    setMapFetching,
    updateMap,
    resetPresentationReady: () => setMapPresentationReady(false),
  }), [updateMap]);

  useEffect(() => {
    if (!isDetail) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousBodyOverflow; };
  }, [isDetail]);

  useEffect(() => {
    if (!isDetail || !mapActivated) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isDetail, mapActivated]);

  const showMapHost = mapActivated || isDetail;

  return (
    <ArchivedMapLayoutContext.Provider value={contextValue}>
      <div
        className={`archived-map-layout${isDetail ? " archived-map-layout--detail" : " archived-map-layout--tree"}${isFullscreen ? " map-dashboard--fullscreen" : ""}`}
      >
        {showMapHost ? (
          <div className="archived-map-host">
            <div className="archived-map-host__canvas-wrap">
              {mapActivated ? (
                <>
                  <div className="sr-only" aria-live="polite">{mapConfig.status}</div>
                  <MapCanvas
                    isFullscreen={isFullscreen}
                    selection={null}
                    objectionPreview={mapConfig.objectionPreview}
                    counterProposalPreview={mapConfig.counterProposalPreview}
                    focusGeoJson={mapConfig.focusGeoJson}
                    workflowFocusDguids={mapConfig.workflowFocusDguids}
                    interactionMode={MAP_INTERACTION_MODE.COUNTER_REVIEW}
                    onStatusChange={(nextStatus) => {
                      setMapConfig((current) => ({ ...current, status: nextStatus }));
                    }}
                    onToggleFullscreen={toggleFullscreen}
                    onInitialPresentationReady={mapPresentationReady ? undefined : handleInitialPresentationReady}
                    presentationReadyKey={mapConfig.presentationReadyKey ?? "archived-map-idle"}
                  />
                  {mapConfig.mapControls}
                </>
              ) : null}
              {mapFetching || !mapActivated ? (
                <PanelLoadingOverlay label="Loading..." />
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="archived-tree-host" inert={isDetail || undefined} aria-hidden={isDetail || undefined}>
          <ArchivedTree />
        </div>
        {isDetail ? (
          <main className="archive-difference-page--layout-panel">
            <Outlet />
          </main>
        ) : null}
      </div>
    </ArchivedMapLayoutContext.Provider>
  );
}

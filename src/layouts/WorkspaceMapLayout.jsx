import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useMatch } from "react-router-dom";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { PanelLoadingOverlay } from "@/components/non_prebuilt/LoadingIndicator.jsx";
import { WorkspaceMapLayoutContext } from "@/contexts/WorkspaceMapLayoutContext.jsx";
import { MAP_INTERACTION_MODE } from "@/lib/map/interactionMode.js";
import "@/styles/map.css";
import "@/styles/workspace-review.css";
import "@/styles/workspace-map-layout.css";

const EMPTY_MAP_CONFIG = {
  objectionPreview: null,
  counterProposalPreview: null,
  focusGeoJson: null,
  workflowFocusDguids: [],
  presentationReadyKey: null,
  geometryError: null,
  status: "",
  mapControls: null,
  onPresentationReady: null,
};

export default function WorkspaceMapLayout() {
  const isDetail = Boolean(useMatch("/dashboard/workspace/:submissionId"));
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

  const showMapHost = mapActivated || (isDetail && !mapConfig.geometryError);

  return (
    <WorkspaceMapLayoutContext.Provider value={contextValue}>
      <div
        className={`workspace-map-layout${isDetail ? " workspace-map-layout--detail" : " workspace-map-layout--tree"}`}
      >
        {showMapHost ? (
          <div className="workspace-map-host">
            {mapConfig.geometryError ? (
              <div className="workspace-review-map-empty" role="status">
                <strong>Map geometry unavailable</strong>
                <p>{mapConfig.geometryError}</p>
              </div>
            ) : (
              <div className="workspace-map-host__canvas-wrap">
                {mapActivated ? (
                  <>
                    <div className="sr-only" aria-live="polite">{mapConfig.status}</div>
                    <MapCanvas
                      selection={null}
                      objectionPreview={mapConfig.objectionPreview}
                      counterProposalPreview={mapConfig.counterProposalPreview}
                      focusGeoJson={mapConfig.focusGeoJson}
                      workflowFocusDguids={mapConfig.workflowFocusDguids}
                      interactionMode={MAP_INTERACTION_MODE.COUNTER_REVIEW}
                      onStatusChange={(nextStatus) => {
                        setMapConfig((current) => ({ ...current, status: nextStatus }));
                      }}
                      onInitialPresentationReady={mapPresentationReady ? undefined : handleInitialPresentationReady}
                      presentationReadyKey={mapConfig.presentationReadyKey ?? "workspace-map-idle"}
                    />
                    {mapConfig.mapControls}
                  </>
                ) : null}
                {mapFetching || !mapActivated ? (
                  <PanelLoadingOverlay label="Loading..." />
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        {isDetail ? (
          <main className="workspace-review-page workspace-review-page--layout-panel">
            <Outlet />
          </main>
        ) : (
          <Outlet />
        )}
      </div>
    </WorkspaceMapLayoutContext.Provider>
  );
}

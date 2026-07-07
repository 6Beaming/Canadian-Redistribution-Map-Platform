import { useCallback, useEffect, useMemo, useState } from "react";
import { HorizontalTabs } from "@/components/ui/horizontal-tabs";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { MapInfoPanel, getDefaultPanelView, getPanelViews } from "@/components/non_prebuilt/MapInfoPanel.jsx";
import { MapRegionSelector } from "@/components/non_prebuilt/MapRegionSelector.jsx";
import UserMenuLeft from "@/components/non_prebuilt/UserMenuLeft.jsx";
import { DEFAULT_ROLLOUT_CATEGORY_ID } from "@/lib/map/rolloutPlan.js";
import { mapApi } from "@/services/mapApi.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import "@/styles/map.css";

export default function UserHome() {
  const [status, setStatus] = useState("Loading map...");
  const [selection, setSelection] = useState(null);
  const [rolloutHoverSelection, setRolloutHoverSelection] = useState(null);
  const [profilesByDguid, setProfilesByDguid] = useState(new Map());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelView, setPanelView] = useState(getDefaultPanelView("user"));
  const [isRolloutOpen, setIsRolloutOpen] = useState(false);
  const [rolloutCategoryId, setRolloutCategoryId] = useState(DEFAULT_ROLLOUT_CATEGORY_ID);
  const views = useMemo(() => getPanelViews("user"), []);
  const tabItems = useMemo(
    () =>
      views.map((item, index) => ({
        ...item,
        disabled: !selection && index > 0,
      })),
    [selection, views],
  );

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
    setSelection({ type: "da", dguid });
    setRolloutHoverSelection(null);
    setIsRolloutOpen(false);
  }, []);

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
            onRolloutHoverChange={handleRolloutHoverChange}
            onRolloutSelect={handleRolloutSelect}
          />
        </div>
      </div>
    </div>
  );
}

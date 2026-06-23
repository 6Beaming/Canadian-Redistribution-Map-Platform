import { useCallback, useEffect, useState } from "react";
import { MapCanvas } from "@/components/non_prebuilt/MapCanvas.jsx";
import { MapInfoPanel } from "@/components/non_prebuilt/MapInfoPanel.jsx";
import { mapApi } from "@/services/mapApi.js";
import { buildProfileIndex } from "@/lib/map/profileUtils.js";
import "@/styles/map.css";

export default function UserHome() {
  const [status, setStatus] = useState("Loading map…");
  const [selection, setSelection] = useState(null);
  const [profilesByDguid, setProfilesByDguid] = useState(new Map());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    mapApi
      .getDaProfiles()
      .then((payload) => {
        if (!isMounted) return;
        const { index } = buildProfileIndex(payload);
        setProfilesByDguid(index);
      })
      .catch((error) => {
        if (isMounted) setStatus(`Error: ${error.message}`);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isFullscreen) return undefined;

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

  const handleDaSelect = useCallback((dguid) => {
    setSelection({ type: "da", dguid });
  }, []);

  const handleFedSelect = useCallback((fedNum, fedName) => {
    setSelection({ type: "fed", fedNum, fedName });
  }, []);

  const handleStatusChange = useCallback((message) => {
    setStatus(message);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((current) => !current);
  }, []);

  return (
    <div className="p-6 flex flex-col gap-6 max-w-screen-xl mx-auto">
      {!isFullscreen ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-gray-500">
            Click a dissemination area on the map to view its census data.
          </p>
        </div>
      ) : null}

      <div
        className={
          isFullscreen
            ? undefined
            : "rounded-xl border border-gray-300 shadow-md overflow-hidden h-[700px]"
        }
      >
        <div
          className={`map-dashboard h-full${isFullscreen ? " map-dashboard--fullscreen" : ""}`}
        >
          <section className="map-dashboard__main h-full" aria-label="Map workspace">
            <div className="map-dashboard__map-wrap h-full">
              <div className="map-dashboard__status" aria-live="polite">
                {status}
              </div>
              <MapCanvas
                isFullscreen={isFullscreen}
                onDaSelect={handleDaSelect}
                onFedSelect={handleFedSelect}
                onStatusChange={handleStatusChange}
                onToggleFullscreen={handleToggleFullscreen}
              />
            </div>
          </section>
          <MapInfoPanel selection={selection} profilesByDguid={profilesByDguid} />
        </div>
      </div>
    </div>
  );
}

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

  useEffect(() => {
    let isMounted = true;
    mapApi.getDaProfiles().then((payload) => {
      if (!isMounted) return;
      const { index } = buildProfileIndex(payload);
      setProfilesByDguid(index);
    }).catch((error) => {
      if (isMounted) setStatus(`Error: ${error.message}`);
    });
    return () => { isMounted = false; };
  }, []);

  const handleDaSelect = useCallback((dguid) => {
    setSelection({ type: "da", dguid });
  }, []);

  const handleFedSelect = useCallback((fedNum, fedName) => {
    setSelection({ type: "fed", fedNum, fedName });
  }, []);

  const handleStatusChange = useCallback((message) => {
    setStatus(message);
  }, []);

  return (
    <div className="p-6 flex flex-col gap-6 max-w-screen-xl mx-auto">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-gray-500">
          Click a dissemination area on the map to view its census data.
        </p>
      </div>

      <div className="rounded-xl border border-gray-300 shadow-md overflow-hidden h-[700px]">
        <div className="map-dashboard h-full">
          <section className="map-dashboard__main h-full">
            <div className="map-dashboard__map-wrap h-full">
              <div className="map-dashboard__status">{status}</div>
              <MapCanvas
                isFullscreen={false}
                onDaSelect={handleDaSelect}
                onFedSelect={handleFedSelect}
                onStatusChange={handleStatusChange}
                onToggleFullscreen={() => {}}
              />
            </div>
          </section>
          <MapInfoPanel selection={selection} profilesByDguid={profilesByDguid} />
        </div>
      </div>
    </div>
  );
}
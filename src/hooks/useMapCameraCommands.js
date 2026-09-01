import { useCallback, useEffect, useRef, useState } from "react";

let nextCameraRequestId = 1;

function createCameraCommand(source, target) {
  if (!target) return null;
  return {
    requestId: nextCameraRequestId++,
    source,
    target,
  };
}

/**
 * Issues one-shot map camera commands. MapCanvas consumes each requestId at most once,
 * so map-ready ticks and selection changes never re-trigger presenter movement.
 */
export function useMapCameraCommands({ initialTarget = null } = {}) {
  const [cameraCommand, setCameraCommand] = useState(null);
  const issuedInitialRef = useRef(false);
  const lastInitialTargetKeyRef = useRef("");

  useEffect(() => {
    if (!initialTarget) return;

    const targetKey = [
      initialTarget.location?.[0],
      initialTarget.location?.[1],
      initialTarget.zoom,
      initialTarget.label,
    ].join(":");

    if (!targetKey || targetKey === lastInitialTargetKeyRef.current) {
      return;
    }

    lastInitialTargetKeyRef.current = targetKey;
    const source = issuedInitialRef.current ? "recenter" : "initial";
    issuedInitialRef.current = true;
    setCameraCommand(createCameraCommand(source, initialTarget));
  }, [initialTarget]);

  const issueCommand = useCallback((source, target) => {
    setCameraCommand(createCameraCommand(source, target));
  }, []);

  const recenter = useCallback((target) => {
    issueCommand("recenter", target);
  }, [issueCommand]);

  const search = useCallback((target) => {
    issueCommand("search", target);
  }, [issueCommand]);

  const clearPending = useCallback(() => {
    setCameraCommand(null);
  }, []);

  return {
    cameraCommand,
    recenter,
    search,
    clearPending,
  };
}

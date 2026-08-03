import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { RealtimeClient } from "../lib/realtime/realtimeClient.js";
import {
  invalidateRealtimeEvent,
  resyncRealtimeQueries,
} from "../lib/realtime/realtimeInvalidation.js";

const RealtimeContext = createContext(null);

export function RealtimeProvider({ children }) {
  const { clearSession, sessionStatus, user } = useAuth();
  const [connectionState, setConnectionState] = useState("offline");
  const [lastEvent, setLastEvent] = useState(null);
  const clientRef = useRef(null);

  if (!clientRef.current) {
    clientRef.current = new RealtimeClient({
      onEvent: async (event) => {
        setLastEvent(event);
        await invalidateRealtimeEvent(event);
      },
      onResync: resyncRealtimeQueries,
      onStateChange: setConnectionState,
      onUnauthorized: clearSession,
    });
  }

  const sessionKey = user
    ? [user.id, user.role, user.province].map((value) => String(value ?? "")).join(":")
    : null;

  useEffect(() => {
    const client = clientRef.current;
    if (sessionStatus === "signed-in" && sessionKey) client.start(sessionKey);
    else client.stop();
    return () => client.stop();
  }, [sessionKey, sessionStatus]);

  const value = useMemo(() => ({
    connectionState,
    disconnect: () => clientRef.current.disconnect(),
    lastEvent,
    reconnect: () => clientRef.current.reconnect(),
  }), [connectionState, lastEvent]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error("useRealtime must be used inside RealtimeProvider");
  return context;
}


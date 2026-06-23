import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../services/authApi.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [sessionStatus, setSessionStatus] = useState("checking");

  const clearSession = useCallback(() => {
    setUser(null);
    setSessionStatus("signed-out");
  }, []);

  const markSignedIn = useCallback((nextUser) => {
    setUser(nextUser || null);
    setSessionStatus(nextUser ? "signed-in" : "signed-out");
  }, []);

  const refreshSession = useCallback(async () => {
    setSessionStatus("checking");

    try {
      const { user: currentUser } = await authApi.getCurrentUser();

      if (currentUser) {
        markSignedIn(currentUser);
        return currentUser;
      }
    } catch {
      // No active app session.
    }

    clearSession();
    return null;
  }, [clearSession, markSignedIn]);

  const signOut = useCallback(async () => {
    await authApi.logout();
    clearSession();
  }, [clearSession]);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const { user: currentUser } = await authApi.getCurrentUser();

        if (!isMounted) {
          return;
        }

        if (currentUser) {
          markSignedIn(currentUser);
          return;
        }
      } catch {
        // No active app session.
      }

      if (isMounted) {
        clearSession();
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, [clearSession, markSignedIn]);

  const value = useMemo(
    () => ({
      clearSession,
      markSignedIn,
      refreshSession,
      sessionStatus,
      signOut,
      user
    }),
    [clearSession, markSignedIn, refreshSession, sessionStatus, signOut, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}

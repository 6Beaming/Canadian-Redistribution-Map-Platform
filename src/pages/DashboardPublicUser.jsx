import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/authApi.js";

export default function DashboardPublicUser() {
  const navigate = useNavigate();
  const [sessionStatus, setSessionStatus] = useState("checking");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        await authApi.getCurrentUser();

        if (!isMounted) {
          return;
        }

        setSessionStatus("signed-in");
      } catch {
        if (isMounted) {
          setSessionStatus("signed-out");
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  async function handleAuthAction() {
    if (sessionStatus !== "signed-in") {
      navigate("/sign-in");
      return;
    }

    setIsSubmitting(true);

    try {
      await authApi.logout();
      setSessionStatus("signed-out");
      navigate("/sign-in", { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="brand-lockup">
          <div>
            <h1>Public User Dashboard</h1>
          </div>
        </div>
        <button
          className="ghost-button sign-out-button"
          disabled={sessionStatus === "checking" || isSubmitting}
          onClick={handleAuthAction}
          type="button"
        >
          {sessionStatus === "signed-in" ? "Sign Out" : "Sign In"}
        </button>
      </header>
    </main>
  );
}

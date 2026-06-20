import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/authApi.js";

export default function DashboardCommissioner() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const { user } = await authApi.getCurrentUser();

        if (isMounted && user?.role !== "commissioner") {
          navigate("/", { replace: true });
        }
      } catch {
        if (isMounted) {
          navigate("/", { replace: true });
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  async function handleSignOut() {
    setIsSubmitting(true);

    try {
      await authApi.logout();
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
            <h1>Commissioner Dashboard</h1>
          </div>
        </div>
        <button
          className="ghost-button sign-out-button"
          disabled={isSubmitting}
          onClick={handleSignOut}
          type="button"
        >
          Sign Out
        </button>
      </header>
    </main>
  );
}

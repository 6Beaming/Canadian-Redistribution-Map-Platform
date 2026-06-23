import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function DashboardCommissioner() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { sessionStatus, signOut, user } = useAuth();

  useEffect(() => {
    if (sessionStatus === "checking") {
      return;
    }

    if (sessionStatus === "signed-out") {
      navigate("/sign-in", { replace: true });
      return;
    }

    if (user?.role !== "commissioner") {
      navigate("/", { replace: true });
    }
  }, [navigate, sessionStatus, user]);

  async function handleSignOut() {
    setIsSubmitting(true);

    try {
      await signOut();
      navigate("/sign-in", { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sessionStatus !== "signed-in" || user?.role !== "commissioner") {
    return null;
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

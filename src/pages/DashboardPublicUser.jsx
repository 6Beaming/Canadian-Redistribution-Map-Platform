import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/authApi.js";

export default function DashboardPublicUser() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setError("");
    setIsSigningOut(true);

    try {
      await authApi.logout();
      navigate("/", { replace: true });
    } catch (signOutError) {
      setError(signOutError.message);
      setIsSigningOut(false);
    }
  }

  return (
    <div>
      <h1>Public User dashboard</h1>
      <p>This page is for public users</p>
      {error ? <p>{error}</p> : null}
      <button disabled={isSigningOut} onClick={handleSignOut} type="button">
        {isSigningOut ? "Signing out" : "Sign Out"}
      </button>
    </div>
  );
}

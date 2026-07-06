import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthLinkClient } from "@/services/authLinkClient.js";

const initialPasswordForm = {
  confirmPassword: "",
  password: ""
};

export default function PasswordSetupPage({ mode }) {
  const navigate = useNavigate();
  const isInviteFlow = mode === "invite";
  const [form, setForm] = useState(initialPasswordForm);
  const [authClient, setAuthClient] = useState(null);
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    try {
      const client = getAuthLinkClient();
      setAuthClient(client);

      const { data } = client.auth.onAuthStateChange((event) => {
        if (
          isMounted &&
          (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")
        ) {
          setError("");
          setStatus("ready");
        }
      });

      client.auth.getSession().then(({ data: sessionData }) => {
        if (!isMounted) {
          return;
        }

        if (sessionData?.session) {
          setError("");
          setStatus("ready");
          return;
        }

        setError(
          isInviteFlow
            ? "Open the commissioner invitation link from your email to continue."
            : "Open the password reset link from your email to continue."
        );
        setStatus("error");
      });

      return () => {
        isMounted = false;
        data.subscription.unsubscribe();
      };
    } catch (setupError) {
      setError(setupError.message);
      setStatus("error");
    }
  }, [isInviteFlow]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setStatus("submitting");
      const { error: updateError } = await authClient.auth.updateUser({
        password: form.password
      });

      if (updateError) {
        throw updateError;
      }

      await authClient.auth.signOut();
      setForm(initialPasswordForm);
      navigate("/sign-in", {
        replace: true,
        state: {
          notice: isInviteFlow
            ? "Invitation verified and password created. You can now sign in."
            : "Password updated. You can now sign in."
        }
      });
    } catch (updateError) {
      setError(updateError.message || "Unable to update password.");
      setStatus("ready");
    }
  }

  const canShowForm = status === "ready" || status === "submitting";

  return (
    <main className="auth-shell">
      <section
        className="auth-layout"
        aria-label={
          isInviteFlow ? "Accept commissioner invitation" : "Reset password"
        }
      >
        <div className="login-panel">
          <div className="brand-lockup">
            <div>
              <h1>
                {isInviteFlow
                  ? "Accept Commissioner Invitation"
                  : "Reset Password"}
              </h1>
            </div>
          </div>

          {canShowForm ? (
            <form className="login-form" onSubmit={handleSubmit}>
              <label htmlFor="new-password">
                {isInviteFlow ? "Create Password" : "New Password"}
              </label>
              <input
                autoComplete="new-password"
                disabled={status === "submitting"}
                id="new-password"
                name="password"
                onChange={handleChange}
                required
                type="password"
                value={form.password}
              />

              <label htmlFor="confirm-password">Confirm Password</label>
              <input
                autoComplete="new-password"
                disabled={status === "submitting"}
                id="confirm-password"
                name="confirmPassword"
                onChange={handleChange}
                required
                type="password"
                value={form.confirmPassword}
              />

              {error ? <p className="form-error">{error}</p> : null}

              <button
                className="primary-button"
                disabled={status === "submitting"}
                type="submit"
              >
                <ShieldCheck aria-hidden="true" size={19} />
                <span>
                  {status === "submitting"
                    ? isInviteFlow
                      ? "Creating password"
                      : "Updating password"
                    : isInviteFlow
                      ? "Create password"
                      : "Update password"}
                </span>
              </button>

              <button
                className="text-button"
                onClick={() => navigate("/sign-in")}
                type="button"
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <div className="login-form">
              {status === "checking" ? (
                <div className="loading-mark" aria-label="Checking email link" />
              ) : null}
              {error ? <p className="form-error">{error}</p> : null}
              <button
                className="text-button"
                onClick={() => navigate("/sign-in")}
                type="button"
              >
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

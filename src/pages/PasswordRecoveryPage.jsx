import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPasswordRecoveryClient } from "../services/passwordRecoveryClient.js";

const initialPasswordResetForm = {
  confirmPassword: "",
  password: ""
};

// This is the page opened from the email reset link. User enters a new password and confirms it.
export default function PasswordRecoveryPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialPasswordResetForm);
  const [recoveryClient, setRecoveryClient] = useState(null);
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let isMounted = true;

    try {
      const client = getPasswordRecoveryClient();
      setRecoveryClient(client);

      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY" && isMounted) {
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

        setError("Open the password reset link from your email to continue.");
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
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
    setError("");
    setNotice("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

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
      const { error: updateError } = await recoveryClient.auth.updateUser({
        password: form.password
      });

      if (updateError) {
        throw updateError;
      }

      await recoveryClient.auth.signOut();
      setForm(initialPasswordResetForm);
      navigate("/sign-in", {
        replace: true,
        state: { notice: "Password updated. You can now sign in." }
      });
    } catch (updateError) {
      setError(updateError.message || "Unable to update password.");
      setStatus("ready");
    }
  }

  const canShowResetForm = status === "ready" || status === "submitting";

  return (
    <main className="auth-shell">
      <section className="auth-layout" aria-label="Reset password">
        <div className="login-panel">
          <div className="brand-lockup">
            <div>
              <h1>Reset Password</h1>
            </div>
          </div>

          {canShowResetForm ? (
            <form className="login-form" onSubmit={handleSubmit}>
              <label htmlFor="new-password">New Password</label>
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
              {notice ? <p className="form-success">{notice}</p> : null}

              <Button
                className="mt-3 w-full"
                disabled={status === "submitting"}
                type="submit"
              >
                <ShieldCheck aria-hidden="true" size={19} />
                <span>
                  {status === "submitting"
                    ? "Updating password"
                    : "Update password"}
                </span>
              </Button>

              <Button
                onClick={() => navigate("/sign-in")}
                type="button"
                variant="link"
                size="sm"
                className="justify-self-center"
              >
                Back to sign in
              </Button>
            </form>
          ) : (
            <div className="login-form">
              {status === "checking" ? (
                <div className="loading-mark" aria-label="Checking reset link" />
              ) : null}
              {error ? <p className="form-error">{error}</p> : null}
              {notice ? <p className="form-success">{notice}</p> : null}
              <Button
                onClick={() => navigate("/sign-in")}
                type="button"
                variant="link"
                size="sm"
                className="justify-self-center"
              >
                Back to sign in
              </Button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

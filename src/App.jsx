import { LogIn, LogOut, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { authApi } from "./services/authApi.js";
import { getPasswordRecoveryClient } from "./services/passwordRecoveryClient.js";

const initialForm = {
  email: "",
  password: "",
  confirmPassword: ""
};

const initialPasswordResetForm = {
  password: "",
  confirmPassword: ""
};

function ResetPasswordView() {
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
      window.history.replaceState({}, "", "/");
      setForm(initialPasswordResetForm);
      setNotice("Password updated. You can now sign in.");
      setStatus("complete");
    } catch (updateError) {
      setError(updateError.message || "Unable to update password.");
      setStatus("ready");
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-layout" aria-label="Reset password">
        <div className="login-panel">
          <div className="brand-lockup">
            <div>
              <h1>Reset Password</h1>
            </div>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label htmlFor="new-password">New Password</label>
            <input
              autoComplete="new-password"
              disabled={status !== "ready"}
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
              disabled={status !== "ready"}
              id="confirm-password"
              name="confirmPassword"
              onChange={handleChange}
              required
              type="password"
              value={form.confirmPassword}
            />

            {error ? <p className="form-error">{error}</p> : null}
            {notice ? <p className="form-success">{notice}</p> : null}

            <button
              className="primary-button"
              disabled={status !== "ready"}
              type="submit"
            >
              <ShieldCheck aria-hidden="true" size={19} />
              <span>
                {status === "submitting" ? "Updating password" : "Update password"}
              </span>
            </button>

            <button
              className="text-button"
              onClick={() => window.location.assign("/")}
              type="button"
            >
              Back to sign in
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [form, setForm] = useState(initialForm);
  const [authView, setAuthView] = useState("login");
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isPasswordRecoveryRoute = window.location.pathname === "/reset-password";

  const initials = useMemo(() => {
    const source = user?.name || user?.email || "";
    return source
      .split(/[.@\s_-]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [user]);

  useEffect(() => {
    if (isPasswordRecoveryRoute) {
      setStatus("signed-out");
      return;
    }

    let isMounted = true;

    authApi
      .getCurrentUser()
      .then(({ user: currentUser }) => {
        if (isMounted) {
          setUser(currentUser);
          setStatus("signed-in");
        }
      })
      .catch(() => {
        if (isMounted) {
          setStatus("signed-out");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isPasswordRecoveryRoute]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
    setError("");
    setNotice("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("submitting");
    setError("");
    setNotice("");

    try {
      const { user: signedInUser } = await authApi.login(form);
      setUser(signedInUser);
      setForm(initialForm);
      setStatus("signed-in");
    } catch (loginError) {
      setError(loginError.message);
      setStatus("signed-out");
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    setStatus("submitting");
    setError("");
    setNotice("");

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      setStatus("signed-out");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      setStatus("signed-out");
      return;
    }

    try {
      const { message } = await authApi.signup({
        email: form.email,
        password: form.password
      });

      setForm(initialForm);
      setNotice(message);
      setStatus("signed-out");
    } catch (signupError) {
      setError(signupError.message);
      setStatus("signed-out");
    }
  }

  async function handlePasswordReset(event) {
    event.preventDefault();
    setStatus("submitting");
    setError("");
    setNotice("");

    try {
      const { message } = await authApi.requestPasswordReset({
        email: form.email
      });

      setNotice(message);
      setStatus("signed-out");
    } catch (resetError) {
      setError(resetError.message);
      setStatus("signed-out");
    }
  }

  function showResetForm() {
    setAuthView("reset");
    setForm((currentForm) => ({
      ...currentForm,
      password: "",
      confirmPassword: ""
    }));
    setError("");
    setNotice("");
  }

  function showSignupForm() {
    setAuthView("signup");
    setForm((currentForm) => ({
      ...currentForm,
      password: "",
      confirmPassword: ""
    }));
    setError("");
    setNotice("");
  }

  function showLoginForm() {
    setAuthView("login");
    setForm((currentForm) => ({
      ...currentForm,
      password: "",
      confirmPassword: ""
    }));
    setError("");
    setNotice("");
  }

  async function handleLogout() {
    setStatus("submitting");
    setError("");
    setNotice("");

    try {
      await authApi.logout();
      setUser(null);
      setStatus("signed-out");
    } catch (logoutError) {
      setError(logoutError.message);
      setStatus(user ? "signed-in" : "signed-out");
    }
  }

  if (isPasswordRecoveryRoute) {
    return <ResetPasswordView />;
  }

  if (status === "checking") {
    return (
      <main className="screen-center">
        <div className="loading-mark" aria-label="Loading session" />
      </main>
    );
  }

  if (user) {
    return (
      <main className="dashboard-shell">
        <header className="dashboard-header">
          <div className="brand-lockup">
            <div>
              <p className="eyebrow">CRMP</p>
              <h1>Commissioner Dashboard</h1>
            </div>
          </div>
          <button
            className="ghost-button"
            onClick={handleLogout}
            disabled={status === "submitting"}
            type="button"
          >
            <LogOut aria-hidden="true" size={18} />
            <span>{status === "submitting" ? "Signing out" : "Sign out"}</span>
          </button>
        </header>

        <section className="workspace-grid" aria-label="Dashboard">
          <div className="profile-panel">
            <div className="avatar" aria-hidden="true">
              {initials || "C"}
            </div>
            <div>
              <p className="panel-label">Signed in as</p>
              <h2>{user.name || user.email}</h2>
              <p>{user.email}</p>
              <span className="role-pill">{user.role}</span>
            </div>
          </div>

          <div className="status-panel">
            <ShieldCheck aria-hidden="true" size={28} />
            <div>
              <p className="panel-label">Session</p>
              <h2>Authenticated</h2>
              <p>Protected API calls can now use the HttpOnly session cookie.</p>
            </div>
          </div>
        </section>

        {error ? <p className="form-error">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-layout" aria-label="User sign in">
        <div className="login-panel">
          <div className="brand-lockup">
            <div>
              <h1>
                {authView === "reset"
                  ? "Reset Password"
                  : authView === "signup"
                    ? "Sign Up"
                    : "Sign In"}
              </h1>
            </div>
          </div>

          <form
            className="login-form"
            onSubmit={
              authView === "reset"
                ? handlePasswordReset
                : authView === "signup"
                  ? handleSignup
                  : handleSubmit
            }
          >
            <label htmlFor="email">Email</label>
            <input
              autoComplete="email"
              id="email"
              name="email"
              onChange={handleChange}
              required
              type="email"
              value={form.email}
            />

            {authView !== "reset" ? (
              <>
                <label htmlFor="password">Password</label>
                <input
                  autoComplete={
                    authView === "signup" ? "new-password" : "current-password"
                  }
                  id="password"
                  name="password"
                  onChange={handleChange}
                  required
                  type="password"
                  value={form.password}
                />
                {authView === "login" ? (
                  <button
                    className="inline-text-button forgot-password-button"
                    onClick={showResetForm}
                    type="button"
                  >
                    Forgot password?
                  </button>
                ) : null}
              </>
            ) : null}

            {authView === "signup" ? (
              <>
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  autoComplete="new-password"
                  id="confirmPassword"
                  name="confirmPassword"
                  onChange={handleChange}
                  required
                  type="password"
                  value={form.confirmPassword}
                />
              </>
            ) : null}

            {error ? <p className="form-error">{error}</p> : null}
            {notice ? <p className="form-success">{notice}</p> : null}

            <button
              className="primary-button"
              disabled={status === "submitting"}
              type="submit"
            >
              {authView === "reset" ? (
                <Mail aria-hidden="true" size={19} />
              ) : authView === "signup" ? (
                <UserPlus aria-hidden="true" size={19} />
              ) : (
                <LogIn aria-hidden="true" size={19} />
              )}
              <span>
                {authView === "reset"
                  ? status === "submitting"
                    ? "Sending link"
                    : "Send reset link"
                  : authView === "signup"
                    ? status === "submitting"
                      ? "Creating account"
                      : "Sign up"
                  : status === "submitting"
                    ? "Signing in"
                    : "Sign in"}
              </span>
            </button>

            {authView === "login" ? (
              <p className="auth-prompt">
                <span>New user?</span>
                <button
                  className="inline-text-button"
                  onClick={showSignupForm}
                  type="button"
                >
                  Create an account
                </button>
              </p>
            ) : (
              <button
                className="text-button"
                onClick={showLoginForm}
                type="button"
              >
                Back to sign in
              </button>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}

export default App;

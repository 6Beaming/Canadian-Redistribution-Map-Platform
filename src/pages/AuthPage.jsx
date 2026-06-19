import {
  ArrowLeft,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  UserCircle,
  UserPlus
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { authApi } from "../services/authApi.js";
import { getPasswordRecoveryClient } from "../services/passwordRecoveryClient.js";

const initialForm = {
  email: "",
  password: "",
  confirmPassword: ""
};

const initialProfileForm = {
  firstName: "",
  lastName: "",
  province: "",
  postalCode: "",
  sin: "",
  dob: ""
};

const initialPasswordResetForm = {
  password: "",
  confirmPassword: ""
};

const provinces = [
  ["AB", "Alberta"],
  ["BC", "British Columbia"],
  ["MB", "Manitoba"],
  ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"],
  ["NT", "Northwest Territories"],
  ["NU", "Nunavut"],
  ["ON", "Ontario"],
  ["PE", "Prince Edward Island"],
  ["QC", "Quebec"],
  ["SK", "Saskatchewan"],
  ["YT", "Yukon"]
];

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

function AuthPage() {
  const [form, setForm] = useState(initialForm);
  const [profileForm, setProfileForm] = useState(initialProfileForm);
  const [authView, setAuthView] = useState("login");
  const [pendingProfileUser, setPendingProfileUser] = useState(null);
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signedInView, setSignedInView] = useState("dashboard");
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

    async function restoreSession() {
      try {
        const { user: currentUser } = await authApi.getCurrentUser();

        if (isMounted) {
          setUser(currentUser);
          setPendingProfileUser(null);
          setStatus("signed-in");
        }

        return;
      } catch {
        // No complete app session; check for an onboarding-only session.
      }

      try {
        const pendingResult = await authApi.getPendingProfileSession();

        if (isMounted && pendingResult?.profileRequired) {
          setUser(null);
          setPendingProfileUser(pendingResult.user);
          setStatus("profile-required");
          return;
        }
      } catch {
        // No pending onboarding session either.
      }

      if (isMounted) {
        setUser(null);
        setPendingProfileUser(null);
        setStatus("signed-out");
      }
    }

    restoreSession();

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

  function handlePasswordChange(event) {
    setForm((currentForm) => ({
      ...currentForm,
      password: event.target.value
    }));
    setError("");
    setNotice("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("submitting");
    setError("");
    setNotice("");

    try {
      const result = await authApi.login(form);
      setForm(initialForm);

      if (result.profileRequired) {
        setUser(null);
        setPendingProfileUser(result.user);
        setStatus("profile-required");
        return;
      }

      setPendingProfileUser(null);
      setUser(result.user);
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

  function handleProfileChange(event) {
    const { name, value } = event.target;
    setProfileForm((currentForm) => ({ ...currentForm, [name]: value }));
    setError("");
    setNotice("");
  }

  async function handleCompleteProfile(event) {
    event.preventDefault();
    setStatus("submitting");
    setError("");
    setNotice("");

    try {
      const { user: updatedUser } = await authApi.completeProfile(profileForm);
      setPendingProfileUser(null);
      setUser(updatedUser);
      setProfileForm(initialProfileForm);
      setStatus("signed-in");
    } catch (profileError) {
      setError(profileError.message);
      setStatus("profile-required");
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
      setPendingProfileUser(null);
      setSignedInView("dashboard");
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

  if (pendingProfileUser && status === "profile-required") {
    return (
      <main className="auth-shell">
        <section className="auth-layout" aria-label="Complete profile">
          <div className="login-panel">
            <div className="onboarding-header">
              <button
                aria-label="Back to sign in"
                className="icon-button"
                onClick={handleLogout}
                disabled={status === "submitting"}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={22} />
              </button>
              <div className="brand-lockup">
                <div>
                  <h1>Complete Profile</h1>
                </div>
              </div>
            </div>

            <form className="login-form" onSubmit={handleCompleteProfile}>
              <div className="form-row">
                <div>
                  <label htmlFor="firstName">First Name</label>
                  <input
                    autoComplete="given-name"
                    id="firstName"
                    name="firstName"
                    onChange={handleProfileChange}
                    required
                    type="text"
                    value={profileForm.firstName}
                  />
                </div>
                <div>
                  <label htmlFor="lastName">Last Name</label>
                  <input
                    autoComplete="family-name"
                    id="lastName"
                    name="lastName"
                    onChange={handleProfileChange}
                    required
                    type="text"
                    value={profileForm.lastName}
                  />
                </div>
              </div>

              <label htmlFor="province">Province</label>
              <select
                autoComplete="address-level1"
                id="province"
                name="province"
                onChange={handleProfileChange}
                required
                value={profileForm.province}
              >
                <option value="">Select province or territory</option>
                {provinces.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>

              <div className="form-row">
                <div>
                  <label htmlFor="postalCode">Postal Code</label>
                  <input
                    autoComplete="postal-code"
                    id="postalCode"
                    name="postalCode"
                    onChange={handleProfileChange}
                    placeholder="A1A 1A1"
                    required
                    type="text"
                    value={profileForm.postalCode}
                  />
                </div>
                <div>
                  <label htmlFor="dob">Date of Birth</label>
                  <input
                    autoComplete="bday"
                    id="dob"
                    name="dob"
                    onChange={handleProfileChange}
                    required
                    type="date"
                    value={profileForm.dob}
                  />
                </div>
              </div>

              <label htmlFor="sin">SIN</label>
              <input
                autoComplete="off"
                id="sin"
                inputMode="numeric"
                name="sin"
                onChange={handleProfileChange}
                pattern="[0-9 -]{9,11}"
                required
                type="password"
                value={profileForm.sin}
              />

              {error ? <p className="form-error">{error}</p> : null}

              <button
                className="primary-button"
                disabled={status === "submitting"}
                type="submit"
              >
                <ShieldCheck aria-hidden="true" size={19} />
                <span>
                  {status === "submitting" ? "Saving profile" : "Continue"}
                </span>
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  if (user) {
    return (
      <main className="dashboard-shell">
        <header className="dashboard-header">
          <div className="brand-lockup">
            <div>
              <h1>{signedInView === "profile" ? "Profile" : "Dashboard"}</h1>
            </div>
          </div>
          {signedInView === "profile" ? (
            <button
              className="ghost-button"
              onClick={() => setSignedInView("dashboard")}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={18} />
              <span>Dashboard</span>
            </button>
          ) : (
            <button
              aria-label="Open profile"
              className="profile-icon-button"
              onClick={() => setSignedInView("profile")}
              type="button"
            >
              <UserCircle aria-hidden="true" size={34} />
            </button>
          )}
        </header>

        {signedInView === "profile" ? (
          <section className="profile-page" aria-label="Profile">
            <div className="avatar" aria-hidden="true">
              {initials || "C"}
            </div>
            <div>
              <p className="panel-label">Signed in as</p>
              <h2>{user.name || user.email}</h2>
              <p>{user.email}</p>
              <span className="role-pill">{user.role}</span>
            </div>
            <button
              className="ghost-button sign-out-button"
              onClick={handleLogout}
              disabled={status === "submitting"}
              type="button"
            >
              <LogOut aria-hidden="true" size={18} />
              <span>{status === "submitting" ? "Signing out" : "Sign out"}</span>
            </button>
          </section>
        ) : (
          <section className="dashboard-empty" aria-label="Dashboard" />
        )}

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
                <label
                  htmlFor={
                    authView === "login" ? "signin-passcode" : "signup-password"
                  }
                >
                  Password
                </label>
                <input
                  data-1p-ignore={authView === "login" ? "true" : undefined}
                  data-lpignore={authView === "login" ? "true" : undefined}
                  autoComplete={
                    authView === "login" ? "one-time-code" : "new-password"
                  }
                  id={authView === "login" ? "signin-passcode" : "signup-password"}
                  key={`${authView}-password`}
                  name={authView === "login" ? "signin-passcode" : "password"}
                  onChange={handlePasswordChange}
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

export default AuthPage;

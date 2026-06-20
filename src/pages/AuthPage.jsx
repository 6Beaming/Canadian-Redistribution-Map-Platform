import {
  ArrowLeft,
  KeyRound,
  LogIn,
  Mail,
  ShieldCheck,
  UserPlus
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/authApi.js";
import { getPasswordRecoveryClient } from "../services/passwordRecoveryClient.js";

const initialForm = {
  confirmPassword: "",
  email: "",
  password: ""
};

const initialProfileForm = {
  firstName: "",
  lastName: "",
  phoneNumber: "",
  postalCode: "",
  province: ""
};

const initialOtpForm = {
  token: ""
};

const initialPasswordResetForm = {
  confirmPassword: "",
  password: ""
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

function getInitialAuthView() {
  const view = new URLSearchParams(window.location.search).get("view");

  if (view === "login" || view === "reset" || view === "signup") {
    return view;
  }

  return "signup";
}

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

              <button
                className="primary-button"
                disabled={status === "submitting"}
                type="submit"
              >
                <ShieldCheck aria-hidden="true" size={19} />
                <span>
                  {status === "submitting"
                    ? "Updating password"
                    : "Update password"}
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
          ) : (
            <div className="login-form">
              {status === "checking" ? (
                <div className="loading-mark" aria-label="Checking reset link" />
              ) : null}
              {error ? <p className="form-error">{error}</p> : null}
              {notice ? <p className="form-success">{notice}</p> : null}
              <button
                className="text-button"
                onClick={() => window.location.assign("/")}
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

function AuthPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [profileForm, setProfileForm] = useState(initialProfileForm);
  const [otpForm, setOtpForm] = useState(initialOtpForm);
  const [authView, setAuthView] = useState(getInitialAuthView);
  const [pendingPhoneLabel, setPendingPhoneLabel] = useState("");
  const [pendingProfileUser, setPendingProfileUser] = useState(null);
  const [sessionStatus, setSessionStatus] = useState("checking");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isPasswordRecoveryRoute = window.location.pathname === "/reset-password";

  function navigateToRoleHome(user) {
    navigate(user?.role === "commissioner" ? "/commissioner" : "/", {
      replace: true
    });
  }

  useEffect(() => {
    if (isPasswordRecoveryRoute) {
      setSessionStatus("signed-out");
      return;
    }

    let isMounted = true;

    async function restoreSession() {
      try {
        const { user: currentUser } = await authApi.getCurrentUser();

        if (isMounted && currentUser) {
          setPendingProfileUser(null);
          setPendingPhoneLabel("");
          navigateToRoleHome(currentUser);
          return;
        }

        if (isMounted) {
          setSessionStatus("signed-out");
        }

        return;
      } catch {
        // No complete app session; check for an onboarding-only session.
      }

      try {
        const pendingResult = await authApi.getPendingProfileSession();

        if (isMounted && pendingResult?.profileRequired) {
          setPendingProfileUser(pendingResult.user);
          setPendingPhoneLabel(pendingResult.phoneMasked || "");
          setSessionStatus(
            pendingResult.otpRequired ? "otp-required" : "profile-required"
          );
          return;
        }
      } catch {
        // No pending onboarding session either.
      }

      if (isMounted) {
        setPendingProfileUser(null);
        setPendingPhoneLabel("");
        setSessionStatus("signed-out");
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, [isPasswordRecoveryRoute]);

  function clearMessages() {
    setError("");
    setNotice("");
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
    clearMessages();
  }

  function handleProfileChange(event) {
    const { name, value } = event.target;
    setProfileForm((currentForm) => ({ ...currentForm, [name]: value }));
    clearMessages();
  }

  function handleOtpChange(event) {
    const { value } = event.target;
    setOtpForm({ token: value.replace(/\D/g, "").slice(0, 6) });
    clearMessages();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    clearMessages();

    try {
      const result = await authApi.login(form);
      setForm(initialForm);

      if (result.profileRequired) {
        setPendingProfileUser(result.user);
        setPendingPhoneLabel(result.phoneMasked || "");
        setSessionStatus(result.otpRequired ? "otp-required" : "profile-required");
        return;
      }

      setPendingProfileUser(null);
      setPendingPhoneLabel("");
      navigateToRoleHome(result.user);
    } catch (loginError) {
      setError(loginError.message);
      setSessionStatus("signed-out");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    setIsSubmitting(true);
    clearMessages();

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      setIsSubmitting(false);
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      setIsSubmitting(false);
      return;
    }

    try {
      const { message } = await authApi.signup({
        email: form.email,
        password: form.password
      });

      setForm(initialForm);
      navigate("/", { replace: true, state: { notice: message } });
    } catch (signupError) {
      setError(signupError.message);
      setSessionStatus("signed-out");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCompleteProfile(event) {
    event.preventDefault();
    setIsSubmitting(true);
    clearMessages();

    try {
      const result = await authApi.completeProfile(profileForm);
      setPendingPhoneLabel(result.phoneMasked || profileForm.phoneNumber);
      setOtpForm(initialOtpForm);
      setNotice(result.message || "Verification code sent.");
      setSessionStatus("otp-required");
    } catch (profileError) {
      setError(profileError.message);
      setSessionStatus("profile-required");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setIsSubmitting(true);
    clearMessages();

    try {
      const result = await authApi.verifyProfileOtp(otpForm);
      setPendingProfileUser(null);
      setPendingPhoneLabel("");
      setProfileForm(initialProfileForm);
      setOtpForm(initialOtpForm);
      navigateToRoleHome(result.user);
    } catch (otpError) {
      setError(otpError.message);
      setSessionStatus("otp-required");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordReset(event) {
    event.preventDefault();
    setIsSubmitting(true);
    clearMessages();

    try {
      const { message } = await authApi.requestPasswordReset({
        email: form.email
      });

      setNotice(message);
      setSessionStatus("signed-out");
    } catch (resetError) {
      setError(resetError.message);
      setSessionStatus("signed-out");
    } finally {
      setIsSubmitting(false);
    }
  }

  function showResetForm() {
    setAuthView("reset");
    setForm((currentForm) => ({
      ...currentForm,
      confirmPassword: "",
      password: ""
    }));
    clearMessages();
    navigate("/auth?view=reset", { replace: true });
  }

  function showSignupForm() {
    setAuthView("signup");
    setForm((currentForm) => ({
      ...currentForm,
      confirmPassword: "",
      password: ""
    }));
    clearMessages();
    navigate("/auth?view=signup", { replace: true });
  }

  function showLoginForm() {
    setAuthView("login");
    setForm((currentForm) => ({
      ...currentForm,
      confirmPassword: "",
      password: ""
    }));
    clearMessages();
    navigate("/auth?view=login", { replace: true });
  }

  function showProfileForm() {
    setOtpForm(initialOtpForm);
    setSessionStatus("profile-required");
    clearMessages();
  }

  async function handleLogout() {
    setIsSubmitting(true);
    clearMessages();

    try {
      await authApi.logout();
      setPendingProfileUser(null);
      setPendingPhoneLabel("");
      setProfileForm(initialProfileForm);
      setOtpForm(initialOtpForm);
      setSessionStatus("signed-out");
      navigate("/", { replace: true });
    } catch (logoutError) {
      setError(logoutError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isPasswordRecoveryRoute) {
    return <ResetPasswordView />;
  }

  if (sessionStatus === "checking") {
    return (
      <main className="screen-center">
        <div className="loading-mark" aria-label="Loading session" />
      </main>
    );
  }

  if (pendingProfileUser && sessionStatus === "profile-required") {
    return (
      <main className="auth-shell">
        <section className="auth-layout" aria-label="Complete profile">
          <div className="login-panel">
            <div className="onboarding-header">
              <button
                aria-label="Back to sign in"
                className="icon-button"
                disabled={isSubmitting}
                onClick={handleLogout}
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
                  <label htmlFor="phoneNumber">Phone Number</label>
                  <input
                    autoComplete="tel"
                    id="phoneNumber"
                    inputMode="tel"
                    name="phoneNumber"
                    onChange={handleProfileChange}
                    placeholder="647-555-0001"
                    required
                    type="tel"
                    value={profileForm.phoneNumber}
                  />
                </div>
              </div>

              {error ? <p className="form-error">{error}</p> : null}
              {notice ? <p className="form-success">{notice}</p> : null}

              <button
                className="primary-button"
                disabled={isSubmitting}
                type="submit"
              >
                <ShieldCheck aria-hidden="true" size={19} />
                <span>{isSubmitting ? "Saving profile" : "Save profile"}</span>
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  if (pendingProfileUser && sessionStatus === "otp-required") {
    return (
      <main className="auth-shell">
        <section className="auth-layout" aria-label="Verify phone">
          <div className="login-panel">
            <div className="onboarding-header">
              <button
                aria-label="Back to profile"
                className="icon-button"
                disabled={isSubmitting}
                onClick={showProfileForm}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={22} />
              </button>
              <div className="brand-lockup">
                <div>
                  <h1>Verify Phone</h1>
                </div>
              </div>
            </div>

            {pendingPhoneLabel ? (
              <p className="otp-summary">Code sent to {pendingPhoneLabel}</p>
            ) : null}

            <form className="login-form" onSubmit={handleVerifyOtp}>
              <label htmlFor="token">Verification Code</label>
              <input
                autoComplete="one-time-code"
                id="token"
                inputMode="numeric"
                maxLength={6}
                name="token"
                onChange={handleOtpChange}
                pattern="[0-9]{6}"
                required
                type="text"
                value={otpForm.token}
              />

              {error ? <p className="form-error">{error}</p> : null}
              {notice ? <p className="form-success">{notice}</p> : null}

              <button
                className="primary-button"
                disabled={isSubmitting}
                type="submit"
              >
                <KeyRound aria-hidden="true" size={19} />
                <span>{isSubmitting ? "Verifying code" : "Verify code"}</span>
              </button>

              <button
                className="text-button"
                disabled={isSubmitting}
                onClick={handleLogout}
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

  return (
    <main className="auth-shell">
      <section className="auth-layout" aria-label="User sign in">
        <div className="login-panel">
          <div className="brand-lockup">
            {authView === "login" ? (
              <button
                aria-label="Back to public user dashboard"
                className="icon-button"
                disabled={isSubmitting}
                onClick={() => navigate("/")}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={22} />
              </button>
            ) : null}
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
                    authView === "login" ? "current-password" : "new-password"
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
              disabled={isSubmitting}
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
                  ? isSubmitting
                    ? "Sending link"
                    : "Send reset link"
                  : authView === "signup"
                    ? isSubmitting
                      ? "Creating account"
                      : "Sign up"
                    : isSubmitting
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

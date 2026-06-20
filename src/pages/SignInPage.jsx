import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authApi } from "../services/authApi.js";
import AuthOnboarding from "./auth_helpers/AuthOnboarding.jsx";
import AuthPanel from "./auth_helpers/AuthPanel.jsx";
import useAuthOnboarding from "./auth_helpers/useAuthOnboarding.js";

const initialSignInForm = {
  email: "",
  password: ""
};

export default function SignInPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const onboarding = useAuthOnboarding();
  const [form, setForm] = useState(initialSignInForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => location.state?.notice || "");

  useEffect(() => {
    if (typeof location.state?.notice === "string") {
      setNotice(location.state.notice);
    }
  }, [location.state]);

  function clearMessages() {
    setError("");
    setNotice("");
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
    clearMessages();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    clearMessages();

    try {
      const result = await authApi.login(form);
      setForm(initialSignInForm);

      if (result.profileRequired) {
        onboarding.startPendingProfile(result);
        return;
      }

      onboarding.clearPendingProfile();
      onboarding.navigateToRoleHome(result.user);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (onboarding.pendingProfileUser) {
    return (
      <AuthOnboarding
        error={onboarding.error}
        isSubmitting={onboarding.isSubmitting}
        notice={onboarding.notice}
        onCompleteProfile={onboarding.handleCompleteProfile}
        onLogout={onboarding.handleLogout}
        onOtpChange={onboarding.handleOtpChange}
        onProfileChange={onboarding.handleProfileChange}
        onShowProfileForm={onboarding.showProfileForm}
        onVerifyOtp={onboarding.handleVerifyOtp}
        otpForm={onboarding.otpForm}
        pendingPhoneLabel={onboarding.pendingPhoneLabel}
        profileForm={onboarding.profileForm}
        sessionStatus={onboarding.sessionStatus}
      />
    );
  }

  return (
    <AuthPanel
      ariaLabel="User sign in"
      isBackDisabled={isSubmitting}
      onBack={() => navigate("/")}
      title="Sign In"
    >
      <form className="login-form" onSubmit={handleSubmit}>
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

        <label htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          id="password"
          name="password"
          onChange={handleChange}
          required
          type="password"
          value={form.password}
        />

        <button
          className="inline-text-button forgot-password-button"
          onClick={() => navigate("/forgot-password")}
          type="button"
        >
          Forgot password?
        </button>

        {error ? <p className="form-error">{error}</p> : null}
        {notice ? <p className="form-success">{notice}</p> : null}

        <button className="primary-button" disabled={isSubmitting} type="submit">
          <LogIn aria-hidden="true" size={19} />
          <span>{isSubmitting ? "Signing in" : "Sign in"}</span>
        </button>

        <p className="auth-prompt">
          <span>New user?</span>
          <button
            className="inline-text-button"
            onClick={() => navigate("/sign-up")}
            type="button"
          >
            Create an account
          </button>
        </p>
      </form>
    </AuthPanel>
  );
}

import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authApi } from "../services/authApi.js";
import AuthOnboarding from "./auth/AuthOnboarding.jsx";
import AuthPanel from "./auth/AuthPanel.jsx";
import useAuthOnboarding from "./auth/useAuthOnboarding.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const initialSignInForm = {
  email: "",
  password: ""
};

export default function SignInPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const onboarding = useAuthOnboarding();
  const { markSignedIn } = useAuth();
  const [form, setForm] = useState(initialSignInForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => location.state?.notice || "");

  useEffect(() => {
    if (typeof location.state?.notice === "string") {
      setNotice(location.state.notice);
    }
  }, [location.state]);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const queryParams = new URLSearchParams(location.search);
    const hasVerificationParams =
      hashParams.has("access_token") ||
      hashParams.has("error") ||
      queryParams.has("access_token") ||
      queryParams.has("error") ||
      queryParams.has("token_hash") ||
      queryParams.get("type") === "signup";

    if (!hasVerificationParams) {
      return;
    }

    const verificationError =
      hashParams.get("error_description") ||
      queryParams.get("error_description");

    window.history.replaceState({}, "", "/sign-in");

    if (verificationError) {
      setError(verificationError);
      return;
    }

    setNotice((currentNotice) => currentNotice || "Email verified. Sign in to continue.");
  }, [location.search]);

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
      markSignedIn(result.user);
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
        pendingUser={onboarding.pendingProfileUser}
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

        <Button
          className="forgot-password-button justify-self-end"
          onClick={() => navigate("/forgot-password")}
          type="button"
          variant="link"
          size="sm"
        >
          Forgot password?
        </Button>

        {error ? <p className="form-error">{error}</p> : null}
        {notice ? <p className="form-success">{notice}</p> : null}

        <Button className="mt-3 w-full" disabled={isSubmitting} type="submit">
          <LogIn aria-hidden="true" size={19} />
          <span>{isSubmitting ? "Signing in" : "Sign in"}</span>
        </Button>

        <p className="auth-prompt">
          <span>New user?</span>
          <Button
            onClick={() => navigate("/sign-up")}
            type="button"
            variant="link"
            size="sm"
          >
            Create an account
          </Button>
        </p>
      </form>
    </AuthPanel>
  );
}

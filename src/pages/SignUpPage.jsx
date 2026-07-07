import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/authApi.js";
import AuthOnboarding from "./auth/AuthOnboarding.jsx";
import AuthPanel from "./auth/AuthPanel.jsx";
import useAuthOnboarding from "./auth/useAuthOnboarding.js";

const initialSignUpForm = {
  confirmPassword: "",
  email: "",
  password: ""
};

export default function SignUpPage() {
  const navigate = useNavigate();
  const onboarding = useAuthOnboarding();
  const [form, setForm] = useState(initialSignUpForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

      setForm(initialSignUpForm);
      navigate("/sign-in", { replace: true, state: { notice: message } });
    } catch (signupError) {
      setError(signupError.message);
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
    <AuthPanel ariaLabel="User sign up" title="Sign Up">
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
          autoComplete="new-password"
          id="password"
          name="password"
          onChange={handleChange}
          required
          type="password"
          value={form.password}
        />

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

        {error ? <p className="form-error">{error}</p> : null}
        {notice ? <p className="form-success">{notice}</p> : null}

        <button className="primary-button" disabled={isSubmitting} type="submit">
          <UserPlus aria-hidden="true" size={19} />
          <span>{isSubmitting ? "Creating account" : "Sign up"}</span>
        </button>

        <button
          className="text-button"
          onClick={() => navigate("/sign-in")}
          type="button"
        >
          Back to sign in
        </button>
      </form>
    </AuthPanel>
  );
}

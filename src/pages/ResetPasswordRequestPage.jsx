import { Mail } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/authApi.js";
import AuthOnboarding from "./auth/AuthOnboarding.jsx";
import AuthPanel from "./auth/AuthPanel.jsx";
import useAuthOnboarding from "./auth/useAuthOnboarding.js";

const initialResetRequestForm = {
  email: ""
};

// This is the “forgot password” page. User enters their email, and the app sends a reset link.
export default function ResetPasswordRequestPage() {
  const navigate = useNavigate();
  const onboarding = useAuthOnboarding();
  const [form, setForm] = useState(initialResetRequestForm);
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

    try {
      const { message } = await authApi.requestPasswordReset({
        email: form.email
      });

      setNotice(message);
    } catch (resetError) {
      setError(resetError.message);
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
    <AuthPanel ariaLabel="Reset password" title="Reset Password">
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

        {error ? <p className="form-error">{error}</p> : null}
        {notice ? <p className="form-success">{notice}</p> : null}

        <button className="primary-button" disabled={isSubmitting} type="submit">
          <Mail aria-hidden="true" size={19} />
          <span>{isSubmitting ? "Sending link" : "Send reset link"}</span>
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

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../services/authApi.js";

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

// shared onboarding behavior/state
export default function useAuthOnboarding() {
  const navigate = useNavigate();
  const [profileForm, setProfileForm] = useState(initialProfileForm);
  const [otpForm, setOtpForm] = useState(initialOtpForm);
  const [pendingPhoneLabel, setPendingPhoneLabel] = useState("");
  const [pendingProfileUser, setPendingProfileUser] = useState(null);
  const [sessionStatus, setSessionStatus] = useState("checking");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function navigateToRoleHome(user) {
    navigate(user?.role === "commissioner" ? "/commissioner" : "/", {
      replace: true
    });
  }

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const { user: currentUser } = await authApi.getCurrentUser();

        if (isMounted && currentUser) {
          clearPendingProfile();
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
          startPendingProfile(pendingResult);
          return;
        }
      } catch {
        // No pending onboarding session either.
      }

      if (isMounted) {
        clearPendingProfile();
        setSessionStatus("signed-out");
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  function clearMessages() {
    setError("");
    setNotice("");
  }

  function clearPendingProfile() {
    setPendingProfileUser(null);
    setPendingPhoneLabel("");
  }

  function startPendingProfile(result) {
    setPendingProfileUser(result.user);
    setPendingPhoneLabel(result.phoneMasked || "");
    setSessionStatus(result.otpRequired ? "otp-required" : "profile-required");
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
      clearPendingProfile();
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
      clearPendingProfile();
      setProfileForm(initialProfileForm);
      setOtpForm(initialOtpForm);
      setSessionStatus("signed-out");
      navigate("/sign-in", { replace: true });
    } catch (logoutError) {
      setError(logoutError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    clearPendingProfile,
    error,
    handleCompleteProfile,
    handleLogout,
    handleOtpChange,
    handleProfileChange,
    handleVerifyOtp,
    isSubmitting,
    navigateToRoleHome,
    notice,
    otpForm,
    pendingPhoneLabel,
    pendingProfileUser,
    profileForm,
    sessionStatus,
    showProfileForm,
    startPendingProfile
  };
}

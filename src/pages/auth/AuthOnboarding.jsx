import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export default function AuthOnboarding({
  error,
  isSubmitting,
  notice,
  onCompleteProfile,
  onLogout,
  onOtpChange,
  onProfileChange,
  onShowProfileForm,
  onVerifyOtp,
  otpForm,
  pendingPhoneLabel,
  pendingUser,
  profileForm,
  sessionStatus
}) {
  const isCommissionerOnboarding = pendingUser?.role === "commissioner";

  if (sessionStatus === "profile-required") {
    return (
      <main className="auth-shell">
        <section className="auth-layout" aria-label="Complete profile">
          <div className="login-panel">
            <div className="onboarding-header">
              <Button
                aria-label="Back to sign in"
                className="rounded-full"
                disabled={isSubmitting}
                onClick={onLogout}
                size="icon"
                type="button"
                variant="outline"
              >
                <ArrowLeft aria-hidden="true" size={22} />
              </Button>
              <div className="brand-lockup">
                <div>
                  <h1>
                    {isCommissionerOnboarding
                      ? "Commissioner Profile"
                      : "Complete Profile"}
                  </h1>
                </div>
              </div>
            </div>

            <form className="login-form" onSubmit={onCompleteProfile}>
              <div className="form-row">
                <div>
                  <label htmlFor="firstName">First Name</label>
                  <input
                    autoComplete="given-name"
                    id="firstName"
                    name="firstName"
                    onChange={onProfileChange}
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
                    onChange={onProfileChange}
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
                onChange={onProfileChange}
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

              {!isCommissionerOnboarding ? (
                <div className="form-row">
                  <div>
                    <label htmlFor="postalCode">Postal Code</label>
                    <input
                      autoComplete="postal-code"
                      id="postalCode"
                      name="postalCode"
                      onChange={onProfileChange}
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
                      onChange={onProfileChange}
                      placeholder="647-555-0001"
                      required
                      type="tel"
                      value={profileForm.phoneNumber}
                    />
                  </div>
                </div>
              ) : null}

              {error ? <p className="form-error">{error}</p> : null}
              {notice ? <p className="form-success">{notice}</p> : null}

              <Button
                className="mt-3 w-full"
                disabled={isSubmitting}
                type="submit"
              >
                <ShieldCheck aria-hidden="true" size={19} />
                <span>
                  {isSubmitting
                    ? "Saving profile"
                    : isCommissionerOnboarding
                      ? "Save commissioner profile"
                      : "Save profile"}
                </span>
              </Button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  if (sessionStatus === "otp-required") {
    return (
      <main className="auth-shell">
        <section className="auth-layout" aria-label="Verify phone">
          <div className="login-panel">
            <div className="onboarding-header">
              <Button
                aria-label="Back to profile"
                className="rounded-full"
                disabled={isSubmitting}
                onClick={onShowProfileForm}
                size="icon"
                type="button"
                variant="outline"
              >
                <ArrowLeft aria-hidden="true" size={22} />
              </Button>
              <div className="brand-lockup">
                <div>
                  <h1>Verify Phone</h1>
                </div>
              </div>
            </div>

            {pendingPhoneLabel ? (
              <p className="otp-summary">Code sent to {pendingPhoneLabel}</p>
            ) : null}

            <form className="login-form" onSubmit={onVerifyOtp}>
              <label htmlFor="token">Verification Code</label>
              <input
                autoComplete="one-time-code"
                id="token"
                inputMode="numeric"
                maxLength={6}
                name="token"
                onChange={onOtpChange}
                pattern="[0-9]{6}"
                required
                type="text"
                value={otpForm.token}
              />

              {error ? <p className="form-error">{error}</p> : null}
              {notice ? <p className="form-success">{notice}</p> : null}

              <Button
                className="mt-3 w-full"
                disabled={isSubmitting}
                type="submit"
              >
                <KeyRound aria-hidden="true" size={19} />
                <span>{isSubmitting ? "Verifying code" : "Verify code"}</span>
              </Button>

              <Button
                className="justify-self-center"
                disabled={isSubmitting}
                onClick={onLogout}
                size="sm"
                type="button"
                variant="link"
              >
                Back to sign in
              </Button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  return null;
}

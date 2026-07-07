import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { ProfileSignOutButton } from "@/components/non_prebuilt/ProfileSignOutButton.jsx";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { authApi } from "@/services/authApi.js";

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

function profileFormFromUser(user) {
  return {
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    phoneNumber: user?.phoneNumber || "",
    postalCode: user?.postalCode || "",
    province: user?.province || ""
  };
}

export default function UserProfile() {
  const navigate = useNavigate();
  const { markSignedIn, user } = useAuth();
  const [form, setForm] = useState(() => profileFormFromUser(user));
  const [otpForm, setOtpForm] = useState({ token: "" });
  const [otpRequired, setOtpRequired] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!otpRequired) {
      setForm(profileFormFromUser(user));
    }
  }, [otpRequired, user]);

  function resetOtpState() {
    setOtpRequired(false);
    setOtpForm({ token: "" });
  }

  function handleStartEditingProfile() {
    setIsEditingProfile(true);
    setError("");
    setStatus("");
  }

  function handleChange(event) {
    const { name, value } = event.target;
    handleStartEditingProfile();
    setForm((currentForm) => ({ ...currentForm, [name]: value }));

    if (otpRequired) {
      resetOtpState();
    }
  }

  function handleProvinceChange(value) {
    handleStartEditingProfile();
    setForm((currentForm) => ({ ...currentForm, province: value }));

    if (otpRequired) {
      resetOtpState();
    }
  }

  function handleCancelChanges() {
    setForm(profileFormFromUser(user));
    setIsEditingProfile(false);
    resetOtpState();
    setError("");
    setStatus("");
  }

  function handleOtpChange(event) {
    setOtpForm({ token: event.target.value.replace(/\D/g, "").slice(0, 6) });
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setStatus("");

    try {
      const result = await authApi.updatePublicProfile(form);

      if (result.otpRequired) {
        const phoneLabel = result.phoneMasked || "";

        markSignedIn(result.user);
        setForm((currentForm) => ({
          ...profileFormFromUser(result.user),
          phoneNumber: currentForm.phoneNumber
        }));
        setOtpRequired(true);
        setIsEditingProfile(false);
        setOtpForm({ token: "" });
        setStatus(
          phoneLabel
            ? `${result.message} Code sent to ${phoneLabel}.`
            : result.message
        );
        return;
      }

      markSignedIn(result.user);
      setForm(profileFormFromUser(result.user));
      resetOtpState();
      setIsEditingProfile(false);
      setStatus(result.message);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setIsVerifying(true);
    setError("");
    setStatus("");

    try {
      const result = await authApi.verifyPublicProfilePhoneOtp(otpForm);

      markSignedIn(result.user);
      setForm(profileFormFromUser(result.user));
      resetOtpState();
      setIsEditingProfile(false);
      setStatus(result.message);
    } catch (verifyError) {
      setError(verifyError.message);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto flex flex-col gap-6">
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => navigate("/users")}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to map
      </Button>

      <section className="flex flex-col gap-5 rounded-xl border p-6">
        <div>
          <h1 className="text-xl font-semibold">Profile information</h1>
        </div>

        <form
          className="grid max-w-2xl gap-4"
          id="public-profile-form"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-2">
            <Label htmlFor="public-profile-email">Email</Label>
            <Input
              className="cursor-not-allowed bg-gray-100 text-gray-600"
              id="public-profile-email"
              readOnly
              type="email"
              value={user?.email || ""}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="public-profile-first-name">First name</Label>
              <Input
                autoComplete="given-name"
                id="public-profile-first-name"
                name="firstName"
                onChange={handleChange}
                onFocus={handleStartEditingProfile}
                required
                value={form.firstName}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="public-profile-last-name">Last name</Label>
              <Input
                autoComplete="family-name"
                id="public-profile-last-name"
                name="lastName"
                onChange={handleChange}
                onFocus={handleStartEditingProfile}
                required
                value={form.lastName}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="public-profile-province">Province or territory</Label>
            <Select
              name="province"
              onOpenChange={(open) => {
                if (open) {
                  handleStartEditingProfile();
                }
              }}
              onValueChange={handleProvinceChange}
              value={form.province}
            >
              <SelectTrigger
                className="w-full"
                id="public-profile-province"
                onFocus={handleStartEditingProfile}
              >
                <SelectValue placeholder="Select province or territory" />
              </SelectTrigger>
              <SelectContent>
                {provinces.map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="public-profile-postal-code">Postal code</Label>
              <Input
                autoComplete="postal-code"
                id="public-profile-postal-code"
                name="postalCode"
                onChange={handleChange}
                onFocus={handleStartEditingProfile}
                placeholder="A1A 1A1"
                required
                value={form.postalCode}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="public-profile-phone">Phone</Label>
              <Input
                autoComplete="tel"
                id="public-profile-phone"
                inputMode="tel"
                name="phoneNumber"
                onChange={handleChange}
                onFocus={handleStartEditingProfile}
                placeholder="647-555-0001"
                required
                type="tel"
                value={form.phoneNumber}
              />
            </div>
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {status ? (
            <p className="form-success" role="status">
              {status}
            </p>
          ) : null}

        </form>

        {otpRequired ? (
          <form
            className="grid max-w-sm gap-3"
            onSubmit={handleVerifyOtp}
          >
            <div className="grid gap-2">
              <Label htmlFor="public-profile-otp">Verification code</Label>
              <Input
                autoComplete="one-time-code"
                id="public-profile-otp"
                inputMode="numeric"
                maxLength={6}
                name="token"
                onChange={handleOtpChange}
                pattern="[0-9]{6}"
                required
                value={otpForm.token}
              />
            </div>
            <Button disabled={isSubmitting || isVerifying} type="submit">
              <KeyRound className="h-4 w-4" />
              {isVerifying ? "Verifying" : "Verify phone"}
            </Button>
          </form>
        ) : null}

        {isEditingProfile ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isSubmitting || isVerifying}
              form="public-profile-form"
              type="submit"
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? "Saving" : "Save changes"}
            </Button>
            <Button
              disabled={isSubmitting || isVerifying}
              onClick={handleCancelChanges}
              type="button"
              variant="outline"
            >
              Cancel changes
            </Button>
          </div>
        ) : null}
      </section>

      <ProfileSignOutButton />
    </div>
  );
}

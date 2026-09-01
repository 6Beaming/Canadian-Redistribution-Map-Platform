import { useEffect, useState } from "react";
import { KeyRound, Save } from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext.jsx";
import { authApi } from "@/services/authApi.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.jsx";

const actionButtonClassName = "w-auto min-w-0 px-6 py-2";
const secondaryActionButtonClassName = actionButtonClassName;

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

function provinceName(code) {
  return provinces.find(([value]) => value === code)?.[1] ?? code;
}

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
  const { markSignedIn, user } = useAuth();
  const [form, setForm] = useState(() => profileFormFromUser(user));
  const [otpForm, setOtpForm] = useState({ token: "" });
  const [otpRequired, setOtpRequired] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [provinceAdjustment, setProvinceAdjustment] = useState(null);

  useEffect(() => {
    if (!otpRequired) {
      setForm(profileFormFromUser(user));
    }
  }, [otpRequired, user]);

  useEffect(() => {
    if (!status) {
      return undefined;
    }

    function dismissStatus() {
      setStatus("");
    }

    document.addEventListener("pointerdown", dismissStatus);

    return () => {
      document.removeEventListener("pointerdown", dismissStatus);
    };
  }, [status]);

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
      if (result.profileAdjustments?.province) {
        setProvinceAdjustment(result.profileAdjustments.province);
      }
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
      if (result.profileAdjustments?.province) {
        setProvinceAdjustment(result.profileAdjustments.province);
      }
    } catch (verifyError) {
      setError(verifyError.message);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <section className="flex w-full flex-col items-start gap-5 rounded-[24px] border border-[#d7e6fb] bg-white/92 p-6 text-left shadow-[0_16px_38px_rgba(26,115,232,0.08)]">
        <div className="w-full">
          <h2 className="text-xl font-semibold text-[#17324d]">
            Profile Information
          </h2>
        </div>

        <form
          className="grid w-full gap-4 text-left"
          id="public-profile-form"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-2">
            <Label className="w-fit justify-self-start text-left" htmlFor="public-profile-email">Email</Label>
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
              <Label className="w-fit justify-self-start text-left" htmlFor="public-profile-first-name">First Name</Label>
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
              <Label className="w-fit justify-self-start text-left" htmlFor="public-profile-last-name">Last Name</Label>
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
            <Label className="w-fit justify-self-start text-left" htmlFor="public-profile-province">Province Or Territory</Label>
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
              <Label className="w-fit justify-self-start text-left" htmlFor="public-profile-postal-code">Postal Code</Label>
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
              <Label className="w-fit justify-self-start text-left" htmlFor="public-profile-phone">Phone Number</Label>
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
            <p className="w-full rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800" role="status">
              {status}
            </p>
          ) : null}

        </form>

        {otpRequired ? (
          <form
            className="grid w-full max-w-sm gap-3 text-left"
            onSubmit={handleVerifyOtp}
          >
            <div className="grid gap-2">
              <Label className="w-fit justify-self-start text-left" htmlFor="public-profile-otp">Verification Code</Label>
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
            <Button
              className={actionButtonClassName}
              disabled={isSubmitting || isVerifying}
              type="submit"
            >
              <KeyRound className="h-4 w-4" />
              {isVerifying ? "Verifying" : "Verify Phone"}
            </Button>
          </form>
        ) : null}

        {isEditingProfile ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              className={secondaryActionButtonClassName}
              disabled={isSubmitting || isVerifying}
              onClick={handleCancelChanges}
              type="button"
              variant="destructive"
            >
              Cancel Changes
            </Button>
            <Button
              className={actionButtonClassName}
              disabled={isSubmitting || isVerifying}
              form="public-profile-form"
              type="submit"
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? "Saving" : "Save Changes"}
            </Button>
          </div>
        ) : null}
      </section>

      <AlertDialog
        open={Boolean(provinceAdjustment)}
        onOpenChange={(open) => {
          if (!open) setProvinceAdjustment(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Province updated to match your postal code</AlertDialogTitle>
            <AlertDialogDescription>
              Your postal code is located in {provinceName(provinceAdjustment?.to)}.
              {" "}We updated your province from {provinceName(provinceAdjustment?.from)} to {provinceName(provinceAdjustment?.to)} so your map presenter and submissions stay aligned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction type="button" onClick={() => setProvinceAdjustment(null)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

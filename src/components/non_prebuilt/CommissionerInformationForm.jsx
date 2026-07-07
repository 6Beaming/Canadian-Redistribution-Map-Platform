import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { authApi } from "@/services/authApi.js";

function profileFormFromUser(user) {
  return {
    firstName: user?.firstName || "",
    lastName: user?.lastName || ""
  };
}

export function CommissionerInformationForm() {
  const { markSignedIn, user } = useAuth();
  const [form, setForm] = useState(() => profileFormFromUser(user));
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((currentForm) => ({ ...currentForm, [name]: value }));
    setError("");
    setStatus("");
  }

  function handleStartEditingName() {
    setIsEditingName(true);
    setError("");
    setStatus("");
  }

  function handleCancel() {
    setForm(profileFormFromUser(user));
    setIsEditingName(false);
    setError("");
    setStatus("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setStatus("");

    try {
      const result = await authApi.updateCommissionerProfile(form);
      markSignedIn(result.user);
      setForm(profileFormFromUser(result.user));
      setIsEditingName(false);
      setStatus(result.message);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col items-center gap-4 rounded-[24px] border border-[#d7e6fb] bg-white/92 p-6 text-center shadow-[0_16px_38px_rgba(26,115,232,0.08)]">
      <div className="w-full">
        <h2 className="text-xl font-semibold text-[#17324d]">Profile Information</h2>
        <p className="text-sm text-gray-600">
          Update the information associated with your commissioner account.
        </p>
      </div>

      <form
        className="grid w-full max-w-xl gap-4 text-left"
        onSubmit={handleSubmit}
      >
        <div className="grid gap-2">
          <Label htmlFor="commissioner-email">Email</Label>
          <Input
            className="cursor-not-allowed bg-gray-100 text-gray-600"
            id="commissioner-email"
            readOnly
            type="email"
            value={user?.email || ""}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="commissioner-first-name">First Name</Label>
            <Input
              autoComplete="given-name"
              id="commissioner-first-name"
              name="firstName"
              onChange={handleChange}
              onFocus={handleStartEditingName}
              required
              value={form.firstName}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="commissioner-last-name">Last Name</Label>
            <Input
              autoComplete="family-name"
              id="commissioner-last-name"
              name="lastName"
              onChange={handleChange}
              onFocus={handleStartEditingName}
              required
              value={form.lastName}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="commissioner-province">Province Or Territory</Label>
          <Input
            className="cursor-not-allowed bg-gray-100 text-gray-600"
            id="commissioner-province"
            readOnly
            value={user?.province || ""}
          />
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

        {isEditingName ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button disabled={isSubmitting} type="submit">
              <Save className="h-4 w-4" />
              {isSubmitting ? "Saving" : "Save Changes"}
            </Button>
            <Button
              disabled={isSubmitting}
              onClick={handleCancel}
              type="button"
              variant="destructive"
            >
              Cancel Changes
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

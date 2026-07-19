import { useEffect, useState } from "react";
import { Save, Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { authApi } from "@/services/authApi.js";

const actionButtonClassName = "w-auto min-w-0 px-6 py-2";
const secondaryActionButtonClassName = actionButtonClassName;
const inviteTriggerButtonClassName = "w-fit min-w-0 border-[#1a73e8] bg-transparent px-4 py-1.5 text-[#1a73e8] hover:bg-[#e8f0fe] hover:text-[#1a73e8]";

function profileFormFromUser(user) {
  return {
    firstName: user?.firstName || "",
    lastName: user?.lastName || ""
  };
}

function CommissionerInformationForm() {
  const { markSignedIn, user } = useAuth();
  const [form, setForm] = useState(() => profileFormFromUser(user));
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

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
    <section className="flex w-full flex-col items-start gap-4 rounded-[24px] border border-[#d7e6fb] bg-white/92 p-6 text-left shadow-[0_16px_38px_rgba(26,115,232,0.08)]">
      <div className="w-full">
        <h2 className="text-xl font-semibold text-[#17324d]">Profile Information</h2>
      </div>

      <form
        className="grid w-full gap-4 text-left"
        onSubmit={handleSubmit}
      >
        <div className="grid gap-2">
          <Label className="w-fit justify-self-start text-left" htmlFor="commissioner-email">Email</Label>
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
            <Label className="w-fit justify-self-start text-left" htmlFor="commissioner-first-name">First Name</Label>
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
            <Label className="w-fit justify-self-start text-left" htmlFor="commissioner-last-name">Last Name</Label>
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
          <Label className="w-fit justify-self-start text-left" htmlFor="commissioner-province">Province Or Territory</Label>
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
          <p className="w-full rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800" role="status">
            {status}
          </p>
        ) : null}

        {isEditingName ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              className={secondaryActionButtonClassName}
              disabled={isSubmitting}
              onClick={handleCancel}
              type="button"
              variant="destructive"
            >
              Cancel Changes
            </Button>
            <Button
              className={actionButtonClassName}
              disabled={isSubmitting}
              type="submit"
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? "Saving" : "Save Changes"}
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

export default function CommissionerProfile() {
  const [isInviteFormOpen, setIsInviteFormOpen] = useState(false);
  const [isInviteConfirmationOpen, setIsInviteConfirmationOpen] =
    useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");

  function handleInviteSubmit(event) {
    event.preventDefault();
    setInviteError("");
    setInviteStatus("");
    setIsInviteConfirmationOpen(true);
  }

  async function handleConfirmInvite() {
    setIsSendingInvite(true);
    setInviteError("");

    try {
      const result = await authApi.inviteCommissioner(inviteEmail);
      setInviteEmail("");
      setInviteStatus(result.message);
      setIsInviteConfirmationOpen(false);
      setIsInviteFormOpen(false);
    } catch (sendError) {
      setInviteError(sendError.message);
    } finally {
      setIsSendingInvite(false);
    }
  }

  function handleInviteCancel() {
    setInviteEmail("");
    setInviteError("");
    setInviteStatus("");
    setIsInviteConfirmationOpen(false);
    setIsInviteFormOpen(false);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <section className="flex w-full flex-col items-start gap-4 rounded-[24px] border border-[#d7e6fb] bg-white/92 p-6 text-left shadow-[0_16px_38px_rgba(26,115,232,0.08)]">
        <div className="w-full">
          <h2 className="text-xl font-semibold text-[#17324d]">Invite a New Colleague</h2>
          <p className="mt-2 text-sm text-gray-600">
            Enter an email to invite another commissioner to collaborate with you.
          </p>
        </div>

        {!isInviteFormOpen ? (
          <Button
            className={inviteTriggerButtonClassName}
            onClick={() => {
              setInviteError("");
              setInviteStatus("");
              setIsInviteFormOpen(true);
            }}
            variant="outline"
          >
            <UserPlus className="h-4 w-4" />
            Invite a New Colleague
          </Button>
        ) : (
          <form
            className="flex w-full flex-col items-start gap-3 text-left"
            onSubmit={handleInviteSubmit}
          >
            <Label className="w-fit self-start text-left" htmlFor="colleague-email"></Label>
            <Input
              autoComplete="email"
              id="colleague-email"
              name="email"
              onChange={(event) => {
                setInviteEmail(event.target.value);
                setInviteError("");
                setInviteStatus("");
              }}
              placeholder="colleague@example.com"
              required
              type="email"
              value={inviteEmail}
            />
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Button
                className={secondaryActionButtonClassName}
                disabled={isSendingInvite}
                onClick={handleInviteCancel}
                type="button"
                variant="destructive"
              >
                Cancel
              </Button>
              <Button
                className={actionButtonClassName}
                disabled={isSendingInvite}
                type="submit"
              >
                <Send className="h-4 w-4" />
                Send Invitation
              </Button>
            </div>
            {inviteError ? (
              <p className="form-error" role="alert">
                {inviteError}
              </p>
            ) : null}
          </form>
        )}

        {inviteStatus ? (
          <p className="w-full rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800" role="status">
            {inviteStatus}
          </p>
        ) : null}
      </section>

      <CommissionerInformationForm />

      {isInviteConfirmationOpen ? (
        <div
          aria-labelledby="confirm-invite-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-white p-6 shadow-xl">
            <div className="text-left">
              <h2
                className="text-lg font-semibold"
                id="confirm-invite-title"
              >
                Confirm Commissioner Invitation
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                Send an invitation to{" "}
                <span className="font-medium text-gray-900">{inviteEmail}</span>?
                They will receive an email to verify their address and create
                their password.
              </p>
            </div>

            {inviteError ? (
              <p className="form-error" role="alert">
                {inviteError}
              </p>
            ) : null}

            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Button
                className={secondaryActionButtonClassName}
                disabled={isSendingInvite}
                onClick={() => {
                  setInviteError("");
                  setIsInviteConfirmationOpen(false);
                }}
                type="button"
                variant="destructive"
              >
                Cancel
              </Button>
              <Button
                className={actionButtonClassName}
                disabled={isSendingInvite}
                onClick={handleConfirmInvite}
                type="button"
              >
                <Send className="h-4 w-4" />
                {isSendingInvite ? "Sending Invitation" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

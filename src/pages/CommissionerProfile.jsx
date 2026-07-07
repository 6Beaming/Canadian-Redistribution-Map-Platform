import { useState } from "react";
import { ArrowLeft, Send, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CommissionerInformationForm } from "@/components/non_prebuilt/CommissionerInformationForm.jsx";
import { ProfileSignOutButton } from "@/components/non_prebuilt/ProfileSignOutButton.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/services/authApi.js";

export default function CommissionerProfile() {
  const navigate = useNavigate();
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => navigate("/dashboard")}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Button>

      <section className="flex flex-col gap-4 rounded-xl border p-6">
        <div>
          <p className="text-sm text-gray-600">
            Invite another commissioner to collaborate with you.
          </p>
        </div>

        {!isInviteFormOpen ? (
          <Button
            className="w-fit"
            onClick={() => {
              setInviteError("");
              setInviteStatus("");
              setIsInviteFormOpen(true);
            }}
          >
            <UserPlus className="h-4 w-4" />
            Invite a new colleague
          </Button>
        ) : (
          <form
            className="flex max-w-md flex-col gap-3"
            onSubmit={handleInviteSubmit}
          >
            <Label htmlFor="colleague-email">New colleague&apos;s email</Label>
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
            <div className="flex gap-2">
              <Button
                className="w-fit"
                disabled={isSendingInvite}
                type="submit"
              >
                <Send className="h-4 w-4" />
                Send invitation
              </Button>
              <Button
                className="w-fit"
                disabled={isSendingInvite}
                onClick={handleInviteCancel}
                type="button"
                variant="outline"
              >
                Cancel
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
          <p className="form-success" role="status">
            {inviteStatus}
          </p>
        ) : null}
      </section>

      <CommissionerInformationForm />

      <ProfileSignOutButton />

      {isInviteConfirmationOpen ? (
        <div
          aria-labelledby="confirm-invite-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
        >
          <div className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-white p-6 shadow-xl">
            <div>
              <h2
                className="text-lg font-semibold"
                id="confirm-invite-title"
              >
                Confirm commissioner invitation
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

            <div className="flex justify-end gap-2">
              <Button
                disabled={isSendingInvite}
                onClick={() => {
                  setInviteError("");
                  setIsInviteConfirmationOpen(false);
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={isSendingInvite}
                onClick={handleConfirmInvite}
                type="button"
              >
                <Send className="h-4 w-4" />
                {isSendingInvite ? "Sending invitation" : "Confirm and send"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { useState } from "react";
import { Send, UserPlus } from "lucide-react";
import { CommissionerInformationForm } from "@/components/non_prebuilt/CommissionerInformationForm.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/services/authApi.js";

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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <section className="flex flex-col items-center gap-4 rounded-[24px] border border-[#d7e6fb] bg-white/92 p-6 text-center shadow-[0_16px_38px_rgba(26,115,232,0.08)]">
        <div className="w-full">
          <h2 className="text-xl font-semibold text-[#17324d]">Invite A New Colleague</h2>
          <p className="mt-2 text-sm text-gray-600">
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
            Invite A New Colleague
          </Button>
        ) : (
          <form
            className="flex w-full max-w-md flex-col items-center gap-3 text-center"
            onSubmit={handleInviteSubmit}
          >
            <Label htmlFor="colleague-email">New Colleague&apos;s Email</Label>
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
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                className="w-fit"
                disabled={isSendingInvite}
                type="submit"
              >
                <Send className="h-4 w-4" />
                Send Invitation
              </Button>
              <Button
                className="w-fit"
                disabled={isSendingInvite}
                onClick={handleInviteCancel}
                type="button"
                variant="destructive"
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

      {isInviteConfirmationOpen ? (
        <div
          aria-labelledby="confirm-invite-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
        >
          <div className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-white p-6 shadow-xl">
            <div className="text-center">
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

            <div className="flex flex-wrap justify-center gap-2">
              <Button
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
                disabled={isSendingInvite}
                onClick={handleConfirmInvite}
                type="button"
              >
                <Send className="h-4 w-4" />
                {isSendingInvite ? "Sending Invitation" : "Confirm And Send"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

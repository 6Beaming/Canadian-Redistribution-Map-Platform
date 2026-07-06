import { useState } from "react";
import { ArrowLeft, Send, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CommissionerInformationForm } from "@/components/non_prebuilt/CommissionerInformationForm.jsx";
import { ProfileSignOutButton } from "@/components/non_prebuilt/ProfileSignOutButton.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CommissionerProfile() {
  const navigate = useNavigate();
  const [isInviteFormOpen, setIsInviteFormOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");

  function handleInviteSubmit(event) {
    event.preventDefault();
    setInviteStatus(
      `Invitation email entered for ${inviteEmail}. Email delivery is not connected yet.`,
    );
  }

  function handleInviteCancel() {
    setInviteEmail("");
    setInviteStatus("");
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
            onClick={() => setIsInviteFormOpen(true)}
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
                setInviteStatus("");
              }}
              placeholder="colleague@example.com"
              required
              type="email"
              value={inviteEmail}
            />
            <div className="flex gap-2">
              <Button className="w-fit" type="submit">
                <Send className="h-4 w-4" />
                Send invitation
              </Button>
              <Button
                className="w-fit"
                onClick={handleInviteCancel}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
            {inviteStatus ? (
              <p className="text-sm text-gray-600" role="status">
                {inviteStatus}
              </p>
            ) : null}
          </form>
        )}
      </section>

      <CommissionerInformationForm />

      <ProfileSignOutButton />
    </div>
  );
}

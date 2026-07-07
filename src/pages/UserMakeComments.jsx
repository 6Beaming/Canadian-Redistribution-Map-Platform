import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext.jsx";

const PROFILE_SYNC_NOTICE =
  "Attention: Your submitted information will be synchronized with your Profile information.";
const SIGN_IN_NOTICE = "Please sign in to submit your comment.";

const provinceLabels = new Map([
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
  ["YT", "Yukon"],
]);

function getProfileSnapshot(user) {
  return {
    email: user?.email || "",
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    province: provinceLabels.get(user?.province) || user?.province || "",
    postalCode: user?.postalCode || "",
    phoneNumber: user?.phoneNumber || "",
  };
}

function FieldHoverHint({ message }) {
  return (
    <p
      className={`min-h-[18px] text-[12px] leading-[1.35] text-[#d93025] transition-opacity duration-200 ${
        message ? "opacity-0 group-hover/comment-control:opacity-100" : "opacity-0"
      }`}
      role={message ? "note" : undefined}
    >
      {message || "\u00a0"}
    </p>
  );
}

function ProfileField({ id, label, value, disabled, message, type = "text" }) {
  return (
    <div className="group/comment-control grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        className={
          disabled
            ? "min-w-0 cursor-not-allowed bg-gray-100 text-gray-500"
            : "min-w-0 cursor-default bg-[#f8fbff] text-[#3c4043]"
        }
        disabled={disabled}
        id={id}
        readOnly={!disabled}
        type={type}
        value={value}
      />
      <FieldHoverHint message={message} />
    </div>
  );
}

export default function UserMakeComments() {
  const { sessionStatus, user } = useAuth();
  const isSignedIn = sessionStatus === "signed-in";
  const profile = useMemo(() => getProfileSnapshot(user), [user]);
  const [comment, setComment] = useState("");

  function handleCommentChange(event) {
    setComment(event.target.value);
  }

  const profileFieldMessage = isSignedIn ? PROFILE_SYNC_NOTICE : SIGN_IN_NOTICE;
  const commentFieldMessage = isSignedIn ? "" : SIGN_IN_NOTICE;
  const emailFieldMessage = isSignedIn ? "" : SIGN_IN_NOTICE;

  return (
    <section className="grid min-w-0 gap-5 overflow-x-hidden">
      <div className="grid gap-1">
        <h2 className="text-[18px] font-semibold text-[#17324d]">Make Comments</h2>
        <p className="text-sm text-[#5f6368]">
          Review the synchronized profile information below and draft your comment for the current area. This view is front-end only and does not submit or store data.
        </p>
      </div>

      <form className="grid min-w-0 gap-4 overflow-x-hidden">
        <ProfileField
          disabled
          id="comment-profile-email"
          label="Email"
          message={emailFieldMessage}
          type="email"
          value={profile.email}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileField
            disabled={!isSignedIn}
            id="comment-profile-first-name"
            label="First Name"
            message={profileFieldMessage}
            value={profile.firstName}
          />
          <ProfileField
            disabled={!isSignedIn}
            id="comment-profile-last-name"
            label="Last Name"
            message={profileFieldMessage}
            value={profile.lastName}
          />
        </div>

        <ProfileField
          disabled={!isSignedIn}
          id="comment-profile-province"
          label="Province Or Territory"
          message={profileFieldMessage}
          value={profile.province}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileField
            disabled={!isSignedIn}
            id="comment-profile-postal-code"
            label="Postal Code"
            message={profileFieldMessage}
            value={profile.postalCode}
          />
          <ProfileField
            disabled={!isSignedIn}
            id="comment-profile-phone-number"
            label="Phone Number"
            message={profileFieldMessage}
            value={profile.phoneNumber}
          />
        </div>

        <div className="group/comment-control grid min-w-0 gap-2">
          <Label htmlFor="comment-content">Comment Input</Label>
          <Textarea
            className={
              isSignedIn
                ? "min-h-32 w-full bg-white text-[#3c4043]"
                : "min-h-32 w-full cursor-not-allowed bg-gray-100 text-gray-500"
            }
            disabled={!isSignedIn}
            id="comment-content"
            onChange={handleCommentChange}
            placeholder={isSignedIn ? "Type your comment here." : "Please sign in to submit your comment."}
            value={comment}
          />
          <FieldHoverHint message={commentFieldMessage} />
        </div>

        <div className="group/comment-control grid gap-2">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button disabled={!isSignedIn} type="button">
              Submit Comment
            </Button>
          </div>
          <FieldHoverHint message={commentFieldMessage} />
        </div>
      </form>
    </section>
  );
}

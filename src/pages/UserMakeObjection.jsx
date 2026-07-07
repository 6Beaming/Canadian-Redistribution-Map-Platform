import { ArrowLeft, ArrowRight, MapPinned } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { getDaGeometrySummary } from "@/lib/map/objectionWorkflow.js";
import { getDaPanelTitle } from "@/lib/map/profileUtils.js";

const PROFILE_SYNC_NOTICE =
  "Attention: Your submitted information will be synchronized with your Profile information.";
const SIGN_IN_NOTICE = "Please sign in to submit your objection.";

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

function StepBadge({ currentStep }) {
  return (
    <div className="inline-flex rounded-full border border-[#d7e6fb] bg-[#f8fbff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">
      Step {currentStep} Of 4
    </div>
  );
}

function getDaDisplay(profilesByDguid, dguid) {
  if (!dguid) {
    return {
      title: "Not Selected",
      dguid: "N/A",
    };
  }

  const profile = profilesByDguid.get(dguid);
  return {
    title: getDaPanelTitle(profile).text,
    dguid,
  };
}

function PairSummaryCard({ firstDguid, secondDguid, profilesByDguid, geometryIndex }) {
  const first = getDaDisplay(profilesByDguid, firstDguid);
  const second = getDaDisplay(profilesByDguid, secondDguid);
  const firstGeometry = getDaGeometrySummary(geometryIndex, firstDguid);
  const secondGeometry = getDaGeometrySummary(geometryIndex, secondDguid);

  return (
    <Card className="max-w-none overflow-hidden hover:translate-y-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
      <CardHeader className="min-w-0">
        <div className="grid min-w-0 gap-1">
          <CardTitle>Extracted Boundary Pair</CardTitle>
          <CardDescription>
            The selected Yukon DA pair is held only in temporary page memory. Refreshing the page clears the preview.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="grid min-w-0 content-start gap-2 rounded-[14px] border border-[#d7e6fb] bg-[#f8fbff] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">First DA</p>
            <p className="break-words text-[16px] font-semibold text-[#17324d]">{first.title}</p>
            <code className="inline-flex max-w-full break-all rounded-md bg-[#eef5ff] px-2 py-1 text-[12px] text-[#1a73e8]">{first.dguid}</code>
            {firstGeometry ? (
              <p className="break-words text-[13px] leading-6 text-[#5f6368]">
                {firstGeometry.geometryType} with {firstGeometry.polygonCount} polygon part{firstGeometry.polygonCount === 1 ? "" : "s"} and {firstGeometry.ringCount} ring{firstGeometry.ringCount === 1 ? "" : "s"}.
              </p>
            ) : null}
          </div>

          <div className="grid min-w-0 content-start gap-2 rounded-[14px] border border-[#d7e6fb] bg-[#f8fbff] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">Neighbouring DA</p>
            <p className="break-words text-[16px] font-semibold text-[#17324d]">{second.title}</p>
            <code className="inline-flex max-w-full break-all rounded-md bg-[#eef5ff] px-2 py-1 text-[12px] text-[#1a73e8]">{second.dguid}</code>
            {secondGeometry ? (
              <p className="break-words text-[13px] leading-6 text-[#5f6368]">
                {secondGeometry.geometryType} with {secondGeometry.polygonCount} polygon part{secondGeometry.polygonCount === 1 ? "" : "s"} and {secondGeometry.ringCount} ring{secondGeometry.ringCount === 1 ? "" : "s"}.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-[#ffd7d5] bg-[#fff5f5] p-4 text-[#b3261e]">
          <MapPinned className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-[13px] leading-6">
            The shared boundary between these two DAs is highlighted on the map in bright red.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function WizardActions({
  onBack,
  onConfirm,
  backLabel = "Previous Step",
  confirmLabel = "Confirm",
  confirmDisabled = false,
}) {
  return (
    <div className="grid gap-3 pt-2 sm:grid-cols-2">
      <Button className="w-full justify-center" type="button" variant="outline" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Button>
      <Button
        className="w-full justify-center"
        type="button"
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function UserMakeObjection({
  workflow,
  profilesByDguid,
  geometryIndex,
  onBackStep,
  onConfirmReview,
}) {
  const { sessionStatus, user } = useAuth();
  const isSignedIn = sessionStatus === "signed-in";
  const profile = useMemo(() => getProfileSnapshot(user), [user]);
  const [objectionText, setObjectionText] = useState("");
  const step = workflow?.step ?? 1;
  const first = getDaDisplay(profilesByDguid, workflow?.firstDguid);
  const second = getDaDisplay(profilesByDguid, workflow?.secondDguid);
  const profileFieldMessage = isSignedIn ? PROFILE_SYNC_NOTICE : SIGN_IN_NOTICE;
  const textFieldMessage = isSignedIn ? "" : SIGN_IN_NOTICE;
  const emailFieldMessage = isSignedIn ? "" : SIGN_IN_NOTICE;

  if (!geometryIndex) {
    return (
      <section className="grid min-w-0 gap-4 overflow-x-hidden">
        <div className="grid gap-1">
          <h2 className="text-[18px] font-semibold text-[#17324d]">Make An Objection To Boundaries</h2>
          <p className="text-sm text-[#5f6368]">Loading Yukon DA geometry for the objection workflow.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-5 overflow-x-hidden">
      <div className="grid gap-2">
        <StepBadge currentStep={step} />
        <div className="grid gap-1">
          <h2 className="text-[18px] font-semibold text-[#17324d]">Make An Objection To Boundaries</h2>
          <p className="text-sm text-[#5f6368]">
            This front-end prototype currently works only for the effected Yukon DA set and does not write to storage or submit data.
          </p>
        </div>
      </div>

      {workflow?.error ? (
        <p className="rounded-[14px] border border-[#ffd7d5] bg-[#fff5f5] px-4 py-3 text-[13px] font-medium leading-6 text-[#b3261e]">
          {workflow.error}
        </p>
      ) : null}

      {step === 1 ? (
        <div className="grid min-w-0 gap-4 rounded-[18px] border border-[#d7e6fb] bg-[#f8fbff] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">Step 1</p>
          <h3 className="text-[17px] font-semibold text-[#17324d]">Select The First DA</h3>
          <p className="text-[14px] leading-6 text-[#5f6368]">
            Click one Yukon dissemination area on the map to begin the objection workflow.
          </p>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-4 rounded-[18px] border border-[#d7e6fb] bg-[#f8fbff] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">Step 2</p>
            <h3 className="text-[17px] font-semibold text-[#17324d]">Select A Neighbouring DA</h3>
            <p className="text-[14px] leading-6 text-[#5f6368]">
              The first DA has been captured. Click a neighbouring Yukon DA on the map. If the second pick does not share a boundary, the workflow returns to Step 1.
            </p>
            <div className="grid min-w-0 gap-2 rounded-[14px] border border-[#d7e6fb] bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">Current First DA</p>
              <p className="text-[16px] font-semibold text-[#17324d]">{first.title}</p>
              <code className="inline-flex max-w-full break-all rounded-md bg-[#eef5ff] px-2 py-1 text-[12px] text-[#1a73e8]">{first.dguid}</code>
            </div>
          </div>

          <WizardActions
            backLabel="Back To Step 1"
            confirmDisabled
            confirmLabel="Await Map Pick"
            onBack={onBackStep}
            onConfirm={() => {}}
          />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid min-w-0 gap-4">
          <PairSummaryCard
            firstDguid={workflow.firstDguid}
            secondDguid={workflow.secondDguid}
            profilesByDguid={profilesByDguid}
            geometryIndex={geometryIndex}
          />
          <WizardActions
            backLabel="Back To Step 2"
            confirmLabel="Confirm Pair"
            onBack={onBackStep}
            onConfirm={onConfirmReview}
          />
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid min-w-0 gap-4">
          <PairSummaryCard
            firstDguid={workflow.firstDguid}
            secondDguid={workflow.secondDguid}
            profilesByDguid={profilesByDguid}
            geometryIndex={geometryIndex}
          />

          <div className="grid min-w-0 gap-4">
            <div className="grid gap-1">
              <h3 className="text-[17px] font-semibold text-[#17324d]">Objection Form</h3>
              <p className="text-[14px] leading-6 text-[#5f6368]">
                Review the synchronized profile fields below and draft your boundary objection. The submit button remains a front-end-only placeholder and writes nothing.
              </p>
            </div>

            <div className="grid min-w-0 gap-4">
              <ProfileField
                disabled
                id="objection-profile-email"
                label="Email"
                message={emailFieldMessage}
                type="email"
                value={profile.email}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <ProfileField
                  disabled={!isSignedIn}
                  id="objection-profile-first-name"
                  label="First Name"
                  message={profileFieldMessage}
                  value={profile.firstName}
                />
                <ProfileField
                  disabled={!isSignedIn}
                  id="objection-profile-last-name"
                  label="Last Name"
                  message={profileFieldMessage}
                  value={profile.lastName}
                />
              </div>

              <ProfileField
                disabled={!isSignedIn}
                id="objection-profile-province"
                label="Province Or Territory"
                message={profileFieldMessage}
                value={profile.province}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <ProfileField
                  disabled={!isSignedIn}
                  id="objection-profile-postal-code"
                  label="Postal Code"
                  message={profileFieldMessage}
                  value={profile.postalCode}
                />
                <ProfileField
                  disabled={!isSignedIn}
                  id="objection-profile-phone-number"
                  label="Phone Number"
                  message={profileFieldMessage}
                  value={profile.phoneNumber}
                />
              </div>

              <div className="group/comment-control grid min-w-0 gap-2">
                <Label htmlFor="objection-content">Objection Input</Label>
                <Textarea
                  className={
                    isSignedIn
                      ? "min-h-32 w-full bg-white text-[#3c4043]"
                      : "min-h-32 w-full cursor-not-allowed bg-gray-100 text-gray-500"
                  }
                  disabled={!isSignedIn}
                  id="objection-content"
                  onChange={(event) => setObjectionText(event.target.value)}
                  placeholder={
                    isSignedIn
                      ? `Describe your objection for ${first.title} and ${second.title}.`
                      : "Please sign in to submit your objection."
                  }
                  value={objectionText}
                />
                <FieldHoverHint message={textFieldMessage} />
              </div>

              <div className="grid gap-3 pt-2 sm:grid-cols-2 sm:items-start">
                <Button className="w-full justify-center" type="button" variant="outline" onClick={onBackStep}>
                  <ArrowLeft className="h-4 w-4" />
                  Back To Review
                </Button>

                <div className="group/comment-control grid gap-2">
                  <Button className="w-full justify-center" disabled={!isSignedIn} type="button">
                    Submit Objection
                  </Button>
                  <FieldHoverHint message={textFieldMessage} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

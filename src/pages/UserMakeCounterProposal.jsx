import { ArrowLeft, ArrowRight, RefreshCcw, Redo2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { HorizontalTabs } from "@/components/ui/horizontal-tabs";
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
import { getDaPanelTitle } from "@/lib/map/profileUtils.js";

const PROFILE_SYNC_NOTICE =
  "Attention: Your submitted information will be synchronized with your Profile information.";
const SIGN_IN_NOTICE = "Please sign in to submit your counter-proposal.";

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

const previewModeItems = [
  { id: "proposal", label: "Proposal View" },
  { id: "original", label: "Original View" },
];

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

function formatArea(value) {
  const numericValue = Number(value) || 0;

  if (Math.abs(numericValue) >= 1_000_000) {
    return `${(numericValue / 1_000_000).toFixed(2)} sq km`;
  }

  return `${Math.round(numericValue).toLocaleString("en-CA")} sq m`;
}

function formatPopulation(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-CA");
}

function formatSignedPopulation(value) {
  const numericValue = Number(value) || 0;

  if (numericValue === 0) {
    return "0";
  }

  return `${numericValue > 0 ? "+" : "-"}${formatPopulation(Math.abs(numericValue))}`;
}

function formatCoordinate(value) {
  return Number(value).toFixed(5);
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
      Step {currentStep} Of 6
    </div>
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
      <Button
        className="w-full min-w-0 whitespace-normal px-4 text-center leading-5"
        type="button"
        variant="outline"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Button>
      <Button
        className="w-full min-w-0 whitespace-normal px-4 text-center leading-5"
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

function SelectionPairCard({ cache, profilesByDguid }) {
  const first = getDaDisplay(profilesByDguid, cache?.firstDguid);
  const second = getDaDisplay(profilesByDguid, cache?.secondDguid);

  return (
    <Card className="max-w-none overflow-hidden hover:translate-y-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
      <CardHeader className="min-w-0">
        <div className="grid min-w-0 gap-1">
          <CardTitle>Counter-Proposal Cache</CardTitle>
          <CardDescription>
            The selected Yukon DA pair has been extracted into the browser-side <code>counter-proposal-cache</code>. Refreshing the page clears it.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="grid min-w-0 gap-2 rounded-[14px] border border-[#d7e6fb] bg-[#f8fbff] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">First DA</p>
            <p className="break-words text-[16px] font-semibold text-[#17324d]">{first.title}</p>
            <code className="inline-flex max-w-full break-all rounded-md bg-[#eef5ff] px-2 py-1 text-[12px] text-[#1a73e8]">{first.dguid}</code>
          </div>
          <div className="grid min-w-0 gap-2 rounded-[14px] border border-[#d7e6fb] bg-[#f8fbff] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">Neighbouring DA</p>
            <p className="break-words text-[16px] font-semibold text-[#17324d]">{second.title}</p>
            <code className="inline-flex max-w-full break-all rounded-md bg-[#eef5ff] px-2 py-1 text-[12px] text-[#1a73e8]">{second.dguid}</code>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-[14px] border border-[#d7e6fb] bg-white p-4 sm:grid-cols-3">
          <div className="grid gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">Shared Handles</p>
            <p className="text-[16px] font-semibold text-[#17324d]">{cache?.handles?.length ?? 0}</p>
          </div>
          <div className="grid gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">History Depth</p>
            <p className="text-[16px] font-semibold text-[#17324d]">{cache?.history?.length ?? 0}</p>
          </div>
          <div className="grid gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">Cache Asset</p>
            <p className="text-[16px] font-semibold text-[#17324d]">{cache?.sourceAsset ?? "counter-proposal-cache"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ImpactCard({ title, impact }) {
  return (
    <div className="grid min-w-0 gap-3 rounded-[16px] border border-[#d7e6fb] bg-[#f8fbff] p-4">
      <div className="grid gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">{title}</p>
        <p className="text-[15px] font-semibold text-[#17324d]">
          Population Impact {formatSignedPopulation(impact?.populationDelta)}
        </p>
      </div>
      <dl className="grid gap-2 text-[13px] text-[#5f6368]">
        <div className="flex items-center justify-between gap-3">
          <dt>Original Area</dt>
          <dd className="font-medium text-[#17324d]">{formatArea(impact?.originalArea)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt>Current Area</dt>
          <dd className="font-medium text-[#17324d]">{formatArea(impact?.currentArea)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt>Area Delta</dt>
          <dd className="font-medium text-[#17324d]">{formatArea(impact?.areaDelta)}</dd>
        </div>
      </dl>
    </div>
  );
}

function EditorWorkspaceCard({
  cache,
  previewMode,
  onPreviewModeChange,
  onUndo,
  onRedo,
  profilesByDguid,
}) {
  const first = getDaDisplay(profilesByDguid, cache?.firstDguid);
  const second = getDaDisplay(profilesByDguid, cache?.secondDguid);
  const selectedHandle = cache?.handles?.find((handle) => handle.id === cache?.selectedHandleId) ?? null;
  const firstImpact = cache?.impacts?.byDguid?.[cache?.firstDguid] ?? null;
  const secondImpact = cache?.impacts?.byDguid?.[cache?.secondDguid] ?? null;
  const transfer = cache?.impacts?.transfer ?? null;

  return (
    <Card className="max-w-none overflow-hidden hover:translate-y-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
      <CardHeader className="min-w-0">
        <div className="grid min-w-0 gap-1">
          <CardTitle>Counter-Proposal Editing Area</CardTitle>
          <CardDescription>
            Use the live map on the left to click a shared boundary point, drag it inside the combined DA area, then compare the original and proposal views here.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        <div className="grid min-w-0 gap-4">
          <HorizontalTabs
            items={previewModeItems}
            value={previewMode}
            onValueChange={onPreviewModeChange}
          />

          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-[40px_40px_minmax(0,1fr)]">
            <Button
              aria-label="Undo"
              className="h-10 min-w-0 w-10 justify-center justify-self-start px-0"
              size="icon-sm"
              title="Undo"
              type="button"
              variant="outline"
              onClick={onUndo}
              disabled={!cache?.history || cache.history.length <= 1}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              aria-label="Redo"
              className="h-10 min-w-0 w-10 justify-center justify-self-start px-0"
              size="icon-sm"
              title="Redo"
              type="button"
              variant="outline"
              onClick={onRedo}
              disabled={!cache?.future || cache.future.length === 0}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
            <div className="col-span-2 grid min-w-0 gap-1 rounded-[14px] border border-[#d7e6fb] bg-[#f8fbff] px-4 py-3 sm:col-span-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">Selected Handle</p>
              {selectedHandle ? (
                <p className="break-all text-[13px] font-medium text-[#17324d]">
                  {formatCoordinate(selectedHandle.coordinate[0])}, {formatCoordinate(selectedHandle.coordinate[1])}
                </p>
              ) : (
                <p className="text-[13px] text-[#5f6368]">Select one boundary point on the map.</p>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ImpactCard impact={firstImpact} title={first.title} />
            <ImpactCard impact={secondImpact} title={second.title} />
          </div>

          <div className="grid gap-2 rounded-[14px] border border-[#d7e6fb] bg-white p-4 text-[13px] text-[#5f6368]">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-[#17324d]">Population Transfer</span>
              <RefreshCcw className="h-4 w-4 text-[#1a73e8]" />
            </div>
            {transfer?.fromDguid && transfer?.toDguid ? (
              <p>
                {formatPopulation(transfer.amount)} residents are currently estimated to move from{" "}
                <span className="font-semibold text-[#17324d]">{getDaDisplay(profilesByDguid, transfer.fromDguid).title}</span>{" "}
                to{" "}
                <span className="font-semibold text-[#17324d]">{getDaDisplay(profilesByDguid, transfer.toDguid).title}</span>.
              </p>
            ) : (
              <p>No net population transfer is currently detected.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function UserMakeCounterProposal({
  workflow,
  profilesByDguid,
  onBackStep,
  onConfirmCache,
  onConfirmEdit,
  onConfirmPreview,
  onPreviewModeChange,
  onUndo,
  onRedo,
}) {
  const { sessionStatus, user } = useAuth();
  const isSignedIn = sessionStatus === "signed-in";
  const profile = useMemo(() => getProfileSnapshot(user), [user]);
  const [proposalText, setProposalText] = useState("");
  const step = workflow?.step ?? 1;
  const cache = workflow?.cache ?? null;
  const first = getDaDisplay(profilesByDguid, workflow?.firstDguid);
  const second = getDaDisplay(profilesByDguid, workflow?.secondDguid);
  const profileFieldMessage = isSignedIn ? PROFILE_SYNC_NOTICE : SIGN_IN_NOTICE;
  const textFieldMessage = isSignedIn ? "" : SIGN_IN_NOTICE;
  const emailFieldMessage = isSignedIn ? "" : SIGN_IN_NOTICE;

  return (
    <section className="grid min-w-0 gap-5 overflow-x-hidden">
      <div className="grid gap-2">
        <StepBadge currentStep={step} />
        <div className="grid gap-1">
          <h2 className="text-[18px] font-semibold text-[#17324d]">Make a Counter-Proposal</h2>
          <p className="text-sm text-[#5f6368]">
            This front-end prototype extracts a temporary browser cache for one neighbouring Yukon DA pair, lets you edit the shared boundary live on the map, and clears everything after refresh.
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
            Click one Yukon dissemination area on the map to begin your counter-proposal.
          </p>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-4 rounded-[18px] border border-[#d7e6fb] bg-[#f8fbff] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">Step 2</p>
            <h3 className="text-[17px] font-semibold text-[#17324d]">Select A Neighbouring DA</h3>
            <p className="text-[14px] leading-6 text-[#5f6368]">
              The first DA has been captured. Click a neighbouring Yukon DA on the map. If the second pick is not adjacent, the workflow returns to Step 1.
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
          <SelectionPairCard cache={cache} profilesByDguid={profilesByDguid} />
          <div className="rounded-[14px] border border-[#d7e6fb] bg-[#f8fbff] px-4 py-3 text-[13px] leading-6 text-[#5f6368]">
            The browser cache is ready. The next step enables shared-boundary point picking, dragging, and live population impact updates.
          </div>
          <WizardActions
            backLabel="Back To Step 2"
            confirmLabel="Open Editor"
            onBack={onBackStep}
            onConfirm={onConfirmCache}
          />
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid min-w-0 gap-4">
          <SelectionPairCard cache={cache} profilesByDguid={profilesByDguid} />
          <EditorWorkspaceCard
            cache={cache}
            onPreviewModeChange={onPreviewModeChange}
            onRedo={onRedo}
            onUndo={onUndo}
            previewMode={workflow?.previewMode ?? "proposal"}
            profilesByDguid={profilesByDguid}
          />
          <WizardActions
            backLabel="Back To Cache"
            confirmLabel="Review Map Switch"
            onBack={onBackStep}
            onConfirm={onConfirmEdit}
          />
        </div>
      ) : null}

      {step === 5 ? (
        <div className="grid min-w-0 gap-4">
          <EditorWorkspaceCard
            cache={cache}
            onPreviewModeChange={onPreviewModeChange}
            onRedo={onRedo}
            onUndo={onUndo}
            previewMode={workflow?.previewMode ?? "proposal"}
            profilesByDguid={profilesByDguid}
          />
          <div className="rounded-[14px] border border-[#d7e6fb] bg-[#f8fbff] px-4 py-3 text-[13px] leading-6 text-[#5f6368]">
            Switch between the original map and your proposal overlay as many times as needed. When you are satisfied, continue to the submission form.
          </div>
          <WizardActions
            backLabel="Back To Editing"
            confirmLabel="Open Submission Form"
            onBack={onBackStep}
            onConfirm={onConfirmPreview}
          />
        </div>
      ) : null}

      {step === 6 ? (
        <div className="grid min-w-0 gap-4">
          <EditorWorkspaceCard
            cache={cache}
            onPreviewModeChange={onPreviewModeChange}
            onRedo={onRedo}
            onUndo={onUndo}
            previewMode={workflow?.previewMode ?? "proposal"}
            profilesByDguid={profilesByDguid}
          />

          <div className="grid min-w-0 gap-4">
            <div className="grid gap-1">
              <h3 className="text-[17px] font-semibold text-[#17324d]">Counter-Proposal Form</h3>
              <p className="text-[14px] leading-6 text-[#5f6368]">
                Review the synchronized profile fields below and describe how your edited boundary should replace the current configuration. The submit button remains front-end only.
              </p>
            </div>

            <div className="grid min-w-0 gap-4">
              <ProfileField
                disabled
                id="counter-proposal-profile-email"
                label="Email"
                message={emailFieldMessage}
                type="email"
                value={profile.email}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <ProfileField
                  disabled={!isSignedIn}
                  id="counter-proposal-profile-first-name"
                  label="First Name"
                  message={profileFieldMessage}
                  value={profile.firstName}
                />
                <ProfileField
                  disabled={!isSignedIn}
                  id="counter-proposal-profile-last-name"
                  label="Last Name"
                  message={profileFieldMessage}
                  value={profile.lastName}
                />
              </div>

              <ProfileField
                disabled={!isSignedIn}
                id="counter-proposal-profile-province"
                label="Province Or Territory"
                message={profileFieldMessage}
                value={profile.province}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <ProfileField
                  disabled={!isSignedIn}
                  id="counter-proposal-profile-postal-code"
                  label="Postal Code"
                  message={profileFieldMessage}
                  value={profile.postalCode}
                />
                <ProfileField
                  disabled={!isSignedIn}
                  id="counter-proposal-profile-phone-number"
                  label="Phone Number"
                  message={profileFieldMessage}
                  value={profile.phoneNumber}
                />
              </div>

              <div className="group/comment-control grid min-w-0 gap-2">
                <Label htmlFor="counter-proposal-content">Counter-Proposal Input</Label>
                <Textarea
                  className={
                    isSignedIn
                      ? "min-h-32 w-full bg-white text-[#3c4043]"
                      : "min-h-32 w-full cursor-not-allowed bg-gray-100 text-gray-500"
                  }
                  disabled={!isSignedIn}
                  id="counter-proposal-content"
                  onChange={(event) => setProposalText(event.target.value)}
                  placeholder={
                    isSignedIn
                      ? `Describe your updated boundary between ${first.title} and ${second.title}.`
                      : "Please sign in to submit your counter-proposal."
                  }
                  value={proposalText}
                />
                <FieldHoverHint message={textFieldMessage} />
              </div>

              <div className="grid gap-3 pt-2 sm:grid-cols-2 sm:items-start">
                <Button
                  className="w-full min-w-0 whitespace-normal px-4 text-center leading-5"
                  type="button"
                  variant="outline"
                  onClick={onBackStep}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back To Preview
                </Button>

                <div className="group/comment-control grid gap-2">
                  <Button
                    className="w-full min-w-0 whitespace-normal px-4 text-center leading-5"
                    disabled={!isSignedIn}
                    type="button"
                  >
                    Submit Counter-Proposal
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

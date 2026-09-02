import { ArrowLeft, ArrowRight, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  WorkflowActionFooter,
  workflowActionButtonClassName,
} from "@/components/non_prebuilt/WorkflowActionFooter.jsx";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { getDaPanelTitle } from "@/lib/map/profileUtils.js";
import { submitCounterProposalWithDraft } from "@/lib/map/counterProposalSubmit.js";
import { submitCounterProposal } from "@/services/submissionsApi.js";
import { toast } from "sonner";

const SIGN_IN_NOTICE = "Please sign in to submit your counter-proposal.";
const balancedActionButtonClassName = `${workflowActionButtonClassName} w-[calc(50%-0.25rem)] max-w-[188px] px-2 text-[13px]`;

function SignInSubmissionNotice({ message }) {
  if (!message) return null;

  return <p className="workflow-submit-notice" role="note">{message}</p>;
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

function formatAreaInSquareKilometres(value, showPositiveSign = false, fractionDigits = 2) {
  const areaInSquareKilometres = (Number(value) || 0) / 1_000_000;
  const roundingFactor = 10 ** fractionDigits;
  const roundedValue = Math.round(areaInSquareKilometres * roundingFactor) / roundingFactor;
  const formattedValue = Math.abs(roundedValue).toLocaleString("en-CA", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  if (roundedValue < 0) {
    return `-${formattedValue}`;
  }

  if (showPositiveSign && roundedValue > 0) {
    return `+${formattedValue}`;
  }

  return formattedValue;
}

function getAreaComparisonValues(impact) {
  const originalArea = Number(impact?.originalArea) || 0;
  const proposedArea = Number(impact?.currentArea) || 0;
  let fractionDigits = 2;

  while (
    originalArea !== proposedArea &&
    fractionDigits < 6 &&
    formatAreaInSquareKilometres(originalArea, false, fractionDigits) ===
      formatAreaInSquareKilometres(proposedArea, false, fractionDigits)
  ) {
    fractionDigits += 1;
  }

  return {
    original: formatAreaInSquareKilometres(originalArea, false, fractionDigits),
    proposed: formatAreaInSquareKilometres(proposedArea, false, fractionDigits),
    difference: formatAreaInSquareKilometres(impact?.areaDelta, true, fractionDigits),
  };
}

function formatPopulation(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-CA");
}

function formatSignedPopulation(value) {
  const numericValue = Math.round(Number(value) || 0);

  if (numericValue === 0) {
    return "0";
  }

  return `${numericValue > 0 ? "+" : "-"}${formatPopulation(Math.abs(numericValue))}`;
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

function StepBadge({ currentStep }) {
  return (
    <div className="inline-flex rounded-full border border-[#d7e6fb] bg-[#f8fbff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#607086]">
      Step {currentStep} Of 4
    </div>
  );
}

function WizardActions({
  onBack,
  onConfirm,
  backLabel = "Previous Step",
  confirmLabel = "Confirm",
  confirmDisabled = false,
  equalWidth = false,
}) {
  const buttonClassName = equalWidth
    ? balancedActionButtonClassName
    : workflowActionButtonClassName;

  return (
    <WorkflowActionFooter>
      <Button
        className={buttonClassName}
        type="button"
        variant="outline"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Button>
      <Button
        className={buttonClassName}
        type="button"
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </WorkflowActionFooter>
  );
}

function getChangeColorClassName(value) {
  const numericValue = Number(value) || 0;

  if (numericValue < 0) return "text-red-600";
  if (numericValue > 0) return "text-green-600";
  return "text-[#17324d]";
}

function ComparisonValue({ row, side }) {
  const value = row[`${side}Value`];
  const change = row[`${side}Change`];
  const hasChange = (Number(change) || 0) !== 0;

  if (row.areaTransition) {
    return (
      <span className="flex min-w-0 flex-col items-center justify-center gap-0.5 text-center">
        <span className="text-[14px] font-bold leading-5 text-slate-500">
          {row[`${side}OriginalValue`]}
        </span>
        <span className={`text-[14px] font-bold leading-5 ${getChangeColorClassName(change)}`}>
          ↳ {value}
        </span>
        <span className={`text-xs font-semibold leading-4 ${getChangeColorClassName(change)}`}>
          ({row[`${side}DifferenceValue`]})
        </span>
      </span>
    );
  }

  return (
    <span
      className={`${row.prominent ? "text-[14px] font-bold leading-5" : `text-xs ${hasChange ? "font-semibold" : "font-medium"} leading-4`} ${getChangeColorClassName(change)}`}
    >
      {value}
    </span>
  );
}

function ComparisonCard({ first, second, firstImpact, secondImpact }) {
  const firstAreaValues = getAreaComparisonValues(firstImpact);
  const secondAreaValues = getAreaComparisonValues(secondImpact);
  const rows = [
    {
      label: "Population Impact",
      firstValue: formatSignedPopulation(firstImpact?.populationDelta),
      secondValue: formatSignedPopulation(secondImpact?.populationDelta),
      firstChange: firstImpact?.populationDelta,
      secondChange: secondImpact?.populationDelta,
      prominent: true,
    },
    {
      label: "Area (km²)",
      firstOriginalValue: firstAreaValues.original,
      secondOriginalValue: secondAreaValues.original,
      firstValue: firstAreaValues.proposed,
      secondValue: secondAreaValues.proposed,
      firstDifferenceValue: firstAreaValues.difference,
      secondDifferenceValue: secondAreaValues.difference,
      firstChange: firstImpact?.areaDelta,
      secondChange: secondImpact?.areaDelta,
      areaTransition: true,
    },
  ];

  return (
    <div className="min-w-0 overflow-hidden rounded-[14px] border border-[#d7e6fb] bg-white">
      <div className="border-b border-[#d7e6fb] bg-[#f8fbff] px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#607086]">
          Comparison
        </p>
      </div>

      <div className="grid grid-cols-[0.7fr_1fr_1fr] border-b border-[#d7e6fb] bg-white">
        <div aria-hidden="true" className="min-h-11 border-r border-[#e8f0fe]" />
        <div className="flex min-h-11 min-w-0 items-center justify-center border-r border-[#e8f0fe] px-1.5 py-1">
          <p className="break-words text-center text-[11px] font-semibold uppercase leading-[14px] text-[#17324d]">
            {first.title}
          </p>
        </div>
        <div className="flex min-h-11 min-w-0 items-center justify-center border-r border-transparent px-1.5 py-1">
          <p className="break-words text-center text-[11px] font-semibold uppercase leading-[14px] text-[#17324d]">
            {second.title}
          </p>
        </div>
      </div>

      {rows.map((row, index) => (
        <div
          key={row.label}
          className={`grid grid-cols-[0.7fr_1fr_1fr] bg-white ${index < rows.length - 1 ? "border-b border-[#e8f0fe]" : ""}`}
        >
          <div className="flex min-w-0 items-center border-r border-[#e8f0fe] bg-[#f8fbff] px-2.5 py-1.5">
            <span className="text-xs font-medium leading-4 text-slate-700">{row.label}</span>
          </div>
          <div className="flex min-w-0 items-center justify-center border-r border-[#e8f0fe] px-2 py-1.5 text-center">
            <ComparisonValue row={row} side="first" />
          </div>
          <div className="flex min-w-0 items-center justify-center border-r border-transparent px-2 py-1.5 text-center">
            <ComparisonValue row={row} side="second" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CounterProposalComparison({ cache, profilesByDguid }) {
  const first = getDaDisplay(profilesByDguid, cache?.firstDguid);
  const second = getDaDisplay(profilesByDguid, cache?.secondDguid);
  const firstImpact = cache?.impacts?.byDguid?.[cache?.firstDguid] ?? null;
  const secondImpact = cache?.impacts?.byDguid?.[cache?.secondDguid] ?? null;

  return (
    <ComparisonCard
      first={first}
      firstImpact={firstImpact}
      second={second}
      secondImpact={secondImpact}
    />
  );
}

function EditorWorkspaceCard({
  cache,
  profilesByDguid,
}) {
  const transfer = cache?.impacts?.transfer ?? null;

  return (
    <Card className="max-w-none gap-3 overflow-hidden p-4 hover:translate-y-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
      <CardContent className="min-w-0">
        <div className="grid min-w-0 gap-3">
          <p className="text-[13px] leading-5 text-[#5f6368]">
            Drag a boundary point to adjust your proposal
          </p>

          <CounterProposalComparison
            cache={cache}
            profilesByDguid={profilesByDguid}
          />

          <div className="grid gap-1.5 rounded-[14px] border border-[#d7e6fb] bg-white p-3 text-[13px] leading-5 text-[#5f6368]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[#17324d]">Population Transfer</span>
              <RefreshCcw className="h-4 w-4 text-[#1a73e8]" />
            </div>
            {transfer?.fromDguid && transfer?.toDguid ? (
              <p>
                <span className="font-bold text-[#17324d]">{formatPopulation(transfer.amount)}</span>{" "}
                residents are estimated to move from{" "}
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
  onConfirmEdit,
  onSubmitSuccess,
  exportSubmissionOperations,
}) {
  const { sessionStatus } = useAuth();
  const isSignedIn = sessionStatus === "signed-in";
  const [title, setTitle] = useState("");
  const [proposalText, setProposalText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const step = workflow?.step ?? 1;
  const cache = workflow?.cache ?? null;
  const first = getDaDisplay(profilesByDguid, workflow?.firstDguid);
  const second = getDaDisplay(profilesByDguid, workflow?.secondDguid);
  const textFieldMessage = isSignedIn ? "" : SIGN_IN_NOTICE;
  const hasGeometryIssues = Boolean(cache?.sourceGeometryIssues?.length);

  useEffect(() => {
    setTitle("");
    setProposalText("");
  }, [workflow?.firstDguid, workflow?.secondDguid, step]);

  async function handleSubmitCounterProposal() {
    if (!isSignedIn || isSubmitting) {
      return;
    }

    if (!title.trim()) {
      toast.error("Counter-proposal title cannot be empty.", { duration: 1500 });
      return;
    }

    if (!proposalText.trim()) {
      toast.error("Counter-proposal description cannot be empty.", { duration: 1500 });
      return;
    }

    if (!workflow?.firstDguid || !workflow?.secondDguid) {
      toast.error("Select a DA pair before submitting.", { duration: 1500 });
      return;
    }

    if (!cache?.currentFeatureCollection?.features?.length) {
      toast.error("Edited boundary geometry is missing.", { duration: 1500 });
      return;
    }

    if (hasGeometryIssues) {
      toast.error("This DA pair cannot be submitted until geometry issues are resolved.", {
        duration: 2000,
      });
      return;
    }

    const fedNum = profilesByDguid.get(workflow.firstDguid)?.fed_num ?? null;

    setIsSubmitting(true);

    try {
      let payload;
      if (typeof exportSubmissionOperations === "function") {
        const exported = await exportSubmissionOperations();
        if (!exported?.operations?.length) {
          toast.error("Move at least one shared boundary vertex before submitting.", { duration: 2000 });
          return;
        }
        payload = {
          schemaVersion: "2.0",
          title: title.trim(),
          comment: proposalText.trim(),
          releaseId: exported.releaseId,
          baseRevision: exported.baseRevision,
          primaryDguid: exported.primaryDguid ?? workflow.firstDguid,
          secondaryDguid: exported.secondaryDguid ?? workflow.secondDguid,
          operations: exported.operations,
          clientDiagnostics: exported.clientDiagnostics,
        };
      } else {
        payload = {
          title: title.trim(),
          comment: proposalText.trim(),
          fed_num: fedNum,
          dguid: workflow.firstDguid,
          neighboring_dguid: workflow.secondDguid,
          proposed_geometry: cache.currentFeatureCollection,
        };
      }

      await submitCounterProposalWithDraft({
        submit: submitCounterProposal,
        payload,
        onSuccess: () => onSubmitSuccess?.(workflow.secondDguid ?? workflow.firstDguid),
      });

      setTitle("");
      setProposalText("");
      toast.success("Counter-proposal submitted successfully.", { duration: 1500 });
    } catch (error) {
      console.error("Failed to submit counter-proposal:", error);
      toast.error(error.message || "Failed to submit counter-proposal.", {
        duration: 2500,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="grid min-w-0 gap-3">
      <div className="grid gap-2">
        <StepBadge currentStep={step} />
      </div>

      {workflow?.error ? (
        <p className="rounded-[14px] border border-[#ffd7d5] bg-[#fff5f5] px-4 py-3 text-[13px] font-medium leading-6 text-[#b3261e]">
          {workflow.error}
        </p>
      ) : null}

      {step === 1 ? (
        <div className="grid min-w-0 gap-4 rounded-[18px] border border-[#d7e6fb] bg-[#f8fbff] p-5">
          <h3 className="text-[17px] font-semibold text-[#17324d]">Select an area</h3>
          <p className="text-[14px] leading-6 text-[#5f6368]">
            Click a dissemination area on the map to begin your counter-proposal.
          </p>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-4 rounded-[18px] border border-[#d7e6fb] bg-[#f8fbff] p-5">
            <h3 className="text-[17px] font-semibold text-[#17324d]">Select a neighbouring area of</h3>
            <div className="grid min-w-0 gap-2 rounded-[14px] border border-[#d7e6fb] bg-white p-4">
              <p className="text-[16px] font-semibold text-[#17324d]">{first.title}</p>
            </div>
          </div>

          <WizardActions
            backLabel="Back to Step 1"
            confirmDisabled
            confirmLabel="Await Map Pick"
            onBack={onBackStep}
            onConfirm={() => {}}
          />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid min-w-0 gap-3">
          <EditorWorkspaceCard
            cache={cache}
            profilesByDguid={profilesByDguid}
          />
          <WizardActions
            backLabel="Back to Selection"
            confirmLabel="Confirm"
            equalWidth
            onBack={onBackStep}
            onConfirm={onConfirmEdit}
          />
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid min-w-0 gap-3">
          <CounterProposalComparison
            cache={cache}
            profilesByDguid={profilesByDguid}
          />

          <div className="group/comment-control grid min-w-0 gap-2">
            <Label htmlFor="counter-proposal-title">Title</Label>
            <Input
              className={
                isSignedIn
                  ? "min-w-0 bg-white text-[#3c4043]"
                  : "min-w-0 cursor-not-allowed bg-gray-100 text-gray-500"
              }
              disabled={!isSignedIn || isSubmitting}
              id="counter-proposal-title"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Enter a title for your counter-proposal."
              value={title}
            />
            {textFieldMessage ? <FieldHoverHint message={textFieldMessage} /> : null}
          </div>

          <div className="group/comment-control grid min-w-0 gap-2">
            <Label htmlFor="counter-proposal-content">Description for the new boundary</Label>
            <Textarea
              className={
                isSignedIn
                  ? "min-h-32 w-full bg-white text-[#3c4043]"
                  : "min-h-32 w-full cursor-not-allowed bg-gray-100 text-gray-500"
              }
              disabled={!isSignedIn || isSubmitting}
              id="counter-proposal-content"
              onChange={(event) => setProposalText(event.target.value)}
              placeholder={
                isSignedIn
                  ? `Describe your updated boundary between ${first.title} and ${second.title}.`
                  : "Please sign in to submit your counter-proposal."
              }
              value={proposalText}
            />
            {textFieldMessage ? <FieldHoverHint message={textFieldMessage} /> : null}
          </div>

          <div className="grid min-w-0 gap-1">
            <WorkflowActionFooter className="mt-0 gap-2">
              <Button
                className={balancedActionButtonClassName}
                type="button"
                variant="outline"
                onClick={onBackStep}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Editing
              </Button>

              <Button
                className={balancedActionButtonClassName}
                disabled={!isSignedIn || isSubmitting || hasGeometryIssues}
                type="button"
                onClick={handleSubmitCounterProposal}
              >
                {isSubmitting ? "Submitting..." : "Submit"}
              </Button>
            </WorkflowActionFooter>
            <SignInSubmissionNotice message={textFieldMessage} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

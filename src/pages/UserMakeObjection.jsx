import { ArrowLeft, ArrowRight, MapPinned } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  WorkflowActionFooter,
  workflowActionButtonClassName,
} from "@/components/non_prebuilt/WorkflowActionFooter.jsx";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { getDaPanelTitle } from "@/lib/map/profileUtils.js";
import { toast } from "sonner";
import { addComment } from "@/services/commentsApi";

const SIGN_IN_NOTICE = "Please sign in to submit your boundary objection.";

function SignInSubmissionNotice({ message }) {
  if (!message) return null;

  return <p className="workflow-submit-notice" role="note">{message}</p>;
}

function FieldHoverHint({ message }) {
  return (
    <p
      className={`min-h-[18px] text-[12px] leading-[1.35] text-[#d93025] transition-opacity duration-200 ${message ? "opacity-0 group-hover/comment-control:opacity-100" : "opacity-0"
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

function PairSummaryCard({ firstDguid, secondDguid, profilesByDguid }) {
  const first = getDaDisplay(profilesByDguid, firstDguid);
  const second = getDaDisplay(profilesByDguid, secondDguid);

  return (
    <div className="grid min-w-0 gap-4 rounded-[18px] border border-[#d7e6fb] bg-[#f8fbff] p-5">
      <h2 className="text-[17px] font-semibold leading-6 text-[#17324d]">
        Review the selected boundary
      </h2>
      <div className="relative grid min-w-0 grid-cols-2 gap-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-slate-300"
        />
        <div className="grid min-w-0 gap-2 rounded-[14px] border border-[#d7e6fb] bg-white p-4">
          <p className="text-[16px] font-semibold text-[#17324d]">{first.title}</p>
        </div>

        <div className="grid min-w-0 gap-2 rounded-[14px] border border-[#d7e6fb] bg-white p-4">
          <p className="text-[16px] font-semibold text-[#17324d]">{second.title}</p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-[14px] border border-blue-100 bg-blue-50/50 p-4 text-blue-800">
        <MapPinned className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-[13px] leading-6">
          The shared boundary between these two DAs is highlighted on the map in{" "}
          <span className="font-semibold text-red-600">bright red</span>.
        </p>
      </div>
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
    <WorkflowActionFooter>
      <Button
        className={workflowActionButtonClassName}
        type="button"
        variant="outline"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Button>
      <Button
        className={workflowActionButtonClassName}
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

export default function UserMakeObjection({
  proposalId,
  fedNum,
  dguid,
  neighboring_dguid,
  workflow,
  profilesByDguid,
  onBackStep,
  onConfirmReview,
}) {
  const { sessionStatus, user } = useAuth();
  const isSignedIn = sessionStatus === "signed-in";
  const [objectionText, setObjectionText] = useState("");
  const [title, setTitle] = useState("");
  const step = workflow?.step ?? 1;
  const first = getDaDisplay(profilesByDguid, workflow?.firstDguid);
  const second = getDaDisplay(profilesByDguid, workflow?.secondDguid);
  const textFieldMessage = isSignedIn ? "" : SIGN_IN_NOTICE;

  function handleTitleChange(event) {
    setTitle(event.target.value);
  }

  async function handleSubmitObjection() {
    if (!isSignedIn) return;

    if (title == "") {
      toast.error("Objection title cannot be empty.", {
        duration: 1000,
      });
      return;
    }
    if (objectionText == "") {
      toast.error("Objection text cannot be empty", {
        duration: 1000,
      });
      return;
    }

    try {
      await addComment(
        proposalId,
        user.id,
        objectionText,
        fedNum,
        dguid,
        title,
        neighboring_dguid,
        "objection"
      );

      setTitle("");
      setObjectionText("");
      toast.success("Objection submitted successfully.", {
        duration: 1000,
      });
    } catch (error) {
      console.error("Failed to submit objection:", error);
      toast.error("Failed to submit objection.", {
        duration: 1000,
      });
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
            Click a dissemination area on the map to begin your objection.
          </p>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-4 rounded-[18px] border border-[#d7e6fb] bg-[#f8fbff] p-5">
            <h3 className="text-[17px] font-semibold text-[#17324d]">Select a neighbouring area</h3>
            <p className="text-[14px] leading-6 text-[#5f6368]">
              Click a neighbouring dissemination area to decide the boundary.
            </p>
            <div className="grid min-w-0 gap-2 rounded-[14px] border border-[#d7e6fb] bg-white p-4">
              <p className="text-[16px] font-semibold text-[#17324d]">{first.title}</p>
            </div>
          </div>

          <WizardActions
            backLabel="Back to Step 1"
            confirmDisabled
            confirmLabel="Await Map Pick"
            onBack={onBackStep}
            onConfirm={() => { }}
          />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid min-w-0 gap-4">
          <PairSummaryCard
            firstDguid={workflow.firstDguid}
            secondDguid={workflow.secondDguid}
            profilesByDguid={profilesByDguid}
          />
          <WizardActions
            backLabel="Back to Step 2"
            confirmLabel="Confirm Pair"
            onBack={onBackStep}
            onConfirm={onConfirmReview}
          />
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-4">
            <div className="grid min-w-0 gap-4">

              <div className="group/comment-control grid min-w-0 gap-1">
                <Label className="justify-self-start text-left" htmlFor="objection-title">Title</Label>
                <Input
                  className={
                    isSignedIn
                      ? "min-w-0 bg-white text-[#3c4043]"
                      : "min-w-0 cursor-not-allowed bg-gray-100 text-gray-500"
                  }
                  disabled={!isSignedIn}
                  id="objection-title"
                  onChange={handleTitleChange}
                  placeholder="Enter a title for your objection."
                  value={title}
                />
                <FieldHoverHint message={textFieldMessage} />
              </div>

              <div className="group/comment-control grid min-w-0 gap-1">
                <Label className="justify-self-start text-left" htmlFor="objection-content">Reason for Objection</Label>
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

              <WorkflowActionFooter>
                <Button
                  className={workflowActionButtonClassName}
                  type="button"
                  variant="outline"
                  onClick={onBackStep}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Review
                </Button>

                <Button
                  className={workflowActionButtonClassName}
                  disabled={!isSignedIn}
                  type="button"
                  onClick={handleSubmitObjection}
                >
                  Submit Objection
                </Button>
              </WorkflowActionFooter>
              <SignInSubmissionNotice message={textFieldMessage} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

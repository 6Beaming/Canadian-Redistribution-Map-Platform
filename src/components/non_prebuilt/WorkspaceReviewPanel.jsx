import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  Check,
  ChevronDown,
  MessageSquareText,
  Minus,
  Plus,
  Send,
  Tag,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext.jsx";
import {
  addWorkspaceComment,
  canMergeArchiveRequest,
  commitWorkspaceAction,
  getWorkspaceReviewState,
  saveWorkspaceLabelCatalog,
  saveWorkspaceLabels,
  subscribeWorkspaceState,
  updateWorkspaceArchiveAssignees,
  WORKSPACE_STATUS,
} from "@/services/tempWorkspace.js";

const DEFAULT_LABELS = [
  { id: "constructive", name: "Constructive", color: "#1f9d62", custom: false },
  { id: "worth-to-achieve", name: "Worth to Achieve", color: "#2878d0", custom: false },
  { id: "discussion-required", name: "Discussion Required", color: "#d59a00", custom: false },
  { id: "negligible", name: "Negligible", color: "#ea7a1f", custom: false },
  { id: "over-aggressive", name: "Over Aggressive", color: "#df3d4b", custom: false },
];

const CUSTOM_LABELS = [
  { id: "custom-cyan", name: "", color: "#0891b2", custom: true },
  { id: "custom-pink", name: "", color: "#db5ca4", custom: true },
  { id: "custom-purple", name: "", color: "#805ad5", custom: true },
];

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function normalizeType(value) {
  return String(value ?? "feedback").toLowerCase().replaceAll("_", "-");
}

function SubmissionSelector({ submissions, activeId, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const close = (event) => {
      if (!selectorRef.current?.contains(event.target)) setIsOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [isOpen]);

  return (
    <div className="workspace-review-selector" ref={selectorRef}>
      <button
        type="button"
        className="workspace-review-selector__trigger"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <MessageSquareText aria-hidden="true" />
        <span>{String(activeId ?? "—")}</span>
        <ChevronDown className={isOpen ? "is-open" : ""} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="workspace-review-selector__menu">
          {submissions.map((submission) => (
            <button
              type="button"
              className={String(submission.id) === String(activeId) ? "is-active" : ""}
              key={submission.id}
              onClick={() => {
                setIsOpen(false);
                onSelect(submission.id);
              }}
            >
              <span>{String(submission.id ?? "—")}</span>
              <small>{submission.title || submission.type}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LabelEditor({ submissionId, selectedLabels, savedCatalog = [], onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [catalog, setCatalog] = useState(() =>
    savedCatalog.length ? savedCatalog : [...DEFAULT_LABELS, ...CUSTOM_LABELS],
  );

  useEffect(() => {
    setCatalog(savedCatalog.length ? savedCatalog : [...DEFAULT_LABELS, ...CUSTOM_LABELS]);
  }, [savedCatalog, submissionId]);

  function persist(nextLabels) {
    saveWorkspaceLabels(submissionId, nextLabels);
    onChange(nextLabels);
  }

  function toggleLabel(label) {
    const isSelected = selectedLabels.some((entry) => entry.id === label.id);
    if (!isSelected && label.custom && !label.name.trim()) return;
    persist(
      isSelected
        ? selectedLabels.filter((entry) => entry.id !== label.id)
        : [...selectedLabels, label],
    );
  }

  function renameCustomLabel(id, name) {
    const nextCatalog = catalog.map((label) =>
      label.id === id ? { ...label, name } : label,
    );
    setCatalog(nextCatalog);
    saveWorkspaceLabelCatalog(submissionId, nextCatalog);
    if (selectedLabels.some((label) => label.id === id)) {
      persist(selectedLabels.map((label) => (label.id === id ? { ...label, name } : label)));
    }
  }

  return (
    <section className="workspace-review-section">
      <div className="workspace-review-section__heading">
        <div><Tag aria-hidden="true" /><strong>Shared labels</strong></div>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={isOpen ? "Close label picker" : "Add a label"}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? <Minus aria-hidden="true" /> : <Plus aria-hidden="true" />} Add label
        </button>
      </div>
      <div className="workspace-labels">
        {selectedLabels.length ? selectedLabels.map((label) => (
          <span key={label.id} style={{ "--label-color": label.color }}>
            {label.name}
            <button type="button" aria-label={`Remove ${label.name}`} onClick={() => toggleLabel(label)}>
              <X aria-hidden="true" />
            </button>
          </span>
        )) : <p>No labels selected.</p>}
      </div>
      {isOpen ? (
        <div className="workspace-label-picker">
          {catalog.map((label) => {
            const checked = selectedLabels.some((entry) => entry.id === label.id);
            return (
              <div className="workspace-label-picker__row" key={label.id}>
                <button
                  type="button"
                  aria-pressed={checked}
                  aria-label={checked ? `Remove ${label.name}` : `Add ${label.name || "custom label"}`}
                  disabled={!checked && label.custom && !label.name.trim()}
                  onClick={() => toggleLabel(label)}
                >
                  <i style={{ background: label.color }} />
                  {checked ? <Check aria-hidden="true" /> : null}
                </button>
                {label.custom ? (
                  <input
                    aria-label={`Edit ${label.id}`}
                    value={label.name}
                    placeholder="Custom label"
                    maxLength={30}
                    onChange={(event) => renameCustomLabel(label.id, event.target.value)}
                  />
                ) : <span>{label.name}</span>}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function MemberCommentSelector({ activeAuthor, authors, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef(null);
  const label = activeAuthor === "all" ? "All Members" : activeAuthor;

  useEffect(() => {
    if (!isOpen) return undefined;
    const close = (event) => {
      if (!selectorRef.current?.contains(event.target)) setIsOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [isOpen]);

  return (
    <div className="workspace-review-selector workspace-member-selector" ref={selectorRef}>
      <button
        type="button"
        className="workspace-review-selector__trigger workspace-member-selector__trigger"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <MessageSquareText aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className={isOpen ? "is-open" : ""} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="workspace-review-selector__menu workspace-member-selector__menu">
          {["all", ...authors].map((author) => {
            const optionLabel = author === "all" ? "All Members" : author;
            return (
              <button
                type="button"
                className={author === activeAuthor ? "is-active" : ""}
                key={author}
                onClick={() => {
                  onChange(author);
                  setIsOpen(false);
                }}
              >
                <span>{optionLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CommentThread({ submissionId, comments, reviewerEmail, onChange, readOnly = false }) {
  const [draft, setDraft] = useState("");
  const authors = [...new Set(comments.map((comment) => comment.email))];
  const [activeAuthor, setActiveAuthor] = useState("all");
  const visibleComments = useMemo(() => {
    const filtered = activeAuthor === "all"
      ? comments
      : comments.filter((comment) => comment.email === activeAuthor);
    return [...filtered].sort((left, right) => {
      if (left.isClosing !== right.isClosing) return left.isClosing ? -1 : 1;
      return new Date(right.createdAt) - new Date(left.createdAt);
    });
  }, [activeAuthor, comments]);

  function submitComment(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    addWorkspaceComment(submissionId, { email: reviewerEmail, content });
    setDraft("");
    onChange();
  }

  return (
    <section className="workspace-review-section">
      <div className="workspace-review-section__heading workspace-review-section__heading--comments">
        <div><MessageSquareText aria-hidden="true" /><strong>Commissioner comments</strong></div>
        <MemberCommentSelector
          activeAuthor={activeAuthor}
          authors={authors}
          onChange={setActiveAuthor}
        />
      </div>
      <div className="workspace-comment-thread">
        {visibleComments.length ? visibleComments.map((comment) => (
          <article className={comment.isClosing ? "is-closing" : ""} key={comment.id}>
            <header>
              <strong>{comment.isClosing ? `${comment.email}'s Closing Comment:` : comment.email}</strong>
              <time>{formatTimestamp(comment.createdAt)}</time>
            </header>
            {comment.action ? <p className="workspace-comment-action">{comment.action}</p> : null}
            <p>{comment.content}</p>
          </article>
        )) : <p className="workspace-review-empty">No commissioner comments yet.</p>}
      </div>
      {readOnly ? (
        <p className="workspace-comment-readonly">This comment thread is read-only in the current workflow.</p>
      ) : (
        <form className="workspace-comment-form" onSubmit={submitComment}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Leave a review comment..."
            rows={3}
          />
          <button type="submit" disabled={!draft.trim()}><Send aria-hidden="true" />Submit Comment</button>
        </form>
      )}
    </section>
  );
}

function SubmissionDetails({ submission }) {
  const isPair = Boolean(submission.neighboring_dguid);

  return (
    <section className="workspace-review-section">
      <div className="workspace-review-section__heading">
        <div><MessageSquareText aria-hidden="true" /><strong>Submission</strong></div>
      </div>
      <dl className="workspace-submission-details">
        <dt>Reference ID</dt><dd><code>{submission.id}</code></dd>
        <dt>Submitted by</dt><dd>{submission.authorEmail}</dd>
        <dt>Submitted at</dt><dd>{formatTimestamp(submission.created_at)}</dd>
        <dt>Type</dt><dd>{normalizeType(submission.type).replaceAll("-", " ")}</dd>
        <dt>DA</dt><dd><code>{submission.dguid || "—"}</code></dd>
        {isPair ? <><dt>Neighbouring DA</dt><dd><code>{submission.neighboring_dguid}</code></dd></> : null}
      </dl>
      <label className="workspace-readonly-field">
        <span>Title</span>
        <input value={submission.title || "Untitled submission"} readOnly />
      </label>
      <label className="workspace-readonly-field">
        <span>Submission content</span>
        <textarea value={submission.comment || "No submission content."} rows={5} readOnly />
      </label>
    </section>
  );
}

function CounterProposalImpact({ submission }) {
  if (normalizeType(submission.type) !== "counter-proposal") return null;
  const impacts = submission.geometry?.impacts?.byDguid ?? {};
  const dguids = [submission.dguid, submission.neighboring_dguid].filter(Boolean);

  return (
    <section className="workspace-review-section">
      <div className="workspace-review-section__heading"><div><strong>Population + Area impact</strong></div></div>
      <div className="workspace-impact-table" role="table">
        <div role="row"><strong>DA</strong><strong>Population</strong><strong>Area (km²)</strong></div>
        {dguids.map((dguid) => {
          const impact = impacts[dguid] ?? {};
          return (
            <div role="row" key={dguid}>
              <code>{String(dguid).slice(-8)}</code>
              <span>{Number(impact.populationDelta || 0) >= 0 ? "+" : ""}{Math.round(impact.populationDelta || 0)}</span>
              <span>
                {(Number(impact.originalArea || 0) / 1_000_000).toFixed(2)} → {(Number(impact.currentArea || 0) / 1_000_000).toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DecisionControls({ submission, review, reviewerEmail, reviewerEmails, onCommitted }) {
  const [message, setMessage] = useState("");
  const [assignees, setAssignees] = useState(() =>
    review.archiveRequest?.assignees?.length
      ? review.archiveRequest.assignees
      : reviewerEmails,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const request = review.archiveRequest;
  const isRequester = request?.requesterEmail === reviewerEmail;
  const canMerge = isRequester && canMergeArchiveRequest(request);

  useEffect(() => {
    if (request?.assignees) setAssignees(request.assignees);
  }, [request?.assignees]);

  function toggleAssignee(email, checked) {
    const nextAssignees = checked
      ? [...new Set([...assignees, email])]
      : assignees.filter((entry) => entry !== email);
    setAssignees(nextAssignees);
    updateWorkspaceArchiveAssignees(submission.id, reviewerEmail, nextAssignees);
  }

  async function runAction(action) {
    if (!message.trim()) {
      setError("A commit message is required.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      await commitWorkspaceAction(submission, {
        action,
        email: reviewerEmail,
        message,
        assignees,
      });
      setMessage("");
      onCommitted(action);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="workspace-review-section workspace-decision-panel">
      <div className="workspace-review-section__heading"><div><strong>Decision</strong></div></div>
      {submission.status === WORKSPACE_STATUS.ARCHIVE_REQUEST && isRequester ? (
        <fieldset className="workspace-assignees">
          <legend>Archive request assignees</legend>
          {reviewerEmails.map((email) => (
            <label key={email}>
              <input
                type="checkbox"
                checked={assignees.includes(email)}
                onChange={(event) => toggleAssignee(email, event.target.checked)}
              />
              {email}
            </label>
          ))}
        </fieldset>
      ) : null}
      <label className="workspace-commit-message">
        <span>Commit message <strong>Required</strong></span>
        <textarea
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Explain the decision and its reasoning..."
        />
      </label>
      {error ? <p className="workspace-decision-error" role="alert">{error}</p> : null}
      <div className="workspace-decision-actions">
        {submission.status === WORKSPACE_STATUS.PENDING ? <>
          <button type="button" className="is-accept" disabled={isSubmitting} onClick={() => runAction("accept")}><Check />Accept</button>
          <button type="button" className="is-reject" disabled={isSubmitting} onClick={() => runAction("reject")}><X />Reject</button>
        </> : null}
        {submission.status === WORKSPACE_STATUS.ACCEPTED ? (
          <button type="button" className="is-archive" disabled={isSubmitting} onClick={() => runAction("archive-request")}>
            <ArchiveRestore />Make an Archive Request
          </button>
        ) : null}
        {submission.status === WORKSPACE_STATUS.REJECTED ? (
          <button type="button" className="is-accept" disabled={isSubmitting} onClick={() => runAction("accept-again")}><Check />Accept Again</button>
        ) : null}
        {submission.status === WORKSPACE_STATUS.ARCHIVE_REQUEST && !isRequester ? <>
          <button type="button" className="is-accept" disabled={isSubmitting} onClick={() => runAction("archive-vote-accept")}><Check />Accept</button>
          <button type="button" className="is-reject" disabled={isSubmitting} onClick={() => runAction("archive-vote-reject")}><X />Reject</button>
        </> : null}
        {submission.status === WORKSPACE_STATUS.ARCHIVE_REQUEST && isRequester ? <>
          <button type="button" className="is-reject" disabled={isSubmitting} onClick={() => runAction("archive-cancel")}><X />Cancel Request</button>
          <button type="button" className="is-archive" disabled={isSubmitting || !canMerge} onClick={() => runAction("archive-merge")}>
            <ArchiveRestore />Merge into the Archive Tree
          </button>
        </> : null}
      </div>
      {submission.status === WORKSPACE_STATUS.ARCHIVE_REQUEST && isRequester && !canMerge ? (
        <p className="workspace-decision-note">Every selected assignee must accept before merge is enabled.</p>
      ) : null}
    </section>
  );
}

export function WorkspaceReviewPanel({
  submission,
  siblingSubmissions,
  onSubmissionSelect,
  onCommitted,
  reviewerEmails: availableReviewerEmails = [],
}) {
  const { user } = useAuth();
  const reviewerEmail = user?.email || "commissioner@example.com";
  const reviewerEmails = [...new Set([reviewerEmail, ...availableReviewerEmails])];
  const [review, setReview] = useState(() => getWorkspaceReviewState(submission.id));

  function refreshReview() {
    setReview(getWorkspaceReviewState(submission.id));
  }

  useEffect(() => {
    refreshReview();
    return subscribeWorkspaceState(refreshReview);
  }, [submission.id]);

  return (
    <aside className="map-info-panel workspace-review-panel" aria-label="Submission workspace review">
      <SubmissionSelector
        submissions={siblingSubmissions}
        activeId={submission.id}
        onSelect={onSubmissionSelect}
      />
      <div className="workspace-review-panel__scroll">
        <LabelEditor
          submissionId={submission.id}
          selectedLabels={review.labels}
          savedCatalog={review.labelCatalog}
          onChange={(labels) => setReview((current) => ({ ...current, labels }))}
        />
        <CommentThread
          submissionId={submission.id}
          comments={review.comments}
          reviewerEmail={reviewerEmail}
          onChange={refreshReview}
          readOnly={submission.status !== WORKSPACE_STATUS.PENDING}
        />
        <SubmissionDetails submission={submission} />
        <CounterProposalImpact submission={submission} />
        <DecisionControls
          submission={submission}
          review={review}
          reviewerEmail={reviewerEmail}
          reviewerEmails={reviewerEmails}
          onCommitted={onCommitted}
        />
      </div>
    </aside>
  );
}

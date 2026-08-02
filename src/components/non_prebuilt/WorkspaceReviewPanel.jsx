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
  createWorkspaceLabelCatalog,
  deleteWorkspaceComment,
  deleteWorkspaceLabelCatalog,
  getWorkspaceReviewState,
  saveWorkspaceLabelCatalog,
  saveWorkspaceLabels,
  subscribeWorkspaceState,
  updateWorkspaceComment,
  updateWorkspaceArchiveAssignees,
  WORKSPACE_STATUS,
} from "@/services/workspaceApi.js";

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

function LabelEditor({
  submissionId,
  selectedLabels = [],
  savedCatalog = [],
  onChange,
  onCatalogChange,
  unavailableMessage = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [catalog, setCatalog] = useState(savedCatalog);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [error, setError] = useState("");
  const mutationPending = pendingIds.size > 0;

  useEffect(() => {
    setCatalog(savedCatalog);
  }, [savedCatalog]);

  function identity(label) {
    return String(label.catalogId ?? label.id);
  }

  async function persist(nextLabels, pendingId) {
    setPendingIds((current) => new Set(current).add(pendingId));
    setError("");
    try {
      const persisted = await saveWorkspaceLabels(submissionId, nextLabels);
      await onChange(persisted);
      return persisted;
    } catch (saveError) {
      setError(saveError.message || "Unable to update labels.");
      return null;
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(pendingId);
        return next;
      });
    }
  }

  async function toggleLabel(label) {
    const labelId = identity(label);
    if (mutationPending) return;
    const isSelected = selectedLabels.some((entry) => identity(entry) === labelId);
    if (!isSelected && label.custom && !label.name.trim()) return;
    await persist(
      isSelected
        ? selectedLabels.filter((entry) => identity(entry) !== labelId)
        : [...selectedLabels, label],
      labelId,
    );
  }

  function editCustomLabel(id, changes) {
    const nextCatalog = catalog.map((label) =>
      label.id === id ? { ...label, ...changes } : label,
    );

    setCatalog(nextCatalog);
  }

  async function persistCustomLabel(label) {
    const name = label.name.trim();
    if (!name || mutationPending) return;
    setPendingIds((current) => new Set(current).add(label.id));
    setError("");
    try {
      const saved = await saveWorkspaceLabelCatalog(label.id, { name, color: label.color });
      setCatalog((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      await onCatalogChange?.(saved);
    } catch (saveError) {
      setError(saveError.message || "Unable to save the custom label.");
      setCatalog(savedCatalog);
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(label.id);
        return next;
      });
    }
  }

  async function createCustomLabel() {
    const pendingId = "create-catalog-label";
    if (mutationPending) return;
    const existingNames = new Set(catalog.map((label) => String(label.name).trim().toLowerCase()));
    let suffix = 1;
    while (existingNames.has(`custom label ${suffix}`)) suffix += 1;
    setPendingIds((current) => new Set(current).add(pendingId));
    setError("");
    try {
      const saved = await createWorkspaceLabelCatalog({
        name: `Custom Label ${suffix}`,
        color: "#607d8b",
        custom: true,
      });
      setCatalog((current) => [...current, saved]);
      await onCatalogChange?.(saved);
    } catch (saveError) {
      setError(saveError.message || "Unable to create the custom label.");
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(pendingId);
        return next;
      });
    }
  }

  async function removeCustomLabel(label) {
    if (mutationPending) return;
    setPendingIds((current) => new Set(current).add(label.id));
    setError("");
    try {
      await deleteWorkspaceLabelCatalog(label.id);
      setCatalog((current) => current.filter((entry) => entry.id !== label.id));
      await onCatalogChange?.({ deletedId: label.id });
    } catch (saveError) {
      setError(saveError.message || "Unable to delete the custom label.");
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(label.id);
        return next;
      });
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
          disabled={Boolean(unavailableMessage)}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? <Minus aria-hidden="true" /> : <Plus aria-hidden="true" />} Add label
        </button>
      </div>
      <div className="workspace-labels">
        {selectedLabels.length ? selectedLabels.map((label, index) => (
          <span key={label.id ?? `${label.name}-${index}`} style={{ "--label-color": label.color }}>
            {label.name}
            <button
              type="button"
              aria-label={`Remove ${label.name}`}
              disabled={mutationPending}
              onClick={() => toggleLabel(label)}
            >
              <X aria-hidden="true" />
            </button>
          </span>
        )) : <p>No labels selected.</p>}
      </div>
      {unavailableMessage ? (
        <p className="workspace-decision-error" role="status">{unavailableMessage}</p>
      ) : null}
      {isOpen ? (
        <div className="workspace-label-picker">
          {catalog.map((label, index) => {
            const checked = selectedLabels.some((entry) => identity(entry) === label.id);
            return (
              <div className="workspace-label-picker__row" key={label.id ?? `${label.name}-${index}`}>
                <button
                  type="button"
                  aria-pressed={checked}
                  aria-label={checked ? `Remove ${label.name}` : `Add ${label.name || "custom label"}`}
                  disabled={mutationPending || (!checked && label.custom && !label.name.trim())}
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
                  onChange={(event) => editCustomLabel(label.id, { name: event.target.value })}
                  onBlur={() => void persistCustomLabel(label)}
                  disabled={mutationPending}
                />
                ) : <span>{label.name}</span>}
                {label.custom ? (
                  <input
                    type="color"
                    aria-label={`Change ${label.name} color`}
                    value={/^#[0-9a-f]{6}$/iu.test(label.color) ? label.color : "#607d8b"}
                    onChange={(event) => editCustomLabel(label.id, { color: event.target.value })}
                    onBlur={() => void persistCustomLabel(label)}
                    disabled={mutationPending}
                  />
                ) : null}
                {label.custom && label.createdBy ? (
                  <button
                    type="button"
                    aria-label={`Delete ${label.name}`}
                    disabled={mutationPending}
                    onClick={() => void removeCustomLabel(label)}
                  >
                    <X aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            className="workspace-label-picker__create"
            disabled={mutationPending}
            onClick={() => void createCustomLabel()}
          >
            <Plus aria-hidden="true" />
            {pendingIds.has("create-catalog-label") ? "Creating…" : "Create custom label"}
          </button>
        </div>
      ) : null}
      {error ? <p className="workspace-decision-error" role="alert">{error}</p> : null}
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingCommentId, setPendingCommentId] = useState("");
  const [editingCommentId, setEditingCommentId] = useState("");
  const [editingDraft, setEditingDraft] = useState("");
  const [error, setError] = useState("");
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

  async function submitComment(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      await addWorkspaceComment(submissionId, { content });
      await onChange();
      setDraft("");
    } catch (submitError) {
      setError(submitError.message || "Unable to submit the comment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveEditedComment(comment) {
    const content = editingDraft.trim();
    if (!content || pendingCommentId) return;
    setPendingCommentId(comment.id);
    setError("");
    try {
      await updateWorkspaceComment(comment.id, {
        content,
        action: comment.action,
        is_closing: comment.isClosing,
      });
      await onChange();
      setEditingCommentId("");
      setEditingDraft("");
    } catch (saveError) {
      setError(saveError.message || "Unable to update the comment.");
    } finally {
      setPendingCommentId("");
    }
  }

  async function removeComment(comment) {
    if (pendingCommentId) return;
    setPendingCommentId(comment.id);
    setError("");
    try {
      await deleteWorkspaceComment(comment.id);
      await onChange();
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete the comment.");
    } finally {
      setPendingCommentId("");
    }
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
            {editingCommentId === comment.id ? (
              <div className="workspace-comment-editor">
                <textarea
                  value={editingDraft}
                  onChange={(event) => setEditingDraft(event.target.value)}
                  rows={3}
                  disabled={pendingCommentId === comment.id}
                />
                <div>
                  <button
                    type="button"
                    disabled={!editingDraft.trim() || pendingCommentId === comment.id}
                    onClick={() => void saveEditedComment(comment)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={pendingCommentId === comment.id}
                    onClick={() => {
                      setEditingCommentId("");
                      setEditingDraft("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : <p>{comment.content}</p>}
            {!readOnly && !comment.isClosing && comment.email === reviewerEmail && editingCommentId !== comment.id ? (
              <div className="workspace-comment-actions">
                <button
                  type="button"
                  disabled={Boolean(pendingCommentId)}
                  onClick={() => {
                    setEditingCommentId(comment.id);
                    setEditingDraft(comment.content);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={Boolean(pendingCommentId)}
                  onClick={() => void removeComment(comment)}
                >
                  {pendingCommentId === comment.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            ) : null}
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
          <button type="submit" disabled={!draft.trim() || isSubmitting}>
            <Send aria-hidden="true" />{isSubmitting ? "Submitting…" : "Submit Comment"}
          </button>
          {error ? <p className="workspace-decision-error" role="alert">{error}</p> : null}
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
  const impactSummary = submission.geometry?.impacts ?? null;
  const impacts = impactSummary?.byDguid ?? {};
  const dguids = [submission.dguid, submission.neighboring_dguid].filter(Boolean);

  return (
    <section className="workspace-review-section">
      <div className="workspace-review-section__heading"><div><strong>Estimated population + area impact</strong></div></div>
      {impactSummary?.availability === "unavailable" ? (
        <p className="workspace-review-empty">Unavailable: {impactSummary.reason || "impact data is incomplete."}</p>
      ) : null}
      <div className="workspace-impact-table" role="table">
        <div role="row"><strong>DA</strong><strong>Population</strong><strong>Area (km²)</strong></div>
        {dguids.map((dguid) => {
          const impact = impacts[dguid] ?? {};
          return (
            <div role="row" key={dguid}>
              <code>{String(dguid).slice(-8)}</code>
              <span>{impact.populationDelta === null || impact.populationDelta === undefined
                ? "Unavailable"
                : `${impact.populationDelta >= 0 ? "+" : ""}${Math.round(impact.populationDelta)}`}</span>
              <span>
                {Number.isFinite(impact.originalArea) && Number.isFinite(impact.currentArea)
                  ? `${(impact.originalArea / 1_000_000).toFixed(2)} → ${(impact.currentArea / 1_000_000).toFixed(2)}`
                  : "Unavailable"}
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

  async function toggleAssignee(email, checked) {
    const nextAssignees = checked
      ? [...new Set([...assignees, email])]
      : assignees.filter((entry) => entry !== email);

    setAssignees(nextAssignees);

    try {
      await updateWorkspaceArchiveAssignees(
        submission.id,
        nextAssignees
      );

      onCommitted("archive-update-assignees");
    } catch (error) {
      console.error(error);
      setError(error.message);
    }
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
                onChange={(event) => void toggleAssignee(email, event.target.checked)}
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

  const EMPTY_REVIEW = {
    comments: [],
    labels: [],
    labelCatalog: [],
    archiveRequest: null,
    collaborationWarning: "",
  };

  const { user } = useAuth();
  const reviewerEmail = user?.email || "commissioner@example.com";
  const reviewerEmails = [...new Set([reviewerEmail, ...availableReviewerEmails])];
  const [review, setReview] = useState(EMPTY_REVIEW);
  const [reviewError, setReviewError] = useState("");
  const refreshSequence = useRef(0);

  async function refreshReview() {
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    try {
      const nextReview = await getWorkspaceReviewState(submission.id);
      if (refreshSequence.current !== sequence) return;
      setReview({
        comments: nextReview.comments ?? [],
        labels: nextReview.labels ?? [],
        labelCatalog: nextReview.labelCatalog ?? [],
        archiveRequest: nextReview.archiveRequest ?? null,
        collaborationWarning: nextReview.collaborationWarning ?? "",
      });
      setReviewError("");
    } catch (error) {
      console.error("Unable to load workspace review:", error);
      if (refreshSequence.current === sequence) {
        setReviewError(error.message || "Unable to refresh Workspace collaboration.");
      }
    }
  }

  useEffect(() => {
    refreshReview();
    const unsubscribe = subscribeWorkspaceState(refreshReview);
    return () => {
      refreshSequence.current += 1;
      unsubscribe();
    };
  }, [submission.id]);

  return (
    <aside className="map-info-panel workspace-review-panel" aria-label="Submission workspace review">
      <SubmissionSelector
        submissions={siblingSubmissions}
        activeId={submission.id}
        onSelect={onSubmissionSelect}
      />
      <div className="workspace-review-panel__scroll">
        {reviewError ? (
          <div className="workspace-decision-error" role="alert">
            <span>{reviewError}</span>
            <button type="button" onClick={() => void refreshReview()}>Retry</button>
          </div>
        ) : null}
        <LabelEditor
          submissionId={submission.id}
          selectedLabels={review.labels}
          savedCatalog={review.labelCatalog}
          onChange={refreshReview}
          onCatalogChange={refreshReview}
          unavailableMessage={review.collaborationWarning}
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

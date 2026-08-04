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
  getArchiveRequest,
  getWorkspaceComments,
  getWorkspaceLabelCatalog,
  getWorkspaceLabels,
  getWorkspaceReviewState,
  getWorkspaceSubmissionStatus,
  saveWorkspaceLabelCatalog,
  saveWorkspaceLabels,
  subscribeWorkspaceReviewState,
  updateWorkspaceComment,
  updateWorkspaceArchiveAssignees,
  WORKSPACE_STATUS,
} from "@/services/workspaceApi.js";
import {
  getWorkspaceReviewInvalidationTargets,
  reconcileWorkspaceCustomLabels,
} from "@/lib/realtime/workspaceRealtime.js";

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function normalizeType(value) {
  return String(value ?? "feedback").toLowerCase().replaceAll("_", "-");
}

function getClosingNoteTitle(action) {
  const normalized = String(action ?? "").toLowerCase();
  if (normalized.includes("accepted this submission")) return "Approved Note";
  if (normalized.includes("rejected this submission")) return "Rejection Note";
  if (normalized.includes("archive")) return "Archive Note";
  return "Decision Note";
}

function customPlaceholder(label, index) {
  if (!label?.custom || label?.createdBy) return "";
  const match = String(label.name ?? "").match(/^custom (?:label )?(cyan|pink|purple|[1-3])$/iu);
  const slots = { cyan: 1, pink: 2, purple: 3 };
  const slot = match ? (slots[String(match[1]).toLowerCase()] ?? Number(match[1])) : index + 1;
  return `Customized Label ${slot}`;
}

function prepareCatalog(entries = []) {
  return entries
    .map((entry, index) => {
      const placeholder = customPlaceholder(entry, index);
      return placeholder ? { ...entry, name: "", placeholder } : { ...entry };
    })
    .sort((left, right) => Number(Boolean(left.custom)) - Number(Boolean(right.custom)));
}

function labelIdentity(label) {
  return String(label?.custom
    ? label?.id ?? ""
    : label?.key ?? label?.catalogId ?? label?.id ?? "");
}

function reconcileLabelsInOrder(referenceLabels = [], persistedLabels = []) {
  const persistedById = new Map(
    persistedLabels.map((label) => [labelIdentity(label), label]),
  );
  const reconciled = referenceLabels
    .map((label) => persistedById.get(labelIdentity(label)))
    .filter(Boolean);
  const reconciledIds = new Set(reconciled.map(labelIdentity));
  persistedLabels.forEach((label) => {
    if (!reconciledIds.has(labelIdentity(label))) reconciled.push(label);
  });
  return reconciled;
}

const EMPTY_REVIEW = Object.freeze({
  submissionId: null,
  comments: [],
  labels: [],
  labelCatalog: [],
  archiveRequest: null,
  collaborationWarning: "",
});

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
  const [catalog, setCatalog] = useState(() => prepareCatalog(savedCatalog));
  const [optimisticSelected, setOptimisticSelected] = useState(selectedLabels);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [invalidCustomIds, setInvalidCustomIds] = useState(() => new Set());
  const [error, setError] = useState("");
  const invalidTimersRef = useRef(new Map());
  const draftSequenceRef = useRef(0);
  const mutationPending = pendingIds.size > 0;

  useEffect(() => () => {
    invalidTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    invalidTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!mutationPending) setCatalog(prepareCatalog(savedCatalog));
  }, [mutationPending, savedCatalog]);

  useEffect(() => {
    if (!mutationPending) {
      setOptimisticSelected((current) => reconcileLabelsInOrder(current, selectedLabels));
    }
  }, [mutationPending, selectedLabels]);

  function clearInvalidCustomLabel(labelId) {
    const timerId = invalidTimersRef.current.get(labelId);
    if (timerId) window.clearTimeout(timerId);
    invalidTimersRef.current.delete(labelId);
    setInvalidCustomIds((current) => {
      if (!current.has(labelId)) return current;
      const next = new Set(current);
      next.delete(labelId);
      return next;
    });
  }

  function flagInvalidCustomLabel(labelId) {
    const existingTimer = invalidTimersRef.current.get(labelId);
    if (existingTimer) window.clearTimeout(existingTimer);
    setInvalidCustomIds((current) => new Set(current).add(labelId));
    const timerId = window.setTimeout(() => {
      invalidTimersRef.current.delete(labelId);
      setInvalidCustomIds((current) => {
        const next = new Set(current);
        next.delete(labelId);
        return next;
      });
    }, 5000);
    invalidTimersRef.current.set(labelId, timerId);
  }

  async function persist(nextLabels, pendingId) {
    const previousLabels = optimisticSelected;
    setOptimisticSelected(nextLabels);
    setPendingIds((current) => new Set(current).add(pendingId));
    setError("");
    try {
      const persisted = await saveWorkspaceLabels(submissionId, nextLabels);
      const reconciled = reconcileLabelsInOrder(nextLabels, persisted);
      setOptimisticSelected(reconciled);
      onChange(reconciled);
      return reconciled;
    } catch (saveError) {
      setOptimisticSelected(previousLabels);
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
    const labelId = labelIdentity(label);
    if (mutationPending) return;
    const isSelected = optimisticSelected.some((entry) => labelIdentity(entry) === labelId);
    if (!isSelected && label.custom && !label.name.trim()) {
      flagInvalidCustomLabel(label.id);
      return;
    }
    await persist(
      isSelected
        ? optimisticSelected.filter((entry) => labelIdentity(entry) !== labelId)
        : [...optimisticSelected, label],
      labelId,
    );
  }

  function handleLabelRowClick(event, label) {
    if (event.target.closest("button, input")) return;
    void toggleLabel(label);
  }

  function editCustomLabel(id, changes) {
    if (Object.hasOwn(changes, "name") && String(changes.name).trim()) {
      clearInvalidCustomLabel(id);
    }
    const nextCatalog = catalog.map((label) =>
      label.id === id ? { ...label, ...changes } : label,
    );

    setCatalog(nextCatalog);
  }

  async function persistCustomLabel(label) {
    const name = label.name.trim();
    const isDraft = String(label.id).startsWith("draft-custom-");
    if (mutationPending) return;
    if (!name) {
      flagInvalidCustomLabel(label.id);
      return;
    }
    setPendingIds((current) => new Set(current).add(label.id));
    setError("");
    try {
      const saved = isDraft
        ? await createWorkspaceLabelCatalog(submissionId, { name, color: label.color, custom: true })
        : await saveWorkspaceLabelCatalog(label.id, submissionId, { name, color: label.color });
      setCatalog((current) => prepareCatalog(current.map((entry) => entry.id === label.id ? saved : entry)));
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
    if (mutationPending) return;
    setError("");
    draftSequenceRef.current += 1;
    const sequence = catalog.filter((label) => label.custom).length + 1;
    setCatalog((current) => prepareCatalog([
      ...current,
      {
        id: `draft-custom-${Date.now()}-${draftSequenceRef.current}`,
        name: "",
        color: "#607d8b",
        custom: true,
        createdBy: "draft",
        placeholder: `Customized Label ${sequence}`,
      },
    ]));
  }

  async function removeCustomLabel(label) {
    if (mutationPending) return;
    if (String(label.id).startsWith("draft-custom-")) {
      clearInvalidCustomLabel(label.id);
      setCatalog((current) => current.filter((entry) => entry.id !== label.id));
      return;
    }
    setPendingIds((current) => new Set(current).add(label.id));
    setError("");
    try {
      await deleteWorkspaceLabelCatalog(label.id, submissionId);
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
        <div><Tag aria-hidden="true" /><strong>Labels</strong></div>
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
        {optimisticSelected.length ? optimisticSelected.map((label, index) => (
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
            const checked = optimisticSelected.some((entry) => labelIdentity(entry) === label.id);
            const invalidCustomLabel = invalidCustomIds.has(label.id);
            return (
              <div
                className={`workspace-label-picker__row${mutationPending ? " is-disabled" : ""}`}
                key={label.id ?? `${label.name}-${index}`}
                onClick={(event) => handleLabelRowClick(event, label)}
              >
                <button
                  type="button"
                  aria-pressed={checked}
                  aria-label={checked ? `Remove ${label.name}` : `Add ${label.name || "custom label"}`}
                  disabled={mutationPending}
                  onClick={() => void toggleLabel(label)}
                >
                  <i style={{ background: label.color }} />
                  {checked ? <Check aria-hidden="true" /> : null}
                </button>
                {label.custom ? (
                  <input
                  aria-label={`Edit ${label.id}`}
                  value={label.name}
                    className={invalidCustomLabel ? "is-invalid" : ""}
                    placeholder={invalidCustomLabel
                      ? "Labels cannot be empty"
                      : label.placeholder || "Customized Label"}
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
            Add custom label
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
              <strong>{comment.isClosing ? getClosingNoteTitle(comment.action) : comment.email}</strong>
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

function DecisionControls({
  submission,
  review,
  reviewerEmail,
  reviewerEmails,
  archiveRequestLoading,
  onCommitted,
}) {
  const [message, setMessage] = useState("");
  const [assignees, setAssignees] = useState(() =>
    review.archiveRequest?.assignees?.length
      ? review.archiveRequest.assignees
      : reviewerEmails,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedStatus, setSubmittedStatus] = useState(null);
  const [isUpdatingAssignees, setIsUpdatingAssignees] = useState(false);
  const [error, setError] = useState("");
  const displayedStatus = submittedStatus ?? submission.status;
  const request = review.archiveRequest;
  const requesterEmail = String(request?.requesterEmail ?? "").trim().toLowerCase();
  const signedInEmail = String(reviewerEmail ?? "").trim().toLowerCase();
  const isRequester = Boolean(request) && (
    request.allowedActions?.includes("cancel")
    || (requesterEmail && requesterEmail === signedInEmail)
  );
  const canMerge = isRequester && (
    request.allowedActions?.includes("merge")
    || canMergeArchiveRequest(request)
  );

  useEffect(() => {
    if (request?.assignees) setAssignees(request.assignees);
  }, [request?.assignees]);

  async function toggleAssignee(email, checked) {
    if (isUpdatingAssignees) return;
    const previousAssignees = assignees;
    const nextAssignees = checked
      ? [...new Set([...assignees, email])]
      : assignees.filter((entry) => entry !== email);

    setAssignees(nextAssignees);
    setIsUpdatingAssignees(true);
    setError("");

    try {
      await updateWorkspaceArchiveAssignees(
        submission.id,
        nextAssignees
      );

    } catch (error) {
      console.error(error);
      setError(error.message);
      setAssignees(previousAssignees);
    } finally {
      setIsUpdatingAssignees(false);
    }
  }

  async function runAction(action) {
    if (!message.trim()) {
      setError("A commit message is required.");
      return;
    }
    setSubmittedStatus(submission.status);
    setIsSubmitting(true);
    setError("");
    let keepControlsFrozen = false;
    try {
      const committed = await commitWorkspaceAction(submission, {
        action,
        email: reviewerEmail,
        message,
        assignees,
      });
      setMessage("");
      onCommitted(action, committed);
      keepControlsFrozen = action !== "archive-request";
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      if (!keepControlsFrozen) {
        setSubmittedStatus(null);
        setIsSubmitting(false);
      }
    }
  }

  return (
    <section className="workspace-review-section workspace-decision-panel">
      <div className="workspace-review-section__heading"><div><strong>Decision</strong></div></div>
      {displayedStatus === WORKSPACE_STATUS.ARCHIVE_REQUEST && isRequester ? (
        <fieldset className="workspace-assignees">
          <legend>Archive request assignees</legend>
          {reviewerEmails.map((email) => (
            <label key={email}>
              <input
                type="checkbox"
                checked={assignees.includes(email)}
                disabled={isUpdatingAssignees}
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
        {displayedStatus === WORKSPACE_STATUS.PENDING ? <>
          <button type="button" className="is-accept" disabled={isSubmitting} onClick={() => runAction("accept")}><Check />Accept</button>
          <button type="button" className="is-reject" disabled={isSubmitting} onClick={() => runAction("reject")}><X />Reject</button>
        </> : null}
        {displayedStatus === WORKSPACE_STATUS.ACCEPTED ? (
          <button type="button" className="is-archive" disabled={isSubmitting} onClick={() => runAction("archive-request")}>
            <ArchiveRestore />Make an Archive Request
          </button>
        ) : null}
        {displayedStatus === WORKSPACE_STATUS.REJECTED ? (
          <button type="button" className="is-accept" disabled={isSubmitting} onClick={() => runAction("accept-again")}><Check />Accept Again</button>
        ) : null}
        {displayedStatus === WORKSPACE_STATUS.ARCHIVE_REQUEST && request && !isRequester ? <>
          <button type="button" className="is-accept" disabled={isSubmitting} onClick={() => runAction("archive-vote-accept")}><Check />Accept</button>
          <button type="button" className="is-reject" disabled={isSubmitting} onClick={() => runAction("archive-vote-reject")}><X />Reject</button>
        </> : null}
        {displayedStatus === WORKSPACE_STATUS.ARCHIVE_REQUEST && isRequester ? <>
          <button type="button" className="is-reject" disabled={isSubmitting} onClick={() => runAction("archive-cancel")}><X />Cancel Request</button>
          <button type="button" className="is-archive" disabled={isSubmitting || !canMerge} onClick={() => runAction("archive-merge")}>
            <ArchiveRestore />Merge into the Archive Tree
          </button>
        </> : null}
      </div>
      {displayedStatus === WORKSPACE_STATUS.ARCHIVE_REQUEST && !request ? (
        <p className="workspace-decision-note" role="status">
          {archiveRequestLoading
            ? "Loading Archive Request…"
            : "Archive Request details are unavailable."}
        </p>
      ) : null}
      {displayedStatus === WORKSPACE_STATUS.ARCHIVE_REQUEST && isRequester && !canMerge ? (
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
  onSubmissionUpdated,
  reviewerEmails: availableReviewerEmails = [],
}) {

  const { user } = useAuth();
  const reviewerEmail = user?.email || "commissioner@example.com";
  const reviewerEmails = [...new Set([reviewerEmail, ...availableReviewerEmails])];
  const [review, setReview] = useState(EMPTY_REVIEW);
  const [reviewError, setReviewError] = useState("");
  const [archiveRequestLoad, setArchiveRequestLoad] = useState({
    submissionId: null,
    loading: false,
  });
  const refreshSequence = useRef(0);
  const targetedRefreshSequence = useRef({
    archiveRequest: 0,
    comments: 0,
    labelCatalog: 0,
    labels: 0,
    status: 0,
  });

  async function refreshReview({ rethrow = false } = {}) {
    const sequence = refreshSequence.current + 1;
    const commentsSequence = targetedRefreshSequence.current.comments;
    const archiveRequestSequence = targetedRefreshSequence.current.archiveRequest;
    const labelCatalogSequence = targetedRefreshSequence.current.labelCatalog;
    const labelsSequence = targetedRefreshSequence.current.labels;
    const statusSequence = targetedRefreshSequence.current.status;
    refreshSequence.current = sequence;
    try {
      const [nextReview, nextStatus] = await Promise.all([
        getWorkspaceReviewState(submission.id),
        getWorkspaceSubmissionStatus(submission.id),
      ]);
      if (refreshSequence.current !== sequence) return;
      setReview((current) => {
        const isCurrentSubmission = String(current.submissionId) === String(submission.id);
        return {
          submissionId: submission.id,
          comments: targetedRefreshSequence.current.comments === commentsSequence
            ? nextReview.comments ?? []
            : (isCurrentSubmission ? current.comments : []),
          labels: targetedRefreshSequence.current.labels === labelsSequence
            ? nextReview.labels ?? []
            : (isCurrentSubmission ? current.labels : []),
          labelCatalog: targetedRefreshSequence.current.labelCatalog === labelCatalogSequence
            ? nextReview.labelCatalog ?? []
            : (isCurrentSubmission ? current.labelCatalog : []),
          archiveRequest: targetedRefreshSequence.current.archiveRequest === archiveRequestSequence
            ? nextReview.archiveRequest ?? null
            : (isCurrentSubmission ? current.archiveRequest : null),
          collaborationWarning: nextReview.collaborationWarning ?? "",
        };
      });
      if (targetedRefreshSequence.current.status === statusSequence) {
        onSubmissionUpdated?.(nextStatus);
      }
      setReviewError("");
    } catch (error) {
      console.error("Unable to load workspace review:", error);
      if (refreshSequence.current === sequence) {
        setReviewError(error.message || "Unable to refresh Workspace collaboration.");
      }
      if (rethrow) throw error;
    }
  }

  async function refreshComments() {
    const sequence = targetedRefreshSequence.current.comments + 1;
    targetedRefreshSequence.current.comments = sequence;
    try {
      const comments = await getWorkspaceComments(submission.id);
      if (targetedRefreshSequence.current.comments !== sequence) return;
      setReview((current) => String(current.submissionId) === String(submission.id)
        ? { ...current, comments: comments ?? [] }
        : { ...EMPTY_REVIEW, submissionId: submission.id, comments: comments ?? [] });
      setReviewError("");
    } catch (error) {
      if (targetedRefreshSequence.current.comments === sequence) {
        setReviewError(error.message || "Unable to refresh Workspace comments.");
      }
      throw error;
    }
  }

  async function refreshLabels() {
    const sequence = targetedRefreshSequence.current.labels + 1;
    targetedRefreshSequence.current.labels = sequence;
    try {
      const labels = await getWorkspaceLabels(submission.id);
      if (targetedRefreshSequence.current.labels !== sequence) return;
      setReview((current) => String(current.submissionId) === String(submission.id)
        ? { ...current, labels: labels ?? [] }
        : { ...EMPTY_REVIEW, submissionId: submission.id, labels: labels ?? [] });
      setReviewError("");
    } catch (error) {
      if (targetedRefreshSequence.current.labels === sequence) {
        setReviewError(error.message || "Unable to refresh Workspace labels.");
      }
      throw error;
    }
  }

  async function refreshCustomLabels() {
    const labelCatalogSequence = targetedRefreshSequence.current.labelCatalog + 1;
    const labelsSequence = targetedRefreshSequence.current.labels + 1;
    targetedRefreshSequence.current.labelCatalog = labelCatalogSequence;
    targetedRefreshSequence.current.labels = labelsSequence;
    try {
      const labelCatalog = await getWorkspaceLabelCatalog(submission.id);
      if (targetedRefreshSequence.current.labelCatalog !== labelCatalogSequence) return;
      setReview((current) => {
        const isCurrentSubmission = String(current.submissionId) === String(submission.id);
        const currentLabels = isCurrentSubmission ? current.labels : [];
        return {
          ...(isCurrentSubmission ? current : EMPTY_REVIEW),
          submissionId: submission.id,
          labelCatalog: labelCatalog ?? [],
          labels: targetedRefreshSequence.current.labels === labelsSequence
            ? reconcileWorkspaceCustomLabels(currentLabels, labelCatalog ?? [])
            : currentLabels,
        };
      });
      setReviewError("");
    } catch (error) {
      if (targetedRefreshSequence.current.labelCatalog === labelCatalogSequence) {
        setReviewError(error.message || "Unable to refresh custom Workspace labels.");
      }
      throw error;
    }
  }

  async function refreshArchiveRequest() {
    const sequence = targetedRefreshSequence.current.archiveRequest + 1;
    const activeSubmissionId = String(submission.id);
    targetedRefreshSequence.current.archiveRequest = sequence;
    setArchiveRequestLoad({ submissionId: activeSubmissionId, loading: true });
    try {
      let archiveRequest;
      try {
        archiveRequest = await getArchiveRequest(submission.id);
      } catch (error) {
        if (error.status !== 404) throw error;
        archiveRequest = null;
      }
      if (targetedRefreshSequence.current.archiveRequest !== sequence) return;
      setReview((current) => String(current.submissionId) === String(submission.id)
        ? { ...current, archiveRequest }
        : { ...EMPTY_REVIEW, submissionId: submission.id, archiveRequest });
      setReviewError("");
    } catch (error) {
      if (targetedRefreshSequence.current.archiveRequest === sequence) {
        setReviewError(error.message || "Unable to refresh the Archive Request.");
      }
      throw error;
    } finally {
      if (targetedRefreshSequence.current.archiveRequest === sequence) {
        setArchiveRequestLoad({ submissionId: activeSubmissionId, loading: false });
      }
    }
  }

  async function refreshStatus() {
    const sequence = targetedRefreshSequence.current.status + 1;
    targetedRefreshSequence.current.status = sequence;
    try {
      const nextStatus = await getWorkspaceSubmissionStatus(submission.id);
      if (targetedRefreshSequence.current.status !== sequence) return;
      onSubmissionUpdated?.(nextStatus);
      setReviewError("");
    } catch (error) {
      if (targetedRefreshSequence.current.status === sequence) {
        setReviewError(error.message || "Unable to refresh the Workspace status.");
      }
      throw error;
    }
  }

  async function handleReviewInvalidation({ hints, resync }) {
    if (resync) {
      await refreshReview({ rethrow: true });
      return;
    }
    const targets = getWorkspaceReviewInvalidationTargets(hints, submission.id);
    await Promise.all([
      ...(targets.includes("archiveRequest") ? [refreshArchiveRequest()] : []),
      ...(targets.includes("comments") ? [refreshComments()] : []),
      ...(targets.includes("labelCatalog") ? [refreshCustomLabels()] : []),
      ...(targets.includes("labels") ? [refreshLabels()] : []),
      ...(targets.includes("status") ? [refreshStatus()] : []),
    ]);
  }

  useEffect(() => {
    setReviewError("");
    refreshReview();
    if (submission.status === WORKSPACE_STATUS.ARCHIVE_REQUEST) {
      void refreshArchiveRequest().catch(() => {});
    }
    const unsubscribe = subscribeWorkspaceReviewState(submission.id, {
      onInvalidate: handleReviewInvalidation,
      onRecover: refreshReview,
    });
    return () => {
      refreshSequence.current += 1;
      targetedRefreshSequence.current.archiveRequest += 1;
      targetedRefreshSequence.current.comments += 1;
      targetedRefreshSequence.current.labelCatalog += 1;
      targetedRefreshSequence.current.labels += 1;
      targetedRefreshSequence.current.status += 1;
      unsubscribe();
    };
  }, [submission.id]);

  const activeReview = String(review.submissionId) === String(submission.id)
    ? review
    : EMPTY_REVIEW;
  const archiveRequestLoading = submission.status === WORKSPACE_STATUS.ARCHIVE_REQUEST
    && !activeReview.archiveRequest
    && (
      archiveRequestLoad.submissionId !== String(submission.id)
      || archiveRequestLoad.loading
    );

  function updateActiveLabels(labels) {
    setReview((current) => String(current.submissionId) === String(submission.id)
      ? { ...current, labels }
      : current);
  }

  function updateActiveCatalog(change) {
    setReview((current) => {
      if (String(current.submissionId) !== String(submission.id)) return current;
      if (change?.deletedId) {
        return {
          ...current,
          labels: current.labels.filter((label) => labelIdentity(label) !== String(change.deletedId)),
          labelCatalog: current.labelCatalog.filter((label) => label.id !== change.deletedId),
        };
      }
      const exists = current.labelCatalog.some((label) => label.id === change?.id);
      return {
        ...current,
        labels: current.labels.map((label) => labelIdentity(label) === change?.id
          ? { ...label, name: change.name, color: change.color }
          : label),
        labelCatalog: exists
          ? current.labelCatalog.map((label) => label.id === change.id ? change : label)
          : [...current.labelCatalog, change],
      };
    });
  }

  function handleDecisionCommitted(action, committed) {
    if (committed?.review) {
      setReview({
        submissionId: submission.id,
        comments: committed.review.comments ?? [],
        labels: committed.review.labels ?? [],
        labelCatalog: committed.review.labelCatalog ?? [],
        archiveRequest: committed.review.archiveRequest ?? null,
        collaborationWarning: committed.review.collaborationWarning ?? "",
      });
    }
    onCommitted?.(action, committed);
  }

  return (
    <aside className="map-info-panel workspace-review-panel" aria-label="Submission workspace review">
      <SubmissionSelector
        submissions={siblingSubmissions}
        activeId={submission.id}
        onSelect={onSubmissionSelect}
      />
      {submission.crossProvinceWarning ? (
        <p className="workspace-cross-province-warning" role="alert">
          {submission.crossProvinceWarning}
        </p>
      ) : null}
      <div className="workspace-review-panel__scroll">
        {reviewError ? (
          <div className="workspace-decision-error" role="alert">
            <span>{reviewError}</span>
            <button type="button" onClick={() => void refreshReview()}>Retry</button>
          </div>
        ) : null}
        <LabelEditor
          key={submission.id}
          submissionId={submission.id}
          selectedLabels={activeReview.labels}
          savedCatalog={activeReview.labelCatalog}
          onChange={updateActiveLabels}
          onCatalogChange={updateActiveCatalog}
          unavailableMessage={activeReview.collaborationWarning}
        />
        <CommentThread
          submissionId={submission.id}
          comments={activeReview.comments}
          reviewerEmail={reviewerEmail}
          onChange={refreshComments}
          readOnly={submission.status !== WORKSPACE_STATUS.PENDING}
        />
        <SubmissionDetails submission={submission} />
        <CounterProposalImpact submission={submission} />
        <DecisionControls
          submission={submission}
          review={activeReview}
          reviewerEmail={reviewerEmail}
          reviewerEmails={reviewerEmails}
          archiveRequestLoading={archiveRequestLoading}
          onCommitted={handleDecisionCommitted}
        />
      </div>
    </aside>
  );
}

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
import { toast } from "sonner";
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
  updateWorkspaceArchiveAssigneesById,
  WORKSPACE_STATUS,
} from "@/services/workspaceApi.js";
import {
  getWorkspaceReviewInvalidationTargets,
  reconcileWorkspaceCustomLabels,
} from "@/lib/realtime/workspaceRealtime.js";
import { mergeCatalogFromServer, replaceCatalogDraft } from "@/lib/workspace/catalogMerge.js";
import { createEchoSuppressor, workspaceReviewHint } from "@/lib/workspace/echoSuppression.js";
import {
  isDraftCustomLabelId,
  isSameLabel,
  labelIdentity,
  prepareCatalog,
  reconcileLabelsInOrder,
  selectionFingerprint,
} from "@/lib/workspace/labelIdentity.js";
import { createLabelMutationQueue } from "@/lib/workspace/labelMutationQueue.js";
import { createLocalMutationGuard } from "@/lib/workspace/localMutationGuard.js";
import { preparePayloadWithRealUuids } from "@/lib/workspace/prepareLabelPayload.js";
import { MapInfoPanelShell } from "@/components/non_prebuilt/MapInfoPanelShell.jsx";

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
    <div className="workspace-review-selector panel-select" ref={selectorRef}>
      <button
        type="button"
        className="workspace-review-selector__trigger panel-select__trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <MessageSquareText aria-hidden="true" />
        <span>{String(activeId ?? "—")}</span>
        <ChevronDown className={isOpen ? "is-open" : ""} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="workspace-review-selector__menu panel-select__menu" role="menu">
          {submissions.map((submission) => (
            <button
              type="button"
              className={`panel-select__option${String(submission.id) === String(activeId) ? " is-active" : ""}`}
              role="menuitem"
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
  onSuppressEcho,
  onLocalMutation,
  unavailableMessage = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [catalog, setCatalog] = useState(() => prepareCatalog(savedCatalog));
  const [optimisticSelected, setOptimisticSelected] = useState(selectedLabels);
  const [pendingLabelKeys, setPendingLabelKeys] = useState(() => new Set());
  const [invalidCustomIds, setInvalidCustomIds] = useState(() => new Set());
  const [error, setError] = useState("");
  const invalidTimersRef = useRef(new Map());
  const draftSequenceRef = useRef(0);
  const catalogRef = useRef(catalog);
  const optimisticSelectedRef = useRef(optimisticSelected);
  const lastCommittedSelectedRef = useRef(selectedLabels);
  const labelQueueRef = useRef(null);
  const labelDrainActiveRef = useRef(false);
  const labelNeedsDrainRef = useRef(false);
  const customEditDeselectedRef = useRef(new Set());
  const persistingDraftIdsRef = useRef(new Set());

  if (!labelQueueRef.current) {
    labelQueueRef.current = createLabelMutationQueue();
  }

  catalogRef.current = catalog;
  optimisticSelectedRef.current = optimisticSelected;

  useEffect(() => () => {
    invalidTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    invalidTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (onLocalMutation?.isAnyActive?.(["labels", "labelCatalog"])) return;
    if (labelQueueRef.current?.isBusy) return;
    setCatalog((current) => mergeCatalogFromServer(current, savedCatalog));
  }, [savedCatalog, onLocalMutation]);

  useEffect(() => {
    if (onLocalMutation?.isAnyActive?.(["labels", "labelCatalog"])) return;
    if (labelQueueRef.current?.isBusy) return;
    const reconciled = reconcileLabelsInOrder(optimisticSelectedRef.current, selectedLabels);
    optimisticSelectedRef.current = reconciled;
    lastCommittedSelectedRef.current = reconcileLabelsInOrder(
      lastCommittedSelectedRef.current,
      selectedLabels,
    );
    setOptimisticSelected(reconciled);
  }, [selectedLabels, onLocalMutation]);

  function syncOptimisticSelected(next) {
    optimisticSelectedRef.current = next;
    setOptimisticSelected(next);
  }

  function suppressLabelEcho() {
    onSuppressEcho?.(["labels", "labelCatalog"]);
  }

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

  async function flushLabelPutOnce() {
    const fingerprintBeforePut = selectionFingerprint(optimisticSelectedRef.current);
    setError("");
    try {
      const { labels: payload, catalog: nextCatalog } = await preparePayloadWithRealUuids(
        optimisticSelectedRef.current,
        catalogRef.current,
        {
          createCustomLabel: (label) => createWorkspaceLabelCatalog(submissionId, label),
          onCatalogEntrySaved: (draftId, saved, mergedCatalog) => {
            catalogRef.current = mergedCatalog;
            setCatalog(mergedCatalog);
            syncOptimisticSelected(
              optimisticSelectedRef.current.map((entry) => (
                isSameLabel(entry, { id: draftId, custom: true }) ? { ...saved, custom: true } : entry
              )),
            );
            onCatalogChange?.(saved);
          },
        },
      );
      if (nextCatalog !== catalogRef.current) {
        catalogRef.current = nextCatalog;
        setCatalog(nextCatalog);
      }
      const persisted = await saveWorkspaceLabels(submissionId, payload);
      const fingerprintAfterPut = selectionFingerprint(optimisticSelectedRef.current);
      if (fingerprintAfterPut !== fingerprintBeforePut) {
        suppressLabelEcho();
        return true;
      }
      const reconciled = reconcileLabelsInOrder(optimisticSelectedRef.current, persisted);
      lastCommittedSelectedRef.current = reconciled;
      syncOptimisticSelected(reconciled);
      suppressLabelEcho();
      return true;
    } catch (saveError) {
      labelQueueRef.current.flush();
      labelDrainActiveRef.current = false;
      labelNeedsDrainRef.current = false;
      syncOptimisticSelected(lastCommittedSelectedRef.current);
      const message = saveError.message || "Unable to update labels.";
      setError(message);
      toast.error("Label update failed. Your selection was restored.");
      return false;
    }
  }

  async function runLabelDrainUntilSettled() {
    onLocalMutation?.begin("labels");
    onLocalMutation?.begin("labelCatalog");
    suppressLabelEcho();
    try {
      let attempts = 0;
      while (attempts < 24) {
        const target = selectionFingerprint(optimisticSelectedRef.current);
        const committed = selectionFingerprint(lastCommittedSelectedRef.current);
        if (target === committed) break;
        const success = await flushLabelPutOnce();
        if (!success) break;
        attempts += 1;
        suppressLabelEcho();
      }
      onChange(lastCommittedSelectedRef.current);
      suppressLabelEcho();
    } finally {
      onLocalMutation?.end("labelCatalog");
      onLocalMutation?.end("labels");
      setPendingLabelKeys(new Set());
    }
  }

  function pumpLabelDrain() {
    labelNeedsDrainRef.current = true;
    if (labelDrainActiveRef.current) return;
    labelDrainActiveRef.current = true;
    void labelQueueRef.current.enqueue(async () => {
      try {
        do {
          labelNeedsDrainRef.current = false;
          await runLabelDrainUntilSettled();
        } while (
          labelNeedsDrainRef.current
          || selectionFingerprint(optimisticSelectedRef.current)
            !== selectionFingerprint(lastCommittedSelectedRef.current)
        );
      } finally {
        labelDrainActiveRef.current = false;
        if (
          labelNeedsDrainRef.current
          || selectionFingerprint(optimisticSelectedRef.current)
            !== selectionFingerprint(lastCommittedSelectedRef.current)
        ) {
          pumpLabelDrain();
        }
      }
    });
  }

  function scheduleLabelSync(triggerKey) {
    suppressLabelEcho();
    setPendingLabelKeys((current) => new Set(current).add(triggerKey));
    pumpLabelDrain();
  }

  function handleToggleLabel(label) {
    const catalogEntry = catalogRef.current.find((entry) => isSameLabel(entry, label)) ?? label;
    const labelKey = labelIdentity(catalogEntry);
    const isSelected = optimisticSelectedRef.current.some((entry) => isSameLabel(entry, catalogEntry));

    if (!isSelected && catalogEntry.custom && !String(catalogEntry.name ?? "").trim()) {
      flagInvalidCustomLabel(catalogEntry.id);
      return;
    }

    if (catalogEntry.custom && !isDraftCustomLabelId(catalogEntry.id)) {
      customEditDeselectedRef.current.delete(catalogEntry.id);
    }

    const nextSelected = isSelected
      ? optimisticSelectedRef.current.filter((entry) => !isSameLabel(entry, catalogEntry))
      : [...optimisticSelectedRef.current, { ...catalogEntry, custom: Boolean(catalogEntry.custom) }];

    syncOptimisticSelected(nextSelected);
    suppressLabelEcho();
    scheduleLabelSync(labelKey);
  }

  function handleLabelRowClick(event, label) {
    if (event.target.closest("button, input")) return;
    void handleToggleLabel(label);
  }

  function editCustomLabel(id, changes) {
    if (Object.hasOwn(changes, "name") && String(changes.name).trim()) {
      clearInvalidCustomLabel(id);
    }
    const entry = catalogRef.current.find((item) => item.id === id);
    const nextCatalog = catalog.map((label) =>
      label.id === id ? { ...label, ...changes } : label,
    );
    catalogRef.current = nextCatalog;
    setCatalog(nextCatalog);

    if (entry?.custom && !isDraftCustomLabelId(id) && !customEditDeselectedRef.current.has(id)) {
      const isSelected = optimisticSelectedRef.current.some((item) => isSameLabel(item, entry));
      if (isSelected) {
        customEditDeselectedRef.current.add(id);
        syncOptimisticSelected(
          optimisticSelectedRef.current.filter((item) => !isSameLabel(item, entry)),
        );
        suppressLabelEcho();
        scheduleLabelSync(labelIdentity(entry));
      }
    }
  }

  async function persistCustomLabel(labelId) {
    if (persistingDraftIdsRef.current.has(labelId)) return;
    const label = catalogRef.current.find((entry) => entry.id === labelId);
    if (!label?.custom) return;
    const name = String(label.name ?? "").trim();
    if (!name) {
      flagInvalidCustomLabel(labelId);
      return;
    }
    if (isDraftCustomLabelId(labelId)) {
      clearInvalidCustomLabel(labelId);
      return;
    }

    persistingDraftIdsRef.current.add(labelId);
    onLocalMutation?.begin("labelCatalog");
    suppressLabelEcho();
    setError("");
    try {
      const saved = await saveWorkspaceLabelCatalog(labelId, submissionId, {
        name,
        color: label.color,
      });
      const nextCatalog = replaceCatalogDraft(catalogRef.current, labelId, saved);
      catalogRef.current = nextCatalog;
      setCatalog(nextCatalog);
      await onCatalogChange?.(saved);
      suppressLabelEcho();
    } catch (saveError) {
      setError(saveError.message || "Unable to save the custom label.");
    } finally {
      persistingDraftIdsRef.current.delete(labelId);
      onLocalMutation?.end("labelCatalog");
    }
  }

  function createCustomLabel() {
    setError("");
    draftSequenceRef.current += 1;
    const sequence = catalog.filter((entry) => entry.custom).length + 1;
    const nextCatalog = prepareCatalog([
      ...catalogRef.current,
      {
        id: `draft-custom-${Date.now()}-${draftSequenceRef.current}`,
        name: "",
        color: "#607d8b",
        custom: true,
        createdBy: "draft",
        placeholder: `Customized Label ${sequence}`,
      },
    ]);
    catalogRef.current = nextCatalog;
    setCatalog(nextCatalog);
  }

  async function removeCustomLabel(label) {
    if (isDraftCustomLabelId(label.id)) {
      clearInvalidCustomLabel(label.id);
      const nextCatalog = catalogRef.current.filter((entry) => entry.id !== label.id);
      catalogRef.current = nextCatalog;
      setCatalog(nextCatalog);
      return;
    }
    const labelKey = labelIdentity(label);
    onLocalMutation?.begin("labelCatalog");
    onLocalMutation?.begin("labels");
    suppressLabelEcho();
    setPendingLabelKeys((current) => new Set(current).add(labelKey));
    setError("");
    try {
      await deleteWorkspaceLabelCatalog(label.id, submissionId);
      const nextCatalog = catalogRef.current.filter((entry) => entry.id !== label.id);
      catalogRef.current = nextCatalog;
      setCatalog(nextCatalog);
      syncOptimisticSelected(
        optimisticSelectedRef.current.filter((entry) => !isSameLabel(entry, label)),
      );
      await onCatalogChange?.({ deletedId: label.id });
      suppressLabelEcho();
    } catch (saveError) {
      setError(saveError.message || "Unable to delete the custom label.");
    } finally {
      setPendingLabelKeys((current) => {
        const next = new Set(current);
        next.delete(labelKey);
        return next;
      });
      onLocalMutation?.end("labels");
      onLocalMutation?.end("labelCatalog");
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
        {optimisticSelected.length ? optimisticSelected.map((label, index) => {
          const pendingKey = labelIdentity(label);
          const isItemPending = pendingLabelKeys.has(pendingKey);
          return (
            <span
              key={label.id ?? `${label.name}-${index}`}
              style={{ "--label-color": label.color }}
              className={isItemPending ? "is-pending" : undefined}
            >
              {label.name}
              <button
                type="button"
                aria-label={`Remove ${label.name}`}
                aria-busy={isItemPending}
                disabled={isItemPending}
                onClick={() => handleToggleLabel(label)}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          );
        }) : <p>No labels selected.</p>}
      </div>
      {unavailableMessage ? (
        <p className="workspace-decision-error" role="status">{unavailableMessage}</p>
      ) : null}
      {isOpen ? (
        <div className="workspace-label-picker">
          {catalog.map((label, index) => {
            const checked = optimisticSelected.some((entry) => isSameLabel(entry, label));
            const invalidCustomLabel = invalidCustomIds.has(label.id);
            const pendingKey = labelIdentity(label);
            const isItemPending = pendingLabelKeys.has(pendingKey);
            return (
              <div
                className={`workspace-label-picker__row${isItemPending ? " is-pending" : ""}`}
                key={label.id ?? `${label.name}-${index}`}
                onClick={(event) => handleLabelRowClick(event, label)}
              >
                <button
                  type="button"
                  aria-pressed={checked}
                  aria-busy={isItemPending}
                  aria-label={checked ? `Remove ${label.name}` : `Add ${label.name || "custom label"}`}
                  disabled={isItemPending}
                  onClick={() => void handleToggleLabel(label)}
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
                    onBlur={() => void persistCustomLabel(label.id)}
                  />
                ) : <span>{label.name}</span>}
                {label.custom ? (
                  <input
                    type="color"
                    aria-label={`Change ${label.name} color`}
                    value={/^#[0-9a-f]{6}$/iu.test(label.color) ? label.color : "#607d8b"}
                    onChange={(event) => editCustomLabel(label.id, { color: event.target.value })}
                    onBlur={() => void persistCustomLabel(label.id)}
                  />
                ) : null}
                {label.custom && label.createdBy ? (
                  <button
                    type="button"
                    aria-label={`Delete ${label.name}`}
                    aria-busy={isItemPending}
                    disabled={isItemPending}
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
            onClick={() => createCustomLabel()}
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
    <div className="workspace-review-selector workspace-member-selector panel-select" ref={selectorRef}>
      <button
        type="button"
        className="workspace-review-selector__trigger workspace-member-selector__trigger panel-select__trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <MessageSquareText aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className={isOpen ? "is-open" : ""} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="workspace-review-selector__menu workspace-member-selector__menu panel-select__menu" role="menu">
          {["all", ...authors].map((author) => {
            const optionLabel = author === "all" ? "All Members" : author;
            return (
              <button
                type="button"
                className={`panel-select__option${author === activeAuthor ? " is-active" : ""}`}
                role="menuitem"
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

function CommentThread({
  submissionId,
  comments,
  reviewerEmail,
  onCommentsChange,
  onSuppressEcho,
  onLocalMutation,
  readOnly = false,
}) {
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingCommentIds, setPendingCommentIds] = useState(() => new Set());
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

  function markCommentPending(commentId, pending) {
    setPendingCommentIds((current) => {
      const next = new Set(current);
      if (pending) next.add(commentId);
      else next.delete(commentId);
      return next;
    });
  }

  async function submitComment(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSubmitting) return;
    const tempId = `temp-comment-${Date.now()}`;
    const optimistic = {
      id: tempId,
      submissionId,
      content,
      email: reviewerEmail,
      createdAt: new Date().toISOString(),
      isClosing: false,
      action: null,
      isOptimistic: true,
    };
    onCommentsChange((current) => [optimistic, ...current]);
    onSuppressEcho?.(["comments"]);
    onLocalMutation?.begin("comments");
    setIsSubmitting(true);
    setError("");
    try {
      const saved = await addWorkspaceComment(submissionId, { content });
      onCommentsChange((current) => current.map((comment) => (
        comment.id === tempId ? saved : comment
      )));
      onSuppressEcho?.(["comments"]);
      setDraft("");
    } catch (submitError) {
      onCommentsChange((current) => current.filter((comment) => comment.id !== tempId));
      const message = submitError.message || "Unable to submit the comment.";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
      onLocalMutation?.end("comments");
    }
  }

  async function saveEditedComment(comment) {
    const content = editingDraft.trim();
    if (!content || pendingCommentIds.has(comment.id)) return;
    const previous = comments.find((entry) => entry.id === comment.id);
    onCommentsChange((current) => current.map((entry) => (
      entry.id === comment.id ? { ...entry, content } : entry
    )));
    onSuppressEcho?.(["comments"]);
    onLocalMutation?.begin("comments");
    markCommentPending(comment.id, true);
    setError("");
    try {
      const saved = await updateWorkspaceComment(comment.id, {
        content,
        action: comment.action,
        is_closing: comment.isClosing,
      });
      onCommentsChange((current) => current.map((entry) => (
        entry.id === comment.id ? saved : entry
      )));
      onSuppressEcho?.(["comments"]);
      setEditingCommentId("");
      setEditingDraft("");
    } catch (saveError) {
      if (previous) {
        onCommentsChange((current) => current.map((entry) => (
          entry.id === comment.id ? previous : entry
        )));
      }
      const message = saveError.message || "Unable to update the comment.";
      setError(message);
      toast.error(message);
    } finally {
      markCommentPending(comment.id, false);
      onLocalMutation?.end("comments");
    }
  }

  async function removeComment(comment) {
    if (pendingCommentIds.has(comment.id)) return;
    const previous = comments.find((entry) => entry.id === comment.id);
    onCommentsChange((current) => current.filter((entry) => entry.id !== comment.id));
    onSuppressEcho?.(["comments"]);
    onLocalMutation?.begin("comments");
    markCommentPending(comment.id, true);
    setError("");
    try {
      await deleteWorkspaceComment(comment.id);
      onSuppressEcho?.(["comments"]);
    } catch (deleteError) {
      if (previous) {
        onCommentsChange((current) => [previous, ...current]);
      }
      const message = deleteError.message || "Unable to delete the comment.";
      setError(message);
      toast.error(message);
    } finally {
      markCommentPending(comment.id, false);
      onLocalMutation?.end("comments");
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
        {visibleComments.length ? visibleComments.map((comment) => {
          const isCommentPending = pendingCommentIds.has(comment.id);
          return (
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
                    disabled={isCommentPending}
                  />
                  <div>
                    <button
                      type="button"
                      disabled={!editingDraft.trim() || isCommentPending}
                      onClick={() => void saveEditedComment(comment)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={isCommentPending}
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
                    disabled={isCommentPending}
                    onClick={() => {
                      setEditingCommentId(comment.id);
                      setEditingDraft(comment.content);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isCommentPending}
                    onClick={() => void removeComment(comment)}
                  >
                    {isCommentPending ? "Deleting…" : "Delete"}
                  </button>
                </div>
              ) : null}
            </article>
          );
        }) : <p className="workspace-review-empty">No commissioner comments yet.</p>}
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
  onArchiveRequestChange,
  onRefreshArchiveRequest,
  onSuppressEcho,
  onLocalMutation,
}) {
  const [message, setMessage] = useState("");
  const [assignees, setAssignees] = useState(() =>
    review.archiveRequest?.assignees?.length
      ? review.archiveRequest.assignees
      : reviewerEmails,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedStatus, setSubmittedStatus] = useState(null);
  const [pendingAssigneeEmails, setPendingAssigneeEmails] = useState(() => new Set());
  const [error, setError] = useState("");
  const assigneesRef = useRef(assignees);
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

  assigneesRef.current = assignees;

  useEffect(() => {
    if (onLocalMutation?.isActive?.("archiveRequest")) return;
    if (pendingAssigneeEmails.size > 0) return;
    if (request?.assignees) setAssignees(request.assignees);
  }, [request?.assignees, request?.version, onLocalMutation, pendingAssigneeEmails.size]);

  async function toggleAssignee(email, checked) {
    if (!request?.id || pendingAssigneeEmails.has(email)) return;
    const previousAssignees = assigneesRef.current;
    const nextAssignees = checked
      ? [...new Set([...assigneesRef.current, email])]
      : assigneesRef.current.filter((entry) => entry !== email);

    onSuppressEcho?.(["archiveRequest"]);
    onLocalMutation?.begin("archiveRequest");
    setAssignees(nextAssignees);
    setPendingAssigneeEmails((current) => new Set(current).add(email));
    setError("");

    try {
      const updated = await updateWorkspaceArchiveAssigneesById(
        request.id,
        nextAssignees,
        { expectedVersion: request.version },
      );
      onArchiveRequestChange?.(updated);
      onSuppressEcho?.(["archiveRequest"]);
    } catch (assigneeError) {
      setAssignees(previousAssignees);
      if (assigneeError.code === "STALE_RESOURCE_VERSION") {
        await onRefreshArchiveRequest?.();
      }
      setError(assigneeError.message);
      toast.error(assigneeError.message || "Unable to update assignees.");
    } finally {
      setPendingAssigneeEmails((current) => {
        const next = new Set(current);
        next.delete(email);
        return next;
      });
      onLocalMutation?.end("archiveRequest");
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
          {reviewerEmails.map((email) => {
            const isAssigneePending = pendingAssigneeEmails.has(email);
            return (
              <label key={email}>
                <input
                  type="checkbox"
                  checked={assignees.includes(email)}
                  disabled={isAssigneePending}
                  aria-busy={isAssigneePending}
                  onChange={(event) => void toggleAssignee(email, event.target.checked)}
                />
                {email}
              </label>
            );
          })}
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
      <div className="workspace-decision-actions workflow-action-stack">
        {displayedStatus === WORKSPACE_STATUS.PENDING ? <>
          <button type="button" className="is-accept" disabled={isSubmitting} onClick={() => runAction("accept")}><Check />Accept</button>
          <button type="button" className="is-reject" disabled={isSubmitting} onClick={() => runAction("reject")}><X />Reject</button>
        </> : null}
        {displayedStatus === WORKSPACE_STATUS.ACCEPTED ? <>
          <button type="button" className="is-reject" disabled={isSubmitting} onClick={() => runAction("reject-again")}><X />Reject again</button>
          <button type="button" className="is-archive" disabled={isSubmitting} onClick={() => runAction("archive-request")}>
            <ArchiveRestore />Make an Archive Request
          </button>
        </> : null}
        {displayedStatus === WORKSPACE_STATUS.REJECTED ? (
          <button type="button" className="is-accept" disabled={isSubmitting} onClick={() => runAction("accept-again")}><Check />Accept again</button>
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
      {displayedStatus === WORKSPACE_STATUS.ARCHIVE_REQUEST && isRequester && request ? (
        <p className="workspace-decision-note">
          Every selected assignee must accept before merge is enabled.
        </p>
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
  const echoSuppressorRef = useRef(createEchoSuppressor({ ttlMs: 5000 }));
  const localMutationGuardRef = useRef(createLocalMutationGuard());
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
        const guard = localMutationGuardRef.current;
        const preserveLabels = guard.isAnyActive(["labels", "labelCatalog"]) && isCurrentSubmission;
        const preserveArchiveRequest = guard.isActive("archiveRequest") && isCurrentSubmission;
        const preserveComments = guard.isActive("comments") && isCurrentSubmission;
        return {
          submissionId: submission.id,
          comments: preserveComments
            ? current.comments
            : targetedRefreshSequence.current.comments === commentsSequence
              ? nextReview.comments ?? []
              : (isCurrentSubmission ? current.comments : []),
          labels: preserveLabels
            ? current.labels
            : targetedRefreshSequence.current.labels === labelsSequence
              ? nextReview.labels ?? []
              : (isCurrentSubmission ? current.labels : []),
          labelCatalog: preserveLabels
            ? current.labelCatalog
            : targetedRefreshSequence.current.labelCatalog === labelCatalogSequence
              ? nextReview.labelCatalog ?? []
              : (isCurrentSubmission ? current.labelCatalog : []),
          archiveRequest: preserveArchiveRequest
            ? current.archiveRequest
            : targetedRefreshSequence.current.archiveRequest === archiveRequestSequence
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
    if (localMutationGuardRef.current.isActive("comments")) return;
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
    if (localMutationGuardRef.current.isAnyActive(["labels", "labelCatalog"])) return;
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
    if (localMutationGuardRef.current.isAnyActive(["labels", "labelCatalog"])) return;
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
    if (localMutationGuardRef.current.isActive("archiveRequest")) return;
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
    const activeHints = echoSuppressorRef.current.filter(hints ?? []);
    if (!activeHints.length) return;
    const targets = getWorkspaceReviewInvalidationTargets(activeHints, submission.id);
    await Promise.all([
      ...(targets.includes("archiveRequest") ? [refreshArchiveRequest()] : []),
      ...(targets.includes("comments") ? [refreshComments()] : []),
      ...(targets.includes("labelCatalog") ? [refreshCustomLabels()] : []),
      ...(targets.includes("labels") ? [refreshLabels()] : []),
      ...(targets.includes("status") ? [refreshStatus()] : []),
    ]);
  }

  function markEchoSuppressed(targets) {
    const keys = (Array.isArray(targets) ? targets : [targets])
      .map((target) => workspaceReviewHint(submission.id, target))
      .filter(Boolean);
    echoSuppressorRef.current.mark(keys);
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

  function updateComments(updater) {
    setReview((current) => {
      if (String(current.submissionId) !== String(submission.id)) return current;
      const nextComments = typeof updater === "function" ? updater(current.comments) : updater;
      return { ...current, comments: nextComments };
    });
  }

  function updateArchiveRequest(archiveRequest) {
    setReview((current) => String(current.submissionId) === String(submission.id)
      ? { ...current, archiveRequest }
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
    <MapInfoPanelShell
      isOpen
      className="workspace-review-panel"
      ariaLabel="Submission workspace review"
    >
      <div className="map-info-panel__content workspace-review-panel__content">
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
            onSuppressEcho={markEchoSuppressed}
            onLocalMutation={localMutationGuardRef.current}
            unavailableMessage={activeReview.collaborationWarning}
          />
          <CommentThread
            submissionId={submission.id}
            comments={activeReview.comments}
            reviewerEmail={reviewerEmail}
            onCommentsChange={updateComments}
            onSuppressEcho={markEchoSuppressed}
            onLocalMutation={localMutationGuardRef.current}
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
            onArchiveRequestChange={updateArchiveRequest}
            onRefreshArchiveRequest={refreshArchiveRequest}
            onSuppressEcho={markEchoSuppressed}
            onLocalMutation={localMutationGuardRef.current}
          />
        </div>
      </div>
    </MapInfoPanelShell>
  );
}

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { archiveSubmissionIcon } from "@/lib/archiveTree.js";

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function ConfirmationModal({ mode, version, onCancel, onConfirm }) {
  const [confirmation, setConfirmation] = useState("");
  const [seconds, setSeconds] = useState(mode === "revert" ? 5 : 0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode !== "revert" || seconds <= 0) return undefined;
    const timer = window.setTimeout(() => setSeconds((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [mode, seconds]);

  const isDelete = mode === "delete";
  const canConfirm = !isSubmitting && (isDelete ? confirmation === "I confirm" : seconds === 0);

  async function confirm() {
    if (!canConfirm) return;
    setIsSubmitting(true);
    setError("");
    try {
      await onConfirm();
    } catch (actionError) {
      setError(actionError.message || "The Supabase update failed.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="archive-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className={`archive-modal archive-modal--${mode}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="archive-modal__icon">
          {isDelete ? <AlertTriangle aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
        </span>
        <h2 id="archive-modal-title">{isDelete ? "Delete this branch forever?" : `Revert to ${version?.label}?`}</h2>
        <p>
          {isDelete
            ? "All versions of DA changes stored in this branch will be cleared."
            : "This historical version will become the branch's Latest Version in this local milestone."}
        </p>
        {isDelete ? (
          <label>
            Type <strong>I confirm</strong> to continue
            <input
              autoFocus
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="I confirm"
            />
          </label>
        ) : (
          <p className="archive-modal__countdown" aria-live="polite">
            {seconds > 0 ? `Confirmation unlocks in ${seconds} second${seconds === 1 ? "" : "s"}.` : "Revert is ready."}
          </p>
        )}
        {error ? <p className="archive-modal__error" role="alert">{error}</p> : null}
        <div className="archive-modal__actions">
          <button type="button" className="is-secondary" disabled={isSubmitting} onClick={onCancel}>Cancel</button>
          <button type="button" className={isDelete ? "is-delete" : "is-revert"} disabled={!canConfirm} onClick={confirm}>
            {isDelete ? <Trash2 aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
            {isSubmitting ? "Saving..." : isDelete ? "Delete Forever" : "Confirm Revert"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ArchivedTreePanel({ selection, onClose, onDeleteBranch, onRevertVersion, onViewDifference }) {
  const [modal, setModal] = useState(null);

  useEffect(() => setModal(null), [selection?.branch?.key]);

  if (!selection) {
    return (
      <aside className="archive-node-panel archive-node-panel--empty">
        <CheckCircle2 aria-hidden="true" />
        <h2>Select an archived branch</h2>
        <p>Choose a DA branch or version in the canvas to inspect its immutable snapshot.</p>
      </aside>
    );
  }

  const { category, branch, version } = selection;
  const SubmissionIcon = archiveSubmissionIcon(version.submission?.type);
  const isLatest = version.id === branch.latestVersion?.id;

  return (
    <aside className="archive-node-panel">
      <header className="archive-node-panel__heading">
        <strong>Selected Node</strong>
        <button type="button" aria-label="Close selected node" onClick={onClose}><X aria-hidden="true" /></button>
      </header>

      <div className="archive-node-panel__identity">
        <span><SubmissionIcon aria-hidden="true" /></span>
        <div>
          <div><h2>{branch.label}</h2>{isLatest ? <em>Latest</em> : null}</div>
          <p>{category.title}</p>
        </div>
      </div>

      <dl className="archive-node-panel__metadata">
        <dt>Community Name</dt><dd>{branch.communityName}</dd>
        <dt>DA ID</dt><dd><code>{branch.dguids.join(" / ") || "Unknown"}</code></dd>
        <dt>Current Version</dt><dd className="is-version">{version.label}{isLatest ? " (Latest)" : ""}</dd>
        <dt>Last Updated</dt><dd>{formatDate(version.mergedAt)}</dd>
        <dt>Updated By</dt><dd>{version.mergedBy}</dd>
      </dl>

      <button type="button" className="archive-delete-button" onClick={() => setModal({ mode: "delete" })}>
        <AlertTriangle aria-hidden="true" /> Delete Forever
      </button>

      <section className="archive-version-history">
        <h3>Version History</h3>
        <div className="archive-version-history__timeline">
          {[...branch.versions].reverse().map((entry) => {
            const entryIsLatest = entry.id === branch.latestVersion?.id;
            return (
              <article className={entry.id === version.id ? "is-selected" : ""} key={entry.id}>
                <span className={entryIsLatest ? "is-latest" : ""} />
                <div className="archive-version-history__summary">
                  <div><strong>{entry.label}</strong>{entryIsLatest ? <em>Latest</em> : null}<time>{formatDate(entry.mergedAt)}</time></div>
                  <small>Updated by {entry.mergedBy}</small>
                </div>
                <div className="archive-version-history__actions">
                  <button type="button" onClick={() => onViewDifference(category, branch, entry)}>
                    <ArrowLeftRight aria-hidden="true" /> View Difference
                  </button>
                  <button type="button" disabled={entryIsLatest} onClick={() => setModal({ mode: "revert", version: entry })}>
                    <RotateCcw aria-hidden="true" /> Revert
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {!isLatest ? (
        <button type="button" className="archive-panel-revert" onClick={() => setModal({ mode: "revert", version })}>
          <RotateCcw aria-hidden="true" /> Revert to {version.label}
        </button>
      ) : null}

      {modal ? (
        <ConfirmationModal
          key={`${modal.mode}:${modal.version?.id ?? branch.key}`}
          mode={modal.mode}
          version={modal.version}
          onCancel={() => setModal(null)}
          onConfirm={async () => {
            if (modal.mode === "delete") await onDeleteBranch(branch);
            else await onRevertVersion(branch, modal.version);
            setModal(null);
          }}
        />
      ) : null}
    </aside>
  );
}

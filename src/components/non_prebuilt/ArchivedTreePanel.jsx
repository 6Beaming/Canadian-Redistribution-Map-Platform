import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  MapPinned,
  Trash2,
  X,
} from "lucide-react";
import { archiveSubmissionIcon } from "@/lib/archiveTree.js";

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function ConfirmationModal({ onCancel, onConfirm }) {
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const canConfirm = !isSubmitting && confirmation === "I confirm";

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
        className="archive-modal archive-modal--delete"
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="archive-modal__icon">
          <AlertTriangle aria-hidden="true" />
        </span>
        <h2 id="archive-modal-title">Delete this branch forever?</h2>
        <p>All archive-only versions in this branch will be cleared. Its source submissions will return to Pending and retain their original submission geometry operations.</p>
        <label>
          <span style={{ textAlign: "center", display: "block" }}>Type <strong>'I confirm'</strong> to continue</span>
          <input
            autoFocus
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="I confirm"
          />
        </label>
        {error ? <p className="archive-modal__error" role="alert">{error}</p> : null}
        <div className="archive-modal__actions">
          <button type="button" className="is-secondary" disabled={isSubmitting} onClick={onCancel}>Cancel</button>
          <button type="button" className="is-delete" disabled={!canConfirm} onClick={confirm}>
            <Trash2 aria-hidden="true" />
            {isSubmitting ? "Saving..." : "Delete Forever"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ArchivedTreePanel({ selection, onClose, onDeleteBranch, onOpenMap, onViewDifference }) {
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

      <button type="button" className="archive-delete-button" onClick={() => setModal(true)}>
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
                  {entryIsLatest ? (
                    <button type="button" onClick={() => onOpenMap(category, branch, entry)}>
                      <MapPinned aria-hidden="true" /> Open the map view
                    </button>
                  ) : (
                    <button type="button" onClick={() => onViewDifference(category, branch, entry)}>
                      <ArrowLeftRight aria-hidden="true" /> View difference and revert
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {modal ? (
        <ConfirmationModal
          key={branch.key}
          onCancel={() => setModal(null)}
          onConfirm={async () => {
            await onDeleteBranch(branch);
            setModal(null);
          }}
        />
      ) : null}
    </aside>
  );
}

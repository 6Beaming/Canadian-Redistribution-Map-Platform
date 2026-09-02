import { archiveSubmissionIcon, normalizeArchiveType } from "@/lib/archiveTree.js";

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function formatSigned(value, fractionDigits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Unavailable";
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(fractionDigits)}`;
}

function impactFrom(entry, submission) {
  return submission?.geometry?.impacts
    ?? entry?.validationReport?.impact_summary
    ?? entry?.validationReport?.legacyValidationReport?.impact_summary
    ?? entry?.record?.validationReport?.impact_summary
    ?? entry?.record?.validationReport?.legacyValidationReport?.impact_summary
    ?? submission?.impactSummary
    ?? submission?.impact_summary
    ?? null;
}

function CounterProposalImpact({ impact }) {
  const rows = Object.entries(impact?.byDguid ?? {});
  if (!rows.length) {
    return <p className="archive-submission-card__empty">Population and area impact is unavailable for this archived version.</p>;
  }

  return (
    <div className="archive-submission-card__impact" role="table" aria-label="Population and area impact">
      <div role="row" className="archive-submission-card__impact-head">
        <strong>DA</strong><strong>Population Δ</strong><strong>Area (km²)</strong>
      </div>
      {rows.map(([dguid, values]) => (
        <div role="row" key={dguid}>
          <code>{dguid}</code>
          <span>{formatSigned(values?.populationDelta)}</span>
          <span>
            {Number.isFinite(Number(values?.originalArea)) && Number.isFinite(Number(values?.currentArea))
              ? `${(Number(values.originalArea) / 1_000_000).toFixed(2)} → ${(Number(values.currentArea) / 1_000_000).toFixed(2)}`
              : "Unavailable"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ArchivedSubmissionCard({
  entry,
  submission: suppliedSubmission = null,
  categoryLabel = null,
  versionLabel = null,
  isActive = false,
}) {
  const submission = suppliedSubmission ?? entry?.submission ?? {};
  const type = normalizeArchiveType(submission.type ?? entry?.submissionType);
  const SubmissionIcon = archiveSubmissionIcon(type);
  const authorEmail = submission.authorEmail
    ?? submission.profile?.email
    ?? entry?.authorEmail
    ?? "Unknown submitter";
  const title = String(submission.title ?? "").trim() || "Untitled submission";
  const content = String(submission.comment ?? "").trim()
    || String(entry?.closingComment?.content ?? "").trim()
    || "No submission content.";
  const impact = type === "counter-proposal" ? impactFrom(entry, submission) : null;

  return (
    <article className={`archive-submission-card${isActive ? " is-active" : ""}`}>
      <header className="archive-submission-card__header">
        <span className="archive-submission-card__icon"><SubmissionIcon aria-hidden="true" /></span>
        <div>
          <span className="archive-submission-card__category">{categoryLabel ?? type}</span>
          <h3>{title}</h3>
        </div>
        {entry?.isLatest ? <em>Latest</em> : null}
      </header>

      <p className="archive-submission-card__content">{content}</p>

      <dl className="archive-submission-card__metadata">
        <dt>Submitted by</dt><dd>{authorEmail}</dd>
        <dt>Version</dt><dd>{versionLabel ?? `v${entry?.versionNumber ?? 1}`}</dd>
        <dt>Submitted</dt><dd>{formatDate(submission.created_at)}</dd>
        <dt>Merged</dt><dd>{formatDate(entry?.mergedAt)}</dd>
        <dt>Merged by</dt><dd>{entry?.mergedBy ?? "Unknown commissioner"}</dd>
      </dl>

      {entry?.closingComment?.content ? (
        <div className="archive-submission-card__closing">
          <strong>Closing note</strong>
          <p>{entry.closingComment.content}</p>
        </div>
      ) : null}

      {type === "counter-proposal" ? <CounterProposalImpact impact={impact} /> : null}
    </article>
  );
}

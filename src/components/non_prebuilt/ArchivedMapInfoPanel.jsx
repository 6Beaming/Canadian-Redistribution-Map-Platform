import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Flag,
  GitCompareArrows,
  MessageSquareText,
} from "lucide-react";
import { MapInfoPanelShell } from "@/components/non_prebuilt/MapInfoPanelShell.jsx";
import { getDaPanelTitle, getDaPopulationDisplay } from "@/lib/map/profileUtils.js";
import { MISSING_DA_POPULATION, MVP_FED_NUM } from "@/lib/map/constants.js";
import { getArchivedMapProjections } from "@/services/workspaceApi.js";

export const ARCHIVED_MAP_PANEL_VIEWS = [
  { id: "all", label: "All Archived Submissions" },
  { id: "comments", label: "Comments" },
  { id: "objections", label: "Boundary Objections" },
  { id: "counter-proposals", label: "Counter-Proposals" },
];

const PANEL_VIEW_ICONS = {
  all: BarChart3,
  comments: MessageSquareText,
  objections: Flag,
  "counter-proposals": GitCompareArrows,
};

function formatPopulation(value) {
  if (value === MISSING_DA_POPULATION) return MISSING_DA_POPULATION;
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return MISSING_DA_POPULATION;
  }
  return Number(value).toLocaleString();
}

function ArchivedModeSelector({ activeView, onViewChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const activeOption = ARCHIVED_MAP_PANEL_VIEWS.find((view) => view.id === activeView)
    ?? ARCHIVED_MAP_PANEL_VIEWS[0];
  const ActiveIcon = PANEL_VIEW_ICONS[activeOption.id];

  return (
    <div className={`map-info-panel__mode-selector${isOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className="map-info-panel__mode-trigger panel-select__trigger"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <ActiveIcon aria-hidden="true" className="map-info-panel__mode-icon" />
        <span>{activeOption.label}</span>
      </button>
      {isOpen ? (
        <div className="map-info-panel__mode-menu" role="menu">
          {ARCHIVED_MAP_PANEL_VIEWS.map((view) => {
            const Icon = PANEL_VIEW_ICONS[view.id];
            return (
              <button
                key={view.id}
                type="button"
                role="menuitem"
                className="map-info-panel__mode-option"
                onClick={() => {
                  onViewChange(view.id);
                  setIsOpen(false);
                }}
              >
                <Icon aria-hidden="true" className="map-info-panel__mode-icon" />
                <span>{view.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function TimelineCard({ title, meta, body }) {
  return (
    <article className="map-info-panel__collection-card">
      <header>
        <strong>{title}</strong>
        {meta ? <small>{meta}</small> : null}
      </header>
      {body ? <p>{body}</p> : null}
    </article>
  );
}

function ProjectionBody({ panelView, projections }) {
  if (!projections) {
    return <p className="map-info-panel__empty">Loading archived submissions...</p>;
  }

  const comments = panelView === "all" || panelView === "comments" ? projections.comments : [];
  const objections = panelView === "all" || panelView === "objections" ? projections.objections : [];
  const counterProposals = panelView === "all" || panelView === "counter-proposals"
    ? projections.counterProposals
    : [];

  if (!comments.length && !objections.length && !counterProposals.length) {
    return <p className="map-info-panel__empty">No archived submissions found for this area.</p>;
  }

  return (
    <div className="map-info-panel__collection-stack">
      {comments.length ? (
        <section>
          <h3 className="map-info-panel__section-title">Comments</h3>
          {comments.map((entry) => (
            <TimelineCard
              key={entry.versionId ?? `${entry.branchKey}:${entry.versionNumber}`}
              title={entry.submission?.title || "Archived comment"}
              meta={`${entry.mergedBy} · v${entry.versionNumber}`}
              body={entry.submission?.comment || entry.closingComment?.content || "No comment text."}
            />
          ))}
        </section>
      ) : null}

      {objections.map((group) => (
        <section key={group.neighborKey}>
          <h3 className="map-info-panel__section-title">
            Objections · <code>{group.secondaryDguid}</code>
          </h3>
          {group.versions.map((entry) => (
            <TimelineCard
              key={entry.versionId ?? `${entry.branchKey}:${entry.versionNumber}`}
              title={entry.submission?.title || "Archived objection"}
              meta={`${entry.mergedBy} · v${entry.versionNumber}`}
              body={entry.submission?.comment || entry.closingComment?.content || "No objection text."}
            />
          ))}
        </section>
      ))}

      {counterProposals.map((group) => (
        <section key={group.neighborKey}>
          <h3 className="map-info-panel__section-title">
            Counter-Proposals · <code>{group.secondaryDguid}</code>
          </h3>
          {group.versions.map((entry) => (
            <TimelineCard
              key={entry.versionId ?? `${entry.branchKey}:${entry.versionNumber}`}
              title={entry.submission?.title || "Archived counter-proposal"}
              meta={`${entry.mergedBy} · v${entry.versionNumber}${entry.isLatest ? " · Latest" : ""}`}
              body={entry.submission?.comment || entry.closingComment?.content || "No counter-proposal text."}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

export function ArchivedMapInfoPanel({
  selection,
  profilesByDguid,
  panelView,
  onPanelViewChange,
}) {
  const [projections, setProjections] = useState(null);
  const [loadError, setLoadError] = useState("");
  const hasSelection = Boolean(selection?.type === "da" && selection?.dguid);
  const profile = profilesByDguid.get(selection?.dguid);
  const panelTitle = getDaPanelTitle(profile);
  const population = getDaPopulationDisplay(profile);

  useEffect(() => {
    if (!hasSelection) {
      setProjections(null);
      setLoadError("");
      return undefined;
    }

    const controller = new AbortController();
    setProjections(null);
    setLoadError("");
    getArchivedMapProjections(selection.dguid, { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setProjections(payload);
      })
      .catch((error) => {
        if (error?.name !== "AbortError" && !controller.signal.aborted) {
          setLoadError(error.message || "Unable to load archived map projections.");
        }
      });

    return () => controller.abort();
  }, [hasSelection, selection?.dguid]);

  const subtitle = useMemo(() => {
    if (!hasSelection) return "Select a dissemination area to review archived submissions.";
    return "Archived map geometry stays fixed while this panel filters archived content.";
  }, [hasSelection]);

  return (
    <MapInfoPanelShell isOpen={hasSelection} ariaLabel="Archived map details">
      <ArchivedModeSelector activeView={panelView} onViewChange={onPanelViewChange} />
      <div className="map-info-panel__content">
        {!hasSelection ? (
          <div className="map-info-panel__body">
            <p className="map-info-panel__empty">{subtitle}</p>
          </div>
        ) : (
          <>
            <header className="map-info-panel__header">
              <h2 className="map-info-panel__title map-info-panel__title--centered">{panelTitle.text}</h2>
            </header>
            <div className="map-info-panel__body map-info-panel__body--stacked">
              <dl className="map-info-panel__details">
                <dt>DGUID</dt><dd><code>{selection.dguid ?? "—"}</code></dd>
                <dt>Population (2021)</dt><dd>{formatPopulation(population)}</dd>
                <dt>FED</dt><dd><code>{profile?.fed_num ?? MVP_FED_NUM}</code></dd>
              </dl>
              {loadError ? <p className="map-info-panel__empty" role="alert">{loadError}</p> : null}
              <ProjectionBody panelView={panelView} projections={projections} />
            </div>
          </>
        )}
      </div>
    </MapInfoPanelShell>
  );
}

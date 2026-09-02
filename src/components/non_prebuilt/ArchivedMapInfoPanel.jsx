import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  Flag,
  GitCompareArrows,
  MessageSquareText,
} from "lucide-react";
import { ArchivedSubmissionCard } from "@/components/non_prebuilt/ArchivedSubmissionCard.jsx";
import { MapInfoPanelShell } from "@/components/non_prebuilt/MapInfoPanelShell.jsx";
import { getDaPanelTitle, getDaPopulationDisplay } from "@/lib/map/profileUtils.js";
import { MISSING_DA_POPULATION, MVP_FED_NUM } from "@/lib/map/constants.js";
import { getArchivedMapProjections } from "@/services/workspaceApi.js";
import "@/styles/archive-tree.css";

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
  const selectorRef = useRef(null);
  const activeOption = ARCHIVED_MAP_PANEL_VIEWS.find((view) => view.id === activeView)
    ?? ARCHIVED_MAP_PANEL_VIEWS[0];
  const ActiveIcon = PANEL_VIEW_ICONS[activeOption.id];

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeWhenOutside = (event) => {
      if (!selectorRef.current?.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("pointerdown", closeWhenOutside, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeWhenOutside, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className={`map-info-panel__mode-selector archive-map-mode-selector${isOpen ? " is-open" : ""}`}>
      <div ref={selectorRef} className="map-info-panel__mode-control panel-select relative">
      <button
        type="button"
        className="map-info-panel__mode-trigger panel-select__trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <ActiveIcon aria-hidden="true" className="map-info-panel__mode-icon" />
        <span>{activeOption.label}</span>
        <ChevronDown
          className={`map-info-panel__mode-chevron${isOpen ? " map-info-panel__mode-chevron--open" : ""}`}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div
          className="map-info-panel__mode-menu panel-select__menu absolute left-0 top-full z-20 w-full"
          role="menu"
          aria-label="Choose archived submission category"
        >
          {ARCHIVED_MAP_PANEL_VIEWS.filter((view) => view.id !== activeOption.id).map((view) => {
            const Icon = PANEL_VIEW_ICONS[view.id];
            return (
              <button
                key={view.id}
                type="button"
                role="menuitem"
                className="map-info-panel__mode-option panel-select__option"
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
    </div>
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
    <div className="map-info-panel__collection-stack archive-projection-groups">
      {comments.length ? (
        <section>
          <h3 className="map-info-panel__section-title">Comments</h3>
          <div className="archive-projection-group__cards">
            {comments.map((entry) => (
              <ArchivedSubmissionCard
                key={entry.versionId ?? `${entry.branchKey}:${entry.versionNumber}`}
                entry={entry}
                categoryLabel="Comment"
              />
            ))}
          </div>
        </section>
      ) : null}

      {objections.map((group) => (
        <section key={group.neighborKey}>
          <h3 className="map-info-panel__section-title">
            Boundary Objections · <code>{group.secondaryDguid}</code>
          </h3>
          <div className="archive-projection-group__cards">
            {group.versions.map((entry) => (
              <ArchivedSubmissionCard
                key={entry.versionId ?? `${entry.branchKey}:${entry.versionNumber}`}
                entry={entry}
                categoryLabel="Boundary Objection"
              />
            ))}
          </div>
        </section>
      ))}

      {counterProposals.map((group) => (
        <section key={group.neighborKey}>
          <h3 className="map-info-panel__section-title">
            Counter-Proposals · <code>{group.secondaryDguid}</code>
          </h3>
          <div className="archive-projection-group__cards">
            {group.versions.map((entry) => (
              <ArchivedSubmissionCard
                key={entry.versionId ?? `${entry.branchKey}:${entry.versionNumber}`}
                entry={entry}
                categoryLabel="Counter-Proposal"
              />
            ))}
          </div>
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
    <MapInfoPanelShell isOpen ariaLabel="Archived map details">
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

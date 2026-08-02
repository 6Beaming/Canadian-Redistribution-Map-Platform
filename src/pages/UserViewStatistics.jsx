import {
  getDaPanelTitle,
  getDaPopulationDisplay
} from "@/lib/map/profileUtils.js";
import {
  formatDemographicValue,
  getDemographicStatusLabel,
} from "@/lib/demographics/demographicsPresentation.js";
import { MISSING_DA_POPULATION, MVP_FED_NUM } from "@/lib/map/constants.js";
import {
  getRolloutAccentColor,
  getRolloutArea,
  getRolloutCategory
} from "@/lib/map/rolloutPlan.js";
import { clearDaStatisticsCache, getDaStatistics } from "@/services/demographicsApi.js";
import { useEffect, useRef, useState } from "react";

const UNORGANIZED_FOOTNOTE =
  "This dissemination area lies in a census subdivision classified as Unorganized, areas outside incorporated municipalities in Yukon (Statistics Canada geography).";

function formatPopulation(value) {
  if (value === MISSING_DA_POPULATION) return MISSING_DA_POPULATION;
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return MISSING_DA_POPULATION;
  }
  return Number(value).toLocaleString();
}

function SourceLink({ source }) {
  if (!source) return null;

  if (typeof source === "string") {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      return (
        <a href={source} target="_blank" rel="noopener noreferrer">
          {source}
        </a>
      );
    }
    return <code>{source}</code>;
  }

  const label = source.label || source.url || "Source";
  const url = source.url;
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }
  return <span>{label}</span>;
}

function DemographicItem({ item }) {
  const formatted = formatDemographicValue(item);
  return (
    <div className="map-info-panel__statistics-item">
      <dt>{item.label}</dt>
      <dd>
        {formatted ?? <span className="map-info-panel__statistics-state">{getDemographicStatusLabel(item.status)}</span>}
      </dd>
      {item.note ? <p className="map-info-panel__statistics-note">{item.note}</p> : null}
    </div>
  );
}

function DemographicGroups({ statistics }) {
  if (!statistics) return null;
  return (
    <>
      {statistics.quality?.warning ? (
        <p className="map-info-panel__statistics-warning" role="status">
          {statistics.quality.warning}
        </p>
      ) : null}
      {statistics.availability === "unavailable" ? (
        <p className="map-info-panel__statistics-state">
          Statistics Canada has no publishable Census Profile values for this DA.
        </p>
      ) : null}
      <div className="map-info-panel__statistics-groups">
        {statistics.groups.map((group) => (
          <section key={group.id} className="map-info-panel__statistics-group" aria-labelledby={`statistics-${group.id}`}>
            <h3 id={`statistics-${group.id}`}>{group.label}</h3>
            <dl className="map-info-panel__statistics-grid">
              {group.items.map((item) => <DemographicItem key={item.id} item={item} />)}
            </dl>
          </section>
        ))}
      </div>
      <footer className="map-info-panel__statistics-source">
        <a href={statistics.dataset.sourceUrl} target="_blank" rel="noopener noreferrer">
          Statistics Canada · 2021 Census
        </a>
        <span>DF_DA {statistics.dataset.version} · released {statistics.dataset.releaseDate || "2022"}</span>
      </footer>
    </>
  );
}

function DaStatistics({ dguid, profile, statisticsState, onRetry }) {
  const population = getDaPopulationDisplay(profile);
  const panelTitle = getDaPanelTitle(profile);
  const fedNum = String(profile?.fed_num || MVP_FED_NUM);
  const showPending =
    !profile || profile.status !== "ok" || population === MISSING_DA_POPULATION;

  return (
    <>
      <header className="map-info-panel__header">
        <h2 className="map-info-panel__title map-info-panel__title--centered">
          {panelTitle.text}
          {panelTitle.unorganized ? (
            <sup className="map-info-panel__title-mark" aria-hidden="true">
              *
            </sup>
          ) : null}
        </h2>
      </header>

      <div className="map-info-panel__body">
        <dl className="map-info-panel__details">
          <dt>DGUID</dt>
          <dd>
            <code>{dguid ?? "N/A"}</code>
          </dd>

          {profile?.da_code != null ? (
            <>
              <dt>DA code</dt>
              <dd>
                <code>{profile.da_code}</code>
              </dd>
            </>
          ) : null}

          {profile?.community_display &&
          !panelTitle.unorganized &&
          profile.community_display !== panelTitle.text ? (
            <>
              <dt>Community (CSD)</dt>
              <dd>{profile.community_display}</dd>
            </>
          ) : null}

          <dt>Population (2021)</dt>
          <dd>{formatPopulation(population)}</dd>

          <dt>FED</dt>
          <dd>
            <code>{fedNum}</code>
          </dd>

          {profile?.source ? (
            <>
              <dt>Population source</dt>
              <dd>
                <SourceLink source={profile.source} />
              </dd>
            </>
          ) : null}

          {profile?.community_source ? (
            <>
              <dt>Community source</dt>
              <dd>
                <SourceLink source={profile.community_source} />
              </dd>
            </>
          ) : null}
        </dl>

        {showPending ? (
          <p className="map-info-panel__pending">
            Census name and population are collected externally. Run{" "}
            <code>scripts/reusable/collect_da_profiles.py</code> to refresh{" "}
            <code>src/data/map/indexes/da_profile_index.json</code>.
          </p>
        ) : null}

        {panelTitle.unorganized ? (
          <p className="map-info-panel__footnote">{UNORGANIZED_FOOTNOTE}</p>
        ) : null}

        {statisticsState.loading ? (
          <p className="map-info-panel__statistics-state" role="status">Loading statistics…</p>
        ) : null}
        {statisticsState.error ? (
          <div className="map-info-panel__statistics-state map-info-panel__statistics-state--error" role="alert">
            <p>{statisticsState.error}</p>
            <button type="button" onClick={onRetry}>Retry statistics</button>
          </div>
        ) : null}
        <DemographicGroups statistics={statisticsState.data} />
      </div>
    </>
  );
}

function FedStatistics({ fedNum, fedName }) {
  const num = String(fedNum ?? "N/A");
  const name = fedName || `FED ${num}`;
  const rolloutArea = getRolloutArea(num);
  const rolloutCategoryId = rolloutArea?.categoryId ?? null;
  const rolloutCategory = rolloutCategoryId ? getRolloutCategory(rolloutCategoryId) : null;
  const showRolloutCard = rolloutCategoryId === "enabled" || rolloutCategoryId === "data-blocked";

  return (
    <>
      <header className="map-info-panel__header">
        <h2 className="map-info-panel__title map-info-panel__title--centered">{name}</h2>
      </header>
      <div className="map-info-panel__body">
        <dl className="map-info-panel__details">
          <dt>FED</dt>
          <dd>
            <code>{num}</code>
          </dd>
        </dl>
        {showRolloutCard && rolloutCategory ? (
          <div
            className="map-info-panel__rollout-badge"
            style={{
              backgroundColor: getRolloutAccentColor(rolloutCategory.id),
              borderColor: rolloutCategory.color,
              color: rolloutCategory.id === "data-blocked" ? "#7a6331" : rolloutCategory.color
            }}
          >
            {rolloutCategory.description}
          </div>
        ) : (
          <p className="map-info-panel__coming-soon">Coming Soon!</p>
        )}
        <p className="map-info-panel__hint">
          {rolloutCategoryId === "enabled"
            ? "Zoom in and select a DA to inspect the local DA boundary and profile data."
            : "Local DA metadata is not ready for this FED yet."}
        </p>
      </div>
    </>
  );
}

export default function UserViewStatistics({ selection, profilesByDguid }) {
  const dguid = selection?.type === "da" ? String(selection.dguid ?? "") : "";
  const [retryVersion, setRetryVersion] = useState(0);
  const [statisticsState, setStatisticsState] = useState({ data: null, loading: false, error: "" });
  const requestSequence = useRef(0);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (!dguid) {
      setStatisticsState({ data: null, loading: false, error: "" });
      return undefined;
    }
    const controller = new AbortController();
    setStatisticsState((current) => ({ ...current, loading: true, error: "" }));
    getDaStatistics(dguid, { signal: controller.signal, force: retryVersion > 0 })
      .then((data) => {
        if (requestSequence.current === sequence) {
          setStatisticsState({ data, loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError" && requestSequence.current === sequence) {
          setStatisticsState((current) => ({ ...current, loading: false, error: error.message }));
        }
      });
    return () => controller.abort();
  }, [dguid, retryVersion]);

  const retry = () => {
    clearDaStatisticsCache(dguid);
    setRetryVersion((current) => current + 1);
  };

  if (!selection?.type) {
    return (
      <section className="map-info-panel__body min-w-0 text-left">
        <p className="map-info-panel__empty text-left">
          Click a dissemination area on the map to view details.
        </p>
      </section>
    );
  }

  if (selection.type === "da") {
    return (
      <DaStatistics
        dguid={selection.dguid}
        profile={profilesByDguid.get(selection.dguid)}
        statisticsState={statisticsState}
        onRetry={retry}
      />
    );
  }

  return (
    <FedStatistics fedNum={selection.fedNum} fedName={selection.fedName} />
  );
}

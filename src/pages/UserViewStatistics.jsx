import {
  getDaPanelTitle,
  getDaPopulationDisplay
} from "@/lib/map/profileUtils.js";
import { MISSING_DA_POPULATION, MVP_FED_NUM } from "@/lib/map/constants.js";

const UNORGANIZED_FOOTNOTE =
  "This dissemination area lies in a census subdivision classified as Unorganized—areas outside incorporated municipalities in Yukon (Statistics Canada geography).";

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

function DaStatistics({ dguid, profile }) {
  const population = getDaPopulationDisplay(profile);
  const panelTitle = getDaPanelTitle(profile);
  const showPending =
    !profile || profile.status !== "ok" || population === MISSING_DA_POPULATION;

  return (
    <>
      <header className="map-info-panel__header">
        <h2 className="map-info-panel__title">
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
            <code>{dguid ?? "—"}</code>
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
            <code>{MVP_FED_NUM}</code>
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
            <code>scripts/collect_yt_da_profiles.py</code> to refresh{" "}
            <code>src/data/map/yt_da_profiles.json</code>.
          </p>
        ) : null}

        <p className="map-info-panel__hint">
          Click another DA to inspect it. Only the selected DA is highlighted in
          yellow.
        </p>

        {panelTitle.unorganized ? (
          <p className="map-info-panel__footnote">{UNORGANIZED_FOOTNOTE}</p>
        ) : null}
      </div>
    </>
  );
}

function FedStatistics({ fedNum, fedName }) {
  const num = String(fedNum ?? "—");
  const name = fedName || `FED ${num}`;

  return (
    <>
      <header className="map-info-panel__header">
        <h2 className="map-info-panel__title">{name}</h2>
      </header>
      <div className="map-info-panel__body">
        <dl className="map-info-panel__details">
          <dt>FED</dt>
          <dd>
            <code>{num}</code>
          </dd>
        </dl>
        <p className="map-info-panel__coming-soon">Coming Soon!</p>
        <p className="map-info-panel__hint">
          This region is not part of the pilot demo yet. Yukon ({MVP_FED_NUM}) is
          available now.
        </p>
      </div>
    </>
  );
}

export default function UserViewStatistics({ selection, profilesByDguid }) {
  if (!selection?.type) {
    return (
      <>
        <header className="map-info-panel__header">
          <h2 className="map-info-panel__title">Region details</h2>
        </header>
        <div className="map-info-panel__body">
          <p className="map-info-panel__empty">
            Click a dissemination area or federal electoral district on the map to
            view details.
          </p>
        </div>
      </>
    );
  }

  if (selection.type === "da") {
    return (
      <DaStatistics
        dguid={selection.dguid}
        profile={profilesByDguid.get(selection.dguid)}
      />
    );
  }

  return (
    <FedStatistics fedNum={selection.fedNum} fedName={selection.fedName} />
  );
}

import { getDaPanelTitle } from "@/lib/map/profileUtils.js";

function formatAreaInSquareKilometres(value, showPositiveSign = false, fractionDigits = 2) {
  const areaInSquareKilometres = (Number(value) || 0) / 1_000_000;
  const roundingFactor = 10 ** fractionDigits;
  const roundedValue = Math.round(areaInSquareKilometres * roundingFactor) / roundingFactor;
  const formattedValue = Math.abs(roundedValue).toLocaleString("en-CA", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  if (roundedValue < 0) {
    return `-${formattedValue}`;
  }

  if (showPositiveSign && roundedValue > 0) {
    return `+${formattedValue}`;
  }

  return formattedValue;
}

function getAreaComparisonValues(impact) {
  const originalArea = Number(impact?.originalArea) || 0;
  const proposedArea = Number(impact?.currentArea) || 0;
  let fractionDigits = 2;

  while (
    originalArea !== proposedArea
    && fractionDigits < 6
    && formatAreaInSquareKilometres(originalArea, false, fractionDigits)
      === formatAreaInSquareKilometres(proposedArea, false, fractionDigits)
  ) {
    fractionDigits += 1;
  }

  return {
    original: formatAreaInSquareKilometres(originalArea, false, fractionDigits),
    proposed: formatAreaInSquareKilometres(proposedArea, false, fractionDigits),
    difference: formatAreaInSquareKilometres(impact?.areaDelta, true, fractionDigits),
  };
}

function formatPopulation(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-CA");
}

function formatSignedPopulation(value) {
  const numericValue = Math.round(Number(value) || 0);
  if (numericValue === 0) {
    return "0";
  }
  return `${numericValue > 0 ? "+" : "-"}${formatPopulation(Math.abs(numericValue))}`;
}

function getChangeClassName(value) {
  const numericValue = Number(value) || 0;
  if (numericValue < 0) return "submission-impact-summary__value--negative";
  if (numericValue > 0) return "submission-impact-summary__value--positive";
  return "";
}

function getDaLabel(profilesByDguid, dguid) {
  if (!dguid) {
    return { title: "Not selected", dguid: "—" };
  }
  const profile = profilesByDguid?.get?.(dguid) ?? null;
  return {
    title: getDaPanelTitle(profile).text,
    dguid,
  };
}

function ImpactCell({ value, change, areaTransition, originalValue, differenceValue }) {
  if (areaTransition) {
    return (
      <div className="submission-impact-summary__area-cell">
        <span className="submission-impact-summary__area-original">{originalValue}</span>
        <span className={`submission-impact-summary__area-proposed ${getChangeClassName(change)}`}>
          ↳ {value}
        </span>
        <span className={`submission-impact-summary__area-delta ${getChangeClassName(change)}`}>
          ({differenceValue})
        </span>
      </div>
    );
  }

  return (
    <span className={`submission-impact-summary__value ${getChangeClassName(change)}`}>
      {value}
    </span>
  );
}

export function CounterProposalImpactSummary({
  impact,
  primaryDguid,
  secondaryDguid,
  profilesByDguid = new Map(),
}) {
  if (!impact) {
    return <p className="submission-impact-summary__empty">Population and area impact is unavailable.</p>;
  }

  if (impact.availability === "unavailable") {
    return (
      <p className="submission-impact-summary__empty">
        Unavailable: {impact.reason || "impact data is incomplete."}
      </p>
    );
  }

  const first = getDaLabel(profilesByDguid, primaryDguid);
  const second = getDaLabel(profilesByDguid, secondaryDguid);
  const firstImpact = impact.byDguid?.[primaryDguid] ?? null;
  const secondImpact = impact.byDguid?.[secondaryDguid] ?? null;

  if (!firstImpact && !secondImpact) {
    return <p className="submission-impact-summary__empty">Population and area impact is unavailable.</p>;
  }

  const firstAreaValues = getAreaComparisonValues(firstImpact);
  const secondAreaValues = getAreaComparisonValues(secondImpact);
  const transfer = impact.transfer ?? null;
  const transferFrom = getDaLabel(profilesByDguid, transfer?.fromDguid);
  const transferTo = getDaLabel(profilesByDguid, transfer?.toDguid);

  return (
    <div className="submission-impact-summary">
      <div className="submission-impact-summary__table" role="table" aria-label="Proposed boundary impact comparison">
        <div className="submission-impact-summary__row submission-impact-summary__row--head" role="row">
          <span role="columnheader" aria-hidden="true" />
          <span role="columnheader">{first.title}</span>
          <span role="columnheader">{second.title}</span>
        </div>

        <div className="submission-impact-summary__row" role="row">
          <span className="submission-impact-summary__label" role="rowheader">Population impact</span>
          <span role="cell">
            <ImpactCell
              value={formatSignedPopulation(firstImpact?.populationDelta)}
              change={firstImpact?.populationDelta}
            />
          </span>
          <span role="cell">
            <ImpactCell
              value={formatSignedPopulation(secondImpact?.populationDelta)}
              change={secondImpact?.populationDelta}
            />
          </span>
        </div>

        <div className="submission-impact-summary__row" role="row">
          <span className="submission-impact-summary__label" role="rowheader">Area (km²)</span>
          <span role="cell">
            <ImpactCell
              value={firstAreaValues.proposed}
              change={firstImpact?.areaDelta}
              areaTransition
              originalValue={firstAreaValues.original}
              differenceValue={firstAreaValues.difference}
            />
          </span>
          <span role="cell">
            <ImpactCell
              value={secondAreaValues.proposed}
              change={secondImpact?.areaDelta}
              areaTransition
              originalValue={secondAreaValues.original}
              differenceValue={secondAreaValues.difference}
            />
          </span>
        </div>
      </div>

      {transfer?.fromDguid && transfer?.toDguid ? (
        <p className="submission-impact-summary__transfer">
          <strong>{formatPopulation(transfer.amount)}</strong> residents are estimated to move from{" "}
          <strong>{transferFrom.title}</strong> to <strong>{transferTo.title}</strong>.
        </p>
      ) : null}
    </div>
  );
}

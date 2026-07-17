import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAccent,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MISSING_DA_POPULATION, MVP_FED_NUM } from "@/lib/map/constants.js";
import { getDaPanelTitle, getDaPopulationDisplay } from "@/lib/map/profileUtils.js";

const COLLECTION_COPY = {
  comments: {
    title: "Comments",
    cards: [
      {
        title: "Community access concern",
        subtitle: "Placeholder submission",
        body:
          "Residents note that the current draft should keep the Dawson and Whitehorse service patterns easier to follow for future outreach rounds.",
      },
      {
        title: "Population balance note",
        subtitle: "Placeholder submission",
        body:
          "A recurring placeholder review asks for stronger narrative context around census balance, travel distance, and local identity before any boundary change is advanced.",
      },
      {
        title: "Geography continuity request",
        subtitle: "Placeholder submission",
        body:
          "This mock collection keeps a consistent review pattern so the commissioner workspace can exercise long scrolling and repeated card layouts safely.",
      },
    ],
  },
  "boundaries-objections": {
    title: "Boundaries Objections",
    cards: [
      {
        title: "Northern corridor objection",
        subtitle: "Placeholder objection",
        body:
          "This placeholder objection argues that a proposed split would weaken community continuity and complicate representation across long-distance service corridors.",
      },
      {
        title: "Neighbourhood cohesion objection",
        subtitle: "Placeholder objection",
        body:
          "Reviewers request that existing DA groupings remain together unless stronger supporting evidence is provided for a new electoral boundary transition.",
      },
      {
        title: "Accessibility objection",
        subtitle: "Placeholder objection",
        body:
          "A repeated mock item keeps the collection tall enough to validate scrollbar hiding, panel overflow, and mobile drag behavior under realistic content density.",
      },
    ],
  },
  "counter-proposal": {
    title: "Counter-Proposal",
    cards: [
      {
        title: "Alternative north-south split",
        subtitle: "Placeholder counter-proposal",
        body:
          "A sample counter-proposal suggests preserving community links first, then redistributing population using a smaller adjustment around neighbouring DA edges.",
      },
      {
        title: "Transit-aligned alternative",
        subtitle: "Placeholder counter-proposal",
        body:
          "This placeholder plan keeps primary travel corridors and service hubs grouped together so that public participation remains easier to interpret on the map.",
      },
      {
        title: "Minimal-change scenario",
        subtitle: "Placeholder counter-proposal",
        body:
          "The final placeholder entry favors the least disruptive edit path and exists mainly to keep every Yukon DA panel filled with the same stable demo content.",
      },
    ],
  },
};

function formatPopulation(value) {
  if (value === MISSING_DA_POPULATION) {
    return MISSING_DA_POPULATION;
  }

  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return MISSING_DA_POPULATION;
  }

  return Number(value).toLocaleString();
}

function FedSummary({ fedNum, fedName }) {
  return (
    <>
      <header className="map-info-panel__header">
        <h2 className="map-info-panel__title map-info-panel__title--centered">
          {fedName || `FED ${fedNum}`}
        </h2>
      </header>
      <div className="map-info-panel__body">
        <dl className="map-info-panel__details">
          <dt>FED</dt>
          <dd>
            <code>{String(fedNum ?? "—")}</code>
          </dd>
        </dl>
        <p className="map-info-panel__hint">
          Yukon DA collections appear when a dissemination area is selected on the map.
        </p>
      </div>
    </>
  );
}

function WorkspaceCardButton() {
  const navigate = useNavigate();

  return (
    <Button
      className="min-w-0 px-4 py-2 text-[13px]"
      size="sm"
      variant="outline"
      onClick={() => navigate("/dashboard/workspace")}
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M6 14L14 6M8 6H14V12"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Workspace
    </Button>
  );
}

export function CommissionerSubmissionCollections({
  panelView,
  selection,
  profilesByDguid,
}) {
  const collection = COLLECTION_COPY[panelView] ?? COLLECTION_COPY.comments;

  if (!selection?.type) {
    return (
      <div className="map-info-panel__body">
        <p className="map-info-panel__empty">
          Select a dissemination area to review submissions for this location.
        </p>
      </div>
    );
  }

  if (selection.type === "fed") {
    return <FedSummary fedNum={selection.fedNum} fedName={selection.fedName} />;
  }

  const profile = profilesByDguid.get(selection.dguid);
  const panelTitle = getDaPanelTitle(profile);
  const population = getDaPopulationDisplay(profile);

  return (
    <>
      <header className="map-info-panel__header">
        <h2 className="map-info-panel__title map-info-panel__title--centered">
          {panelTitle.text}
        </h2>
      </header>
      <div className="map-info-panel__body map-info-panel__body--stacked">
        <dl className="map-info-panel__details">
          <dt>DGUID</dt>
          <dd>
            <code>{selection.dguid ?? "—"}</code>
          </dd>

          <dt>Population (2021)</dt>
          <dd>{formatPopulation(population)}</dd>

          <dt>FED</dt>
          <dd>
            <code>{MVP_FED_NUM}</code>
          </dd>
        </dl>

        <div className="map-info-panel__collection-stack">
          {collection.cards.map((card, index) => (
            <Card key={`${collection.title}-${index}`} size="sm" className="max-w-none">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardAccent className="mt-2 shrink-0" />
                  <CardAction className="shrink-0">
                    <WorkspaceCardButton />
                  </CardAction>
                </div>
                <div className="space-y-1">
                  <CardTitle>{card.title}</CardTitle>
                  <CardDescription>{card.subtitle}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-[14px] leading-6 text-[#5f6368]">{card.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
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
import {
  getDashboardSubmissionsForDguid,
  subscribeWorkspaceState,
} from "@/services/tempWorkspace.js";

const PANEL_COLLECTION_KEYS = {
  comments: "comments",
  "boundaries-objections": "objections",
  "counter-proposal": "counterProposals",
};

const STATUS_STYLES = {
  pending: "bg-yellow-100 text-yellow-700",
  "archive-request": "bg-blue-100 text-blue-700",
};

function formatPopulation(value) {
  if (value === MISSING_DA_POPULATION) return MISSING_DA_POPULATION;
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
          <dt>FED</dt><dd><code>{String(fedNum ?? "—")}</code></dd>
        </dl>
        <p className="map-info-panel__hint">
          Select a dissemination area to review its active submissions.
        </p>
      </div>
    </>
  );
}

function WorkspaceCardButton({ submissionId }) {
  const navigate = useNavigate();
  return (
    <Button
      className="min-w-0 px-4 py-2 text-[13px]"
      size="sm"
      variant="outline"
      onClick={() => navigate(`/dashboard/workspace?focus=${encodeURIComponent(submissionId)}`)}
    >
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
        <path d="M6 14L14 6M8 6H14V12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Workspace
    </Button>
  );
}

export function CommissionerSubmissionCollections({ panelView, selection, profilesByDguid }) {
  const [collections, setCollections] = useState({
    comments: [],
    objections: [],
    counterProposals: [],
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (selection?.type !== "da") return undefined;

    const load = () => {
      setIsLoading(true);
      return getDashboardSubmissionsForDguid(selection.dguid)
        .then((nextCollections) => {
          if (isMounted) setCollections(nextCollections);
        })
        .finally(() => {
          if (isMounted) setIsLoading(false);
        });
    };
    load();
    const unsubscribe = subscribeWorkspaceState(load);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [selection?.dguid, selection?.type]);

  if (!selection?.type) {
    return <div className="map-info-panel__body"><p className="map-info-panel__empty">Select a dissemination area to review submissions for this location.</p></div>;
  }
  if (selection.type === "fed") {
    return <FedSummary fedNum={selection.fedNum} fedName={selection.fedName} />;
  }

  const profile = profilesByDguid.get(selection.dguid);
  const panelTitle = getDaPanelTitle(profile);
  const population = getDaPopulationDisplay(profile);
  const submissions = collections[PANEL_COLLECTION_KEYS[panelView] ?? "comments"] ?? [];

  return (
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

        <div className="map-info-panel__collection-stack">
          {isLoading ? <p className="map-info-panel__empty">Loading submissions...</p> : null}
          {!isLoading && !submissions.length ? (
            <p className="map-info-panel__empty">No Submission Found</p>
          ) : null}
          {submissions.map((submission) => (
            <Card key={submission.id} size="sm" className="max-w-none">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardAccent className="mt-2 shrink-0" />
                  <CardAction className="shrink-0"><WorkspaceCardButton submissionId={submission.id} /></CardAction>
                </div>
                <div className="space-y-1">
                  <CardTitle>{submission.title || "Untitled submission"}</CardTitle>
                  <CardDescription>{submission.authorEmail || "Unknown submitter"}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[submission.status]}`}>
                  {submission.status === "archive-request" ? "Archive Request" : "Pending"}
                </span>
                <p className="text-[14px] leading-6 text-[#5f6368]">{submission.comment || "No submission content."}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

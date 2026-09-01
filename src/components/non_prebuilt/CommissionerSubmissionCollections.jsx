import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
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
} from "@/services/workspaceApi.js";

const PANEL_COLLECTION_KEYS = {
  comments: "comments",
  "boundaries-objections": "objections",
  "counter-proposal": "counterProposals",
};

const STATUS_STYLES = {
  pending: "bg-amber-100 text-amber-800",
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
      className="h-7 min-w-0 gap-1 border-[#d8e6fb] bg-white px-2 py-1 text-[11px] shadow-none hover:scale-100 hover:border-[#b7d0f8] hover:bg-[#f5f9ff] hover:shadow-none"
      size="sm"
      variant="outline"
      type="button"
      onClick={() => navigate(`/dashboard/workspace?focus=${encodeURIComponent(submissionId)}`, {
        state: { from: "/dashboard" },
      })}
    >
      <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 20 20" fill="none">
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
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (selection?.type !== "da") return undefined;
    const controller = new AbortController();
    let requestId = 0;

    const load = () => {
      const activeRequestId = ++requestId;
      setIsLoading(true);
      setLoadError("");
      return getDashboardSubmissionsForDguid(selection.dguid, { signal: controller.signal })
        .then((nextCollections) => {
          if (!controller.signal.aborted && activeRequestId === requestId) {
            setCollections(nextCollections);
          }
        })
        .catch((error) => {
          if (error?.name !== "AbortError" && !controller.signal.aborted && activeRequestId === requestId) {
            setLoadError(error.message || "Unable to load submissions.");
            setCollections({ comments: [], objections: [], counterProposals: [] });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && activeRequestId === requestId) setIsLoading(false);
        });
    };
    void load();
    const unsubscribe = subscribeWorkspaceState(() => void load());
    return () => {
      requestId += 1;
      controller.abort();
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
          {!isLoading && loadError ? (
            <p className="map-info-panel__empty" role="alert">{loadError}</p>
          ) : null}
          {!isLoading && !loadError && !submissions.length ? (
            <p className="map-info-panel__empty">No Submission Found</p>
          ) : null}
          {submissions.map((submission) => (
            <Card
              key={submission.id}
              size="sm"
              className="flex max-w-none flex-col gap-2.5 p-3 hover:-translate-y-0.5 hover:bg-[#fbfdff] hover:shadow-[0_8px_24px_rgba(26,115,232,0.1)]"
            >
              <CardHeader className="gap-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[submission.status] ?? STATUS_STYLES.pending}`}>
                    {submission.status === "archive-request" ? "Archive Request" : "Pending"}
                  </span>
                  <CardAction className="shrink-0"><WorkspaceCardButton submissionId={submission.id} /></CardAction>
                </div>
              </CardHeader>
              <CardContent className="gap-2">
                <div className="space-y-0.5">
                  <CardTitle className="text-base font-semibold leading-5 text-gray-900">
                    {submission.title || "Untitled submission"}
                  </CardTitle>
                  <CardDescription className="break-all text-sm leading-5 text-gray-500">
                    {submission.authorEmail || "Unknown submitter"}
                  </CardDescription>
                </div>
                <p className="text-sm leading-5 text-gray-700">{submission.comment || "No submission content."}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

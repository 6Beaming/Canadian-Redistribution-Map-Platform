import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import UserViewStatistics from "@/pages/UserViewStatistics.jsx";
import UserMakeComments from "@/pages/UserMakeComments.jsx";
import UserMakeObjection from "@/pages/UserMakeObjection.jsx";
import UserMakeCounterProposal from "@/pages/UserMakeCounterProposal.jsx";
import CommissionerViewUserStats from "@/pages/CommissionerViewUserStats.jsx";
import CommissionerEvaluateReport from "@/pages/CommissionerEvaluateReport.jsx";
import CommissionerSubWorkspace from "@/pages/CommissionerSubWorkspace.jsx";

const USER_PANEL_VIEWS = [
  { id: "statistics", label: "View Statistics" },
  { id: "comments", label: "Make Comments" },
  { id: "objection", label: "Make an Objection   to Boundaries" },
  { id: "counter-proposal", label: "Make a Counter-Proposal" }
];

const COMMISSIONER_PANEL_VIEWS = [
  { id: "view-user-stats", label: "View User Statictics" },
  { id: "evaluate-report", label: "Evaluate this Report" },
  { id: "sub-workspace", label: "Activate Shared Workspace" }
];

function getDefaultPanelView(variant) {
  return variant === "commissioner" ? "view-user-stats" : "statistics";
}

function getActiveLabel(views, panelView) {
  return views.find((view) => view.id === panelView)?.label ?? "Menu";
}

export function MapInfoPanel({ selection, profilesByDguid, variant = "user" }) {
  const views =
    variant === "commissioner" ? COMMISSIONER_PANEL_VIEWS : USER_PANEL_VIEWS;
  const defaultView = getDefaultPanelView(variant);
  const [panelView, setPanelView] = useState(defaultView);
  const hasSelection = Boolean(selection?.type);

  useEffect(() => {
    setPanelView(defaultView);
  }, [selection, defaultView]);

  function renderPanelContent() {
    if (!hasSelection) {
      return (
        <UserViewStatistics
          selection={selection}
          profilesByDguid={profilesByDguid}
        />
      );
    }

    if (variant === "user") {
      switch (panelView) {
        case "comments":
          return (
            <div className="map-info-panel__embedded">
              <UserMakeComments />
            </div>
          );
        case "objection":
          return (
            <div className="map-info-panel__embedded">
              <UserMakeObjection />
            </div>
          );
        case "counter-proposal":
          return (
            <div className="map-info-panel__embedded">
              <UserMakeCounterProposal />
            </div>
          );
        case "statistics":
        default:
          return (
            <UserViewStatistics
              selection={selection}
              profilesByDguid={profilesByDguid}
            />
          );
      }
    }

    switch (panelView) {
      case "evaluate-report":
        return (
          <div className="map-info-panel__embedded">
            <CommissionerEvaluateReport />
          </div>
        );
      case "sub-workspace":
        return (
          <div className="map-info-panel__embedded map-info-panel__embedded--stacked">
            <CommissionerSubWorkspace />
          </div>
        );
      case "view-user-stats":
      default:
        return (
          <CommissionerViewUserStats
            selection={selection}
            profilesByDguid={profilesByDguid}
          />
        );
    }
  }

  return (
    <aside
      className={`map-info-panel${hasSelection ? " map-info-panel--open" : ""}`}
      aria-label="Map details"
    >
      {hasSelection ? (
        <div className="map-info-panel__menu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="map-info-panel__menu-trigger"
              >
                {getActiveLabel(views, panelView)}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="map-info-panel__menu-content">
              {views.map((view) => (
                <DropdownMenuItem
                  key={view.id}
                  onClick={() => setPanelView(view.id)}
                >
                  {view.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      <div
        className={
          hasSelection
            ? "map-info-panel__content map-info-panel__content--with-menu"
            : "map-info-panel__content"
        }
      >
        {renderPanelContent()}
      </div>
    </aside>
  );
}

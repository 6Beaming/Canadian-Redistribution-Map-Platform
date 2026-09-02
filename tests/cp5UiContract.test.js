import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "@jest/globals";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

test("Public and Commissioner tables use the lightweight service without changing table ownership", () => {
  const mine = read("src/pages/MySubmissions.jsx");
  const commissioner = read("src/pages/DashboardSubmissionsTable/DashboardSubmissionsPage.jsx");
  assert.match(mine, /getAllMySubmissionTableRows/);
  assert.match(mine, /normalizePublicSubmissionStatus/);
  assert.doesNotMatch(mine, /rejected:\s*"bg-/);
  assert.match(commissioner, /getAllCommissionerSubmissionTableRows/);
  assert.match(commissioner, /<SubmissionsTable/);
});

test("Commissioner new-submission indicator renders above the table shell", () => {
  const table = read("src/pages/DashboardSubmissionsTable/SubmissionsTable.jsx");
  const indicatorStart = table.indexOf("{newSubmissionCount > 0 ? (");
  const indicatorEnd = table.indexOf(") : null}", indicatorStart);
  const tableShell = table.indexOf(
    '<div ref={tableShellRef} className="submissions-table-shell rounded-md border">',
  );

  assert.ok(indicatorStart >= 0);
  assert.ok(indicatorEnd > indicatorStart);
  assert.ok(tableShell > indicatorEnd);
  assert.match(table, /sticky top-2 z-20 mb-3 flex justify-center/);
});

test("Workspace waits behind the shared full-page loading UI before rendering its complete tree", () => {
  const workspace = read("src/pages/CommissionerWorkspace.jsx");
  const exact = workspace.indexOf("await getWorkspaceSubmission(focusId");
  const full = workspace.indexOf("await getWorkspaceSubmissions", exact);
  assert.ok(exact >= 0 && full > exact);
  assert.match(workspace, /if \(isLoading\) \{[\s\S]*return <RouteLoadingPage \/>/);
  assert.doesNotMatch(workspace, /setWorkspaceSubmissions\(\[focused\]\)/);
});

test("Map pages render during profile hydration and Archived Tree waits for its canvas", () => {
  const publicHome = read("src/pages/UserHome.jsx");
  const dashboard = read("src/pages/DashboardHome.jsx");
  const archived = read("src/pages/ArchivedTree.jsx");
  const archivedCanvas = read("src/components/non_prebuilt/ArchivedTreeCanvas.jsx");

  assert.match(publicHome, /if \(!initialLoad\.ready && initialLoad\.error\)/);
  assert.match(dashboard, /if \(!initialLoad\.ready && initialLoad\.error\)/);
  assert.match(archived, /isLoading=\{isLoading\}/);
  assert.match(archivedCanvas, /const \[hasRendered, setHasRendered\] = useState\(false\)/);
  assert.match(archivedCanvas, /isLoading \|\| !hasRendered/);
  assert.match(archivedCanvas, /<span>Loading\.\.\.<\/span>/);
});

test("Workspace detail hydrates one exact row before its optional sibling list", () => {
  const review = read("src/pages/WorkspaceReview.jsx");
  const exact = review.indexOf("await getSubmissionTableRowById(submissionId)");
  const hydrate = review.indexOf("hydrateWorkspaceSubmission", exact);
  const full = review.indexOf("getWorkspaceSubmissions", hydrate);
  assert.ok(exact >= 0 && hydrate > exact && full > hydrate);
  assert.equal(review.includes("getDaProfiles"), false);
  assert.match(review, /return <RouteLoadingPage \/>/);
});

test("Creating an Archive Request updates the active review without navigating away", () => {
  const api = read("src/services/workspaceApi.js");
  const panel = read("src/components/non_prebuilt/WorkspaceReviewPanel.jsx");
  const review = read("src/pages/WorkspaceReview.jsx");

  assert.doesNotMatch(api, /submission\.status\s*=\s*WORKSPACE_STATUS\.ARCHIVE_REQUEST/);
  assert.match(api, /action === "archive-request"[\s\S]*getWorkspaceSubmissionStatus\(submission\.id\)/);
  assert.match(api, /return \{ status: nextStatus, review, submissionStatus \}/);
  assert.match(panel, /const committed = await commitWorkspaceAction/);
  assert.match(panel, /onCommitted\(action, committed\)/);
  assert.match(panel, /archiveRequest: committed\.review\.archiveRequest \?\? null/);
  assert.match(panel, /request\.allowedActions\?\.includes\("cancel"\)/);
  assert.match(panel, /ARCHIVE_REQUEST && request && !isRequester/);
  assert.match(panel, /refreshReview\(\);[\s\S]*refreshArchiveRequest\(\)\.catch/);
  assert.match(panel, /archiveRequestLoading=\{archiveRequestLoading\}/);
  assert.match(api, /if \(error\.status === 404\) return null;[\s\S]*throw error;/);
  assert.match(review, /if \(action === "archive-request"\) \{[\s\S]*updateSubmissionStatus\(committed\?\.submissionStatus\);[\s\S]*return;/);
  assert.match(review, /onCommitted=\{handleCommitted\}/);
});

test("CP5 navigation, readiness loading, and export entry points remain wired", () => {
  const table = read("src/pages/DashboardSubmissionsTable/DashboardSubmissionsPage.jsx");
  const mapCards = read("src/components/non_prebuilt/CommissionerSubmissionCollections.jsx");
  const header = read("src/pages/Header.jsx");
  const workspace = read("src/pages/CommissionerWorkspace.jsx");
  const archived = read("src/pages/ArchivedTree.jsx");
  const graphs = read("src/pages/DashboardGraphs.jsx");
  const submissionsTable = read("src/pages/DashboardSubmissionsTable/SubmissionsTable.jsx");
  const datePicker = read("src/components/ui/datePicker.jsx");
  const globals = read("src/styles/globals.css");
  const publicHome = read("src/pages/UserHome.jsx");
  const dashboard = read("src/pages/DashboardHome.jsx");

  assert.match(table, /state: \{ from: "\/dashboard\/submissionsTable" \}/);
  assert.match(mapCards, /state: \{ from: "\/dashboard" \}/);
  assert.match(header, /pathname === "\/dashboard\/archivedTree"[\s\S]*return "\/dashboard\/workspace"/);
  assert.match(header, /pathname === "\/dashboard\/graphs"[\s\S]*return "\/dashboard\/submissionsTable"/);
  assert.match(header, /pathname\.startsWith\("\/dashboard\/workspace\/"\)[\s\S]*return "\/dashboard\/workspace"/);
  assert.match(header, /\(isWorkspaceReview \|\| isArchivedTree\) && location\.state\?\.workspaceFrom/);
  assert.match(header, /isCommissioner && pathname === "\/dashboard"/);
  assert.doesNotMatch(header, /isCommissionerSurface && pathname !== "\/dashboard\/submissionsTable"/);
  assert.match(workspace, /navigate\("\/dashboard\/archivedTree", \{[\s\S]*workspaceFrom: location\.state\?\.from \?\? null/);
  assert.match(archived, /\{ replace: true, state: location\.state \}/);
  assert.match(archived, /\/difference\?branch=[\s\S]*\{ state: location\.state \}/);
  assert.match(archived, /exportArchivedTreeJson/);
  assert.doesNotMatch(graphs, /exportCommissionerSubmissionsCsv|Export CSV/);
  assert.match(submissionsTable, /exportCommissionerSubmissionsCsv\(submissionIds\)/);
  assert.match(submissionsTable, /table\.getPrePaginationRowModel\(\)\.rows/);
  assert.match(submissionsTable, /isWithinDateRange\(submission\.submittedAt, dateStart, dateEnd\)/);
  assert.match(datePicker, /"Jan\."[\s\S]*"Aug\."[\s\S]*"Dec\."/);
  assert.match(datePicker, /formatDateLabel\(date\)/);
  assert.doesNotMatch(datePicker, /min-w-0 truncate/);
  assert.match(submissionsTable, /<span>Submission Type<\/span>/);
  assert.match(submissionsTable, /<AlertDialogTitle>Export filtered submissions\?<\/AlertDialogTitle>/);
  assert.match(submissionsTable, /based on[\s\S]*the current filters\? Associated tags will be included\./);
  assert.match(submissionsTable, /<AlertDialogAction onClick=\{\(\) => void exportCsv\(\)\}>/);
  assert.match(globals, /\.commissioner-submissions-toolbar__search \{[\s\S]*max-width: 20rem[\s\S]*flex: 1 1 18rem/);
  assert.match(globals, /\.commissioner-submissions-toolbar__date-group \{[\s\S]*flex: 1\.05 1 21rem/);
  assert.match(globals, /\.commissioner-submissions-toolbar__actions \{[\s\S]*flex: 1\.6 1 30rem/);
  assert.match(globals, /@media \(min-width: 64rem\) \{[\s\S]*\.commissioner-submissions-toolbar \{[\s\S]*flex-wrap: nowrap/);
  assert.match(globals, /font-size: clamp\(0\.75rem, calc\(0\.68rem \+ 0\.32vw\), 0\.95rem\)/);
  assert.match(globals, /\.commissioner-submissions-toolbar__type \{[\s\S]*min-width: clamp\(9\.5rem, 14vw, 12rem\)[\s\S]*flex-grow: 1\.25/);
  [table, publicHome, dashboard].forEach((source) => assert.match(source, /RouteLoadingPage/));
  assert.equal(table.includes("RouteLoadingOverlay"), false);
  assert.equal(publicHome.includes("RouteLoadingOverlay"), false);
  assert.equal(dashboard.includes("RouteLoadingOverlay"), false);
});

test("Shared loading UI blocks page content and fullscreen owns Header visibility", () => {
  const app = read("src/App.jsx");
  const header = read("src/pages/Header.jsx");
  const overlay = read("src/components/non_prebuilt/RouteLoadingOverlay.jsx");
  const loadingPage = read("src/components/non_prebuilt/RouteLoadingPage.jsx");
  const archivedCanvas = read("src/components/non_prebuilt/ArchivedTreeCanvas.jsx");
  const review = read("src/pages/WorkspaceReview.jsx");
  const globals = read("src/styles/globals.css");
  const archivedStyles = read("src/styles/archive-tree.css");

  assert.match(app, /!isFullscreen \? <Header[\s\S]*app-route-content--fullscreen[\s\S]*<RouteLoadingOverlay \/>/);
  assert.ok(app.indexOf("<Header") < app.indexOf("<RouteLoadingOverlay />"));
  assert.match(overlay, /aria-label="Loading"[\s\S]*<span>Loading\.\.\.<\/span>/);
  assert.match(loadingPage, /<span>\{error \|\| "Loading\.\.\."\}<\/span>/);
  assert.match(archivedCanvas, /route-loading-overlay__spinner[\s\S]*<span>Loading\.\.\.<\/span>/);
  assert.match(review, /route-loading-overlay__spinner[\s\S]*<span>Loading\.\.\.<\/span>/);
  assert.doesNotMatch(
    [app, loadingPage, archivedCanvas].join("\n"),
    /RouteLoadingPage label=|Loading (?:page|archived tree|public map|commissioner map)/,
  );
  assert.match(globals, /\.app-route-content \{[\s\S]*z-index: 0;[\s\S]*isolation: isolate;/);
  assert.match(
    globals,
    /\.route-loading-overlay,[\s\S]*\.route-loading-page \{[\s\S]*z-index: 40;[\s\S]*inset: 3\.5rem 0 0;[\s\S]*background: rgba\(226, 232, 240, 0\.58\);[\s\S]*pointer-events: all;/,
  );
  assert.match(header, /<header className="header relative z-50[^"]*bg-background/);
  assert.match(archivedStyles, /\.archive-tree-canvas-loading \{[\s\S]*background: rgba\(226, 232, 240, 0\.58\);/);
});

test("Workspace label and catalog mutations stay scoped, ordered, and optimistic", () => {
  const panel = read("src/components/non_prebuilt/WorkspaceReviewPanel.jsx");
  assert.match(panel, /const \[pendingLabelKeys, setPendingLabelKeys\] = useState\(\(\) => new Set\(\)\)/);
  assert.match(panel, /createLabelMutationQueue/);
  assert.match(panel, /scheduleLabelSync/);
  assert.match(panel, /createLocalMutationGuard/);
  assert.match(panel, /localMutationGuardRef/);
  assert.match(panel, /pumpLabelDrain/);
  assert.match(panel, /runLabelDrainUntilSettled/);
  assert.match(panel, /selectionFingerprint/);
  assert.match(panel, /customEditDeselectedRef/);
  assert.match(panel, /optimisticSelectedRef\.current/);
  assert.match(panel, /lastCommittedSelectedRef/);
  assert.match(panel, /mergeCatalogFromServer/);
  assert.match(panel, /isSameLabel\(entry, label\)/);
  assert.match(panel, /preparePayloadWithRealUuids/);
  assert.match(panel, /onSuppressEcho=\{markEchoSuppressed\}/);
  assert.match(panel, /echoSuppressorRef\.current\.filter/);
  assert.match(panel, /onCommentsChange=\{updateComments\}/);
  assert.match(panel, /updateWorkspaceArchiveAssigneesById/);
  assert.match(panel, /pendingAssigneeEmails/);
  assert.doesNotMatch(panel, /const mutationPending = pendingIds\.size > 0/);
  assert.match(panel, /handleToggleLabel/);
  assert.match(panel, /function handleLabelRowClick\(event, label\)/);
  assert.match(panel, /event\.target\.closest\("button, input"\)/);
  assert.match(panel, /onClick=\{\(event\) => handleLabelRowClick\(event, label\)\}/);
  assert.match(panel, /Customized Label/);
  assert.match(panel, /reconcileLabelsInOrder\(optimisticSelectedRef\.current, persisted\)/);
  assert.match(panel, /onChange=\{updateActiveLabels\}/);
  assert.match(panel, /onCatalogChange=\{updateActiveCatalog\}/);
  assert.match(panel, /key=\{submission\.id\}/);
  assert.match(panel, /review\.submissionId[\s\S]*submission\.id[\s\S]*EMPTY_REVIEW/);
  assert.match(panel, /Labels cannot be empty/);
  assert.match(panel, /}, 5000\)/);
  assert.match(panel, /isDraftCustomLabelId\(label\.id\)[\s\S]*clearInvalidCustomLabel[\s\S]*setCatalog/);
  assert.match(panel, /deleteWorkspaceLabelCatalog\(label\.id, submissionId\)/);
  assert.match(panel, /refreshSequence\.current !== sequence/);
  assert.doesNotMatch(
    panel.slice(panel.indexOf("async function toggleAssignee"), panel.indexOf("async function runAction")),
    /onCommitted\(/,
  );
});

test("Workspace closing comments use action-specific note headings without repeating email", () => {
  const panel = read("src/components/non_prebuilt/WorkspaceReviewPanel.jsx");
  assert.match(panel, /accepted this submission"\)\) return "Approved Note"/);
  assert.match(panel, /rejected this submission"\)\) return "Rejection Note"/);
  assert.match(panel, /includes\("archive"\)\) return "Archive Note"/);
  assert.match(panel, /comment\.isClosing \? getClosingNoteTitle\(comment\.action\) : comment\.email/);
  assert.doesNotMatch(panel, /\$\{comment\.email\}'s Closing Comment/);
});

test("Resolved Workspace submissions announce navigation to the next item", () => {
  const review = read("src/pages/WorkspaceReview.jsx");
  const globals = read("src/styles/globals.css");
  assert.match(review, /import \{ toast \} from "sonner"/);
  assert.match(review, /toast\.success\("Submission resolved\. Moving to the next submission\."/);
  assert.match(review, /toast\.success\("Submission resolved\. Returning to the Workspace\."/);
  assert.equal((review.match(/className: "workspace-resolution-toast"/g) ?? []).length, 2);
  assert.match(globals, /\.workspace-resolution-toast \{[\s\S]*width: max-content !important;[\s\S]*translate: -50% 0/);
  assert.match(globals, /\.workspace-resolution-toast \[data-title\] \{[\s\S]*white-space: nowrap/);
  assert.match(review, /if \(action === "archive-request"\) \{[\s\S]*updateSubmissionStatus[\s\S]*return;/);
  const notice = review.indexOf("Submission resolved. Moving to the next submission.");
  const navigation = review.indexOf("navigate(`/dashboard/workspace/${encodeURIComponent(next.id)}`", notice);
  assert.ok(notice >= 0 && navigation > notice);
});

test("Workspace decision controls do not flash the next status before navigation", () => {
  const panel = read("src/components/non_prebuilt/WorkspaceReviewPanel.jsx");
  const controls = panel.slice(
    panel.indexOf("function DecisionControls"),
    panel.indexOf("export function WorkspaceReviewPanel"),
  );

  assert.match(controls, /const \[submittedStatus, setSubmittedStatus\] = useState\(null\)/);
  assert.match(controls, /const displayedStatus = submittedStatus \?\? submission\.status/);
  assert.match(controls, /setSubmittedStatus\(submission\.status\)[\s\S]*commitWorkspaceAction/);
  assert.match(controls, /keepControlsFrozen = action !== "archive-request"/);
  assert.match(
    controls,
    /if \(!keepControlsFrozen\) \{[\s\S]*setSubmittedStatus\(null\)[\s\S]*setIsSubmitting\(false\)/,
  );
  assert.match(controls, /displayedStatus === WORKSPACE_STATUS\.PENDING/);
  assert.match(controls, /displayedStatus === WORKSPACE_STATUS\.ACCEPTED/);
  assert.match(controls, /runAction\("reject-again"\)/);
  assert.match(controls, /Reject again/);
  assert.match(controls, /displayedStatus === WORKSPACE_STATUS\.REJECTED/);
  assert.doesNotMatch(controls, /submission\.status === WORKSPACE_STATUS/);
});

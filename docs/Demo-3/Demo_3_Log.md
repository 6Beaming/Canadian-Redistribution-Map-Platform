# Demo 3 Log — Map, Workspace, and Archive Delivery

**Active branch:** `feature/demo-3-workspace-and-tree`
**Delivery status:** Demonstration-ready frontend with a mixed durable and transitional data layer
**Scope:** Map reliability, submission review, Workspace, Archived Tree, responsive Commissioner UI, and the next database contract

---

## 1. Delivery Summary

Demo 3 evolves the original map viewer into a workflow-aware application. The
map now combines high-performance PMTiles rendering with exact GeoJSON overlays
for pair-focused review and boundary editing. Commissioner users can browse
submissions, review a selected record in Workspace, move a real Supabase
submission into a versioned Archived Tree, inspect historical versions, and
return archived geometry to the Dashboard map.

The delivery deliberately distinguishes durable work from development adapters:

- live comments and objections are read from Supabase;
- Archived Tree reads and mutations are Supabase-backed and commissioner-only;
- Workspace comments, labels, and archive-request voting remain browser-local
  drafts; and
- Counter-Proposals are currently Yukon fixture data, not persisted records.

The detailed technical references are [map-architecture.md](./map-architecture.md),
[map-backend.md](./map-backend.md), [workspace.md](./workspace.md),
[workspace-backend.md](./workspace-backend.md), and
[New_Database_Schema.md](./New_Database_Schema.md).

## 2. Map and Boundary Workflow Changes

- Replaced black boundary strokes with a shared deep-blue treatment and
  increased stroke widths across FED, DA, selected-pair, and editing layers.
- Clamped map bounds to the Web Mercator latitude limit to remove the northern
  blank region.
- Hide Enabled FED outlines at detailed DA zoom levels so cross-FED DA/FED
  edges do not visually double. Data Blocked FEDs retain their regional
  behaviour.
- Made Enabled FEDs non-clickable and removed their regular InfoPanel flow;
  Enabled DAs and Data Blocked FEDs remain interactive.
- Locked unrelated hover and click behaviour during focused objection and
  counter-proposal stages.
- Established PMTiles/GeoJSON mutual exclusion for focused pairs. Feature state
  hides selected PMTiles features and exact GeoJSON draws the focused pair.
- Added normalized shared-edge ownership, cross-FED adjacency support, JSTS
  validity checks, binary drag backoff, and non-destructive duplicate-vertex
  repair for editable pair copies.

## 3. Commissioner Map Features

### Optional submission heatmap

`src/lib/map/heatmap.js` owns the heatmap expression and MapLibre control.
Only `DashboardHome.jsx` requests the data and passes it into MapCanvas; public
maps do not receive the prop or control. The current loader counts active
pending/archive-request submissions from the transitional Workspace read model.
It must later be replaced by an authenticated compact backend aggregate.

### Archived Map

`src/lib/map/archivedMapEffect.js` loads latest Archived Tree branch versions
from the commissioner API and adds an optional Dashboard control. It outlines
archived DA coverage in green and, where a retained proposed GeoJSON is
available, supplies a focused override source so archived geometry does not
double-render with PMTiles. Historical Counter-Proposal replay remains limited
until Counter-Proposals store immutable server-side geometry snapshots.

## 4. Submission, Dashboard, and Responsive UI

- Public and Commissioner submission tables use horizontal scrolling and
  clamp-based control, pagination, and header sizing.
- Reference IDs display the first five characters plus an ellipsis, with the
  full value in the native tooltip. Commissioner titles are constrained to
  approximately ten characters plus an ellipsis.
- Commissioner `Submitted by` displays the server-merged author email and is
  sortable alphabetically.
- Status chips are normalized as pending (yellow), archive request (blue),
  accepted (green), rejected (red), and archived (purple). Hovered rows display
  a status-specific next-step message.
- Archive Request rows direct a Commissioner to the selected Workspace record
  and display: “Carefully evaluate whether this submission can be archived.”
- The submission toolbar groups Submission Type and Analytics before wrapping
  date controls; all controls use the shared blue visual treatment.
- Audit Log was removed from the Commissioner surface. Analytics was moved to
  the Submissions Table toolbar. Map navigation was standardized as Back to
  Map, and redundant header controls are hidden on their active page.
- Headers and Map InfoPanels use clamp-based sizing. The desktop InfoPanel
  contracts before it can exceed half of the map workspace.

## 5. Workspace and Archived Tree UI

### Workspace

- `/dashboard/workspace` renders an expandable tree of Comments, Objections,
  and Counter-Proposals, each classified as Pending, Archive Request, Accepted,
  or Rejected.
- Tree branches are clickable, animate on expansion/collapse, include counts,
  and can be filtered by the same branch hierarchy.
- The Status Key uses state colours and category icons. Pending contains the
  separate Pending Submissions and Archive Request leaves.
- `/dashboard/workspace/:submissionId` loads a read-only exact map view,
  submission selector, labels, Commissioner comments, impact details, and
  decision controls.
- The Counter-Proposal Original/Proposed switch keeps the mounted MapLibre
  camera and only updates the focused overlay source.
- Label controls and comments selector were aligned with the shared dropdown
  visual language; custom label drafts begin empty and retain saved local
  values for the current browser state.

### Archived Tree

- `/dashboard/archivedTree` uses an interactive Canvas version tree with pan,
  zoom, root/category navigation, branch expansion, search, and a right-side
  version detail panel.
- The detail panel supports read-only Difference, persistent branch revert, and
  destructive branch deletion behind an exact confirmation phrase.
- `/dashboard/archivedTree/:submissionId/difference` provides a read-only map
  comparison between a selected version and its branch latest version.
- Archived Tree never reads or writes an archive tree in localStorage. It
  reloads state from `/api/workspace/archive` after durable actions.

## 6. Backend and Schema Delivery

- `App.jsx` now has a Public-only route safeguard, while `server/app.js`
  registers authentication for every submissions route. `comments.js` then
  separates public-only and Commissioner-only operations, preventing a
  Commissioner session from falling through to the public submission surface.
  The Commissioner-wide list still resolves author emails server-side through
  the Supabase service-role helper.
- `server/routes/workspace.js` is commissioner-only and exposes reviewer
  lookup, temporary status mutation, Archived Tree read, atomic merge, latest
  version revert, and branch deletion.
- `20260719160000_create_workspace_tables.sql` defines the initial Workspace
  tables, while `20260719170000_normalize_submission_status_constraint.sql`
  replaces the legacy submission status CHECK.
- `20260719180000_archive_tree_supabase_versions.sql` adds branch/version
  fields and service-role-only PostgreSQL RPCs for atomic archive merge, revert,
  and deletion.

The migration files are committed but must be applied by a Supabase project
owner before the durable Archive Tree endpoints can succeed.

## 7. Principal File Map

| Area | Main files |
| --- | --- |
| Map lifecycle and focused overlays | `src/components/non_prebuilt/MapCanvas.jsx`, `src/lib/map/objectionWorkflow.js`, `src/lib/map/counterProposalWorkflow.js` |
| Optional map modes | `src/lib/map/heatmap.js`, `src/lib/map/archivedMapEffect.js`, `src/pages/DashboardHome.jsx` |
| Workspace read model | `src/services/tempWorkspace.js`, `src/services/tempCounterProposal.js`, `src/data/map/temp.json` |
| Workspace UI | `src/pages/CommissionerWorkspace.jsx`, `src/pages/WorkspaceReview.jsx`, `src/components/non_prebuilt/WorkspaceReviewPanel.jsx` |
| Archive UI | `src/pages/ArchivedTree.jsx`, `src/pages/ArchivedDifference.jsx`, `src/components/non_prebuilt/ArchivedTreeCanvas.jsx`, `src/components/non_prebuilt/ArchivedTreePanel.jsx`, `src/lib/archiveTree.js` |
| API and persistence | `server/routes/comments.js`, `server/routes/workspace.js`, `server/lib/supabase.js`, `supabase/migrations/` |

## 8. Known Follow-up Work

1. Replace the Counter-Proposal fixture and browser-only geometry hydration with
   authenticated persistent submissions and immutable geometry snapshots.
2. Store Workspace comments, labels, archive requests, assignees, and votes in
   their existing Supabase tables; remove their `localStorage` adapter.
3. Add Supabase Realtime or an equivalent server push/query-refresh strategy
   for multi-Commissioner collaboration.
4. Replace the legacy `submissions.dguid` foreign-key/join dependency with
   server-side validation and display hydration from versioned local map assets.
   Supabase should store submission state and immutable snapshots, not a
   duplicate national DA reference catalog.
5. Complete server-side validation for comment/objection payloads, validate
   objection pairs, and write verified immutable geometry.
6. Replace permanent Archive Tree deletion with a recoverable audit-preserving
   policy if the feature is used outside the demonstration environment.

## 9. Verification

The current branch has been checked with:

```text
npm test -- --runInBand
npm run check:server
npm run build
git diff --check
```

The tests, server check, production build, and whitespace check passed. Vite
continues to report its standard large-chunk advisory.

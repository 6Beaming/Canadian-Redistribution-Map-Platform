# Demo 3 Log - Map Refactoring and Responsive Workflow Delivery

**Branch:** `feature/demo-3-map-refactoring`  
**Status:** Delivered for the current demonstration build  
**Scope:** Map reliability, editing safety, Commissioner tooling, submissions UI, and responsive layout

---

## 1. Delivery Summary

Demo 3 refactors the map from a basic PMTiles viewer into a workflow-aware map
surface. The delivery separates fast baseline rendering from exact pair editing,
adds geometry validation, restores the Commissioner heatmap as an optional
module, and aligns the public and Commissioner UI with the current submissions
flows.

The detailed map design is documented in
[map-architecture.md](./map-architecture.md). Backend contracts and remaining
server work are documented in [map-backend.md](./map-backend.md).

## 2. Map Rendering and Interaction Updates

- Replaced black outlines with a shared deep-blue boundary treatment and
  increased line widths for FED, DA, selected-pair, and editable boundaries.
- Clamped northern map bounds to the Web Mercator latitude limit to remove the
  blank area visible at the top of the map.
- Hide Enabled FED outlines at detailed DA zoom levels to prevent cross-FED
  DA/FED double outlines while retaining Data Blocked FED boundaries.
- Made all Enabled FEDs non-interactive; Enabled DAs and Data Blocked FEDs keep
  their appropriate interaction behavior.
- Locked unrelated hover and click interactions once objection or
  counter-proposal workflows reach their focused stage.
- Matched the blue selected-DA appearance between objection and
  counter-proposal workflows.

## 3. Exact Pair Rendering and Editing Safety

- Added normalized edge ownership and cross-FED adjacency construction for DA
  pairs.
- Switched a selected pair from PMTiles to exact canonical GeoJSON in workflow
  views, with feature-state exclusion for the selected PMTiles fills.
- Replaced conflicting baseline outlines with one focused GeoJSON boundary
  collection, preserving exterior pair edges while drawing the editable shared
  boundary separately.
- Added JSTS 2.12.1 validation for self-intersection, pair overlap, area
  conservation, outer-boundary escape, and unrelated-boundary clearance.
- Added binary drag backoff so invalid pointer moves stop at the last valid
  coordinate.
- Added a local, non-destructive repair step for source pairs with repeated
  non-closure vertices. The repair applies only to the editing clone and never
  rewrites canonical metadata.

## 4. Heatmap Refactoring

The heatmap was moved out of `MapCanvas.jsx` into
`src/lib/map/heatmap.js`.

| Export | Responsibility |
| --- | --- |
| `loadDemoSubmissionHeatmap()` | Loads the current local demonstration counts fixture. |
| `hasSubmissionHeatmapData()` | Guards optional feature mounting. |
| `buildSubmissionHeatmapFillExpression()` | Builds the MapLibre DA fill expression. |
| `createSubmissionHeatmapControl()` | Builds the accessible MapLibre control. |

Only `DashboardHome.jsx` imports the loader and passes `heatmap` to its
Commissioner MapCanvas. Public maps do not pass the prop, so the control and
heatmap paint mode are absent by default. The control now mounts correctly even
when the asynchronous fixture resolves after the MapLibre map has loaded.

The data remains a local fixture; it is not a live aggregate of Supabase
submissions. The replacement API contract is documented in `map-backend.md`.

## 5. Commissioner and Submission UI

- Removed the Audit Log route, page components, API wrapper, navigation entry,
  and server route from the current Commissioner surface.
- Moved the Analytics entry beside Submission Type in the Commissioner
  submissions toolbar and matched its visual treatment to the date controls.
- Added responsive toolbar grouping: Submission Type and Analytics wrap
  together before the two date controls wrap together.
- Added horizontal scrolling for both submissions tables and clamp-based table,
  toolbar, pagination, and header sizing.
- Standardized table labels: `Reference ID`, `Time of Submission`, and
  `Submitted by`.
- Made Commissioner `Submitted by` sortable by email.
- Shortened Reference ID table cells to the first five characters plus an
  ellipsis while retaining the full value in the native hover tooltip.
- Unified status chips and hover messages for accepted, pending, rejected, and
  archived submissions.
- Removed per-row action dropdowns and added the empty archived-tree route for
  archived submission navigation.
- Simplified Commissioner header actions so the active submissions page hides
  its own User Submissions entry, and synchronized the map navigation button
  with the public Back to Map control.

## 6. Responsive and Profile UI

- Added clamp-based sizing to shared headers, search controls, table controls,
  and pagination.
- Updated the map workspace grid so the InfoPanel remains at or below half of
  the desktop workspace and compresses before it can crowd the map.
- Added clamp-based InfoPanel typography, padding, controls, forms, and
  workflow footer sizing to prevent control overlap between mobile and desktop
  breakpoints.
- Hidden the redundant My Submissions control on the public submissions page
  and normalized its capitalization.
- Updated sign-out and cancel actions to use the project destructive red button
  treatment, including hover, active, focus, and disabled behavior.

## 7. Submission Data Flow Changes

The Commissioner-wide submissions request now sends credential cookies and is
restricted to authenticated Commissioner users. `comments.js` obtains author
emails through the server-only Supabase service-role helper in `supabase.js`,
then merges the limited `{ id, email }` result into the submission response.
This resolves the RLS-driven `Unknown` author display without exposing profile
emails through an anonymous endpoint.

Other comments and objections routes still require complete server-side
authorization work before they should be treated as production mutation APIs;
see `map-backend.md`.

## 8. Principal File Changes

| File | Change |
| --- | --- |
| `src/components/non_prebuilt/MapCanvas.jsx` | Layer ordering, bounds, FED visibility, focused GeoJSON pair rendering, control lifecycle, and interaction locking. |
| `src/lib/map/heatmap.js` | New optional heatmap module. |
| `src/lib/map/objectionWorkflow.js` | Shared-edge ownership and adjacency index. |
| `src/lib/map/counterProposalWorkflow.js` | JSTS validation, repair, and safe drag behavior. |
| `src/lib/map/interactionMode.js` | New explicit interaction-mode policy. |
| `src/pages/DashboardHome.jsx` | Commissioner-only heatmap injection. |
| `src/pages/DashboardSubmissionsTable/` | Responsive Commissioner table, sorting, status, and navigation updates. |
| `src/pages/MySubmissions.jsx` | Responsive public table and status display updates. |
| `src/styles/map.css` and `src/styles/globals.css` | Map, InfoPanel, header, toolbar, table, and responsive styling. |
| `server/routes/comments.js` and `server/lib/supabase.js` | Commissioner authorization and service-role email lookup. |

## 9. Verification

The current branch was checked with:

```text
npm test
npm run check:server
npm run build
git diff --check
```

The test suite passes, the server syntax check passes, and the production build
passes. Vite may continue to report its existing chunk-size advisory.


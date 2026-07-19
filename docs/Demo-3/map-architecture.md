# Demo 3 Map Architecture

## 1. Purpose

The Demo 3 map is a MapLibre application that separates fast national
presentation from exact local workflow geometry. PMTiles renders the baseline
map; FED-scoped canonical GeoJSON is loaded only when a workflow needs precise
DA pair boundaries. Google Map Tiles is a visual raster basemap only and is
never used as an electoral-boundary authority.

The architecture supports public map interaction, exact objection and
counter-proposal review, a Commissioner-only submission heatmap, and a
Commissioner-only Archived Map overlay.

## 2. Geographic Asset Model

| Location | Runtime purpose |
| --- | --- |
| `src/data/map/render/` | DA PMTiles render bundle and labels used for normal MapLibre rendering. |
| `src/data/map/metadata/` | Canonical FED-scoped DA GeoJSON shards, loaded lazily for a focused pair. |
| `src/data/map/reference/` | FED boundaries, labels, and names. |
| `src/data/map/manifests/` | Render and rollout manifests. |
| `src/data/map/indexes/` | Compact profile/index inputs. |
| `src/data/map/temp.json` | Development-only Counter-Proposal fixture data; not a geographic source of truth. |

The build pipeline remains one way:

```text
Statistics Canada source data
  -> build_da_metadata_geojson.py
  -> canonical FED-scoped GeoJSON metadata
  -> profile enrichment/index scripts
  -> build_da_render_bundle.py
  -> PMTiles, labels, and manifests
```

Runtime workflows never rewrite the baseline metadata or PMTiles bundle.

## 3. MapLibre Layers and Interaction Rules

`src/components/non_prebuilt/MapCanvas.jsx` owns source/layer registration,
feature state, control lifecycle, pointer handling, and ordering. The primary
stack is:

1. optional Google road-map raster tiles;
2. FED fill and outline layers;
3. DA PMTiles fill and outline layers;
4. FED and DA labels;
5. workflow GeoJSON overlays, heatmap mode, and archived-map overlays.

All electoral outlines use the shared deep-blue boundary colour and responsive
line widths. Enabled FED outlines disappear at detailed DA zoom to prevent
cross-FED DA/FED double drawing; Data Blocked FED outlines remain available.
Initial and maximum latitude bounds are clamped to the Web Mercator limit
(`85.051129`) so the map cannot expose a blank northern raster region.

`src/lib/map/interactionMode.js` defines interaction policy. Enabled DAs remain
selectable; Enabled FEDs are not InfoPanel targets; Data Blocked FEDs retain
their special interaction. Objection focus, counter-edit, and counter-review
modes disable unrelated DA/FED hover and click actions.

## 4. Exact Pair Rendering

`src/lib/map/objectionWorkflow.js` creates a normalized edge index from the
canonical metadata. It contains feature lookup, adjacency, pair shared segments,
and edge ownership. Cross-FED selections merge both relevant metadata shards
before this index is built.

Focused pair rendering intentionally does not draw PMTiles and GeoJSON for the
same DA at once:

1. MapCanvas sets feature state for the selected DGUIDs.
2. PMTiles fill/outline rules suppress the selected baseline features.
3. A single exact GeoJSON collection draws the pair exterior.
4. The shared edge is drawn independently as the workflow/edit line.
5. The outer edges shared with non-selected neighbours remain represented by
   the focused exact collection, not a duplicate baseline edge.

This is used for public objection, counter-proposal editing, Workspace review,
and Archived Difference. It prevents visual PMTiles/GeoJSON offsets without
changing canonical metadata.

## 5. Geometry Editing and Read-only Review

`src/lib/map/counterProposalWorkflow.js` uses JSTS for the client-side editing
guard. Candidate moves must retain valid polygons, preserve pair area within
tolerance, avoid pair overlap, stay in the original pair envelope, and clear
unrelated boundaries. A binary backoff stops an invalid drag at its last legal
position. Repeated non-closure vertices found in some source pairs are repaired
only in an editing clone; canonical files are not changed.

The same exact overlay machinery is reused in read-only pages:

- `WorkspaceReview.jsx` displays selected live/temporary submissions. For a
  Counter-Proposal, Original/Proposed toggling changes source data without
  recreating the map or fitting the camera again.
- `ArchivedDifference.jsx` displays a selected archived version and its latest
  branch version. It is read-only and contains no editor or Commissioner comment
  input.

Client-side JSTS is immediate UX validation, not a server trust boundary.
Future Counter-Proposal and objection submission APIs must validate and store
server-approved geometry.

## 6. Commissioner Optional Modes

### 6.1 Submission Heatmap

`src/lib/map/heatmap.js` is a standalone optional module:

| Export | Responsibility |
| --- | --- |
| `loadSubmissionHeatmap()` | Requests the current hybrid submission aggregate from `tempWorkspace`. |
| `hasSubmissionHeatmapData()` | Prevents an empty control/layer mount. |
| `buildSubmissionHeatmapFillExpression()` | Produces the MapLibre DA fill expression. |
| `createSubmissionHeatmapControl()` | Creates the accessible MapLibre toggle control. |

`DashboardHome.jsx` is the sole caller and passes the resulting `heatmap` prop
to its Commissioner MapCanvas. Public-user maps omit the prop completely.
Today the aggregate counts active pending and archive-request items from live
Supabase feedback/objections plus local Counter-Proposal fixtures. The future
replacement is an authenticated server aggregate keyed by DGUID; MapCanvas does
not need to change when that loader changes.

### 6.2 Archived Map

`src/lib/map/archivedMapEffect.js` is another optional module. It retrieves
durable archive records through `getArchiveTreeRecords()`, selects each branch's
persisted latest version, and returns:

- affected DGUIDs for the green archived outline treatment;
- exact proposed GeoJSON features, if available; and
- override DGUIDs for mutual PMTiles/GeoJSON rendering.

The Dashboard Archived Map control is available only to the Commissioner map.
It is a read-only visualisation; it does not mutate Archive Tree data. Archived
Counter-Proposal fidelity remains constrained by the absence of a durable
Counter-Proposal geometry-write protocol.

## 7. Map-related Data Flows

```text
Normal MapCanvas
  -> /api/map asset service
  -> PMTiles + labels + profile index + selected FED GeoJSON metadata

Focused objection / counter workflow
  -> canonical metadata shards
  -> edge index + JSTS-safe geometry
  -> MapCanvas focused GeoJSON source and feature-state PMTiles exclusion

Commissioner heatmap
  -> loadSubmissionHeatmap()
  -> tempWorkspace.getSubmissionHeatmap()
  -> protected GET /api/comments + local temp.json fixture

Archived Map
  -> loadArchivedMapEffect()
  -> GET /api/workspace/archive
  -> Supabase archive_tree snapshots + canonical metadata hydration
```

The first two paths are baseline map-data paths. The latter two are submission
views and must eventually consume dedicated backend read models rather than the
transitional `tempWorkspace` adapter.

## 8. Configuration and Operations

- The Google Map Tiles key and related client environment variables live in the
  root `.env`, which is Git-ignored and distributed through the project shared
  drive. `.env.local` is not used.
- The local map asset service supports HTTP byte ranges required by PMTiles.
- The electoral map remains functional when Google tiles fail because map
  geometry, selection, overlays, and workflow metadata are repository-owned.
- Map-related API contracts, write paths, and pending refactors are documented
  in [map-backend.md](./map-backend.md). Workspace and archive implementation
  details are documented in [workspace.md](./workspace.md).

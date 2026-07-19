# Demo 3 Map Architecture

## Overview

The Demo 3 map is a layered MapLibre application designed around two different
representations of the same baseline geography:

1. **PMTiles render assets** provide fast, tiled national rendering.
2. **FED-scoped canonical GeoJSON metadata** provides the exact geometry needed
   for a small interactive editing session.

The map never treats the Google basemap as an electoral-boundary source. Google
Map Tiles supplies only the visual road-map background. FED and Dissemination
Area (DA) fills, outlines, selection state, and workflow geometry are rendered
from repository-owned assets.

## Data Layout

| Location | Purpose |
| --- | --- |
| `src/data/map/metadata/` | Canonical FED-scoped DA GeoJSON shards. These are lazy-loaded for an active pair workflow. |
| `src/data/map/render/` | Browser render assets, including `da_boundaries_available.pmtiles` and DA label GeoJSON. |
| `src/data/map/reference/` | Stable FED boundaries, FED labels, and FED names. |
| `src/data/map/manifests/` | Render and rollout manifests that describe available assets. |
| `src/data/map/indexes/` | Small denormalized indexes used for profiles and the temporary heatmap fixture. |

The canonical metadata is intentionally sharded by FED. The application can
load the exact geometry for two selected DAs without downloading a national
GeoJSON file, while PMTiles remains responsible for normal map rendering.

## Asset Build Pipeline

The reusable scripts form a one-way production pipeline:

```text
Statistics Canada source files
  -> build_da_metadata_geojson.py
  -> FED-scoped canonical metadata GeoJSON
  -> collect_da_profiles.py / sync_da_metadata.py
  -> profile index and enriched metadata
  -> build_da_render_bundle.py
  -> PMTiles, labels, and DA asset manifest
```

Supporting scripts generate FED labels and rollout metadata. The temporary
combined GeoJSON used to produce PMTiles is a build artifact and is not a
runtime dependency.

## MapLibre Sources and Layers

`MapCanvas.jsx` owns the MapLibre instance, source registration, layer order,
feature-state updates, and pointer events. The important rendering layers are:

1. Google road-map raster layers, when a Google Map Tiles session is available.
2. FED fill and outline layers from the FED reference asset.
3. DA fill and outline layers from the PMTiles render bundle.
4. FED and DA label layers.
5. Workflow-only GeoJSON overlays for objection and counter-proposal views.

All electoral boundaries use the shared deep-blue `#243b6b` line treatment. The
line widths scale with zoom so the boundary remains legible without looking
heavy at national scale. At zoom level 7 and above, Enabled FED outlines are
suppressed while DA outlines remain visible. This prevents a FED outline from
visually doubling an underlying DA boundary near a cross-FED edge. Data Blocked
FED outlines remain visible because they are still an interactive regional
surface.

The initial bounds and maximum bounds are clamped to the Web Mercator latitude
limit (`85.051129`). This removes the blank strip previously visible when the
map was panned beyond the raster provider's renderable northern extent.

## Presentation and Interaction State

The map uses feature state for selection, hover, rollout visibility, and DA
overrides. The interaction policy lives in `src/lib/map/interactionMode.js`:

- Enabled DAs are interactive.
- Enabled FEDs are not interactive and do not open an InfoPanel state.
- Data Blocked FEDs remain interactive.
- Objection focus, counter-edit, and counter-review modes lock hover and click
  interactions for all unrelated DAs and FEDs.

This keeps the normal browsing map responsive while keeping the user focused on
the selected pair once a workflow enters its detailed stage.

## Pair Workflows

`UserHome.jsx` lazy-loads the canonical metadata shards required for the
selected DAs. When a pair crosses a FED boundary, both source FEDs are merged
before an adjacency index is built.

`src/lib/map/objectionWorkflow.js` builds a normalized edge index containing:

- `featureByDguid`
- `adjacencyByDguid`
- `boundarySegmentsByPair`
- `edgeOwners`

Edges are normalized to six decimal places before ownership is calculated.
Adjacency is therefore inferred from shared edge ownership rather than from a
fragile visual overlap or a search over rendered tiles.

During objection and counter-proposal focus, PMTiles remains the baseline for
the rest of the map, but the selected pair switches to exact GeoJSON rendering.
The selected DA PMTiles fill is excluded with feature state, and the normal DA
outline is temporarily hidden for the focused pair. A single exact GeoJSON
boundary collection then draws the pair exterior, while the actual shared edge
is drawn separately as the red workflow boundary. This avoids the visible
PMTiles/GeoJSON double-outline effect and still retains pair-to-neighbour outer
edges.

The Original and Proposed views use the same focused rendering model. The
Proposed counter-proposal view adds only the editable shared-boundary line and
its handles.

## Geometry Validation and Repair

`src/lib/map/counterProposalWorkflow.js` uses JSTS 2.12.1 for geometry
validation. Candidate moves are evaluated in projected coordinates and must:

- produce valid DA geometries;
- preserve the combined pair area within a small tolerance;
- avoid interior overlap between the two DAs;
- stay inside the original pair envelope; and
- maintain at least two metres of clearance from unrelated boundaries.

When a drag approaches an invalid position, the editor uses binary backoff to
stop at the last valid coordinate instead of committing an invalid polygon.

A small number of baseline pairs contain repeated non-closure vertices. Before
creating an editing session, the workflow clones only the selected pair and
removes those duplicate vertices if that repair yields valid geometry. Canonical
metadata is not modified. If a pair cannot be safely normalized, the workflow
reports the condition instead of allowing a corrupt edit.

## Heatmap Module

The Commissioner heatmap is an optional MapCanvas feature, not a default map
behavior. Its implementation is isolated in `src/lib/map/heatmap.js`:

- `loadDemoSubmissionHeatmap()` loads the current committed demonstration
  fixture, `src/data/map/indexes/da_submissions.json`.
- `buildSubmissionHeatmapFillExpression()` creates the MapLibre fill-color
  expression.
- `createSubmissionHeatmapControl()` owns the control icon and accessibility
  state.
- `hasSubmissionHeatmapData()` prevents the feature from being mounted without
  data.

`DashboardHome.jsx` is the only current caller. It loads the fixture and passes
`heatmap` to its Commissioner `MapCanvas`; public-user MapCanvas instances do
not pass that prop and never create a heatmap control. MapCanvas also mounts the
control after either the map or asynchronous heatmap data becomes ready. This
fixes the prior race where the control could be omitted when the map initialized
before the fixture import completed.

The fixture is intentionally not a live submission aggregate. Replacing it
with a backend endpoint is contained to the heatmap loader contract and does
not require changes to MapCanvas layer logic.

## Main Frontend Responsibilities

| File | Responsibility |
| --- | --- |
| `src/components/non_prebuilt/MapCanvas.jsx` | MapLibre lifecycle, sources, layers, feature state, controls, and pointer handling. |
| `src/components/non_prebuilt/MapInfoPanel.jsx` | Responsive map-side information and workflow panel. |
| `src/lib/map/heatmap.js` | Optional Commissioner heatmap fixture loader, paint expression, and control. |
| `src/lib/map/interactionMode.js` | Explicit interaction permissions for browse and workflow modes. |
| `src/lib/map/objectionWorkflow.js` | Exact edge ownership, adjacency, shared boundaries, and pair exterior geometry. |
| `src/lib/map/counterProposalWorkflow.js` | JSTS validation, safe repair, drag constraints, and edit history. |
| `src/pages/UserHome.jsx` | Public workflow state and lazy metadata loading. |
| `src/pages/DashboardHome.jsx` | Commissioner map entry and the only heatmap injection point. |

## Operational Notes

- PMTiles requests require HTTP byte-range support. The local map asset service
  provides this for `.pmtiles` files.
- `VITE_GOOGLE_MAPS_API_KEY` is stored in the root `.env` file distributed
  through the project Google Drive shared folder. `.env` is Git-ignored and
  must not be committed; `.env.local` is not used by this project.
- The map remains usable without Google Map Tiles. Local electoral geometry and
  interaction do not depend on the basemap session.
- Current server routes and the next backend work are documented in
  [map-backend.md](./map-backend.md).

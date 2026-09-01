# Map Data

This directory contains the committed map assets used by the frontend and the
local Express asset server.

- `metadata/`: canonical DA geometry plus DA-level metadata, grouped by FED
- `render/`: browser-oriented PMTiles and label artifacts
- `reference/`: shared FED reference assets
- `manifests/`: runtime asset manifests and rollout tables
- `indexes/`: frontend/server lookup indexes
- `current-release.json`: pointer to the locally installed immutable authority
- `releases/<releaseId>/exact/`: byte-identical authority shards
- `releases/<releaseId>/indexes/`: random-access DGUID, FED, PRUID, and adjacency indexes
- `releases/<releaseId>/topology/`: sharded shared arcs, stable vertices, and display LODs

PMTiles remains the general-purpose basemap. Submission detail and
Counter-Proposal editing use the release-specific GeoJSON routes under
`/api/map/releases`; generating a new release does not rebuild PMTiles.

See [docs/Demo-3/map-architecture.md](../../../docs/Demo-3/map-architecture.md) for the full
production and runtime flow.

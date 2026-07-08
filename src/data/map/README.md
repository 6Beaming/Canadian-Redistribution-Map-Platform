# Map Data

This directory contains the committed map assets used by the frontend and the
local Express asset server.

- `metadata/`: canonical DA geometry plus DA-level metadata, grouped by FED
- `render/`: browser-oriented PMTiles and label artifacts
- `reference/`: shared FED reference assets
- `manifests/`: runtime asset manifests and rollout tables
- `indexes/`: frontend/server lookup indexes

See [docs/map-architecture.md](../../../docs/map-architecture.md) for the full
production and runtime flow.

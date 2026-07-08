# Map Architecture

## Overview

The map stack now uses a split data model:

1. `src/data/map/metadata/`
   Canonical local DA metadata shards, organized by FED.
   Each shard stores DA geometry together with the properties the frontend and
   future backend care about most: `DGUID`, `fed_num`, `geo_name`,
   `population`, panel labels, and provenance fields.

2. `src/data/map/render/`
   Browser delivery artifacts only.
   This is where the committed PMTiles and lightweight label GeoJSON files live.

3. `src/data/map/reference/`
   FED-wide reference assets shared by the production scripts and the runtime.

4. `src/data/map/manifests/` and `src/data/map/indexes/`
   Derived lookup files that keep runtime access fast without forcing the
   browser to load the editable metadata shards up front.

This repository no longer needs a single combined national DA GeoJSON file.
That file would be too large for comfortable GitHub storage and too expensive
for browser-side delivery. The repository keeps only per-FED metadata shards and
the PMTiles render bundle.

## Directory Layout

### `src/data/map/metadata/`

- One GeoJSON `FeatureCollection` per FED when the file stays under the GitHub
  size target.
- Multiple `fed_<FEDNUM>_partNN.geojson` shards when a FED would otherwise
  exceed the limit.
- These files are the local editable source used when the app needs exact DA
  geometry by `DGUID`.

### `src/data/map/render/`

- `da_boundaries_available.pmtiles`
- `da_labels_available.geojson`

These files are optimized for browser rendering. They are not the editing
source of truth.

### `src/data/map/reference/`

- `fed_boundaries_2023.geojson`
- `fed_boundaries_2023.pmtiles`
- `fed_labels.geojson`
- `fed_names_2023.json`

These files are stable FED-level references used by both the frontend and the
data build pipeline.

### `src/data/map/manifests/`

- `da_asset_manifest.json`
- `fed_rollout_plan.json`

These files tell the runtime which render bundle and metadata shards are
available for each FED.

### `src/data/map/indexes/`

- `da_profile_index.json`
- `da_submissions.json`

`da_profile_index.json` is the frontend/server lookup index for DA names,
population, labels, and other UI fields. It intentionally duplicates selected
metadata from the canonical shards because fast runtime lookup matters more than
strict normalization inside the client bundle.

## Why Metadata Is Sharded by FED

The app will eventually need to:

- look up original DA geometry locally by `DGUID`
- send edited DA geometry to the backend
- re-render a small set of affected DAs during review

Keeping metadata at FED scope provides a practical middle ground:

- small enough to keep each committed file under GitHub limits
- large enough to keep geometry, population, and naming together
- easy to lazy-load only the FED currently being inspected or edited

The frontend should not depend on a giant combined GeoJSON file for editing or
rendering.

## Production Pipeline

### 1. Build canonical metadata geometry

`scripts/reusable/build_da_metadata_geojson.py`

Inputs:

- raw Statistics Canada DA GeoPackages
- `src/data/map/reference/fed_boundaries_2023.geojson`

Output:

- `src/data/map/metadata/fed_<FEDNUM>.geojson`
- or `src/data/map/metadata/fed_<FEDNUM>_partNN.geojson`

This is the ingest step that creates the canonical local DA geometry grouped by
FED.

### 2. Enrich DA profiles

`scripts/reusable/collect_da_profiles.py`

Inputs:

- metadata shards
- local StatCan CSV files under `data/external/statcan/`
- optional StatCan WDS requests for missing population rows
- optional CSD spatial lookup requests for community naming

Output:

- `src/data/map/indexes/da_profile_index.json`

This step builds the runtime index for names, population, and display labels.

### 3. Sync profile fields back into canonical metadata

`scripts/reusable/sync_da_metadata.py`

Inputs:

- metadata shards
- `da_profile_index.json`

Output:

- rewritten metadata shards with merged UI properties
- shard splitting enforced to stay below the repository size limit

This step keeps geometry, population, geo name, and provenance together in the
same canonical FED-scoped files.

### 4. Build FED labels and rollout metadata

- `scripts/reusable/generate_fed_labels.py`
- `scripts/reusable/generate_fed_rollout_plan.mjs`

Outputs:

- `src/data/map/reference/fed_labels.geojson`
- `src/data/map/manifests/fed_rollout_plan.json`

### 5. Build browser render assets

`scripts/reusable/build_da_render_bundle.py`

Outputs:

- `src/data/map/render/da_boundaries_available.pmtiles`
- `src/data/map/render/da_labels_available.geojson`
- `src/data/map/manifests/da_asset_manifest.json`

This stage converts the committed metadata into the browser-friendly PMTiles
runtime bundle. The combined temporary GeoJSON used during PMTiles generation is
not meant to stay in the repository.

## Runtime Data Flow

### Toggle Off

- Google Map Tiles provides the geographic basemap and labels.
- Local rollout fills are hidden.
- Local FED and DA boundaries remain interactive.
- No local DA community labels are shown.

### Toggle On

- The map uses local rollout state from `fed_rollout_plan.json`.
- Local fill colors and blink behavior are enabled.
- Local FED and DA labels come from committed local artifacts.
- The browser still renders polygons from PMTiles, not from metadata GeoJSON.

### Editing Workflows

For `View Statistics`, `Make Comments`, `Make An Objection To Boundaries`, and
`Make A Counter-Proposal`, the app can lazy-load only the metadata shards for
the active FED.

That lets the runtime:

- render the full map from PMTiles
- keep exact DA geometry available for editing by `DGUID`
- avoid downloading every editable GeoJSON file on page load

## Temporary Browser Editing State

Current editing persistence is intentionally limited:

- comments and objections in this branch are front-end only and do not write to
  the backend
- the counter-proposal editor uses a temporary browser-side
  `counter-proposal-cache`
- that cache is cleared on refresh or workflow reset and should be treated as a
  prototype-only persistence layer

This temporary browser cache is the main place future backend work must replace
client-side state.

## Recommended Backend Integration

When the backend team adds persistence, the recommended flow is:

1. Use the local metadata shards as the original geometry lookup source.
2. Query the original two DAs by `DGUID`.
3. Persist edited GeoJSON for the affected DAs in the cloud database.
4. Persist derived population changes and proposal metadata beside the edited
   geometry.
5. During review, render:
   - local PMTiles for untouched areas
   - database-returned edited GeoJSON for the changed DAs

Suggested data boundary:

- local repository data continues to hold the baseline map metadata
- the database stores only proposal-specific overrides and review state

This keeps the baseline map reproducible while making proposal review auditable.

## Google Map Tiles API

The Google Map Tiles API key should stay in each developer's local environment:

- keep `VITE_GOOGLE_MAPS_API_KEY` in `.env.local`
- do not commit real keys
- allow `http://localhost:*` and `http://127.0.0.1:*` in Google Cloud Console

If the team shares one development key, each developer still needs to copy it
into their own local environment file.

## Repository Hygiene

Do commit:

- metadata shards
- render PMTiles and label artifacts
- reference files
- manifests and indexes

Do not commit:

- raw external StatCan CSV files
- CSD cache files
- temporary combined GeoJSON files
- Colab output folders or zip files
- temporary PMTiles build artifacts under `.tmp/`

## One-Time vs Reusable Scripts

- `scripts/reusable/` contains the scripts that can be rerun when new provinces,
  updated boundaries, or refreshed census inputs arrive.
- `scripts/one-time/` contains migration and audit helpers that were useful
  during the current repository transition but are not part of the normal data
  production loop.

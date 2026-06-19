# CRMP Sprint Report — Map MVP Delivery & Integration Plan

**Audience:** Project team only  
**Branch:** `feature/issues6-8/map-rendering-mvp`  
**Status:** Map MVP **deliverable** — standalone demo via Express; ready to merge into React apps.  
**Assumption:** `CRMP-full-data.zip` (audited 2026-06-19) **will not be updated** this cycle. Yukon DA census attributes come from **external StatCan downloads**, not the zip.  
**References:** `Actual_redist-mini-guide.md`, `Missing_Files.md`, `DATA_PROVENANCE.md`, `Proposal.pdf`

---

## 1. Team context — parallel workstreams

| Workstream | Owner(s) | Stack | Status |
|------------|----------|-------|--------|
| **Public User + Commissioner auth** | Auth team | Supabase | In progress |
| **Public User / Commissioner layout** | Frontend team | React + Express; `localStorage` | In progress |
| **Map rendering MVP** | Map team | MapLibre GL JS v4, PMTiles, static assets (`map-mvp/`) | **Complete — deliverable** |

The map MVP is vanilla JS under `map-mvp/`, served by **`server/index.js` (Express)** via `npm run dev:map`. Integration into both React frontends remains the next mandatory step for the full product.

### 1.1 Target architecture after merge

```text
React apps (Public User + Commissioner)
  └── Map module (from map-mvp/)
        ├── PMTiles FED base + Yukon DA layer
        ├── Labels + side panel + pilot gating
        └── Assignment helpers → localStorage / later Supabase API

Express (shared)
  ├── Static: map-mvp/data/* (PMTiles needs Range headers)
  └── REST /api/* → Supabase                    (TBD)
```

---

## 2. Delivered — map MVP

### 2.1 Scope

Standalone prototype for **Yukon pilot** (FED `60001`, **74 dissemination areas**) on a **national FED canvas** (343 districts). Reference implementation for React port.

### 2.2 Runtime behaviour

| Interaction | Behaviour |
|-------------|-----------|
| National view | 343 FED polygons from `fed_boundaries_2023.pmtiles` (GeoJSON fallback if PMTiles unavailable) |
| FED labels | 343 names from `fed_labels.geojson` (zoom 3–8) |
| Yukon DA layer | 74 polygons from `single_fed_das.geojson`; map labels from `yt_da_profiles.json` (zoom ≥ 8) |
| DA click — title | Named CSD: community name only (e.g. **Whitehorse**). Unorganized CSD: **Unnamed DA: DA {code}*** with footnote |
| DA click — details | `DGUID`, DA code, population (2021), FED `60001`, StatCan source links |
| Non-pilot FED | Side panel: riding name + **Coming Soon!** |
| Dev server | `npm run dev:map` → Express on `http://127.0.0.1:8080/` |

### 2.3 Raw bundle vs MVP data (audited architecture)

**`CRMP-full-data.zip` gaps (see `Missing_Files.md`):**

| Expected in zip | Actual | MVP impact |
|-----------------|--------|------------|
| `006_dissemination_areas/*.csv` (6 regional + `territories.csv`) | **0 of 6**; only `*_geo_index.csv` stubs | No in-zip DA population / names |
| `profile_2021/raw/` (4 StatCan products) | Present but **not DA-level** (CSD / ER only) | Cannot substitute for `006` |
| `{prov}_dissemination_areas.gpkg` | Missing for `on`, `qc`, `ns`, `nb`, `nt`, `nu` | No national DA layer |
| `029_feds_2023ro/` | Absent | No FED census profile panel |

**MVP runtime assets (`map-mvp/data/`):**

| File | Role | Source |
|------|------|--------|
| `fed_boundaries_2023.pmtiles` | FED geometry (no embedded names) | Bundle → copied |
| `fed_boundaries_2023.geojson` | FED fallback if PMTiles probe fails | Same boundaries |
| `single_fed_das.geojson` | Yukon DA polygons (`DGUID` + geometry only) | `scripts/extract_mvp_data.ipynb` |
| `fed_labels.geojson` | FED label points | `scripts/generate_fed_labels.py` |
| `yt_da_profiles.json` | Per-DA population, CSD community, panel titles | `scripts/collect_yt_da_profiles.py` |

**External inputs (not in zip, not loaded at runtime):**

| Input | Product | Purpose |
|-------|---------|---------|
| `98-401-X2021006` Territories CSV | StatCan Census Profile | DA population + DAUID (`GEO_NAME` in CSV) |
| StatCan ArcGIS CSD layer | 2021 boundary web service | Community name at DA centroid |
| `scripts/data/fed_names_2023.json` | Elections Canada 2023 RO list (343) | FED map labels |

**Collection pipeline (validated 74/74):**

```bash
python scripts/collect_yt_da_profiles.py \
  --csv scripts/data/external/statcan/98-401-X2021006_English_CSV_data_Territories.csv
python scripts/collect_yt_da_profiles.py --finalize-only   # relabel only
python scripts/generate_fed_labels.py                        # optional FED label refresh
```

No nearest-neighbour heuristics. **Unorganized** CSDs (5 DAs) use `Unnamed DA: DA {code}` + `*` footnote per StatCan geography rules.

**Deferred (not MVP):** `scripts/data/bundle/compare_fed_names.py` — FED name audit vs bundle GPKG merge; run when DB migration starts.

### 2.4 Code layout

| Path | Role |
|------|------|
| `server/index.js` | Express static server + byte-range headers for PMTiles |
| `map-mvp/js/map.js` | Map init, layers, selection, hover |
| `map-mvp/js/panel.js` | DA / FED side panel |
| `map-mvp/js/labels.js` | FED + DA labels; profile lookup |
| `map-mvp/js/districts.js` | Assignment stub (`localStorage`) |
| `scripts/collect_yt_da_profiles.py` | Build / refresh `yt_da_profiles.json` |
| `scripts/generate_fed_labels.py` | Build `fed_labels.geojson` |
| `scripts/extract_mvp_data.ipynb` | Export Yukon DA geometry from bundle |
| `scripts/audit_data_schema.py` | Bundle inventory (Colab notebook available) |

**Removed from MVP:** `map-mvp/serve.py`, `derive_from_bundle.py`, `generate_map_labels.py`, `place_labels_*.geojson`, `scripts/data/yukon_places.json`, bundle MANIFEST / slim-copy pipeline.

### 2.5 How to run the demo

```bash
npm install
npm run dev:map
# Open http://127.0.0.1:8080/
```

PMTiles requires the Express server (Range requests). Do not open `index.html` directly from disk.

### 2.6 React merge checklist

1. Extract `MapView` from `map.js` / `labels.js` lifecycle.
2. Replace `panel.js` DOM with React state (`onDaSelect`, `onFedSelect`).
3. Serve `map-mvp/data/` from integrated static path with Range headers.
4. Namespace `localStorage` keys with app convention.
5. Ship committed `yt_da_profiles.json`; re-run collect script only when refreshing census data.

---

## 3. Proposal use cases vs data gaps

### UC1 — View regions, statistics, redraw

| Capability | Available now | Blocked by |
|------------|---------------|------------|
| National FED map + labels | Yes | — |
| Yukon DA click → population + community label | Yes (74/74 profiles) | — |
| Yukon redraw / validation | Geometry only | Adjacency graph not built |
| Other provinces — DA detail | No | Missing DA GPKG + `006` CSVs |
| FED statistics panel | No | `029_feds_2023ro/` absent |

### UC2 — Submissions / counter-proposals

| Capability | Available now | Blocked by |
|------------|---------------|------------|
| Map-linked IDs (`DGUID`, `fed_num`) | Yukon yes | — |
| Server persistence | No | Supabase + API TBD |

### UC3 — Commissioner review

| Capability | Available now | Blocked by |
|------------|---------------|------------|
| Embedded map (post-merge) | After React integration | — |
| Live submission inbox | No | DB + API TBD |

---

## 4. Supabase plan (when DB deploy proceeds)

**Timeline:** TBD — not a blocker for map MVP demo or React merge.

| Table | Seed from |
|-------|-----------|
| `fed_ref` | `fed_names_2023.json` |
| `das` | `yt_da_profiles.json` + `single_fed_das.geojson` |
| `yt_adjacency` | Offline build from DA polygons |
| `submissions`, `assignments`, `commissioner_notes` | App layer |

Keep PMTiles and GeoJSON **static** on Express; do not load raw StatCan CSVs into Postgres.

---

## 5. Next sprint priorities

### Required — product integration

| # | Task |
|---|------|
| M1 | Merge map module into Public User React app |
| M2 | Merge map module into Commissioner React app |
| M3 | Shared `MapView` component |
| M4 | Express serves integrated static assets + Range |
| M5 | Map events → React panel state |
| M6 | Align `localStorage` key namespace |
| M7 | Pilot disclaimer copy in UI |

### TBD — backend

| # | Task |
|---|------|
| D1 | Deploy Supabase schema |
| D2 | Seed from `yt_da_profiles.json` |
| D3 | Express `/api/*` routes |
| D4–D6 | Submissions persistence, validation, commissioner inbox |

### Out of scope (this cycle)

- National DA interaction beyond Yukon
- Repacking `CRMP-full-data.zip`
- FED GPKG name audit (`compare_fed_names.py`) until DB phase
- Synthetic / heuristic census data

---

## 6. Risk register

| ID | Risk | Mitigation |
|----|------|------------|
| R1 | React merge conflicts | Shared `MapView`; merge early |
| R2 | PMTiles break after path change | Test Range `206` after merge |
| R3 | Port / host confusion | Document `127.0.0.1:8080`; single `npm run dev:map` |
| R4 | `localStorage` key collisions | Namespace at merge (M6) |
| R5 | Stakeholders expect DB submissions | Demo script; label persistence as “coming soon” |
| R6 | Unorganized DA naming confusion | `*` footnote + `Unnamed DA` title pattern |
| R7 | Many DAs share “Whitehorse” on map | Map labels use DA code when CSD count > 3 |
| R8 | National DA expectations | Pilot disclaimer; Yukon-only path |

---

## 7. Document history

| Date | Change |
|------|--------|
| 2026-06-19 | Initial audit-driven report |
| 2026-06-19 | External DA profile pipeline; bundle pipeline removed |
| 2026-06-19 | React merge requirements; Supabase TBD |
| 2026-06-19 | **Delivery sign-off:** 74/74 profiles, CSD labels, panel UI, Express-only server, file cleanup |

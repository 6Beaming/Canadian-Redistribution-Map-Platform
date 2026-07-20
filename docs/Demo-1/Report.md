# CRMP Project Report — Data Architecture & MVP Overview

**Audience:** Project team  
**Branch:** `feature/map-mvp-and-frontend-merging`  
**Sprint delivery details:** See `Demo_1_Log.md`  
**Data references:** `Actual_redist-mini-guide.md`, `Missing_Files.md`, `DATA_PROVENANCE.md`, `Proposal.pdf`

---

## 1. Product vision

The Canadian Redistribution Map Platform (CRMP) is a map-centered web application for federal electoral boundary review. Citizens view proposed maps, submit feedback, and optionally propose boundary changes. Independent boundary commissioners review submissions through a secure dashboard.

**Planned user surfaces:**

| Surface | Primary users | Core features |
|---------|---------------|---------------|
| **Public User** | Citizens | Interactive map, region statistics, feedback / counter-proposals |
| **Commissioner** | Boundary commissioners | Submission review, analytics, map context |

---

## 2. Technical architecture (current)

```text
React app (Vite :5173)
  ├── src/components/ui          — shadcn prebuilt components
  ├── src/components/non_prebuilt — team-built components (map, graphs)
  ├── src/pages                  — route shells
  ├── src/data/map               — local map assets (GeoJSON, PMTiles, profiles)
  ├── src/lib/map                — map constants, profile helpers, label layout
  └── src/services/mapApi.js     — map API client

Express API (:3000)
  ├── /api/auth/*                — Supabase session (incomplete)
  └── /api/map/*                 — map-api-service (assets, profiles, assignments)

scripts/                         — data audit & collection (unchanged)
```

**Stack:** React, MapLibre GL JS, PMTiles, Express, Supabase (planned DB), Tailwind/shadcn.

---

## 3. Data architecture

### 3.1 Canonical source

Primary reference dataset: **`CRMP-full-data.zip`** (audited 2026-06-19). Expected layout documented in bundle `README.md` / `redist-mini-guide.md`. Actual contents vs gaps: `Actual_redist-mini-guide.md`, `Missing_Files.md`.

### 3.2 Critical bundle gaps

| Layer | Expected | Actual impact |
|-------|----------|---------------|
| DA profile CSVs (`006_dissemination_areas/*.csv`) | 6 regional files | No in-bundle DA population join |
| DA GeoPackages | 13 provinces/territories | 6 missing (`on`, `qc`, `ns`, `nb`, `nt`, `nu`) |
| FED 2023 RO profiles (`029_feds_2023ro/`) | Full product | No FED census statistics panel |
| Raw `profile_2021/raw/` zips | Sometimes assumed DA-level | CSD / ER only — not DA rows |

### 3.3 Runtime map assets (`src/data/map/`)

Committed assets power the integrated map module (Yukon pilot):

| Asset | Role |
|-------|------|
| `fed_boundaries_2023.pmtiles` | National FED geometry |
| `single_fed_das.geojson` | Yukon DA polygons |
| `fed_labels.geojson` | FED riding names |
| `yt_da_profiles.json` | DA population + community labels (external StatCan collection) |

Regenerate via `scripts/` collectors; provenance in `DATA_PROVENANCE.md`.

### 3.4 Future database plan

When Supabase deploys: seed reference tables (`fed_ref`, `das`, adjacency) from committed JSON/GeoJSON; keep large geometries as static files served with byte-range. Submissions and assignments move from local/API stub to Postgres.

---

## 4. MVP capability matrix

| Capability | Status | Blocker |
|------------|--------|---------|
| National FED map + labels | **Yes** | — |
| Adaptive FED / DA map labels | **Yes** | — |
| Yukon DA detail (74 DAs) | **Yes** | — |
| Map embedded in React app | **Yes** | See `Demo_1_Log.md` |
| Public User feedback flow | No | App shell + DB |
| Commissioner live inbox | No | DB + API |
| Auth / roles | Incomplete | Supabase integration |
| National DA interaction | No | Missing GPKG + `006` CSVs |
| Redistricting validation | No | Adjacency graph |

---

## 5. Risk register (project-wide)

| ID | Risk | Mitigation |
|----|------|------------|
| R1 | Incomplete raw bundle | External StatCan collection for pilot; document gaps |
| R2 | PMTiles path / Range regression | Test 206 after any static path change |
| R3 | Parallel frontend architectures | Shared `non_prebuilt` components; map-api-service isolation |
| R4 | Auth delay blocks role routing | Open dashboard for demo; guard routes later |
| R5 | Script output paths vs `src/data/map` | Align collectors in follow-up sprint |

---

## 6. Document history

| Date | Change |
|------|--------|
| 2026-06-19 | Initial audit-driven report |
| 2026-06-19 | Sprint delivery content moved to `Demo_1_Log.md`; report refocused on project data architecture |
| 2026-06-17 | Added `src/lib/map` and adaptive label capability to architecture / MVP matrix |

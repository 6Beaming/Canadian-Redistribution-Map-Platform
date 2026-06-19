# CRMP Sprint Report — Map MVP Delivery & Integration Plan

**Audience:** Project team only  
**Sprint outcome:** Map rendering MVP on branch `feature/issues6-8/map-rendering-mvp` is **complete** and ready to merge as a **sub-feature** into the main React applications.  
**Assumption:** `CRMP-full-data.zip` (audited 2026-06-19) **will not be updated** during the remainder of this development cycle.  
**References:** `Actual_redist-mini-guide.md`, `Missing_Files.md`, `Proposal.pdf`

---

## 1. Team context — parallel workstreams

Development is no longer a single standalone `map-mvp/` spike. Other teammates are actively building the application shell:

| Workstream | Owner(s) | Stack | Status |
|------------|----------|-------|--------|
| **Public User + Commissioner auth** | Auth team | Supabase (registration, login, sessions) | In progress |
| **Public User frontend layout** | Frontend team | React + Express; shell components; state in `localStorage` | In progress |
| **Commissioner frontend layout** | Frontend team | React + Express; dashboard shell; state in `localStorage` | In progress |
| **Map rendering MVP** | Map team | MapLibre GL JS v4, PMTiles, static GeoJSON (`map-mvp/`) | **Complete — this branch** |

The main app already uses **React + Express** per README. The map MVP was intentionally built as vanilla JS under `map-mvp/` to unblock rendering; **integration into both React frontends is the mandatory close-out task for this sprint.**

### 1.1 What changes after merge

```text
┌──────────────────────────────────────────────────────────────────┐
│  React apps (Public User + Commissioner) — parallel branches     │
│  • Supabase Auth (login / register)                              │
│  • App shell, routing, layout components                         │
│  • UI state → localStorage (existing team convention)          │
└────────────────────────────┬─────────────────────────────────────┘
                             │ embed as sub-feature (THIS SPRINT)
┌────────────────────────────▼─────────────────────────────────────┐
│  Map module (from map-mvp/)                                      │
│  • MapLibre map + PMTiles FED base + Yukon DA layer              │
│  • Labels, side panel, pilot-region gating                       │
│  • Assignment helpers → align with app localStorage / later API  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  Express server (shared)                                         │
│  • Static assets incl. PMTiles (Range headers) — exists today    │
│  • REST API routes → Supabase          (TBD — see §5)            │
└──────────────────────────────────────────────────────────────────┘
```

**Division of responsibility:**

| Concern | This sprint (required) | Timeline TBD |
|---------|------------------------|--------------|
| Map UI inside React apps | **Yes — merge & embed** | — |
| Auth flows | Auth team (already underway) | — |
| App layout / navigation | Frontend team (already underway) | — |
| Supabase **database** deploy (schema, seed ETL) | — | **TBD** — this sprint if capacity; else next sprint |
| Express **API** refactor (`/api/*` → Supabase) | — | **TBD** — this sprint if capacity; else next sprint |

Until the API layer lands, map-related persistence can continue via **`localStorage`** (consistent with the current frontend convention) or Supabase client calls from React if auth team exposes helpers — but **server-side validation and commissioner data access remain blocked** without the API + DB work.

---

## 2. What we shipped (map MVP branch)

### 2.1 Scope

A **standalone map prototype** under `map-mvp/` proving the interaction model for one pilot region (**Yukon**, FED `60001`, **74 dissemination areas**) on a **national FED canvas** (343 districts). It is the reference implementation to port into React.

### 2.2 Runtime behaviour

| Interaction | Behaviour |
|-------------|-----------|
| National view | 343 FED polygons from PMTiles (`fed_boundaries_2023.pmtiles`) on a white basemap |
| FED labels | 343 riding names at centroids (`fed_labels.geojson`), zoom 3–8 |
| Yukon zoom-in | 74 DA polygons (`single_fed_das.geojson`); community labels (`place_labels_yt.geojson`), zoom ≥ 8 |
| DA click | Yellow highlight + side panel: `DGUID`, `C1_COUNT_TOTAL`, FED hint |
| Non-pilot FED click | Side panel: **“Coming Soon!”** + `fed_num` |
| Dev server | Express (`npm run dev:map`) with HTTP Range support for PMTiles |

### 2.3 Implementation assets

| Asset | Role |
|-------|------|
| `map-mvp/js/map.js` | Map init, layers, byte-range probe, click handlers |
| `map-mvp/js/panel.js` | Side panel content (replaceable by React panel component) |
| `map-mvp/js/labels.js` | FED + place symbol layers |
| `map-mvp/js/districts.js` | Assignment table helpers (stub — wire on merge) |
| `map-mvp/data/*` | PMTiles, GeoJSON, label layers |
| `scripts/extract_mvp_data.ipynb` | Colab → Yukon DA export |
| `scripts/generate_map_labels.py` | Offline label generation from bundle CSVs |

Population join uses **`profile_2021/raw/*_English_CSV_data.csv`**, not the missing canonical `006_dissemination_areas/*.csv` files.

### 2.4 Integration notes for React merge

When embedding into Public User and Commissioner apps:

1. **Extract a `MapView` React component** — wrap MapLibre init lifecycle (`useRef` + `useEffect`); import logic from `map.js` / `labels.js` or convert incrementally.
2. **Replace `panel.js` DOM writes** with React state passed from map click events (`onDaSelect`, `onFedSelect`).
3. **Static asset paths** — serve `map-mvp/data/` from Express `public/` (or copy into React `public/data/`); PMTiles **requires** Range headers on the same origin.
4. **Side panel placement** — Commissioner layout may use a different shell; map module should expose **events + props**, not hard-coded `#side-panel` IDs.
5. **`districts.js`** — align `localStorage` key namespace with app convention (e.g. `crmp-assignment-v1`); later swap writer to Supabase when API exists.
6. **Auth gate** — Public User map can render logged-in or anonymous per auth team; Commissioner map route stays behind commissioner role check (auth team).

---

## 3. Proposal use cases vs missing data

From **Proposal.pdf**, mapped against `Missing_Files.md` and the **integrated** (not standalone) product.

### UC1 — View regions, statistics, and redraw (citizen)

| Capability | Data required | Available now | Blocked by |
|------------|---------------|---------------|------------|
| Pan/zoom national FED map | PMTiles 2023 | Yes | — |
| FED name labels | Derived labels | Yes | `029_feds_2023ro/` absent — mitigated |
| Click DA → population | DA + profile join | **Yukon only** | 6 provinces missing DA GPKG |
| Redraw / reassign DAs | DA layer + assignment | Yukon geometry | No national DA layer; adjacency not built |
| FED-level statistics panel | `029_feds_2023ro/` | No | Folder absent |

**Impact:** UC1 demonstrable **in Yukon** inside the Public User React app after merge. National context works; DA detail outside pilot region does not.

### UC2 — Submit comments, objections, counter-proposals (citizen)

| Capability | Data required | Available now | Blocked by |
|------------|---------------|---------------|------------|
| Map-linked submission UI | `DGUID`, `fed_num` | Yukon IDs valid | — |
| Persist submission | Supabase `submissions` + API | Auth in progress; **DB/API TBD** | Schema not deployed yet |
| Valid counter-proposal populations | Per-DA census | Yukon (post-join) | Missing provinces |

**Impact:** Submission **forms and layout** can ship in React with `localStorage` drafts; **server persistence** waits on DB + API sprint (TBD).

### UC3 — Commissioner review (official)

| Capability | Data required | Available now | Blocked by |
|------------|---------------|---------------|------------|
| Commissioner login | Supabase Auth | Auth team — in progress | — |
| Dashboard layout | React shell | Frontend team — in progress | — |
| Map context in review flow | Embedded map module | **After merge this sprint** | — |
| Inbox / export from DB | Supabase tables + API | **TBD** | DB not deployed |

**Impact:** Commissioner app can show **layout + embedded map** this sprint; live submission inbox requires DB + API (TBD).

### Gap summary (`Missing_Files.md`)

| Missing item | Scope | Features affected |
|--------------|-------|-------------------|
| `{prov}_dissemination_areas.gpkg` | `on`, `qc`, `ns`, `nb`, `nt`, `nu` | UC1 redraw, UC2 counter-proposals nationally |
| `006_dissemination_areas/*.csv` | 0 of 6 canonical files | Join path (workaround exists in `raw/`) |
| `029_feds_2023ro/` | Entire folder | FED statistics panel |
| Ontario boundary stack | Nearly empty `on/` | Ontario persona demos |

---

## 4. Supabase data plan (when DB deploy proceeds)

**Quota:** ~500 MB PostgreSQL; reserve **≥ 350 MB** for user rows.  
**Timeline:** **TBD** — design is ready; deployment and ETL are **not sprint blockers** for map merge.

### 4.1 Tables to upload (derived, slim)

| Table | Purpose | Yukon MVP size |
|-------|---------|----------------|
| `fed_ref` | `fed_num`, `fed_name_en`, `prov_code` | 343 rows |
| `das` | `dguid`, `fed_num`, `pop_2021`, `geo_name`, `data_quality`, optional `geom` | 74 rows |
| `yt_adjacency` | Contiguity edges for validation | ~O(74 × degree) |
| `assignments` | User → `district_id` per `dguid` | grows with users |
| `submissions` | UC2 public input | grows with users |
| `commissioner_notes` | UC3 internal tags / notes | grows with review volume |

Column-level detail unchanged from prior audit — see `Actual_redist-mini-guide.md` for source file mapping (`yt_dissemination_areas.gpkg`, `*_English_CSV_data.csv`, `fed_names_2023.json`).

### 4.2 Keep static (do not load into Postgres)

| Asset | ~Size | Serve via Express static |
|-------|-------|--------------------------|
| `fed_boundaries_2023.pmtiles` | 29 MB | Yes — Range required |
| `single_fed_das.geojson` | 2 MB | Yes |
| Label GeoJSON | < 0.1 MB | Yes |
| Raw profile CSVs | 100+ MB | No — pre-join in Colab only |
| `polling_districts_results_*.csv` | 528 MB | Omit |

### 4.3 ETL sequence (when DB sprint starts)

1. Verify Yukon profile join (74/74 `DGUID`s).
2. Seed `fed_ref`, `das`, `yt_adjacency`.
3. Apply migrations for `submissions`, `assignments`, `commissioner_notes`.
4. Add Express `/api/*` routes — **API refactor bundled with this work**.

---

## 5. Delivery strategies (data / geography)

Unchanged recommendation: **extend Yukon pilot** with real census data; national map as context; graceful degradation elsewhere.

| Strategy | Summary | When |
|----------|---------|------|
| **Primary — Yukon pilot** | Real geometry + population in FED `60001`; “Coming Soon” elsewhere | Current + next sprints |
| **Alt A — National placeholders** | Use 7 provinces with DA GPKG + FED-level stats elsewhere; `data_quality` flags | Only if stakeholders require multi-province demo |
| **Alt B — Fabricate data** | Synthetic DAs / populations | **Reject** for production |

Strategy choice affects **map data and validation**, not the **React merge** — merge proceeds regardless.

---

## 6. Sprint plan — priorities

### 6.1 Required this sprint

| # | Task | Owner | Done when |
|---|------|-------|-----------|
| **M1** | **Merge `feature/issues6-8/map-rendering-mvp` into Public User React app** | Map + Frontend | Map renders in app route; assets served with Range |
| **M2** | **Merge same map module into Commissioner React app** | Map + Frontend | Map available in commissioner map/review route |
| **M3** | Extract reusable `MapView` (or equivalent) shared by both apps | Map | Single module; props for panel slot / callbacks |
| **M4** | Express static config serves PMTiles from integrated `public/data/` | DevOps / Backend | `127.0.0.1` dev URL documented; no `localhost` port conflicts |
| **M5** | Wire map click events to React state (replace `panel.js` DOM) | Frontend | DA / FED selection visible in app UI |
| **M6** | Align assignment `localStorage` key with app convention | Frontend | No key collisions between shell and map |
| **M7** | Pilot copy: “Yukon pilot region” in Public User map view | Product | Visible disclaimer |

**Auth integration (parallel — auth team):** Map routes consume existing Supabase session; no duplicate auth implementation on map branch.

**Layout integration (parallel — frontend team):** Map mounts inside existing shell components; commissioner vs public routes per their layouts.

### 6.2 TBD — this sprint if capacity, else next sprint

| # | Task | Dependency |
|---|------|--------------|
| **D1** | Deploy Supabase schema (`fed_ref`, `das`, `yt_adjacency`, `submissions`, `assignments`, `commissioner_notes`) | — |
| **D2** | Yukon ETL / seed scripts | D1 |
| **D3** | Express API refactor: `/api/submissions`, `/api/assignments`, commissioner read endpoints | D1, Auth |
| **D4** | Replace `localStorage` submission drafts with API persistence | D3 |
| **D5** | Backend validation (population equality, contiguity) | `yt_adjacency` seeded |
| **D6** | Commissioner inbox fed from `submissions` table | D3, D4 |

If the sprint ends before D1 starts, **no regression**: merged React apps still demo map + auth + layout with client-side state only.

### 6.3 Explicitly out of scope (this cycle)

- National DA interaction beyond Yukon
- Fabricated census data (Alt B)
- Uploading 528 MB poll-results CSV to Supabase
- Full Ontario stack without `on_dissemination_areas.gpkg`

---

## 7. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | Map merge conflicts with parallel React layout branches | High | High | Shared `MapView` module; merge early; pair program with frontend team |
| R2 | PMTiles break after asset path change in React `public/` | Medium | High | Keep Range headers on Express; test `bytes=0-1` → 206 after merge |
| R3 | Duplicate Express servers on port 8080 (`localhost` vs `127.0.0.1`) | Medium | Medium | Single `npm run dev`; document `127.0.0.1`; kill stale processes |
| R4 | Map `localStorage` keys collide with app shell keys | Medium | Medium | Namespace convention agreed at merge (M6) |
| R5 | Stakeholders expect DB-backed submissions at sprint demo | Medium | Medium | Demo script: map + auth + layout; label persistence as “coming soon” if D1–D4 slip |
| R6 | Auth ready but no API — users logged in with nowhere to POST | Medium | Low | `localStorage` drafts; disable submit or show “save locally” until D4 |
| R7 | Wrong Yukon census product in profile join | Medium | High | Validate 74/74 `DGUID`s; `data_quality` column when D1 lands |
| R8 | Commissioner map shown without submission data | Low | Low | UC3 inbox is TBD; map embed still valuable for geographic context |
| R9 | Ontario / national DA expectations | High | High | Pilot disclaimer; Yukon demo path |
| R10 | Supabase quota exceeded when D1 proceeds | Medium | Medium | Static geometry; slim rows; no raw CSV in DB |

---

## 8. Document history

| Date | Change |
|------|--------|
| 2026-06-19 | Initial audit-driven report |
| 2026-06-19 | MVP delivery, use cases, Supabase plan, data strategies |
| 2026-06-19 | Parallel auth/layout workstreams; React merge as sprint requirement; DB + API marked TBD |

*Update when map merge completes, DB deploy starts, or delivery strategy changes.*

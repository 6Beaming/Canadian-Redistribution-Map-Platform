# CRMP Sprint Report — Map MVP Delivery & Data Strategy

**Audience:** Project team only  
**Sprint outcome:** Map rendering MVP on branch `feature/issues6-8/map-rendering-mvp` is **complete and deliverable** for this cycle.  
**Assumption:** `CRMP-full-data.zip` (audited 2026-06-19) **will not be updated** during the remainder of this development cycle.  
**References:** `Actual_redist-mini-guide.md`, `Missing_Files.md`, `Proposal.pdf`

---

## 1. What we shipped (MVP branch)

### 1.1 Scope

The sprint delivers a **standalone map MVP** under `map-mvp/` — not the full React application yet. It proves the core map interaction model for one pilot region (**Yukon**, FED `60001`, **74 dissemination areas**) against a **national FED context** (343 districts).

### 1.2 Runtime behaviour

| Interaction | Behaviour |
|-------------|-----------|
| National view | 343 FED polygons from PMTiles (`fed_boundaries_2023.pmtiles`) on a white basemap |
| FED labels | 343 riding names at centroids (`fed_labels.geojson`), zoom 3–8 |
| Yukon zoom-in | 74 DA polygons (`single_fed_das.geojson`); community labels (`place_labels_yt.geojson`), zoom ≥ 8 |
| DA click | Yellow highlight + side panel: `DGUID`, `C1_COUNT_TOTAL`, FED hint |
| Non-pilot FED click | Side panel: **“Coming Soon!”** + `fed_num` |
| Dev server | Express (`npm run dev:map`) with HTTP Range support for PMTiles |

### 1.3 Implementation strategy (this branch)

```text
┌─────────────────────────────────────────────────────────────┐
│  Static assets (map-mvp/data/)                              │
│  • fed_boundaries_2023.pmtiles  — national FED base         │
│  • single_fed_das.geojson       — Yukon DAs (Colab export)│
│  • fed_labels / place_labels    — derived label layers      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  map-mvp/js/  — MapLibre GL JS v4 + pmtiles protocol        │
│  map.js       — layers, byte-range probe, interactions      │
│  panel.js     — side panel content                          │
│  labels.js    — FED + place symbol layers                   │
│  districts.js — assignment helpers (stub, not wired)        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  server/index.js (Express) — static host + Range headers    │
└─────────────────────────────────────────────────────────────┘
```

**Key design choices:**

1. **Pre-join census in Colab** — browser reads slim GeoJSON, not multi-MB CSVs.
2. **PMTiles for national FED** — one ~29 MB file; GeoJSON fallback if byte serving fails.
3. **Pilot gating in UI** — full DA interaction only inside Yukon; other regions degrade gracefully.
4. **Label pipeline offline** — `scripts/generate_map_labels.py` reads bundle CSVs + reference JSON; no runtime external APIs.
5. **Express over Python** — aligns with README tech stack; same Range semantics for PMTiles.

### 1.4 Data pipeline (verified path)

| Step | Tool | Output |
|------|------|--------|
| Extract Yukon DAs + population | `scripts/extract_mvp_data.ipynb` (Colab) | `map-mvp/data/single_fed_das.geojson` |
| Generate map labels | `scripts/generate_map_labels.py` | `fed_labels.geojson`, `place_labels_yt.geojson` |
| Audit bundle vs schema | `scripts/audit_data_schema.py` | `data_schema_audit_report.txt` |

Population join uses **`profile_2021/raw/*_English_CSV_data.csv`** (actual bundle path), not the missing canonical `006_dissemination_areas/*.csv` files.

### 1.5 Explicitly deferred (post-MVP / next sprint)

- React app shell, D3 integration, Supabase auth
- DA click → redistricting colour cycling + persistence (`districts.js` exists but unwired)
- Commissioner dashboard (UC3)
- Submission API and validation backend (UC2)
- Contiguity graph and population-equality validation
- National DA interaction beyond Yukon

---

## 2. Proposal use cases vs missing data

From **Proposal.pdf**, three public-facing use-case groups map to our data reality as follows.

### UC1 — View regions, statistics, and redraw (Mark Thompson, citizen)

| Capability | Data required | Available now | Blocked by (`Missing_Files.md`) |
|------------|---------------|---------------|----------------------------------|
| Pan/zoom national FED map | `fed_boundaries_2023.pmtiles` | Yes | — |
| FED name labels | FED centroids + name lookup | Yes (`fed_labels.geojson`) | `029_feds_2023ro/` absent — mitigated by derived names |
| Click DA → population panel | DA polygons + profile join on `DGUID` | **Yukon only** | `{on,qc,ns,nb,nt,nu}_dissemination_areas.gpkg` missing |
| Click FED → riding statistics | FED-level 2023 profiles | No | `029_feds_2023ro/` missing |
| Redraw / reassign DAs | DA layer + assignment + pop sums | Yukon geometry only | No DA layer in 6 provinces/territories; adjacency not precomputed |
| Historical boundary toggle | PMTiles 2003 / 2015 / 2023 | Visual layers present | 2003 PMTiles lack `fed_num`; limited identify |
| Community labels | Geo index or `GEO_NAME` in profiles | Yukon labels shipped | `016_028` has no `yt`; territories index needs coord join |

**Sprint impact:** UC1 is **demonstrable end-to-end in Yukon**. National map context works; per-riding DA statistics and redraw are **not** deliverable outside provinces with complete DA stacks.

### UC2 — Submit comments, objections, counter-proposals (citizen)

| Capability | Data required | Available now | Blocked by |
|------------|---------------|---------------|------------|
| Attach submission to map feature | Stable IDs (`DGUID`, `fed_num`) | Yukon `DGUID`s valid | — |
| Counter-proposal with valid populations | Per-DA `C1_COUNT_TOTAL` | Yukon (after profile join) | Missing DA layers + profiles for 6 provinces |
| Objection tied to specific boundary segment | FED/DA geometry + metadata | Yukon DAs only | Ontario / Quebec stacks largely absent |

**Sprint impact:** Submission **UI and schema** can be built against Yukon IDs. Accepting counter-proposals for Ontario (persona Mark) requires either **data repack** or a **placeholder / pilot-region policy**.

### UC3 — Commissioner review, tagging, export (Richard Jefferson)

| Capability | Data required | Available now | Blocked by |
|------------|---------------|---------------|------------|
| Inbox of public submissions | Supabase tables (app layer) | Not implemented | — |
| Filter by riding / province | `fed_ref` + submission `fed_num` | FED reference derivable | No national DA coverage metadata in DB yet |
| Live population stats on proposals | Join submissions → `das` table | Yukon rows possible | National `das` table incomplete |
| Export for commission record | Submissions + derived stats | App feature | Exporting placeholder populations is misleading |

**Sprint impact:** Dashboard can launch on **Yukon-filtered submissions**. A national commissioner view without coverage badges would misrepresent product readiness.

### Summary: `Missing_Files.md` gap catalogue → future features

| Missing item | Count / scope | Features most affected |
|--------------|---------------|------------------------|
| `{prov}_dissemination_areas.gpkg` | 6 provinces/territories (`on`, `qc`, `ns`, `nb`, `nt`, `nu`) | UC1 redraw, UC1 DA stats, UC2 counter-proposals |
| `006_dissemination_areas/*.csv` (canonical names) | 0 of 6 regional files | UC1 population join path (workaround: `raw/*_English_CSV_data.csv`) |
| `029_feds_2023ro/` | Entire folder | UC1 FED-level statistics panel |
| `012_adas/` profiles | Absent | Alternative building-block path (low priority) |
| Ontario boundary stack | Nearly empty `on/` | UC1/UC2 for largest user persona (Ontario) |
| Full `profile_2021/` product CSVs | Geo-index stubs only in several folders | Enriched demographics beyond population |

---

## 3. Supabase upload plan (from actual bundle)

**Quota constraint:** ~500 MB total PostgreSQL; reserve **≥ 350 MB** for user-generated rows (submissions, assignments, commissioner notes).

### 3.1 Upload to Supabase (relational / queryable)

These are **derived, slim tables** — not raw zip contents.

#### `fed_ref` — federal electoral district reference

| Column | Type | Source |
|--------|------|--------|
| `fed_num` | `text` PK | `fed_boundaries_2023.pmtiles` / GeoJSON `fed_num` |
| `fed_name_en` | `text` | `scripts/data/fed_names_2023.json` or `fed2021_*_polling_districts.gpkg` `ed_name` |
| `prov_code` | `text` nullable | PMTiles `prov_code` where present |

~343 rows, ≪ 1 MB.

#### `das` — dissemination areas (pilot: Yukon first)

| Column | Type | Source |
|--------|------|--------|
| `dguid` | `text` PK | `yt_dissemination_areas.gpkg` → `single_fed_das.geojson` |
| `fed_num` | `text` FK → `fed_ref` | Spatial join: Yukon FED `60001` |
| `pop_2021` | `integer` | `*_English_CSV_data.csv`, `CHARACTERISTIC_ID = 1` |
| `geo_name` | `text` nullable | Profile `GEO_NAME` or `territories_geo_index.csv` |
| `data_quality` | `text` | `verified` \| `placeholder` — audit flag |
| `geom` | `geometry(Polygon, 4326)` optional | Pre-simplified from export; or omit geometry and serve static GeoJSON |

~74 rows for Yukon MVP, ≪ 1 MB with geometry.

**Postgres geometry is optional for MVP.** Assignments can reference `dguid` only; canonical polygons stay in static `single_fed_das.geojson`.

#### `yt_adjacency` — precomputed contiguity (Yukon)

| Column | Type | Source |
|--------|------|--------|
| `dguid_a` | `text` | Offline graph from `yt_dissemination_areas.gpkg` |
| `dguid_b` | `text` | Touching polygon pairs |

~O(74 × degree) rows; required before backend contiguity validation.

#### `assignments` — user redistricting state

| Column | Type | Source |
|--------|------|--------|
| `user_id` | `uuid` FK | Supabase Auth |
| `dguid` | `text` FK → `das` | App layer |
| `district_id` | `integer` | App layer |
| `updated_at` | `timestamptz` | App layer |

Grows with users; primary mutable content besides submissions.

#### `submissions` — public input (UC2)

| Column | Type | Source |
|--------|------|--------|
| `id` | `uuid` PK | App |
| `user_id` | `uuid` nullable | Auth (optional for anonymous phase) |
| `type` | `text` | `comment` \| `objection` \| `counter_proposal` |
| `body` | `text` | User input |
| `fed_num` | `text` FK | Map selection |
| `dguid_list` | `jsonb` nullable | Referenced DAs (counter-proposals) |
| `assignment_snapshot` | `jsonb` nullable | `{ dguid: district_id }` at submit time |
| `status` | `text` | `pending` \| `reviewed` \| `archived` |
| `created_at` | `timestamptz` | App |

#### `commissioner_notes` — internal review (UC3)

| Column | Type | Source |
|--------|------|--------|
| `submission_id` | `uuid` FK | App |
| `commissioner_id` | `uuid` | Auth |
| `tags` | `text[]` | App |
| `note` | `text` | App |
| `created_at` | `timestamptz` | App |

### 3.2 Do **not** upload to Supabase (host statically)

| Asset | Size (approx.) | Host via |
|-------|------------------|----------|
| `fed_boundaries_2023.pmtiles` | ~29 MB | CDN / Express static / object storage |
| `fed_boundaries_2023.geojson` | ~6 MB | Same (fallback only) |
| `single_fed_das.geojson` | ~2 MB | Static until multi-region deploy |
| `fed_labels.geojson`, `place_labels_*.geojson` | < 0.1 MB | Static |
| Raw `*_English_CSV_data.csv` | 100+ MB combined | Colab pre-join only |
| `polling_districts_results_2006_2023.csv` | ~528 MB | Omit |
| National `{prov}_dissemination_areas.gpkg` catalog | 100s MB | Per-province static GeoJSON when unlocked |

### 3.3 ETL sequence (Yukon → Supabase)

1. Colab: `yt_dissemination_areas.gpkg` + `98-401-X2021028` profile CSV → verify 74 `DGUID` population join.
2. Export slim `das` rows (+ optional simplified geometry).
3. Build `yt_adjacency.json` offline → insert `yt_adjacency` edges.
4. Seed `fed_ref` from `fed_names_2023.json` (343 rows).
5. Wire Express API routes to Supabase client for `submissions` / `assignments`.

---

## 4. Delivery strategies

### 4.1 Primary strategy (recommended) — Extend Yukon MVP

**Goal:** On-time delivery with **real data** in one complete pilot region; national map as context only.

| Phase | Work | Uses actual bundle |
|-------|------|-------------------|
| **Now (done)** | Map MVP: FED base, Yukon DAs, labels, panel | PMTiles, `single_fed_das.geojson`, label GeoJSON |
| **Next** | Wire redistricting UI + `localStorage` / Supabase `assignments` | Yukon `DGUID`s |
| **Next** | Supabase `submissions` + auth stub | Yukon `fed_num` `60001` |
| **Next** | Backend validation: population sums, contiguity | `yt_adjacency`, real `pop_2021` |
| **Next** | Commissioner dashboard (Yukon filter default) | Submission tables |
| **Later** | Add provinces as `{prov}_dissemination_areas.gpkg` land in bundle v2 | ab, bc, mb, sk, nl, pe ready first |

**UI policy:** Non-Yukon FED → *“Statistics for this region will be available in a future release.”* Submissions outside pilot region → disabled or tagged `out_of_pilot`.

**Why this wins:** Only path that ships **verifiable census joins**, **real geometry**, and **validation logic** without fabricating data. Matches sprint MVP; minimizes Supabase footprint.

---

### 4.2 Alternative A — National placeholders + maximize existing data

**Goal:** Marketing/demo shows **all 343 ridings clickable** with *some* content everywhere.

| Layer | National approach | Data source |
|-------|-------------------|-------------|
| FED map + labels | Already national | PMTiles + `fed_labels.geojson` |
| FED click panel | Show `fed_num`, name, **FED-level population** if derivable | `fed2021_*_polling_districts.gpkg` `electors_est`; historical `statscan_*_fednum_*.csv` |
| DA layer | **Per-province where GPKG exists** (7 provinces); placeholder message elsewhere | ab, bc, mb, sk, nl, pe, yt |
| Missing DA provinces | FED-level only + “DA detail coming soon” | — |
| Population on DAs | Join `raw/*_English_CSV_data.csv` where mappable; else deterministic placeholder + `data_quality = placeholder` | Partial coverage |
| Submissions | Accept nationally; validate strictly only in covered provinces | — |

**Trade-offs:**

| Pros | Cons |
|------|------|
| Broader geographic demo | Population validation unreliable in placeholder provinces |
| Reuses 7 existing DA GPKGs | Ontario/Quebec still hollow — key personas underserved |
| No fabricated geometry | Commissioner exports mix verified and placeholder rows |
| Moderate engineering effort | Risk of stakeholders treating placeholders as real |

**Supabase impact:** `das` table grows to ~tens of thousands of rows for 7 provinces; still manageable if geometry stays static. Target **≤ 150 MB** DB footprint; archive old submissions if needed.

---

### 4.3 Alternative B — Fabricate all core missing data

**Goal:** Full national UC1–UC3 demo regardless of bundle gaps.

| Fabrication | Method | Risk |
|-------------|--------|------|
| Missing DA polygons | Generate synthetic hex/grid cells per FED | **Not legally defensible** for redistribution tool |
| DA populations | Random / uniform split of FED totals | Validation passes but meaningless |
| FED profiles | Copy 2021 electors or random demographics | Misleading commissioner review |
| Ontario stack | Entirely synthetic | Contradicts “official boundaries” product promise |

**Trade-offs:**

| Pros | Cons |
|------|------|
| Fastest path to “national” UX | Academic integrity / stakeholder trust failure |
| Unblocks all UC demos superficially | Useless for real boundary commission workflow |
| Single schema nationwide | Must be ripped out when real data arrives |

**Recommendation:** **Reject for production.** Acceptable only as a **throwaway UI prototype** never shown to commissioners or cited in reports. If used internally, hard-code `data_quality = synthetic` and block export.

---

## 5. Strategy comparison

| Criterion | Primary (Yukon extend) | Alt A (national placeholders) | Alt B (fabricate) |
|-----------|------------------------|-------------------------------|-------------------|
| On-time delivery | High | Medium | High |
| Data integrity | High | Medium | **Low** |
| UC1 full demo | Yukon | Partial national | Apparent full |
| UC2 validation | Real (Yukon) | Mixed | Fake |
| UC3 commissioner trust | High | Medium | **Low** |
| Supabase size | Small | Medium | Medium–large |
| Rework when bundle v2 lands | Low | Medium | **High** |

**Team decision:** Proceed with **§4.1** for sprint close and next sprint planning. Revisit Alt A only if stakeholder demo **explicitly requires** multi-province DA clicks and accepts placeholder disclaimers.

---

## 6. Team actions

### Immediate (sprint close)

| # | Action | Owner | Done when |
|---|--------|-------|-----------|
| 1 | Merge map MVP branch; tag sprint deliverable | Dev | Branch merged, `npm run dev:map` documented |
| 2 | Verify Yukon profile join in `extract_mvp_data.ipynb` (`98-401-X2021028`) | Data | 74/74 `DGUID`s with real `C1_COUNT_TOTAL` |
| 3 | Ship `data_quality` flag on all `das` rows | Backend | Column in schema + ETL |
| 4 | Precompute `yt_adjacency` from `yt_dissemination_areas.gpkg` | Data | JSON + Supabase seed script |
| 5 | Implement Supabase tables: `fed_ref`, `das`, `submissions`, `assignments` | Backend | Migrations applied |
| 6 | Wire `districts.js` redistricting to map clicks + persistence | Frontend | Colour cycle + save/restore |
| 7 | User-facing pilot disclaimer: “Yukon pilot region” | Product | Copy in app README / landing |

### Next sprint

| # | Action | Notes |
|---|--------|-------|
| 8 | Express `/api/submissions` routes | UC2 |
| 9 | Commissioner dashboard (Yukon-default filter) | UC3 |
| 10 | Population-equality + contiguity validation API | Requires `yt_adjacency` |
| 11 | React shell; embed map component | README stack |
| 12 | Send `Missing_Files.md` to data collectors | Post-cycle repack; no in-cycle expectation |

### Do not do (this cycle)

- Upload 528 MB poll-results CSV to Supabase
- Promise Ontario DA interaction without `on_dissemination_areas.gpkg`
- Ship fabricated census data without `data_quality = synthetic` guardrails

---

## 7. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | Stakeholders expect Ontario / national DA demo | High | High | Pilot disclaimer; demo script uses Yukon; Alt A only with explicit sign-off |
| R2 | Wrong StatCan product mapped to Yukon DGUIDs | Medium | High | Validate 74/74 join; `data_quality` column; spot-check against StatCan table viewer |
| R3 | Supabase 500 MB quota exceeded | Medium | Medium | Static geometry; slim rows; archive submissions; no raw CSV in DB |
| R4 | PMTiles fail without HTTP Range | Low | Medium | Express dev server; GeoJSON fallback in `map.js`; use `127.0.0.1` not conflicted `localhost` |
| R5 | Commissioner exports mix real / placeholder data | Medium | High | Filter exports by `data_quality`; Yukon-only default view |
| R6 | Bundle v2 arrives mid-sprint and breaks ETL paths | Low | Medium | Pin ETL to `Actual_redist-mini-guide.md`; versioned Colab notebook |
| R7 | Redistricting shipped without contiguity check | Medium | High | Block submit until `yt_adjacency` validation lands |
| R8 | `029_feds_2023ro/` never repacked — FED stats panel blocked | High | Low | Use `fed_ref` + electors_est as interim; label as preliminary |
| R9 | Team pursues Alt B under schedule pressure | Medium | **Critical** | Document rejection in this report; require PM approval for any synthetic data |

---

## 8. Document history

| Date | Change |
|------|--------|
| 2026-06-19 | Initial audit-driven report |
| 2026-06-19 | Rewritten: MVP delivery summary, use-case mapping, Supabase plan, three strategies, actions + risks |

*Update when Supabase schema lands, bundle v2 is received, or delivery strategy changes.*

# CRMP Data Architecture Impact Report

**Audience:** Project team only  
**Assumption:** The bundle audited on **2026-06-19** (`CRMP-full-data.zip`) **will not be updated** during the development cycle.  
**References:** `Actual_redist-mini-guide.md`, `Missing_Files.md`, `Proposal.pdf` (use cases), current `map-mvp/` implementation

---

## 1. Executive summary

The canonical schema documents describe a **complete** national redistricting dataset. The **actual** bundle is a **partial repack**: DA boundary gaps in six provinces/territories, missing `006_dissemination_areas/*.csv` under expected names, and missing `029_feds_2023ro/`. DA-level census profiles **do exist** in nested StatCan products under `profile_2021/raw/`, but not at the paths the mini-guide specifies.

**Development strategy for this cycle:**

| Strategy | Where applied |
|----------|----------------|
| Deliver MVP on **complete geometry + workable profiles** | **Yukon (`yt`)**, FED `60001`, 74 DAs |
| Use **real census join** from `*_English_CSV_data.csv` where mappable | Yukon extraction notebook (update path) |
| **Placeholder** copy / UI for unavailable regions | Non-Yukon FED clicks → “Coming Soon!” |
| **Defer** national-scale features | Ontario commission workflows, full national redraw |
| **Do not upload** multi-GB raw assets to Supabase | Static hosting + slim PostgreSQL tables |

---

## 2. Proposal use cases vs data reality


| Use case | Data required | Status with actual bundle | Impact |
|----------|---------------|---------------------------|--------|
| **UC1 — View regions & statistics** | FED boundaries, DA polygons, population/demographics, optional labels | Yukon: full stack. Ontario / most provinces: **no DA layer** | National “click riding → stats” **not feasible** except Yukon + coarse FED-only elsewhere |
| **UC1 — Toggle historical boundaries** | FED 2003/2013/2023 layers | PMTiles 2003/2015/2023 present; 2003 tiles lack `fed_num` | Toggle **visual** OK; per-district identify on 2003 RO **limited** |
| **UC1 — Redraw / reassign communities** | DA building blocks + assignment + population sums | Yukon 74 DAs OK; adjacency graph **must be precomputed** | MVP redraw scoped to **Yukon**; contiguity validation needs offline graph |
| **UC2 — Submit comment / objection / counter-proposal** | Map feature IDs traceable to submission | `DGUID` + custom `district_id` sufficient for Yukon | Submissions for other regions need **waitlist UI** or commissioner-only manual handling |
| **UC3 — Commissioner review, tags, export** | Centralized submissions + live stats | Supabase tables (not raw zip) | Dashboard can work on **Yukon submissions**; national aggregates **misleading** if users expect Canada-wide coverage |
| **Population equality validation** | Per-DA population on all units in edited region | Real for Yukon after profile join; absent for incomplete provinces | Backend validation **Yukon-only** unless placeholders explicitly allowed |

---

## 3. Feature dependency map

Based on `Actual_redist-mini-guide.md`:

| Feature | Primary files | Secondary / optional | Blocked without |
|---------|---------------|----------------------|-----------------|
| National FED outline map | `fed_boundaries_2023.pmtiles` | White background style | Nothing — **available** |
| DA click + population panel | `yt_dissemination_areas.gpkg` + profile CSV | — | Other provinces: missing `{prov}_dissemination_areas.gpkg` |
| DA highlight / selection | `single_fed_das.geojson` (exported) | — | Re-export if source changes |
| Redistricting assignment | DA GeoJSON + `DGUID` | `localStorage` / Supabase `assignments` | DA layer for target province |
| District population totals | Profile long CSV (`CHARACTERISTIC_ID == 1`) | — | Profile file for that region |
| Place / community labels | `GEO_NAME` in profile CSV; `016_028/*_geo_index.csv` | OSM basemap (optional) | Not blocked for Yukon if join script updated |
| FED name in panel | Join `fed_num` to external lookup or `029_feds_2023ro` | `ed_name` in polling gpkg | **`029_feds_2023ro/` missing** — use Elections Canada naming table or `ed_name` from `fed2021_pd` |
| Historical FED comparison | PMTiles 2003/2015/2023 | Per-prov GPKG RO variants | 2003 PMTiles without IDs |
| Partisan context (optional) | `fed2021_{prov}_polling_districts.gpkg` | DA↔PD spatial join (non-trivial) | Not MVP-critical |
| Commissioner export | Supabase submissions + derived stats | — | Product scope, not zip-limited |

---

## 4. Missing data: impact and mitigations

### 4.1 Missing `{prov}_dissemination_areas.gpkg` (on, qc, ns, nb, nt, nu)

| Impact | Mitigation |
|--------|------------|
| No redistricting in those provinces | MVP + public demo on **Yukon only** |
| Persona Mark (Ontario) cannot use product locally | Marketing copy: “Pilot region: Yukon”; Ontario FED click → **“Statistics for this region — coming soon.”** |
| Commissioner national view incomplete | Dashboard filters default to **Yukon**; show coverage badge |

### 4.2 Missing `006_dissemination_areas/{region}.csv` (expected names)

| Impact | Mitigation |
|--------|------------|
| Mini-guide join path fails | Extraction reads `profile_2021/raw/*_English_CSV_data.csv` (see Actual guide) |
| Risk: wrong product for a province | Validate `DGUID` prefix / `GEO_LEVEL` for Yukon in notebook; document mapping in extraction script |
| If join still fails | **Placeholder** `C1_COUNT_TOTAL` (deterministic per `DGUID`) with UI disclaimer: *“Wait for actual statistics in a future release.”* |

### 4.3 Missing `029_feds_2023ro/`

| Impact | Mitigation |
|--------|------------|
| No canonical FED-level 2023 profile folder | FED click shows `fed_num` only; add small **`fed_names.json`** curated from Elections Canada for labels |
| Cannot seed assignment from official FED–DA mapping nationally | Seed Yukon only from spatial join in Colab |

### 4.4 Incomplete `census_boundaries/{prov}/` stacks

| Impact | Mitigation |
|--------|------------|
| Missing supporting layers (tracts, CSDs, etc.) | Ignore for MVP; only DA + FED needed |
| `on/` almost empty | Do not promise Ontario DA map |

---

## 5. Redundant or low-priority data (do not prioritize for upload)

| Asset | Size / note | Why redundant for CRMP MVP |
|-------|-------------|----------------------------|
| `polling_districts_results_2006_2023.csv` | ~528 MB | Not in schema; poll-level; duplicate of newer `fed2021_pd` for 2021 |
| `raw_data/data/statistics_canada/census/` duplicates | Duplicate statscan CSVs | Same as `census_profiles/` copies |
| `fed_boundaries_2003.pmtiles` + 2003 RO GPKGs | Historical reference | Optional toggle only; 2003 PMTiles **not identifiable** by district |
| `fed_boundaries_2015.pmtiles` | Superseded by 2023 for current RO | Reference layer only |
| Full national `{prov}_*.gpkg` catalog | Hundreds of MB | Serve via **static files / PMTiles**, not PostgreSQL |
| `012_adas/` path (absent) | — | N/A |
| Geo-index-only folders (`002`, `007`, `009`, `011`, `013`, `014`) | Small | Metadata; keep on Drive, not Supabase |
| `fed2021_source/` shapefile fragments | Incomplete | Source archive; not runtime |

---


## 6. Supabase PostgreSQL — 500 MB quota plan

**Constraint:** ~500 MB total; must reserve space for **user-generated rows** (submissions, assignments, commissioner notes).

### 6.1 Do **not** load into Supabase

| Data | Approx. size | Host instead |
|------|--------------|----------------|
| All `{prov}_dissemination_areas.gpkg` | 100s MB national | Static GeoJSON per deployed region only |
| `fed_boundaries_2023.pmtiles` | ~29 MB | Git LFS / Drive / object storage; browser fetch |
| Raw profile CSVs (`*_English_CSV_data.csv`) | 100+ MB combined | Pre-join in Colab → slim GeoJSON |
| `polling_districts_results_*.csv` | 528 MB | Omit entirely |
| Full geometry for non-MVP provinces | — | Omit until bundle complete |

### 6.2 Recommended Supabase tables (Yukon MVP)

| Table | Columns (core) | Est. size |
|-------|------------------|-----------|
| `das` | `dguid` PK, `fed_uid`, `pop_2021`, `geo_name` nullable, `geom` geometry(Polygon, 4326) | ~74 rows + index ≪ 1 MB |
| `fed_ref` | `fed_num`, `fed_name_en`, `prov_code` | 343 rows ≪ 1 MB |
| `assignments` | `user_id`, `dguid`, `district_id`, `updated_at` | grows with users |
| `submissions` | `id`, `user_id`, `type`, `body`, `geom` optional, `fed_num`, `status`, `created_at` | primary user storage |
| `commissioner_notes` | `submission_id`, `commissioner_id`, `tags`, `note`, internal | grows with review volume |

**Geometry in Postgres:** optional for MVP — can store assignment as JSON (`{ dguid: district_id }`) without PostGIS if extension unavailable; keep canonical geometry in static GeoJSON.

### 6.3 Size reduction tactics

1. **Pre-join census to GeoJSON** — export only properties needed in UI (`DGUID`, `C1_COUNT_TOTAL`, `GEO_NAME`, 2–3 demo stats), not full long-format CSV.
2. **Single-province deploy** — one GeoJSON (~2 MB Yukon) vs national DA layer (~GB scale).
3. **PMTiles off-DB** — already done.
4. **Normalize submissions** — store text + references to `DGUID` list, not full GeoJSON duplicates per save.
5. **Archive old submissions** — commissioner export to file; trim DB if quota tight.
6. **Reserve budget** — target **≤ 150 MB** schema + indexes; **≥ 350 MB** headroom for user content.

### 6.4 Static assets (outside Supabase)

| File | Role |
|------|------|
| `fed_boundaries_2023.pmtiles` | National FED context |
| `single_fed_das.geojson` | Yukon DA interaction |
| `fed_names.json` (derived) | FED labels until `029_feds_2023ro/` exists |
| `yt_adjacency.json` (precomputed) | Contiguity checks in API |

---

## 7. Placeholder and messaging policy

| UI surface | When data missing | Recommended copy |
|------------|-------------------|------------------|
| Non-Yukon FED click | No DA layer / no profiles | **“Coming Soon!”** + `fed_num` (current) |
| DA panel population | Placeholder join | **“Population (2021): —”** or deterministic placeholder + footnote |
| Future regions | Commissioner / marketing | **“Statistics for this region will be available in a future release.”** |
| Counter-proposal outside Yukon | No validation data | Disable submit; explain pilot region |

Replace placeholders when `Missing_Files.md` checklist items are closed **in a future release** (out of scope for this cycle).

---

## 8. Recommended team actions (this sprint)

1. **Update `extract_mvp_data.ipynb`** — join Yukon DAs to `98-401-X2021028` (or verified territories product) `*_English_CSV_data.csv`; remove placeholder when join verified.
2. **Add `fed_names.json`** — 343 rows from Elections Canada; use in panel + Step 4 labels.
3. **Precompute `yt_adjacency.json`** — offline from `yt_dissemination_areas.gpkg`.
4. **Supabase schema** — implement `submissions` + `assignments` only; defer national tables.
5. **Document pilot scope** in user-facing README — Yukon only until bundle v2.
6. **Send `Missing_Files.md`** to data owners for post-cycle repack (no expectation of update during this cycle).

---

## 9. Risk register

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Wrong StatCan product mapped to Yukon | Medium | Validate 74 `DGUID`s match after join |
| Stakeholders expect Ontario support | High | Clear pilot messaging; Persona demos use Yukon |
| Supabase quota exceeded by geometry | Medium | Static GeoJSON + slim rows |
| PMTiles fail without byte-range server | Low | Document `serve.py`; use GeoJSON fallback in dev |
| Commissioner exports include placeholder populations | Medium | Flag `data_quality` column in `das` table |

---

*Generated from `data_schema_audit_report.txt` and current `map-mvp/` implementation. Update when extraction notebook or Supabase schema lands.*

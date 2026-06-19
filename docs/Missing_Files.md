# Missing Files — `CRMP-full-data.zip` vs Expected Data Schema

**Bundle audited:** `CRMP-full-data.zip` (~863 MB unpacked; 212 files in archive inventory; additional files after nested zip extraction)  
**Audit date:** 2026-06-19  
**Reference documents (canonical expected layout):** `CRMP-full-data/README.md`, `CRMP-full-data/redist-mini-guide.md`
**Audit source:** `CRMP-full-data/data_schema_audit_report.txt`

This document lists files and folders **described in the canonical schema documents** that are **absent or incomplete** in the current zip. It is intended for **data collectors** repacking the bundle. Naming and paths match the schema documents exactly.

---

## Executive summary

| Category | Expected (per schema) | Status in current zip |
|----------|----------------------|------------------------|
| DA profile CSVs under `006_dissemination_areas/` | 6 regional files | **0 of 6** — only geo-index stubs |
| FED 2023 RO profiles under `029_feds_2023ro/` | Full product folder | **Folder absent** |
| `{prov}_dissemination_areas.gpkg` | All 13 provinces/territories | **6 provinces/territories missing** |
| Full `census_boundaries/{prov}/` stack | Standard geographies per province | **Partial** — varies by `{prov}` |
| ADA profiles under `012_adas/` | Regional CSVs (per mini-guide) | **Not present** in sampled inventory |

Top-level layout `CRMP-full-data/raw_data/...` is correct. Gaps are **missing files inside** the expected folders, not wrong root paths.

---

## 1. Missing — DA population CSVs (`006_dissemination_areas/`)

Per `CRMP-full-data/redist-mini-guide.md`, DA census profiles belong under:

`raw_data/statistics_canada/census_profiles/profile_2021/006_dissemination_areas/`

Expected **six regional profile CSVs** (long format: one row per geography per characteristic):

| File | Status | Purpose (per mini-guide) |
|------|--------|---------------------------|
| `atlantic.csv` | **MISSING** | DA profiles — Atlantic provinces |
| `quebec.csv` | **MISSING** | DA profiles — Quebec |
| `ontario.csv` | **MISSING** | DA profiles — Ontario |
| `prairies.csv` | **MISSING** | DA profiles — Alberta, Manitoba, Saskatchewan |
| `bc.csv` | **MISSING** | DA profiles — British Columbia |
| `territories.csv` | **MISSING** | DA profiles — Northwest Territories, Nunavut, Yukon |

### Required columns (per mini-guide)

| Column | Meaning |
|--------|---------|
| `DGUID` | Join key — matches `DGUID` in `{prov}_dissemination_areas.gpkg` |
| `CHARACTERISTIC_ID` | Statistic identifier (`1` = Population, 2021) |
| `CHARACTERISTIC_NAME` | Human-readable statistic name |
| `C1_COUNT_TOTAL` | Count value |

### Present in `006_dissemination_areas/` instead (not substitutes)

| File | Status | Why it is not a substitute |
|------|--------|----------------------------|
| `quebec_geo_index.csv` | Present | Geography **index only** (`Geo Code`, `Geo Name`, `Line Number`) — no `CHARACTERISTIC_ID` / `C1_COUNT_TOTAL` |
| `territories_geo_index.csv` | Present | Same — index only, not profile table |

---

## 2. Missing — FED 2023 Representation Order profiles (`029_feds_2023ro/`)

Per `CRMP-full-data/redist-mini-guide.md` and `CRMP-full-data/README.md`:

| Path | Status |
|------|--------|
| `raw_data/statistics_canada/census_profiles/profile_2021/029_feds_2023ro/` | **MISSING** (entire folder) |

Expected content: 2021 Census Profile tables at **federal electoral district (FED)** geography for the **2023 Representation Order**, joinable via `FEDUID` / `fed_num` (see schema geography codes).

---

## 3. Missing — ADA profile CSVs (`012_adas/`)

Per `CRMP-full-data/redist-mini-guide.md` (alternative building blocks):

| Path | Status |
|------|--------|
| `raw_data/statistics_canada/census_profiles/profile_2021/012_adas/` | **MISSING** or empty in current zip |

Expected: regional ADA profile CSVs (same long-format pattern as `006_dissemination_areas/`, keyed on ADA geography codes).

---

## 4. Missing — `{prov}_dissemination_areas.gpkg` by province

Per `CRMP-full-data/redist-mini-guide.md`:

`raw_data/statistics_canada/census_boundaries/{prov}/{prov}_dissemination_areas.gpkg`

Each file should carry geometry plus identifiers (`DAUID`, `DGUID`, `LANDAREA`, `PRUID` per mini-guide).

| `{prov}` | File | Status |
|----------|------|--------|
| `on` | `on_dissemination_areas.gpkg` | **MISSING** |
| `qc` | `qc_dissemination_areas.gpkg` | **MISSING** |
| `ns` | `ns_dissemination_areas.gpkg` | **MISSING** |
| `nb` | `nb_dissemination_areas.gpkg` | **MISSING** |
| `nt` | `nt_dissemination_areas.gpkg` | **MISSING** |
| `nu` | `nu_dissemination_areas.gpkg` | **MISSING** |
| `yt` | `yt_dissemination_areas.gpkg` | Present |
| `ab` | `ab_dissemination_areas.gpkg` | Present |
| `bc` | `bc_dissemination_areas.gpkg` | Present |
| `mb` | `mb_dissemination_areas.gpkg` | Present |
| `sk` | `sk_dissemination_areas.gpkg` | Present |
| `nl` | `nl_dissemination_areas.gpkg` | Present |
| `pe` | `pe_dissemination_areas.gpkg` | Present |

---

## 5. Missing — electoral district GeoPackages (selected provinces)

Per `CRMP-full-data/redist-mini-guide.md`, expected under `census_boundaries/{prov}/`:

- `{prov}_electoral_districts.gpkg` (current RO)
- `{prov}_electoral_districts_2003ro.gpkg`
- `{prov}_electoral_districts_2013ro.gpkg`

### Ontario (`on/`) — largely absent

| File | Status |
|------|--------|
| `on_dissemination_areas.gpkg` | **MISSING** |
| `on_aggregate_dissemination_areas.gpkg` | **MISSING** |
| `on_electoral_districts.gpkg` | **MISSING** |
| `on_electoral_districts_2003ro.gpkg` | **MISSING** |
| `on_electoral_districts_2013ro.gpkg` | **MISSING** |
| `on_electoral_districts_2023ro.gpkg` | **MISSING** |

Present in `on/` (non-substitutes for redistricting building blocks):

| File | Note |
|------|------|
| `on_designated_places.gpkg` | Minor geography |
| `on_population_centres.gpkg` | Minor geography |

### Other provinces — partial FED / boundary stacks

| `{prov}` | Notable gaps (audit) |
|----------|----------------------|
| `qc` | No `{prov}_dissemination_areas.gpkg`; only sparse layers (e.g. `_2003ro`, `_2013ro`, population centres) |
| `ns` | No `{prov}_dissemination_areas.gpkg`; limited layer set |
| `nb` | No `{prov}_dissemination_areas.gpkg` (aggregate DA present) |
| `nt` | No `{prov}_dissemination_areas.gpkg`; minimal layer set |
| `nu` | No `{prov}_dissemination_areas.gpkg`; minimal layer set |
| `bc` | `{prov}_dissemination_areas.gpkg` present; current `{prov}_electoral_districts.gpkg` **not observed** in audit (2003/2013 RO variants present) |

---

## 6. Missing — other `profile_2021/` product folders (schema-implied)

`CRMP-full-data/README.md` describes `profile_2021/` as **2021 Census Profile tables by geography (numbered StatCan product folders)**. The current zip contains several numbered folders with **geo-index or metadata only**, not full profile CSVs:

| Folder | Present content | Expected (typical full bundle) |
|--------|-----------------|--------------------------------|
| `002_cmas_cas/` | `data_geo_index.csv` only | Regional profile CSV(s) for CMAs/CAs |
| `007_census_tracts/` | `data_geo_index.csv` only | Regional profile CSV(s) for census tracts |
| `009_population_centres/` | `data_geo_index.csv` only | Regional profile CSV(s) |
| `011_designated_places/` | `data_geo_index.csv` only | Regional profile CSV(s) |
| `013_fsas/` | `meta.txt` only | FSA profile CSV(s) |
| `014_dissolved_csds/` | `meta.txt` only | Dissolved CSD profile CSV(s) |
| `016_028_province_csds/` | `*_geo_index.csv` only (ab, nb, nl, ns, on, sk) | Province CSD profile CSV(s) |

Geo-index files use columns `Geo Code`, `Geo Name`, `Line Number` — **not** the mini-guide profile schema (`DGUID`, `CHARACTERISTIC_ID`, `C1_COUNT_TOTAL`).

---

## 7. Present — items correctly described in schema (verification)

These **are present** and match `CRMP-full-data/README.md` (collectors should retain them in repacks):

| Path | Notes |
|------|-------|
| `raw_data/elections_canada/historical/fed_boundaries_2003.pmtiles` | Layer `fed2003_districts` |
| `raw_data/elections_canada/historical/fed_boundaries_2015.pmtiles` | Layer `fed2015_districts`; attrs include `fed_num`, `prov_code` |
| `raw_data/elections_canada/historical/fed_boundaries_2023.pmtiles` | Layer `fed2023_districts`; attrs include `fed_num` |
| `raw_data/elections_canada/fed2021_pd/fed2021_{prov}_polling_districts.gpkg` | All provinces; vote columns per schema |
| `raw_data/statistics_canada/census_profiles/statscan_*_fednum_*.csv` | Historical FED-level profiles (not DA-level) |


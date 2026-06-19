# Missing Files — `CRMP-full-data.zip` vs Expected Data Schema

**Bundle audited:** `CRMP-full-data.zip` (~863 MB unpacked; 212 files in archive inventory; additional files after nested zip extraction)  
**Audit date:** 2026-06-19  
**Reference documents (canonical expected layout):** `CRMP-full-data/README.md`, `CRMP-full-data/redist-mini-guide.md`  
**Audit source:** `data_schema_audit_report.txt`

This document lists files and folders **described in the canonical schema documents** that are **absent or incomplete** in the current zip, plus **related profile gaps** discovered in the audit (geo-index stubs, non-DA raw products). Naming and paths match the schema documents exactly.

---

## Executive summary

| Category | Expected (per schema) | Status in current zip |
|----------|----------------------|------------------------|
| DA profile CSVs under `006_dissemination_areas/` | 6 regional files | **0 of 6** — only geo-index stubs |
| Yukon / territories DA profiles (`territories.csv`) | Part of `006` | **Missing** — blocks per-DA `GEO_NAME` + population for YT |
| FED 2023 RO profiles under `029_feds_2023ro/` | Full product folder | **Folder absent** |
| `{prov}_dissemination_areas.gpkg` | All 13 provinces/territories | **6 missing** (`on`, `qc`, `ns`, `nb`, `nt`, `nu`) |
| Raw `profile_2021/raw/` StatCan zips (4 products) | Often assumed to hold DA stats | **Present but not DA-level** (see §1b) |
| ADA profiles under `012_adas/` | Regional CSVs (per mini-guide) | **Not present** |
| Full `profile_2021/` numbered products | Regional profile CSVs | **Mostly geo_index or meta only** (see §6) |

Top-level layout `CRMP-full-data/raw_data/...` is correct. Gaps are **missing files inside** the expected folders, not wrong root paths.

---

## 1. Missing — DA population CSVs (`006_dissemination_areas/`)

Per `CRMP-full-data/redist-mini-guide.md`, DA census profiles belong under:

`raw_data/statistics_canada/census_profiles/profile_2021/006_dissemination_areas/`

Expected **six regional profile CSVs** (long format: one row per geography per characteristic):

| File | Status | Geography scope (per mini-guide) |
|------|--------|----------------------------------|
| `atlantic.csv` | **MISSING** | DA profiles — NL, NS, PE, NB |
| `quebec.csv` | **MISSING** | DA profiles — Quebec |
| `ontario.csv` | **MISSING** | DA profiles — Ontario |
| `prairies.csv` | **MISSING** | DA profiles — AB, MB, SK |
| `bc.csv` | **MISSING** | DA profiles — British Columbia |
| `territories.csv` | **MISSING** | DA profiles — NT, NU, **Yukon** |

### Required columns (per mini-guide)

| Column | Meaning |
|--------|---------|
| `DGUID` | Join key — matches `DGUID` in `{prov}_dissemination_areas.gpkg` |
| `CHARACTERISTIC_ID` | Statistic identifier (`1` = Population, 2021) |
| `CHARACTERISTIC_NAME` | Human-readable statistic name |
| `C1_COUNT_TOTAL` | Count value |
| `GEO_NAME` | Human-readable geography label (present in long-format StatCan exports) |

### Present in `006_dissemination_areas/` instead (not substitutes)

| File | Status | Why it is not a substitute |
|------|--------|----------------------------|
| `quebec_geo_index.csv` | Present | Geography **index only** (`Geo Code`, `Geo Name`, `Line Number`) — no `CHARACTERISTIC_ID` / `C1_COUNT_TOTAL` |
| `territories_geo_index.csv` | Present (344 rows) | Same — **CSD-level** name index for territories; not per-DA profile data |

**Yukon impact:** `yt_dissemination_areas.gpkg` has 74 DA polygons with `DGUID` but **no** `GEO_NAME` on geometry. Without `territories.csv` (or an equivalent external StatCan product **98-401-X2021006** download), Yukon DA names and 2021 population cannot be joined from this zip.

### 1b. Raw StatCan products in bundle — not a workaround for missing `006` CSVs

The audit scanned `profile_2021/raw/*_English_CSV_data.csv` files. Population rows (`CHARACTERISTIC_ID = 1`) break down as:

| Extracted folder | Pop rows | `GEO_LEVEL` | DA rows? |
|------------------|----------|-------------|----------|
| `98-401-X2021008_eng_CSV` | 90 | Economic region, province, territory, country | **No** |
| `98-401-X2021018_eng_CSV` | 95 | Census subdivision | **No** |
| `98-401-X2021026_eng_CSV` | 35 | Census subdivision | **No** |
| `98-401-X2021028_eng_CSV` | 31 | Census subdivision (Nunavut) | **No** |

Collectors should **not** assume these four files replace the missing regional `006` CSVs.

---

## 2. Missing — FED 2023 Representation Order profiles (`029_feds_2023ro/`)

Per `CRMP-full-data/redist-mini-guide.md` and `CRMP-full-data/README.md`:

| Path | Status |
|------|--------|
| `raw_data/statistics_canada/census_profiles/profile_2021/029_feds_2023ro/` | **MISSING** (entire folder) |

Expected content: 2021 Census Profile tables at **federal electoral district (FED)** geography for the **2023 Representation Order**, joinable via `FEDUID` / `fed_num`.

**Impact:** No canonical census-profile statistics at 2023 RO FED geography inside the zip. FED **names** for map labels must be derived from electoral boundary GeoPackages and/or `fed2021_pd` (338 merged names in audit — 5 fewer than 343 districts), or from an external 2023 RO name list.

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

| `{prov}` | File | Status | DA features (audit) |
|----------|------|--------|---------------------|
| `on` | `on_dissemination_areas.gpkg` | **MISSING** | — |
| `qc` | `qc_dissemination_areas.gpkg` | **MISSING** | — |
| `ns` | `ns_dissemination_areas.gpkg` | **MISSING** | — |
| `nb` | `nb_dissemination_areas.gpkg` | **MISSING** | — (ADA gpkg present: 130) |
| `nt` | `nt_dissemination_areas.gpkg` | **MISSING** | — |
| `nu` | `nu_dissemination_areas.gpkg` | **MISSING** | — |
| `yt` | `yt_dissemination_areas.gpkg` | Present | 74 |
| `ab` | `ab_dissemination_areas.gpkg` | Present | 6203 |
| `bc` | `bc_dissemination_areas.gpkg` | Present | 7848 |
| `mb` | `mb_dissemination_areas.gpkg` | Present | 2223 |
| `sk` | `sk_dissemination_areas.gpkg` | Present | 2625 |
| `nl` | `nl_dissemination_areas.gpkg` | Present | 1082 |
| `pe` | `pe_dissemination_areas.gpkg` | Present | 319 |

### Regional profile CSV needed when DA GPKG exists

| `{prov}` | DA boundary | Missing profile CSV (when adding census attributes) |
|----------|-------------|-----------------------------------------------------|
| `yt`, `nt`, `nu` | YT present; NT/NU absent | `territories.csv` |
| `nl`, `ns`, `pe`, `nb` | NL/PE present; NS/NB DA absent | `atlantic.csv` |
| `ab`, `mb`, `sk` | Present | `prairies.csv` |
| `bc` | Present | `bc.csv` |
| `on` | **Missing** | `ontario.csv` |
| `qc` | **Missing** | `quebec.csv` |

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
| `qc` | No `{prov}_dissemination_areas.gpkg`; sparse FED layers (2003/2013 RO, population centres) |
| `ns` | No `{prov}_dissemination_areas.gpkg`; limited layer set |
| `nb` | No `{prov}_dissemination_areas.gpkg` (aggregate DA present) |
| `nt` | No `{prov}_dissemination_areas.gpkg`; minimal layer set |
| `nu` | No `{prov}_dissemination_areas.gpkg`; minimal layer set |
| `bc` | `{prov}_dissemination_areas.gpkg` present; current `{prov}_electoral_districts.gpkg` **not observed** in audit (2003/2013 RO variants present) |

---

## 6. Incomplete — other `profile_2021/` product folders (schema-implied)

`CRMP-full-data/README.md` describes `profile_2021/` as **2021 Census Profile tables by geography (numbered StatCan product folders)**. The current zip contains several numbered folders with **geo-index or metadata only**, not full profile CSVs:

| Folder | Present content | Expected (typical full bundle) |
|--------|-----------------|--------------------------------|
| `002_cmas_cas/` | `data_geo_index.csv` only | Regional profile CSV(s) for CMAs/CAs |
| `007_census_tracts/` | `data_geo_index.csv` only | Regional profile CSV(s) for census tracts |
| `009_population_centres/` | `data_geo_index.csv` only | Regional profile CSV(s) |
| `011_designated_places/` | `data_geo_index.csv` only | Regional profile CSV(s) |
| `013_fsas/` | `meta.txt` only | FSA profile CSV(s) |
| `014_dissolved_csds/` | `meta.txt` only | Dissolved CSD profile CSV(s) |
| `016_028_province_csds/` | `*_geo_index.csv` only (`ab`, `nb`, `nl`, `ns`, `on`, `sk`) | Province CSD profile CSV(s) |

Geo-index files use columns `Geo Code`, `Geo Name`, `Line Number` — **not** the mini-guide profile schema (`DGUID`, `CHARACTERISTIC_ID`, `C1_COUNT_TOTAL`).

---

## 7. Collector priority checklist

| Priority | Item | Why |
|----------|------|-----|
| **P0** | `006_dissemination_areas/territories.csv` | Yukon (and NT/NU) per-DA population + `GEO_NAME` |
| **P1** | Missing DA GPKGs: `on`, `qc`, `ns`, `nb`, `nt`, `nu` | National DA coverage |
| **P2** | Remaining `006` regional CSVs (`atlantic`, `quebec`, `ontario`, `prairies`, `bc`) | Provinces that already have DA boundaries |
| **P3** | `029_feds_2023ro/` | FED-level 2021 census stats under 2023 RO |
| **P4** | `012_adas/` regional CSVs | ADA-based workflows |
| **P5** | Full `016_028` / other numbered profile folders | CSD and other geography profiles beyond geo_index |

---

## 8. Present — items correctly described in schema (verification)

These **are present** and match `CRMP-full-data/README.md` (collectors should retain them in repacks):

| Path | Notes |
|------|-------|
| `raw_data/elections_canada/historical/fed_boundaries_2003.pmtiles` | Layer `fed2003_districts` |
| `raw_data/elections_canada/historical/fed_boundaries_2015.pmtiles` | Layer `fed2015_districts`; attrs include `fed_num`, `prov_code` |
| `raw_data/elections_canada/historical/fed_boundaries_2023.pmtiles` | Layer `fed2023_districts`; attrs include `fed_num` (no name) |
| `raw_data/elections_canada/fed2021_pd/fed2021_{prov}_polling_districts.gpkg` | All provinces; vote columns + `ed_name` per FED |
| `raw_data/statistics_canada/census_profiles/statscan_*_fednum_*.csv` | Historical FED-level profiles (not DA-level) |
| `raw_data/statistics_canada/census_boundaries/{prov}/{prov}_dissemination_areas.gpkg` | Where listed as present in §4 |

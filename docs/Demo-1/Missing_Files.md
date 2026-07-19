# Missing Files — `CRMP-full-data.zip` vs Expected Data Schema

**Bundle audited:** `CRMP-full-data.zip` (~863 MB unpacked; 212 files in archive inventory; additional files after nested zip extraction)  
**Audit date:** 2026-06-19  
**Audit source:** `docs/Demo-1/data_schema_audit_report.txt`  
**Reference documents (canonical expected layout):** `CRMP-full-data/README.md`, `CRMP-full-data/redist-mini-guide.md`

This document lists files and folders **described in the canonical schema** that are **absent or incomplete** in the audited zip, and summarizes **how those gaps affect the intended dataset architecture** (building-block geometry + profile joins + FED statistics). Paths and naming match the schema documents.

---

## Executive summary

| Category | Expected (per schema) | Status in audited zip |
|----------|----------------------|------------------------|
| DA profile CSVs under `006_dissemination_areas/` | 6 regional files | **0 of 6** — only geo-index stubs |
| FED 2023 RO profiles under `029_feds_2023ro/` | Full product folder | **Folder absent** |
| `{prov}_dissemination_areas.gpkg` | All 13 provinces/territories | **6 missing** |
| In-bundle `profile_2021/raw/` (4 StatCan products) | Sometimes assumed to hold DA stats | **Present but not DA-level** |
| ADA profiles under `012_adas/` | Regional CSVs | **Not present** |
| Full `profile_2021/` numbered products | Regional profile CSVs | **Mostly geo_index or meta only** |

Top-level layout `CRMP-full-data/raw_data/...` is correct. Gaps are **missing or misnamed files inside** expected folders, not wrong root paths.

---

## Architectural impact (summary)

The canonical redistricting model requires **DA polygons** joined to **DA census profiles** on `DGUID`, plus optional **FED-level** census products and boundary layers. Based on audit §2–§5:

| Layer | Intended role | Effect of current gaps |
|-------|---------------|------------------------|
| **DA building blocks** | `{prov}_dissemination_areas.gpkg` | **Incomplete national coverage** — six provinces/territories have no standard DA GPKG; redistricting workflows cannot run uniformly nationwide. |
| **DA attributes** | `006_dissemination_areas/*.csv` | **No in-bundle DA population or profile `GEO_NAME` join** for any province — even where DA GPKG exists, `profile_rows = 0` at DA level (audit §5). |
| **Raw `profile_2021/raw/` CSVs** | Partial StatCan products | **Cannot substitute** for missing `006` files — audited products contain economic region, province, territory, country, or CSD rows only; **no dissemination-area rows** (audit §3). |
| **Geo-index stubs** | `*_geo_index.csv` in `006`, `016_028`, etc. | Provide name/line pointers only — **do not satisfy** the mini-guide profile schema (`DGUID`, `CHARACTERISTIC_ID`, `C1_COUNT_TOTAL`). |
| **FED map labels** | Names on boundaries or census FED product | PMTiles have **no name field**; merged electoral GPKG + `fed2021_pd` yields **338** names vs **343** districts (audit §6). |
| **FED census statistics** | `029_feds_2023ro/` | **No canonical 2021 census profile tables** at 2023 RO FED geography inside the zip. |
| **ADA alternative** | `012_adas/` + ADA GPKGs | ADA polygons may exist; **ADA profile CSVs missing** — ADA-based population workflow incomplete. |
| **Ontario stack** | Full `on/` boundary layers | **`on/` largely empty** for DA, ADA, and electoral district GPKGs — largest province unsupported for geometry-based workflows. |

**Bottom line:** The bundle supports **partial** geometry-only DA coverage (seven provinces/territories with standard DA GPKG, plus NB ADA) and rich **election / historical FED** material, but **does not implement the canonical DA polygon + regional profile join** anywhere without adding the missing `006` CSVs (or equivalent DA-level profile products not present in the four raw zips).

---

## 1. Missing — DA population CSVs (`006_dissemination_areas/`)

Path: `raw_data/statistics_canada/census_profiles/profile_2021/006_dissemination_areas/`

Expected **six regional profile CSVs** (long format):

| File | Status | Covers (per mini-guide) |
|------|--------|-------------------------|
| `atlantic.csv` | **MISSING** | NL, NS, PE, NB |
| `quebec.csv` | **MISSING** | Quebec |
| `ontario.csv` | **MISSING** | Ontario |
| `prairies.csv` | **MISSING** | AB, MB, SK |
| `bc.csv` | **MISSING** | British Columbia |
| `territories.csv` | **MISSING** | NT, NU, YT |

### Required columns (per mini-guide)

| Column | Meaning |
|--------|---------|
| `DGUID` | Join key to `{prov}_dissemination_areas.gpkg` |
| `CHARACTERISTIC_ID` | Statistic ID (`1` = Population, 2021) |
| `CHARACTERISTIC_NAME` | Statistic label |
| `C1_COUNT_TOTAL` | Count value |

### Present instead (not substitutes — audit §2, §3)

| File | Why insufficient |
|------|------------------|
| `quebec_geo_index.csv` | Index only — no `CHARACTERISTIC_ID` / `C1_COUNT_TOTAL` |
| `territories_geo_index.csv` | Index only (344 rows sampled) — not a profile table |

### In-bundle raw products — not a workaround (audit §3)

| Folder | Pop rows (CHAR=1) | `GEO_LEVEL` | DA rows? |
|--------|-------------------|-------------|----------|
| `98-401-X2021008_eng_CSV` | 90 | ER / province / territory / country | **No** |
| `98-401-X2021018_eng_CSV` | 95 | Census subdivision | **No** |
| `98-401-X2021026_eng_CSV` | 35 | Census subdivision | **No** |
| `98-401-X2021028_eng_CSV` | 31 | Census subdivision | **No** |

---

## 2. Missing — FED 2023 Representation Order profiles (`029_feds_2023ro/`)

| Path | Status |
|------|--------|
| `raw_data/statistics_canada/census_profiles/profile_2021/029_feds_2023ro/` | **MISSING** |

**Impact:** No in-bundle 2021 Census Profile tables at **2023 RO FED** geography. FED-level demographic panels that depend on this product cannot be populated from the zip alone. FED **geometry** remains available via PMTiles and provincial electoral GPKGs; **names** may be approximated from electoral layers (338 merged names, audit §6) but not from the missing census product.

---

## 3. Missing — ADA profile CSVs (`012_adas/`)

| Path | Status |
|------|--------|
| `profile_2021/012_adas/` | **MISSING** |

**Impact:** Provinces with `{prov}_aggregate_dissemination_areas.gpkg` lack matching regional ADA profile CSVs — the ADA-based alternative to standard DAs (mini-guide) is incomplete.

---

## 4. Missing — `{prov}_dissemination_areas.gpkg`

Path: `raw_data/statistics_canada/census_boundaries/{prov}/{prov}_dissemination_areas.gpkg`

| `{prov}` | Status | DA features (audit §5) |
|----------|--------|------------------------|
| `on`, `qc`, `ns`, `nb`, `nt`, `nu` | **MISSING** | — |
| `yt` | Present | 74 |
| `ab` | Present | 6203 |
| `bc` | Present | 7848 |
| `mb` | Present | 2223 |
| `sk` | Present | 2625 |
| `nl` | Present | 1082 |
| `pe` | Present | 319 |

**Impact:** Without DA GPKG, a province cannot participate in DA-level redistricting geometry workflows at all (audit score **0**). New Brunswick has **130 ADA** features but no standard DA GPKG.

### Matching regional profile CSV (when geometry exists)

| Region | `{prov}` with DA GPKG | Missing profile file |
|--------|----------------------|----------------------|
| Territories | `yt` (NT/NU also lack GPKG) | `territories.csv` |
| Atlantic | `nl`, `pe` (`ns`, `nb` lack DA GPKG) | `atlantic.csv` |
| Prairies | `ab`, `mb`, `sk` | `prairies.csv` |
| British Columbia | `bc` | `bc.csv` |
| Ontario | no GPKG | `ontario.csv` |
| Quebec | no GPKG | `quebec.csv` |

---

## 5. Missing — electoral district GeoPackages (selected)

Expected under `census_boundaries/{prov}/`: `{prov}_electoral_districts.gpkg`, `_2003ro`, `_2013ro`.

### Ontario (`on/`) — largely absent

Missing: `on_dissemination_areas.gpkg`, `on_aggregate_dissemination_areas.gpkg`, all `on_electoral_districts*.gpkg` listed in audit.

Present (non-substitutes): `on_designated_places.gpkg`, `on_population_centres.gpkg`.

### Other partial stacks (audit)

| `{prov}` | Notable gaps |
|----------|--------------|
| `qc` | No DA GPKG; sparse FED / population-centre layers |
| `ns`, `nt`, `nu` | No DA GPKG; minimal layers |
| `nb` | No DA GPKG (ADA present) |
| `bc` | DA GPKG present; current `{prov}_electoral_districts.gpkg` not observed (2003/2013 RO variants present) |

**Impact:** FED name merge and provincial boundary completeness vary; largest gaps concentrate in **Ontario** and **Quebec**.

---

## 6. Incomplete — other `profile_2021/` folders

Several numbered folders contain **geo_index or metadata only** (audit §3, §8):

| Folder | Present | Expected (typical full bundle) |
|--------|---------|--------------------------------|
| `002_cmas_cas/` | `data_geo_index.csv` | CMA/CA profile CSVs |
| `007_census_tracts/` | `data_geo_index.csv` | Census tract profile CSVs |
| `009_population_centres/` | `data_geo_index.csv` | Population centre profile CSVs |
| `011_designated_places/` | `data_geo_index.csv` | Designated place profile CSVs |
| `013_fsas/` | `meta.txt` | FSA profile CSVs |
| `014_dissolved_csds/` | `meta.txt` | Dissolved CSD profile CSVs |
| `016_028_province_csds/` | `*_geo_index.csv` (`ab`, `nb`, `nl`, `ns`, `on`, `sk`) | Province CSD profile CSVs |

**Impact:** Secondary geography levels are indexed but not profile-complete inside the zip.

---

## 7. Collector priority (data repack)

| Priority | Item | Architectural need |
|----------|------|-------------------|
| **P0** | All six `006_dissemination_areas/*.csv` | Enables canonical DA profile join nationwide where GPKG exists |
| **P1** | Missing DA GPKGs: `on`, `qc`, `ns`, `nb`, `nt`, `nu` | National DA geometry coverage |
| **P2** | `029_feds_2023ro/` | FED-level 2021 census under 2023 RO |
| **P3** | `012_adas/` regional CSVs | ADA profile workflow |
| **P4** | Full numbered `profile_2021/` products beyond geo_index | CSD, tract, and other profile tables |

---

## 8. Present — verification (retain in repacks)

| Path | Notes (audit) |
|------|---------------|
| `elections_canada/historical/fed_boundaries_*.pmtiles` | 2003 / 2015 / 2023 RO layers |
| `elections_canada/fed2021_pd/fed2021_{prov}_polling_districts.gpkg` | All provinces |
| `statistics_canada/census_profiles/statscan_*_fednum_*.csv` | Historical FED profiles (not DA-level) |
| `statistics_canada/census_boundaries/{prov}/{prov}_dissemination_areas.gpkg` | Where listed present in §4 |

---

## 9. Undocumented but present (audit §2, §8)

| Path | Note |
|------|------|
| `polling_districts/.../polling_districts_results_2006_2023.csv` | ~528 MB; not in Schema/mini-guide |
| `016_028_province_csds/`, `014_dissolved_csds/` | Folders exist; Schema docs incomplete |

These do not close the gaps in §1–§6.

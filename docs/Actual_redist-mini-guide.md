# Actual Redistricting Data Guide

This document describes the **actual** contents of `CRMP-full-data.zip` as recorded in **`docs/data_schema_audit_report.txt`** (generated 2026-06-19; bundle root `CRMP-full-data/CRMP-full-data`; **210 files** schema-sampled, **212** in archive inventory).

It mirrors the structure of `CRMP-full-data/redist-mini-guide.md` but reflects **what is on disk**, including paths and formats not listed in the canonical schema documents.

For **expected** (canonical) layout, see `CRMP-full-data/README.md` and `CRMP-full-data/redist-mini-guide.md`.  
For **gaps vs expected and architectural impact**, see `Missing_Files.md`.

---

## What a redistricting dataset needs

Same logical model as the canonical mini-guide:

1. **Building blocks** — small geographic units (typically dissemination areas, DAs).
2. **Assignment table** — `unit_id → district_id` (application layer; not in the zip).
3. **Population totals** — census counts joinable to building blocks on standard IDs (`DGUID`, etc.).

This guide documents **which files in the audited bundle** satisfy each role.

---

## Bundle layout (actual)

After extracting the outer zip:

```text
CRMP-full-data/
└── raw_data/
    ├── elections_canada/
    │   ├── fed2021_pd/                    # 13 × polling-district GeoPackages (2021 votes)
    │   ├── historical/                    # 3 × FED boundary PMTiles (2003 / 2015 / 2023 RO)
    │   ├── fed2021_source/
    │   └── polling_districts/
    │       └── elections_canada/processed/
    │           └── polling_districts_results_2006_2023.csv   # see § Undocumented files
    ├── statistics_canada/
    │   ├── census_boundaries/{prov}/
    │   └── census_profiles/
    │       ├── profile_2021/
    │       ├── statscan_*_fednum_*.csv
    │       └── README.md
    └── data/
        └── statistics_canada/census/      # duplicate copies of some statscan CSVs
```

**Nested archives:** four StatCan product folders under `profile_2021/raw/` (extracted in audit):

- `98-401-X2021008_eng_CSV/`
- `98-401-X2021018_eng_CSV/`
- `98-401-X2021026_eng_CSV/`
- `98-401-X2021028_eng_CSV/`

---

## Dissemination areas (DAs)

### Polygons

Canonical path:

`raw_data/statistics_canada/census_boundaries/{prov}/{prov}_dissemination_areas.gpkg`

| `{prov}` | `{prov}_dissemination_areas.gpkg` (audit §2) |
|----------|---------------------------------------------|
| Present | `ab`, `bc`, `mb`, `sk`, `nl`, `pe`, `yt` |
| **Absent** | `on`, `qc`, `ns`, `nb`, `nt`, `nu` |

**Note:** New Brunswick ships `{prov}_aggregate_dissemination_areas.gpkg` (130 features) but not standard `{prov}_dissemination_areas.gpkg`.

**Sample schema** (present DA layers): geometry (WGS 84 / EPSG:4326), `DGUID`, `DAUID`, `LANDAREA`, `PRUID`. **`GEO_NAME` is not on boundary GeoPackages** — names come from profile tables when available.

### Census profiles — canonical `006_dissemination_areas/`

**Expected** (mini-guide): six regional CSVs — `atlantic.csv`, `quebec.csv`, `ontario.csv`, `prairies.csv`, `bc.csv`, `territories.csv`.

**Actual:** **all six missing** (audit §2). Present instead:

| File | Columns | Role |
|------|---------|------|
| `quebec_geo_index.csv` | `Geo Code`, `Geo Name`, `Line Number` | Geo **index** only — not a profile table |
| `territories_geo_index.csv` | same (344 rows sampled) | Geo **index** only — not a profile table |

These files cannot supply `CHARACTERISTIC_ID` / `C1_COUNT_TOTAL` for DA population joins.

### Census profiles — `profile_2021/raw/` (four extracted products)

Each folder contains `*_English_CSV_data.csv` (long format: `DGUID`, `GEO_LEVEL`, `GEO_NAME`, `CHARACTERISTIC_ID`, `C1_COUNT_TOTAL`, …).

Audit sample notes for population rows (`CHARACTERISTIC_ID = 1`):

| Product folder | Pop rows | `GEO_LEVEL` (audit) |
|----------------|----------|---------------------|
| `98-401-X2021008` | 90 | Economic region 76, Province 10, Territory 3, Country 1 |
| `98-401-X2021018` | 95 | Census subdivision 95 |
| `98-401-X2021026` | 35 | Census subdivision 35 |
| `98-401-X2021028` | 31 | Census subdivision 31 |

**None of the four in-bundle raw profile CSVs contain dissemination-area rows** (audit §3). They do not replace the missing `006` regional CSVs.

### Regional readiness (audit §5)

Readiness score 0–4: boundary GPKG + in-bundle DA profile rows + join path.

| `{prov}` | DA features in gpkg | Profile pop rows (CHAR=1) | Score |
|----------|----------------------|---------------------------|-------|
| `ab` | 6203 | 0 | 2 |
| `bc` | 7848 | 0 | 2 |
| `mb` | 2223 | 0 | 2 |
| `sk` | 2625 | 0 | 2 |
| `nl` | 1082 | 0 | 2 |
| `pe` | 319 | 0 | 2 |
| `yt` | 74 | 0 | 2 |
| `nb` | 130 (ADA gpkg only) | 0 | 2 |
| `ns`, `nt`, `nu`, `on`, `qc` | MISSING | 0 | 0 |

Score **2** = DA boundary present; **no** in-bundle DA profile table. Score **0** = DA boundary absent.

**Join recipe** (when canonical `006` CSVs exist):

1. Load `{prov}_dissemination_areas.gpkg`.
2. Read matching regional `006/*.csv`; filter `CHARACTERISTIC_ID == 1`.
3. Keep `DGUID`, `C1_COUNT_TOTAL`, optionally `GEO_NAME`.
4. Merge on `DGUID`.

---

## Federal electoral districts (FED)

### PMTiles

Path: `raw_data/elections_canada/historical/`

| File | Layer | Attributes (audit) |
|------|-------|-------------------|
| `fed_boundaries_2003.pmtiles` | `fed2003_districts` | `rep_order`, `year` |
| `fed_boundaries_2015.pmtiles` | `fed2015_districts` | `fed_num`, `prov_code`, `rep_order`, `year` |
| `fed_boundaries_2023.pmtiles` | `fed2023_districts` | `fed_num`, `rep_order`, `year` |

**PMTiles carry no riding name field** (audit §6).

### GeoPackage FED layers

Per province under `census_boundaries/{prov}/`: `{prov}_electoral_districts.gpkg` and `_2003ro` / `_2013ro` variants where present. Completeness varies; Ontario’s stack is largely absent (see `Missing_Files.md`).

### FED names derivable from bundle (audit §6)

| Source | Result |
|--------|--------|
| Merged `{prov}_electoral_districts*.gpkg` + `fed2021_pd` (`ed_name`) | **338** unique `fed_num` → name pairs |
| Expected 2023 RO district count | 343 (5 fewer in merged set) |
| `029_feds_2023ro/` | **Absent** |

`fed2021_pd` distinct `ed_name` counts per province (audit): e.g. `on` 121, `qc` 78, `bc` 42, `ab` 34, … (all 13 provinces/territories represented).

### FED census profiles

| Path | Status |
|------|--------|
| `profile_2021/029_feds_2023ro/` | **Absent** |
| `statscan_*_fednum_*.csv` | Present (historical FED-level profiles; multi-line headers) |

---

## Geography name indexes (not profile tables)

Several `profile_2021/` folders contain **geo_index** CSVs only (`Geo Code`, `Geo Name`, `Line Number`):

| Location | Content (audit) |
|----------|-------------------|
| `006_dissemination_areas/` | `quebec_geo_index.csv`, `territories_geo_index.csv` |
| `016_028_province_csds/` | `ab`, `nb`, `nl`, `ns`, `on`, `sk` `*_geo_index.csv` (96–952 rows sampled) |
| `002_cmas_cas/`, `007_census_tracts/`, `009_population_centres/`, `011_designated_places/` | `data_geo_index.csv` each |

These are **indexes**, not long-format profile tables with `DGUID` / `CHARACTERISTIC_ID` / `C1_COUNT_TOTAL`.

---

## Other `profile_2021/` folders (actual)

| Folder | Contents (audit) |
|--------|-------------------|
| `002_cmas_cas/` | `data_geo_index.csv` |
| `007_census_tracts/` | `data_geo_index.csv` |
| `009_population_centres/` | `data_geo_index.csv` |
| `011_designated_places/` | `data_geo_index.csv` |
| `013_fsas/` | `meta.txt` only |
| `014_dissolved_csds/` | `meta.txt` only |
| `012_adas/` | **Absent** (expected ADA profile CSVs) |

---

## Election results

### 2021 poll-by-poll (schema-documented)

`raw_data/elections_canada/fed2021_pd/fed2021_{prov}_polling_districts.gpkg` — all provinces; sample columns include `FED_NUM`, `ed_name`, vote columns, `total_votes`. CRS: EPSG:3347 (Lambert).

### Undocumented in Schema / mini-guide (audit §2)

| Path | Size (audit) | Note |
|------|--------------|------|
| `raw_data/elections_canada/polling_districts/elections_canada/processed/polling_districts_results_2006_2023.csv` | ~528 MB | Poll-station results 2006–2023 |
| `raw_data/statistics_canada/census_profiles/profile_2021/014_dissolved_csds/meta.txt` | present | Metadata only; folder not fully described in Schema |

---

## Aggregate DAs (ADAs)

Canonical alternative: `{prov}_aggregate_dissemination_areas.gpkg` + `profile_2021/012_adas/` regional CSVs.

**Actual:** ADA GeoPackages exist for several provinces; **`012_adas/` profile CSVs not present** in the audited bundle.

---

## Adjacency

Not shipped as files. Build offline from `{prov}_dissemination_areas.gpkg` touching polygons (same as canonical mini-guide).

---

## Quick reference

| Need | Actual bundle | Gap (audit) |
|------|---------------|-------------|
| DA polygons | `{prov}_dissemination_areas.gpkg` where present | Missing for 6 `{prov}` |
| DA population + `GEO_NAME` | `006_dissemination_areas/{regional}.csv` | **All 6 canonical files missing** |
| DA pop from `profile_2021/raw/` | Four extracted products | **Not DA-level** |
| CSD / place name indexes | `*_geo_index.csv` under `006`, `016_028`, etc. | Index only — no DA counts |
| National FED map (tiles) | `historical/fed_boundaries_2023.pmtiles` | No embedded names |
| FED names (derived) | Electoral GPKG + `fed2021_pd` | 338/343; not census `029` product |
| FED census profiles (2023 RO) | `029_feds_2023ro/` | **Folder absent** |
| 2021 votes by polling district | `fed2021_{prov}_polling_districts.gpkg` | Present |

---

## Audit metadata

| Item | Value |
|------|-------|
| Report | `docs/data_schema_audit_report.txt` |
| Generated | 2026-06-19T19:37:29 |
| Archive inventory | 212 files |
| Schema-sampled | 210 files |
| Nested zips in `profile_2021/raw/` | 4 extracted folders |

Regenerate the report after any bundle update (see audit script in repository).

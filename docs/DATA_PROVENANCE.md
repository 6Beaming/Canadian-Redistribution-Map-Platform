# Data provenance — map-mvp & scripts

MVP policy: **boundaries and FED tiles from the shipped `map-mvp/data/` assets**; **Yukon DA names and population from external collection** (`yt_da_profiles.json`). No nearest-neighbour or bundle `006` CSV join at runtime.

---

## `map-mvp/data/` files

| File | Source | How produced | Runtime API? |
|------|--------|--------------|--------------|
| `fed_boundaries_2023.pmtiles` | Elections Canada historical boundaries | Copied from CRMP bundle | No |
| `fed_boundaries_2023.geojson` | Same boundaries (fallback) | Tippecanoe / EC export | No |
| `single_fed_das.geojson` | Yukon DA polygons | `scripts/extract_mvp_data.ipynb` — **`DGUID` + geometry only** | No |
| `fed_labels.geojson` | FED centroids + external names | `scripts/generate_fed_labels.py` | No |
| `yt_da_profiles.json` | StatCan CSV download and/or WDS API | `scripts/collect_yt_da_profiles.py` | No (pre-built) |

**Removed from MVP:** `place_labels_yt.geojson`, `scripts/data/bundle` MANIFEST pipeline, `derive_from_bundle.py`, `scripts/data/derived/`.

---

## External reference tables

| File | Role | MVP dependency? |
|------|------|-------------------|
| `scripts/data/fed_names_2023.json` | Elections Canada 2023 RO riding names (343) | **Yes** — FED map labels |
| `scripts/data/bundle/compare_fed_names.py` | Merge 338 names from electoral GPKG + `fed2021_pd`; diff vs external list | **No** — audit/testing only |

---

## Label and panel semantics

| UI element | Data source | Notes |
|------------|-------------|-------|
| FED map labels | `fed_labels.geojson` ← `fed_names_2023.json` | Not bundle-derived 338-name merge |
| DA panel title | `yt_da_profiles.json` → `geo_name` | Placeholder: `missing name` |
| DA population | `yt_da_profiles.json` → `population` | Placeholder: `missing population` |
| DA map labels (zoom ≥ 8) | DA centroids where `geo_name` is present | No CSD nearest-neighbour |
| Pending data notice | Shown when profiles are missing/partial | Points to `collect_yt_da_profiles.py` |

---

## Pipeline order

```text
map-mvp/data/single_fed_das.geojson     (geometry — already in repo)
        +
scripts/collect_yt_da_profiles.py     (external StatCan CSV / API)
        →
map-mvp/data/yt_da_profiles.json

scripts/data/fed_names_2023.json
        →
scripts/generate_fed_labels.py → map-mvp/data/fed_labels.geojson
```

Optional audit (not MVP):

```text
CRMP-full-data electoral GPKG → scripts/data/bundle/ (local copy)
        →
scripts/data/bundle/compare_fed_names.py → scripts/data/bundle/output/
```

---

## Collecting Yukon DA profiles

`006/territories.csv` is **not** in the CRMP zip. The file currently in
`scripts/data/external/statcan/` is product **98-401-X2021008** (economic regions) —
it has **no dissemination-area rows** and cannot fill Yukon DA profiles.

**MVP collection strategy (2026-06-19 test):**

| Approach | Result | Use for MVP? |
|----------|--------|--------------|
| `--csv` on 98-401-X2021008 | 0 / 74 DGUIDs | No — wrong product |
| `--api` only | 0 / 74 DGUIDs | No — slow, all failed locally |
| **Pipeline: DA-level CSV then `--api`** | Best when correct file exists | **Yes** |

Until product **98-401-X2021006** (territories, DA-level) is downloaded, the map uses
`yt_da_profiles.json` with `missing name` / `missing population` placeholders.

```bash
python scripts/collect_yt_da_profiles.py --init
python scripts/collect_yt_da_profiles.py --csv scripts/data/external/statcan/<98-401-X2021006*_English_CSV_data.csv>
python scripts/collect_yt_da_profiles.py --csv ... --api   # optional gap-fill
```

## FED name audit (deferred)

`scripts/data/bundle/compare_fed_names.py` remains for a future DB migration pass.
The MVP keeps **343** names from `scripts/data/fed_names_2023.json` → `fed_labels.geojson`
(no local electoral GPKG copy required).

---

## Audit tool

```bash
python scripts/audit_data_schema.py /path/to/CRMP-full-data --no-extract-nested -o data_schema_audit_report.txt
```

See `docs/Actual_redist-mini-guide.md` and `docs/Missing_Files.md` for bundle gaps.

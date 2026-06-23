# External StatCan profile files

## Required for regenerating `yt_da_profiles.json`

Download **98-401-X2021006 — Territories only** from [Census Profile downloads](https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger.cfm) and place:

```text
scripts/data/external/statcan/98-401-X2021006_English_CSV_data_Territories.csv
```

Catalogue: https://www150.statcan.gc.ca/n1/en/catalogue/98-401-X2021006

Large CSV files are gitignored; the committed runtime artifact is `map-mvp/data/yt_da_profiles.json`.

## Regenerate

```bash
python scripts/collect_yt_da_profiles.py \
  --csv scripts/data/external/statcan/98-401-X2021006_English_CSV_data_Territories.csv
python scripts/collect_yt_da_profiles.py --finalize-only
```

Community names come from StatCan 2021 CSD boundaries (ArcGIS lookup at DA centroid). Unorganized CSDs show as **Unnamed DA** in the panel with a footnote.

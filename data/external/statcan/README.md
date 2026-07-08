# External StatCan Inputs

This folder is for raw Statistics Canada CSV inputs used during local metadata
enrichment. These files are dependencies for the reusable data scripts and are
not intended to be committed.

## Expected contents

- downloaded StatCan DA profile CSV files
- optional cached CSD lookup responses under `csd_cache/`

## Common usage

```powershell
python scripts\reusable\collect_da_profiles.py --csv-root data\external\statcan
```

```powershell
python scripts\reusable\collect_da_profiles.py --csv-root data\external\statcan --api --enrich-community
```

## Outputs

- `src/data/map/indexes/da_profile_index.json`
- enriched metadata after `python scripts\reusable\sync_da_metadata.py`

## Notes

- Large raw CSV files and cache directories are gitignored.
- `--api` fills missing population rows from the official StatCan WDS endpoint.
- `--enrich-community` uses centroid-to-CSD matching so DA panels can show
  human-readable community names.

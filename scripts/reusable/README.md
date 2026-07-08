# Reusable Scripts

This folder contains the data-production scripts that can be rerun when new raw
inputs or new provinces are added.

Typical order:

1. `build_da_metadata_geojson.py`
2. `collect_da_profiles.py`
3. `sync_da_metadata.py`
4. `generate_fed_labels.py`
5. `generate_fed_rollout_plan.mjs`
6. `build_da_render_bundle.py`

Support utilities such as `metadata_utils.py` live here as well.

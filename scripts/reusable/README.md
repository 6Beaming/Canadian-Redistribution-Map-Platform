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
7. `audit_map_release_inputs.py`
8. `build_map_release.py --release-id <immutable-release-id>`
9. `validate_map_release.py`

Support utilities such as `metadata_utils.py` live here as well.

The map-release pipeline is deliberately separate from the PMTiles rendering
pipeline. It copies exact authority shards byte-for-byte, creates random-access
DGUID/scope indexes, and derives sharded shared-arc, stable-vertex, adjacency,
and display-LOD assets. Build-time topology uses a temporary SQLite database so
the nationwide geometry is never retained as one Python object. The validator
recomputes every artifact and byte-range digest and enforces the 80 MiB Git
file gate.

After local validation and local Supabase migration tests pass, the scripts in
`../one-time/` are run in this order: `register_map_release.mjs`,
`backfill_submission_geometry_operations.mjs`, then
`migrate_archive_tree_v2.mjs`. They default to dry-run; database writes require
the explicit `--apply` flag. A non-zero unresolved/manual-review count blocks
cutover and legacy cleanup.

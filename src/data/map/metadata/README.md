# Metadata Shards

This folder stores the canonical local DA metadata grouped by FED.

Each file is a GeoJSON `FeatureCollection` whose features keep geometry together
with the DA properties needed by the app, including `DGUID`, `fed_num`,
`geo_name`, `population`, and display-label fields.

Large FEDs are split into `fed_<FEDNUM>_partNN.geojson` shards so every
committed file stays below the GitHub size limit.

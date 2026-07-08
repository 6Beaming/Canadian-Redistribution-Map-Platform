#!/usr/bin/env python3
"""One-time cleanup for migrated DA profile index metadata after the authority->metadata move."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE_INDEX = ROOT / "src" / "data" / "map" / "indexes" / "da_profile_index.json"
sys.path.insert(0, str(ROOT / "scripts" / "reusable"))

from metadata_utils import load_json, write_json

OLD_STATCAN_PREFIX = "scripts/data/external/statcan"
NEW_STATCAN_PREFIX = "data/external/statcan"
OLD_LEGACY_PATH = "src/data/map/yt_da_profiles.json"
OLD_PIPELINE = "authority_geojson_plus_csv_plus_wds_plus_csd_matching"
NEW_PIPELINE = "metadata_geojson_plus_csv_plus_wds_plus_csd_matching"


def rewrite_paths(value):
    if isinstance(value, dict):
        return {key: rewrite_paths(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rewrite_paths(item) for item in value]
    if isinstance(value, str):
        return value.replace(OLD_STATCAN_PREFIX, NEW_STATCAN_PREFIX)
    return value


def normalize_sources(sources):
    normalized = []
    seen = set()

    for source in sources or []:
        if not isinstance(source, str):
            continue
        if source == OLD_LEGACY_PATH:
            continue
        next_source = source.replace(OLD_STATCAN_PREFIX, NEW_STATCAN_PREFIX)
        if next_source in seen:
            continue
        seen.add(next_source)
        normalized.append(next_source)

    return normalized


def main():
    payload = load_json(PROFILE_INDEX)
    payload = rewrite_paths(payload)

    meta = dict(payload.get("_meta") or {})
    meta["generated_at"] = datetime.now(timezone.utc).isoformat()
    meta["sources"] = normalize_sources(meta.get("sources"))
    meta["collection_pipeline"] = NEW_PIPELINE
    meta["legacy_yt_fallback_used"] = False
    meta["csd_cache_dir"] = (
        (ROOT / "data" / "external" / "statcan" / "csd_cache")
        .relative_to(ROOT)
        .as_posix()
    )
    payload["_meta"] = meta

    write_json(PROFILE_INDEX, payload)
    print(f"[done] Normalized profile index metadata at {PROFILE_INDEX}")


if __name__ == "__main__":
    main()

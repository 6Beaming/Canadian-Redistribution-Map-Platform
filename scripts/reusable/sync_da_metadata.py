#!/usr/bin/env python3
"""Merge DA profile fields into canonical metadata shards and enforce GitHub-safe sizes."""

from __future__ import annotations

import argparse
from collections import defaultdict
from copy import deepcopy
from pathlib import Path

from metadata_utils import (
    iter_metadata_geojson_paths,
    load_json,
    normalize_text,
    parse_metadata_filename,
    remove_existing_metadata_geojson,
    write_metadata_shards,
)

ROOT = Path(__file__).resolve().parents[2]
METADATA_DIR = ROOT / "src" / "data" / "map" / "metadata"
PROFILE_INDEX = ROOT / "src" / "data" / "map" / "indexes" / "da_profile_index.json"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-dir", default=str(METADATA_DIR))
    parser.add_argument("--profiles", default=str(PROFILE_INDEX))
    parser.add_argument("--max-file-mb", type=float, default=49.0)
    return parser.parse_args()


def load_profiles(path: Path):
    payload = load_json(path)
    return payload.get("profiles", {})


def load_grouped_features(metadata_dir: Path):
    grouped = defaultdict(list)

    for path in iter_metadata_geojson_paths(metadata_dir):
        parsed = parse_metadata_filename(path)
        if not parsed:
            continue

        fed_num = parsed["fed_num"]
        payload = load_json(path)
        grouped[fed_num].extend(payload.get("features", []))

    return grouped


def merge_profile_properties(feature, profiles_by_dguid):
    next_feature = deepcopy(feature)
    properties = dict(next_feature.get("properties") or {})
    dguid = normalize_text(properties.get("DGUID"))
    profile = profiles_by_dguid.get(dguid) or {}

    properties["DGUID"] = dguid
    properties["DAUID"] = normalize_text(properties.get("DAUID")) or dguid[-8:]
    properties["fed_num"] = normalize_text(
        properties.get("fed_num") or profile.get("fed_num"),
    )
    properties["PRUID"] = normalize_text(
        properties.get("PRUID") or profile.get("pruid"),
    )

    for field in (
        "da_code",
        "geo_name",
        "name_source",
        "population",
        "status",
        "source",
        "community_name",
        "community_source",
        "community_display",
        "is_unorganized",
        "panel_title",
        "display_label",
        "map_label",
    ):
        if field in profile:
            properties[field] = profile[field]

    next_feature["properties"] = properties
    return next_feature


def main():
    args = parse_args()
    metadata_dir = Path(args.metadata_dir).expanduser().resolve()
    profiles_path = Path(args.profiles).expanduser().resolve()
    max_bytes = int(args.max_file_mb * 1024 * 1024)

    profiles_by_dguid = load_profiles(profiles_path)
    grouped_features = load_grouped_features(metadata_dir)

    if not grouped_features:
        raise SystemExit(f"No metadata GeoJSON files found in {metadata_dir}")

    rewritten_groups = {}
    for fed_num, features in grouped_features.items():
        rewritten_groups[fed_num] = [
            merge_profile_properties(feature, profiles_by_dguid)
            for feature in features
        ]

    remove_existing_metadata_geojson(metadata_dir)

    total_files = 0
    for fed_num in sorted(rewritten_groups):
        written_paths = write_metadata_shards(
            metadata_dir,
            fed_num,
            rewritten_groups[fed_num],
            max_bytes=max_bytes,
        )
        total_files += len(written_paths)
        print(
            f"[ok] FED {fed_num}: {len(rewritten_groups[fed_num])} features -> "
            f"{len(written_paths)} metadata shard(s)"
        )

    print(f"[done] Wrote {total_files} metadata shard file(s) to {metadata_dir}")


if __name__ == "__main__":
    main()

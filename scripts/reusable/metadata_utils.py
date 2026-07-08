from __future__ import annotations

import json
import re
from pathlib import Path

METADATA_FILENAME_RE = re.compile(
    r"^(?:fed|da)_(?P<fed_num>\d{5})(?:_part(?P<part>\d+))?\.geojson$",
    re.IGNORECASE,
)
FEATURE_COLLECTION_PREFIX_BYTES = len(
    '{"type":"FeatureCollection","features":['.encode("utf-8"),
)
FEATURE_COLLECTION_SUFFIX_BYTES = len("]}".encode("utf-8"))


def normalize_text(value) -> str:
    return str(value or "").strip()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict):
    write_json_with_options(path, payload, indent=2, separators=None)


def write_json_with_options(
    path: Path,
    payload: dict,
    *,
    indent=None,
    separators=None,
):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=indent,
            separators=separators,
        ),
        encoding="utf-8",
    )


def parse_metadata_filename(path: Path):
    match = METADATA_FILENAME_RE.match(path.name)
    if not match:
        return None

    part = match.group("part")
    return {
        "fed_num": match.group("fed_num"),
        "part": int(part) if part else None,
    }


def iter_metadata_geojson_paths(metadata_dir: Path):
    return sorted(
        path
        for path in metadata_dir.glob("*.geojson")
        if parse_metadata_filename(path)
    )


def remove_existing_metadata_geojson(metadata_dir: Path):
    for path in iter_metadata_geojson_paths(metadata_dir):
        path.unlink()


def sort_features(features):
    return sorted(
        features,
        key=lambda feature: normalize_text(
            feature.get("properties", {}).get("DGUID"),
        ),
    )


def build_metadata_payload(features):
    return {
        "type": "FeatureCollection",
        "features": sort_features(features),
    }


def estimate_feature_bytes(feature) -> int:
    return len(
        json.dumps(
            feature,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8"),
    )


def split_features_into_shards(features, max_bytes: int):
    sorted_items = sort_features(features)
    if not sorted_items:
        return []

    shards = []
    current = []
    current_bytes = FEATURE_COLLECTION_PREFIX_BYTES + FEATURE_COLLECTION_SUFFIX_BYTES

    for feature in sorted_items:
        feature_bytes = estimate_feature_bytes(feature)
        comma_bytes = 1 if current else 0
        next_bytes = current_bytes + comma_bytes + feature_bytes

        if current and next_bytes > max_bytes:
            shards.append(current)
            current = [feature]
            single_bytes = (
                FEATURE_COLLECTION_PREFIX_BYTES
                + FEATURE_COLLECTION_SUFFIX_BYTES
                + feature_bytes
            )
            if single_bytes > max_bytes:
                raise ValueError(
                    f"Single DA feature exceeds max shard size ({single_bytes} bytes > {max_bytes} bytes).",
                )
            current_bytes = single_bytes
            continue

        current.append(feature)
        current_bytes = next_bytes

    if current:
        shards.append(current)

    return shards


def write_metadata_shards(
    metadata_dir: Path,
    fed_num: str,
    features,
    max_bytes: int,
):
    shards = split_features_into_shards(features, max_bytes)
    written_paths = []

    for index, shard_features in enumerate(shards, start=1):
        filename = (
            f"fed_{fed_num}.geojson"
            if len(shards) == 1
            else f"fed_{fed_num}_part{index:02d}.geojson"
        )
        output_path = metadata_dir / filename
        write_json_with_options(
            output_path,
            build_metadata_payload(shard_features),
            indent=None,
            separators=(",", ":"),
        )
        written_paths.append(output_path)

    return written_paths

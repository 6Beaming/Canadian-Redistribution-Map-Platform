#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

from map_release_utils import (
    MAP_ROOT,
    get_dguid,
    get_fed_num,
    get_pruid,
    iter_geojson_features,
    sha256_file,
    validate_feature,
    write_json,
)
from metadata_utils import iter_metadata_geojson_paths, load_json, parse_metadata_filename


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit immutable map-release inputs without changing source data.",
    )
    parser.add_argument("--map-root", type=Path, default=MAP_ROOT)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("local/map-release-input-audit.json"),
    )
    parser.add_argument("--max-errors", type=int, default=200)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    map_root = args.map_root.resolve()
    metadata_dir = map_root / "metadata"
    profile_path = map_root / "indexes" / "da_profile_index.json"
    manifest_path = map_root / "manifests" / "da_asset_manifest.json"

    errors: list[dict] = []
    warnings: list[dict] = []

    def report(target: list, code: str, message: str, **context) -> None:
        if len(target) < args.max_errors:
            target.append({"code": code, "message": message, **context})

    if not metadata_dir.is_dir():
        report(errors, "METADATA_DIR_MISSING", "Metadata directory is unavailable.")
    if not profile_path.is_file():
        report(errors, "PROFILE_INDEX_MISSING", "DA profile index is unavailable.")
    if not manifest_path.is_file():
        report(errors, "ASSET_MANIFEST_MISSING", "DA asset manifest is unavailable.")
    if errors:
        write_json(args.output, {"ok": False, "errors": errors, "warnings": warnings})
        return 1

    profiles_payload = load_json(profile_path)
    profiles = profiles_payload.get("profiles", {})
    asset_manifest = load_json(manifest_path)
    manifest_assets = {
        str(asset.get("fedNum", "")): asset
        for asset in asset_manifest.get("assets", [])
    }

    seen_dguids: set[str] = set()
    duplicate_dguids: set[str] = set()
    feature_counts_by_fed: Counter[str] = Counter()
    geometry_types: Counter[str] = Counter()
    status_counts: Counter[str] = Counter()
    total_vertices = 0
    max_feature = {"dguid": None, "bytes": 0, "vertices": 0, "file": None}
    source_files: list[dict] = []

    metadata_paths = list(iter_metadata_geojson_paths(metadata_dir))
    for path in metadata_paths:
        parsed_name = parse_metadata_filename(path) or {}
        filename_fed = str(parsed_name.get("fed_num") or "")
        file_feature_count = 0
        source_files.append(
            {
                "path": path.relative_to(map_root).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": f"sha256:{sha256_file(path)}",
            },
        )
        try:
            features = iter_geojson_features(path)
            for feature, _offset, length in features:
                file_feature_count += 1
                dguid = get_dguid(feature)
                if dguid in seen_dguids:
                    duplicate_dguids.add(dguid)
                else:
                    seen_dguids.add(dguid)

                feature_errors = validate_feature(feature)
                for message in feature_errors:
                    report(
                        errors,
                        "INVALID_FEATURE",
                        message,
                        dguid=dguid or None,
                        file=path.name,
                    )

                properties = feature.get("properties") or {}
                feature_fed = get_fed_num(feature)
                pruid = get_pruid(feature)
                profile = profiles.get(dguid)
                if feature_fed != filename_fed:
                    report(
                        errors,
                        "FED_MISMATCH",
                        "Feature FED does not match its metadata shard.",
                        dguid=dguid,
                        expectedFed=filename_fed,
                        actualFed=feature_fed,
                    )
                if not pruid:
                    report(errors, "PRUID_MISSING", "Feature PRUID is missing.", dguid=dguid)
                if profile is None:
                    report(errors, "PROFILE_MISSING", "Feature profile is missing.", dguid=dguid)
                else:
                    if str(profile.get("fed_num") or "") != feature_fed:
                        report(
                            errors,
                            "PROFILE_FED_MISMATCH",
                            "Profile FED does not match metadata.",
                            dguid=dguid,
                        )
                    if str(profile.get("pruid") or "") != pruid:
                        report(
                            errors,
                            "PROFILE_PRUID_MISMATCH",
                            "Profile PRUID does not match metadata.",
                            dguid=dguid,
                        )

                geometry_type = str((feature.get("geometry") or {}).get("type") or "missing")
                geometry_types[geometry_type] += 1
                status_counts[str(properties.get("status") or "missing")] += 1

                vertex_count = 0
                coordinates = (feature.get("geometry") or {}).get("coordinates")
                stack = [coordinates]
                while stack:
                    value = stack.pop()
                    if (
                        isinstance(value, list)
                        and len(value) >= 2
                        and isinstance(value[0], (int, float))
                        and isinstance(value[1], (int, float))
                    ):
                        vertex_count += 1
                    elif isinstance(value, list):
                        stack.extend(value)
                total_vertices += vertex_count
                if length > max_feature["bytes"]:
                    max_feature = {
                        "dguid": dguid,
                        "bytes": length,
                        "vertices": vertex_count,
                        "file": path.name,
                    }

                feature_counts_by_fed[feature_fed] += 1
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            report(
                errors,
                "SHARD_READ_FAILED",
                str(error),
                file=path.name,
            )
            continue

        if file_feature_count == 0:
            report(warnings, "EMPTY_SHARD", "Metadata shard has no features.", file=path.name)

    for dguid in sorted(duplicate_dguids):
        report(errors, "DUPLICATE_DGUID", "DGUID occurs more than once.", dguid=dguid)

    profile_dguids = set(profiles)
    for dguid in sorted(profile_dguids - seen_dguids):
        report(warnings, "PROFILE_WITHOUT_FEATURE", "Profile has no exact feature.", dguid=dguid)

    for fed_num, asset in sorted(manifest_assets.items()):
        expected = int(asset.get("featureCount") or 0)
        actual = feature_counts_by_fed.get(fed_num, 0)
        if expected != actual:
            report(
                errors,
                "MANIFEST_FEATURE_COUNT_MISMATCH",
                "Asset manifest feature count does not match metadata.",
                fedNum=fed_num,
                expected=expected,
                actual=actual,
            )

    metadata_feds = set(feature_counts_by_fed)
    for fed_num in sorted(metadata_feds - set(manifest_assets)):
        report(errors, "FED_NOT_IN_MANIFEST", "Metadata FED is absent from manifest.", fedNum=fed_num)

    payload = {
        "schemaVersion": "1.0",
        "ok": not errors,
        "mapRoot": map_root.as_posix(),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "counts": {
            "metadataFiles": len(metadata_paths),
            "features": len(seen_dguids),
            "profiles": len(profile_dguids),
            "feds": len(metadata_feds),
            "vertices": total_vertices,
            "errors": len(errors),
            "warnings": len(warnings),
        },
        "geometryTypes": dict(sorted(geometry_types.items())),
        "statusCounts": dict(sorted(status_counts.items())),
        "featureCountsByFed": dict(sorted(feature_counts_by_fed.items())),
        "maxFeature": max_feature,
        "sourceFiles": source_files,
        "errors": errors,
        "warnings": warnings,
    }
    write_json(args.output, payload)
    print(
        f"Audited {len(seen_dguids)} DA features across {len(metadata_paths)} shards "
        f"in {payload['elapsedSeconds']}s: {len(errors)} error(s), {len(warnings)} warning(s).",
    )
    print(f"Report: {args.output.resolve()}")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

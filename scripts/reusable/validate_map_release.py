#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

from map_release_utils import (
    MAP_ROOT,
    MAX_GIT_FILE_BYTES,
    canonical_json_bytes,
    get_dguid,
    load_json,
    sha256_bytes,
    sha256_file,
    stable_hash_rows,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate an immutable local map release.")
    parser.add_argument("--map-root", type=Path, default=MAP_ROOT)
    parser.add_argument("--release-id")
    parser.add_argument("--output", type=Path, default=Path("local/map-release-validation.json"))
    parser.add_argument("--max-file-bytes", type=int, default=MAX_GIT_FILE_BYTES)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    map_root = args.map_root.resolve()
    current = load_json(map_root / "current-release.json")
    release_id = args.release_id or current.get("releaseId")
    release_root = map_root / "releases" / str(release_id)
    manifest = load_json(release_root / "release.json")
    errors: list[dict] = []

    def error(code: str, message: str, **context) -> None:
        errors.append({"code": code, "message": message, **context})

    if current.get("releaseId") == release_id and current.get("manifestSha256") != manifest.get("manifestSha256"):
        error("CURRENT_MANIFEST_MISMATCH", "current-release.json does not reference the release manifest hash.")

    identity = {key: value for key, value in manifest.items() if key != "manifestSha256"}
    actual_manifest_hash = f"sha256:{sha256_bytes(canonical_json_bytes(identity))}"
    if manifest.get("manifestSha256") != actual_manifest_hash:
        error("MANIFEST_HASH_MISMATCH", "release.json identity hash is invalid.")

    artifact_hash_rows: list[tuple[str, str]] = []
    for artifact in manifest.get("artifacts", []):
        path = release_root / artifact.get("path", "")
        if not path.is_file():
            error("ARTIFACT_MISSING", "Manifest artifact is missing.", path=artifact.get("path"))
            continue
        size = path.stat().st_size
        if size != artifact.get("bytes"):
            error("ARTIFACT_SIZE_MISMATCH", "Artifact byte count differs from manifest.", path=artifact.get("path"))
        if size > args.max_file_bytes:
            error("GIT_FILE_LIMIT", "Artifact exceeds the configured Git file-size gate.", path=artifact.get("path"), bytes=size)
        digest = sha256_file(path)
        if artifact.get("sha256") != f"sha256:{digest}":
            error("ARTIFACT_HASH_MISMATCH", "Artifact digest differs from manifest.", path=artifact.get("path"))
        artifact_hash_rows.append((artifact.get("path", ""), digest))
    catalog_hash = f"sha256:{stable_hash_rows(artifact_hash_rows)}"
    if manifest.get("artifactCatalogSha256") != catalog_hash:
        error("ARTIFACT_CATALOG_MISMATCH", "Artifact catalog digest is invalid.")

    dguid_index = load_json(release_root / "indexes" / "dguids.json").get("items", {})
    records_by_shard: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for dguid, descriptor in dguid_index.items():
        records_by_shard[descriptor.get("shard", "")].append((dguid, descriptor))
    for relative_path, records in records_by_shard.items():
        shard_path = release_root / relative_path
        if not shard_path.is_file():
            error("EXACT_SHARD_MISSING", "DGUID index points to a missing exact shard.", shard=relative_path)
            continue
        shard = shard_path.read_bytes()
        for dguid, descriptor in records:
            offset = int(descriptor.get("offset", -1))
            length = int(descriptor.get("length", -1))
            raw = shard[offset : offset + length]
            if len(raw) != length:
                error("EXACT_OFFSET_RANGE", "DGUID byte range falls outside its shard.", dguid=dguid)
                continue
            if descriptor.get("sha256") != f"sha256:{sha256_bytes(raw)}":
                error("EXACT_OFFSET_HASH", "DGUID byte range digest is invalid.", dguid=dguid)
                continue
            try:
                feature = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                error("EXACT_OFFSET_JSON", "DGUID byte range is not a GeoJSON Feature.", dguid=dguid)
                continue
            if get_dguid(feature) != dguid:
                error("EXACT_OFFSET_DGUID", "DGUID byte range resolves a different feature.", dguid=dguid)

    adjacency = load_json(release_root / "indexes" / "adjacency.json").get("items", {})
    for dguid, neighbors in adjacency.items():
        for neighbor in neighbors:
            if dguid not in adjacency.get(neighbor, []):
                error("ASYMMETRIC_ADJACENCY", "Adjacency is not symmetric.", dguid=dguid, neighbor=neighbor)

    shared_index = load_json(release_root / "topology" / "shared-arcs.index.json").get("items", {})
    shared_data_by_path: dict[str, bytes] = {}
    for pair, descriptor in shared_index.items():
        shard = descriptor.get("shard")
        if shard not in shared_data_by_path:
            shared_path = release_root / str(shard or "")
            if not shared_path.is_file():
                error("SHARED_ARC_SHARD_MISSING", "Shared-arc index points to a missing shard.", pair=pair, shard=shard)
                continue
            shared_data_by_path[shard] = shared_path.read_bytes()
        shared_data = shared_data_by_path[shard]
        offset = int(descriptor.get("offset", -1))
        length = int(descriptor.get("length", -1))
        raw_with_newline = shared_data[offset : offset + length]
        raw = raw_with_newline.rstrip(b"\n")
        if descriptor.get("sha256") != f"sha256:{sha256_bytes(raw)}":
            error("SHARED_ARC_HASH", "Shared-arc byte range digest is invalid.", pair=pair)
            continue
        try:
            record = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            error("SHARED_ARC_JSON", "Shared-arc byte range is invalid JSON.", pair=pair)
            continue
        if record.get("pair") != pair:
            error("SHARED_ARC_PAIR", "Shared-arc index resolves a different pair.", pair=pair)
        first, second = pair.split("|", 1)
        if second not in adjacency.get(first, []) or first not in adjacency.get(second, []):
            error("PAIR_NOT_ADJACENT", "Shared-arc pair is absent from adjacency index.", pair=pair)
        for chain in record.get("chains", []):
            exact = [[vertex[1], vertex[2]] for vertex in chain.get("vertices", [])]
            if len(exact) < 2:
                error("EMPTY_SHARED_CHAIN", "Shared arc has fewer than two vertices.", pair=pair)
                continue
            for level, indexes in chain.get("lods", {}).items():
                if any(not isinstance(index, int) or index < 0 or index >= len(exact) for index in indexes):
                    error("LOD_INDEX_RANGE", "LOD references a vertex outside its shared arc.", pair=pair, level=level)
                    continue
                coordinates = [exact[index] for index in indexes]
                if len(coordinates) < 2 or coordinates[0] != exact[0] or coordinates[-1] != exact[-1]:
                    error("LOD_ENDPOINT_MISMATCH", "LOD does not preserve shared-arc endpoints.", pair=pair, level=level)

    expected_count = int((manifest.get("counts") or {}).get("dguids") or 0)
    if len(dguid_index) != expected_count:
        error("DGUID_COUNT_MISMATCH", "DGUID index count differs from the release manifest.")
    expected_pairs = int((manifest.get("counts") or {}).get("adjacentPairs") or 0)
    if len(shared_index) != expected_pairs:
        error("PAIR_COUNT_MISMATCH", "Shared pair count differs from the release manifest.")

    payload = {
        "schemaVersion": "1.0",
        "ok": not errors,
        "releaseId": release_id,
        "manifestSha256": manifest.get("manifestSha256"),
        "counts": {"dguids": len(dguid_index), "adjacentPairs": len(shared_index), "errors": len(errors)},
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "errors": errors[:200],
    }
    write_json(args.output, payload)
    print(f"Validated {release_id} in {payload['elapsedSeconds']}s: {len(errors)} error(s).")
    print(f"Report: {args.output.resolve()}")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

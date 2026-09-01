#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

from map_release_utils import (
    MAP_ROOT,
    artifact_record,
    canonical_json_bytes,
    coordinate_key,
    get_dguid,
    get_fed_num,
    get_pruid,
    iter_feature_slices,
    iter_rings,
    load_json,
    pair_key,
    parse_coordinate_key,
    sha256_bytes,
    sha256_file,
    simplify_line,
    stable_hash_rows,
    vertex_id,
    write_json,
)
from metadata_utils import iter_metadata_geojson_paths


DEFAULT_RELEASE_ID = "statscan-da-2021-r1"
SCHEMA_VERSION = "1.0"
NORMALIZATION_VERSION = "wgs84-8dp-v1"
VERTEX_SCHEMA_VERSION = "shared-array-v1"
LOD_SCHEMA_VERSION = "shared-arc-index-dp-v1"
LOD_LEVELS = {
    "fine": 0.000025,
    "medium": 0.0001,
    "coarse": 0.0005,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build an immutable, indexed DA geometry release.")
    parser.add_argument("--map-root", type=Path, default=MAP_ROOT)
    parser.add_argument("--release-id", default=DEFAULT_RELEASE_ID)
    parser.add_argument("--staging-dir", type=Path)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--audit-only", action="store_true")
    parser.add_argument("--max-memory-mb", type=int, default=2048)
    parser.add_argument("--shard-bytes", type=int, default=64 * 1024 * 1024)
    parser.add_argument("--workers", type=int, default=1)
    return parser.parse_args()


def open_topology_db(path: Path) -> sqlite3.Connection:
    database = sqlite3.connect(path)
    database.executescript(
        """
        pragma journal_mode = wal;
        pragma synchronous = normal;
        pragma temp_store = file;
        pragma cache_size = -131072;
        create table if not exists edge_occurrences (
          edge_key text not null,
          start_key text not null,
          end_key text not null,
          dguid text not null,
          primary key (edge_key, dguid, start_key, end_key)
        ) without rowid;
        create index if not exists edge_occurrences_edge_idx
          on edge_occurrences(edge_key, dguid);
        """,
    )
    return database


def copy_exact_shard(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and sha256_file(target) == sha256_file(source):
        return
    shutil.copyfile(source, target)


def ordered_chains(edges: set[tuple[str, str]]) -> list[list[str]]:
    neighbors: dict[str, set[str]] = defaultdict(set)
    unused: set[tuple[str, str]] = set()
    for first, second in edges:
        normalized = tuple(sorted((first, second)))
        unused.add(normalized)
        neighbors[first].add(second)
        neighbors[second].add(first)

    chains: list[list[str]] = []
    while unused:
        endpoints = sorted(
            vertex
            for vertex, candidates in neighbors.items()
            if len(candidates) != 2 and any(tuple(sorted((vertex, other))) in unused for other in candidates)
        )
        if endpoints:
            start = endpoints[0]
        else:
            start = min(min(edge) for edge in unused)
        chain = [start]
        previous = None
        current = start
        while True:
            candidates = sorted(
                other
                for other in neighbors[current]
                if tuple(sorted((current, other))) in unused and other != previous
            )
            if not candidates:
                candidates = sorted(
                    other
                    for other in neighbors[current]
                    if tuple(sorted((current, other))) in unused
                )
            if not candidates:
                break
            following = candidates[0]
            unused.remove(tuple(sorted((current, following))))
            chain.append(following)
            previous, current = current, following
            if current == start:
                break
        chains.append(chain)
    return chains


def write_ndjson_record(target, value: dict) -> tuple[int, int, str]:
    payload = canonical_json_bytes(value) + b"\n"
    offset = target.tell()
    target.write(payload)
    return offset, len(payload), f"sha256:{sha256_bytes(payload[:-1])}"


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    if args.workers != 1:
        print("Note: the topology pass is intentionally single-writer; --workers is reserved for LOD workers.")
    map_root = args.map_root.resolve()
    release_root = map_root / "releases" / args.release_id
    staging_root = (args.staging_dir or release_root.with_name(f".{args.release_id}.building")).resolve()
    metadata_paths = list(iter_metadata_geojson_paths(map_root / "metadata"))
    profile_payload = load_json(map_root / "indexes" / "da_profile_index.json")
    profiles = profile_payload.get("profiles", {})
    source_manifest = load_json(map_root / "manifests" / "da_asset_manifest.json")

    if args.audit_only:
        print(f"Would build {args.release_id} from {len(metadata_paths)} metadata shards.")
        return 0
    if staging_root.exists() and not args.resume:
        shutil.rmtree(staging_root)
    staging_root.mkdir(parents=True, exist_ok=True)
    exact_root = staging_root / "exact" / "shards"
    index_root = staging_root / "indexes"
    topology_root = staging_root / "topology"
    exact_root.mkdir(parents=True, exist_ok=True)
    index_root.mkdir(parents=True, exist_ok=True)
    topology_root.mkdir(parents=True, exist_ok=True)

    database = open_topology_db(staging_root / ".topology.sqlite")
    dguid_index: dict[str, dict] = {}
    fed_index: dict[str, list[str]] = defaultdict(list)
    pruid_index: dict[str, list[str]] = defaultdict(list)
    artifact_paths: list[tuple[Path, int | None]] = []
    source_hash_rows: list[tuple[str, str]] = []

    print(f"Pass 1/4: exact shards, offsets, scopes, and edge occurrences ({len(metadata_paths)} files)")
    for file_number, source_path in enumerate(metadata_paths, start=1):
        target_path = exact_root / source_path.name
        copy_exact_shard(source_path, target_path)
        source_hash = sha256_file(source_path)
        source_hash_rows.append((source_path.name, source_hash))
        file_records = 0
        pending_edges: list[tuple[str, str, str, str]] = []
        shard_data = target_path.read_bytes()
        for offset, end in iter_feature_slices(shard_data):
            length = end - offset
            feature = json.loads(shard_data[offset:end].decode("utf-8"))
            file_records += 1
            dguid = get_dguid(feature)
            fed_num = get_fed_num(feature)
            pruid = get_pruid(feature)
            profile = profiles.get(dguid) or {}
            raw = shard_data[offset:end]
            dguid_index[dguid] = {
                "shard": f"exact/shards/{target_path.name}",
                "offset": offset,
                "length": length,
                "sha256": f"sha256:{sha256_bytes(raw)}",
                "fedNum": fed_num,
                "pruid": pruid,
                "enabled": str((feature.get("properties") or {}).get("status") or "").lower() in {"enabled", "ok"},
                "profile": profile,
            }
            fed_index[fed_num].append(dguid)
            pruid_index[pruid].append(dguid)
            for _polygon, _ring, positions in iter_rings(feature.get("geometry")):
                for first, second in zip(positions, positions[1:]):
                    first_key = coordinate_key(first)
                    second_key = coordinate_key(second)
                    if first_key == second_key:
                        continue
                    edge = "|".join(sorted((first_key, second_key)))
                    pending_edges.append((edge, first_key, second_key, dguid))
                    if len(pending_edges) >= 25_000:
                        database.executemany("insert or ignore into edge_occurrences values (?, ?, ?, ?)", pending_edges)
                        database.commit()
                        pending_edges.clear()
        if pending_edges:
            database.executemany("insert or ignore into edge_occurrences values (?, ?, ?, ?)", pending_edges)
            database.commit()
        artifact_paths.append((target_path, file_records))
        print(f"  [{file_number:03d}/{len(metadata_paths):03d}] {source_path.name}: {file_records} DAs")

    write_json(index_root / "dguids.json", {"schemaVersion": SCHEMA_VERSION, "items": dguid_index}, compact=True)
    write_json(index_root / "feds.json", {"schemaVersion": SCHEMA_VERSION, "items": {key: sorted(value) for key, value in fed_index.items()}}, compact=True)
    write_json(index_root / "pruids.json", {"schemaVersion": SCHEMA_VERSION, "items": {key: sorted(value) for key, value in pruid_index.items()}}, compact=True)
    artifact_paths.extend([(index_root / "dguids.json", len(dguid_index)), (index_root / "feds.json", len(fed_index)), (index_root / "pruids.json", len(pruid_index))])

    print("Pass 2/4: canonical shared edges and symmetric adjacency")
    cursor = database.execute(
        """
        select a.start_key, a.end_key, a.dguid, b.dguid
        from edge_occurrences a
        join edge_occurrences b on b.edge_key = a.edge_key and b.dguid > a.dguid
        order by a.dguid, b.dguid, a.edge_key
        """,
    )
    adjacency: dict[str, set[str]] = defaultdict(set)
    shared_index: dict[str, dict] = {}
    shared_paths: list[tuple[Path, int]] = []
    topology_hash_rows: list[tuple[str, str]] = []
    print("Pass 3/4: shared arc chains, stable vertices, and display LOD")

    def build_pair_record(pair: str, edges: set[tuple[str, str]]) -> dict:
        first_dguid, second_dguid = pair.split("|", 1)
        adjacency[first_dguid].add(second_dguid)
        adjacency[second_dguid].add(first_dguid)
        chain_payloads = []
        for chain_number, chain in enumerate(ordered_chains(edges)):
            exact_coordinates = [parse_coordinate_key(value) for value in chain]
            lods = {}
            coordinate_indexes = {coordinate: index for index, coordinate in enumerate(exact_coordinates)}
            for level, tolerance in LOD_LEVELS.items():
                simplified = simplify_line(exact_coordinates, tolerance)
                lods[level] = [coordinate_indexes[coordinate] for coordinate in simplified]
            vertices = [
                [
                    vertex_id(args.release_id, pair, coordinate),
                    *parse_coordinate_key(coordinate),
                    1 if index == 0 or index == len(chain) - 1 else 0,
                ]
                for index, coordinate in enumerate(chain)
            ]
            chain_payloads.append(
                {
                    "arcId": f"a1_{sha256_bytes(f'{pair}|{chain_number}'.encode())[:20]}",
                    "closed": len(chain) > 2 and chain[0] == chain[-1],
                    "vertices": vertices,
                    "lods": lods,
                },
            )
        return {"pair": pair, "dguids": [first_dguid, second_dguid], "chains": chain_payloads}

    target = None
    target_path = None
    target_records = 0
    shard_number = -1

    def write_shared_record(pair: str, record: dict) -> tuple[int, int, str, str]:
        nonlocal target, target_path, target_records, shard_number
        payload = canonical_json_bytes(record) + b"\n"
        if target is None or (target.tell() > 0 and target.tell() + len(payload) > args.shard_bytes):
            if target is not None:
                target.close()
                shared_paths.append((target_path, target_records))
            shard_number += 1
            target_records = 0
            target_path = topology_root / f"shared-arcs-{shard_number:03d}.ndjson"
            target = target_path.open("wb")
        offset = target.tell()
        target.write(payload)
        target_records += 1
        return offset, len(payload), f"sha256:{sha256_bytes(payload[:-1])}", target_path.name

    try:
        active_pair = None
        active_edges: set[tuple[str, str]] = set()
        for start_key, end_key, first_dguid, second_dguid in cursor:
            pair = pair_key(first_dguid, second_dguid)
            if active_pair is not None and pair != active_pair:
                record = build_pair_record(active_pair, active_edges)
                offset, length, digest, shard = write_shared_record(active_pair, record)
                shared_index[active_pair] = {"shard": f"topology/{shard}", "offset": offset, "length": length, "sha256": digest}
                topology_hash_rows.append((active_pair, digest.removeprefix("sha256:")))
                active_edges = set()
            active_pair = pair
            active_edges.add((start_key, end_key))
        if active_pair is not None:
            record = build_pair_record(active_pair, active_edges)
            offset, length, digest, shard = write_shared_record(active_pair, record)
            shared_index[active_pair] = {"shard": f"topology/{shard}", "offset": offset, "length": length, "sha256": digest}
            topology_hash_rows.append((active_pair, digest.removeprefix("sha256:")))
    finally:
        if target is not None:
            target.close()
            shared_paths.append((target_path, target_records))

    write_json(index_root / "adjacency.json", {"schemaVersion": SCHEMA_VERSION, "items": {key: sorted(value) for key, value in adjacency.items()}}, compact=True)
    write_json(topology_root / "shared-arcs.index.json", {"schemaVersion": SCHEMA_VERSION, "items": shared_index}, compact=True)
    artifact_paths.extend(
        [(index_root / "adjacency.json", len(adjacency)), *shared_paths, (topology_root / "shared-arcs.index.json", len(shared_index))],
    )
    database.close()
    for suffix in ("", "-wal", "-shm"):
        temporary = staging_root / f".topology.sqlite{suffix}"
        if temporary.exists():
            temporary.unlink()

    print("Pass 4/4: deterministic release manifest")
    geometry_revision = f"sha256:{stable_hash_rows(source_hash_rows)}"
    topology_revision = f"sha256:{stable_hash_rows(topology_hash_rows)}"
    artifacts = [artifact_record(path, staging_root, records=records) for path, records in artifact_paths]
    artifact_digest = stable_hash_rows((item["path"], item["sha256"].removeprefix("sha256:")) for item in artifacts)
    manifest_identity = {
        "schemaVersion": SCHEMA_VERSION,
        "releaseId": args.release_id,
        "geometryRevision": geometry_revision,
        "topologyRevision": topology_revision,
        "normalizationVersion": NORMALIZATION_VERSION,
        "vertexSchemaVersion": VERTEX_SCHEMA_VERSION,
        "lodSchemaVersion": LOD_SCHEMA_VERSION,
        "sourceManifestGeneratedAt": source_manifest.get("generatedAt"),
        "counts": {"dguids": len(dguid_index), "feds": len(fed_index), "pruids": len(pruid_index), "adjacentPairs": len(shared_index)},
        "lodLevels": LOD_LEVELS,
        "artifacts": artifacts,
        "artifactCatalogSha256": f"sha256:{artifact_digest}",
    }
    manifest_sha = f"sha256:{sha256_bytes(canonical_json_bytes(manifest_identity))}"
    release_manifest = {**manifest_identity, "manifestSha256": manifest_sha}
    write_json(staging_root / "release.json", release_manifest)
    if release_root.exists():
        shutil.rmtree(release_root)
    os.replace(staging_root, release_root)
    write_json(map_root / "current-release.json", {"schemaVersion": SCHEMA_VERSION, "releaseId": args.release_id, "manifestSha256": manifest_sha})
    print(f"Built {args.release_id}: {len(dguid_index)} DAs, {len(shared_index)} adjacent pairs in {time.perf_counter() - started:.1f}s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

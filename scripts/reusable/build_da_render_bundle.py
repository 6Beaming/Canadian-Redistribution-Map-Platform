#!/usr/bin/env python3
"""Build the local DA render bundle used by the frontend map.

Outputs:
  src/data/map/render/da_boundaries_available.pmtiles
  src/data/map/render/da_labels_available.geojson
  src/data/map/manifests/da_asset_manifest.json
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from metadata_utils import iter_metadata_geojson_paths, load_json, normalize_text, parse_metadata_filename

ROOT = Path(__file__).resolve().parents[2]
METADATA_DIR = ROOT / "src" / "data" / "map" / "metadata"
PROFILES_JSON = ROOT / "src" / "data" / "map" / "indexes" / "da_profile_index.json"
RENDER_DIR = ROOT / "src" / "data" / "map" / "render"
MANIFEST_OUT = ROOT / "src" / "data" / "map" / "manifests" / "da_asset_manifest.json"
ROLL_OUT_PLAN = ROOT / "src" / "data" / "map" / "manifests" / "fed_rollout_plan.json"
TMP_DIR = ROOT / ".tmp"
DEFAULT_TIPPECANOE_IMAGE = "metacollin/tippecanoe:latest"
DEFAULT_PMTILES_IMAGE = "protomaps/go-pmtiles:latest"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-dir", default=str(METADATA_DIR))
    parser.add_argument("--profiles", default=str(PROFILES_JSON))
    parser.add_argument("--output-dir", default=str(RENDER_DIR))
    parser.add_argument("--manifest-out", default=str(MANIFEST_OUT))
    parser.add_argument("--layer-name", default="da_boundaries_available")
    parser.add_argument("--minimum-zoom", type=int, default=5)
    parser.add_argument("--maximum-zoom", type=int, default=12)
    parser.add_argument("--max-pmtiles-mb", type=float, default=50.0)
    parser.add_argument("--keep-combined-geojson", action="store_true")
    parser.add_argument("--skip-pmtiles", action="store_true")
    parser.add_argument("--docker-tippecanoe-image", default=DEFAULT_TIPPECANOE_IMAGE)
    parser.add_argument("--docker-pmtiles-image", default=DEFAULT_PMTILES_IMAGE)
    return parser.parse_args()

def ring_centroid(ring):
    if len(ring) < 3:
        lng = sum(point[0] for point in ring) / len(ring)
        lat = sum(point[1] for point in ring) / len(ring)
        return [lng, lat]

    area = 0.0
    cx = 0.0
    cy = 0.0
    for index, point in enumerate(ring):
        nxt = ring[(index + 1) % len(ring)]
        cross = point[0] * nxt[1] - nxt[0] * point[1]
        area += cross
        cx += (point[0] + nxt[0]) * cross
        cy += (point[1] + nxt[1]) * cross

    area *= 0.5
    if abs(area) < 1e-12:
        lng = sum(point[0] for point in ring) / len(ring)
        lat = sum(point[1] for point in ring) / len(ring)
        return [lng, lat]

    return [cx / (6.0 * area), cy / (6.0 * area)]


def feature_centroid(feature):
    geometry = feature["geometry"]
    geom_type = geometry["type"]
    coords = geometry["coordinates"]

    if geom_type == "Point":
        return list(coords)
    if geom_type == "Polygon":
        return ring_centroid(coords[0])
    if geom_type == "MultiPolygon":
        largest = max(coords, key=lambda polygon: len(polygon[0]))
        return ring_centroid(largest[0])
    return [0.0, 0.0]

def load_rollout_lookup():
    if not ROLL_OUT_PLAN.exists():
        return {}

    payload = load_json(ROLL_OUT_PLAN)
    return {
        str(area.get("fedNum")): {
            "fedName": normalize_text(area.get("name")),
            "provinceCode": normalize_text(area.get("provinceCode")).lower(),
        }
        for area in payload.get("areas", [])
        if normalize_text(area.get("fedNum"))
    }


def load_profiles(profile_path: Path):
    if not profile_path.exists():
        return {}
    return load_json(profile_path).get("profiles", {})


def load_metadata_assets(metadata_dir: Path):
    grouped_assets = {}
    combined_features = []

    metadata_files = iter_metadata_geojson_paths(metadata_dir)
    if metadata_files:
        for path in metadata_files:
            parsed = parse_metadata_filename(path)
            if not parsed:
                continue

            fed_num = parsed["fed_num"]
            payload = load_json(path)
            features = payload.get("features", [])

            for feature in features:
                props = feature.setdefault("properties", {})
                props["fed_num"] = normalize_text(props.get("fed_num")) or fed_num
                props["DGUID"] = normalize_text(props.get("DGUID"))
                props["DAUID"] = normalize_text(props.get("DAUID")) or props["DGUID"][-8:]

            asset = grouped_assets.setdefault(
                fed_num,
                {
                    "fedNum": fed_num,
                    "metadataGeojsons": [],
                    "featureCount": 0,
                },
            )
            asset["metadataGeojsons"].append(f"metadata/{path.name}")
            asset["featureCount"] += len(features)
            combined_features.extend(features)

        return list(grouped_assets.values()), combined_features

    if metadata_dir.exists():
        payload = load_json(next(iter(metadata_dir.glob("*.geojson"))))
        features = payload.get("features", [])
        for feature in features:
            props = feature.setdefault("properties", {})
            props["fed_num"] = normalize_text(props.get("fed_num")) or "60001"
            props["DGUID"] = normalize_text(props.get("DGUID"))
            props["DAUID"] = normalize_text(props.get("DAUID")) or props["DGUID"][-8:]

        return (
            [
                {
                    "fedNum": "60001",
                    "metadataGeojsons": [],
                    "featureCount": len(features),
                }
            ],
            features,
        )

    raise SystemExit("No metadata DA GeoJSON files were found.")


def classify_label_kind(label, da_code):
    if not label:
        return "code", 0
    if label == da_code or label.isdigit():
        return "code", 0
    return "community", 2


def build_label_geojson(features, profiles_by_dguid):
    label_features = []

    for feature in features:
        props = feature.get("properties", {})
        dguid = normalize_text(props.get("DGUID"))
        if not dguid:
            continue

        profile = profiles_by_dguid.get(dguid, {})
        da_code = normalize_text(profile.get("da_code") or props.get("DAUID") or dguid[-8:])
        label = normalize_text(
            profile.get("map_label")
            or profile.get("display_label")
            or profile.get("geo_name")
            or da_code
        )

        if not label or label == "missing name":
            continue

        kind, priority = classify_label_kind(label, da_code)
        label_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": feature_centroid(feature)},
                "properties": {
                    "name": label,
                    "dguid": dguid,
                    "kind": kind,
                    "priority": priority,
                },
            }
        )

    return {"type": "FeatureCollection", "features": label_features}


def write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def ensure_removed(path: Path):
    if path.exists():
        path.unlink()


def relative_to_root(path: Path):
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def container_path(path: Path):
    return f"/workspace/{relative_to_root(path)}"


def has_local_pmtiles_toolchain():
    return bool(shutil.which("tippecanoe") and shutil.which("pmtiles"))


def has_docker():
    return bool(shutil.which("docker"))


def build_pmtiles_with_local(
    combined_geojson: Path,
    pmtiles_out: Path,
    layer_name: str,
    minimum_zoom: int,
    maximum_zoom: int,
):
    tippecanoe = shutil.which("tippecanoe")
    pmtiles = shutil.which("pmtiles")

    if not tippecanoe or not pmtiles:
        raise SystemExit("The local PMTiles toolchain is not installed.")

    with tempfile.TemporaryDirectory(prefix="crmp-da-render-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        mbtiles_path = temp_dir / "da_boundaries_available.mbtiles"

        subprocess.run(
            [
                tippecanoe,
                "--force",
                "--read-parallel",
                "--detect-shared-borders",
                "--drop-densest-as-needed",
                "--extend-zooms-if-still-dropping",
                "--no-feature-limit",
                "--no-tile-size-limit",
                "--minimum-zoom",
                str(minimum_zoom),
                "--maximum-zoom",
                str(maximum_zoom),
                "--layer",
                layer_name,
                "--output",
                str(mbtiles_path),
                str(combined_geojson),
            ],
            check=True,
        )

        pmtiles_out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                pmtiles,
                "convert",
                str(mbtiles_path),
                str(pmtiles_out),
            ],
            check=True,
        )


def build_pmtiles_with_docker(
    combined_geojson: Path,
    pmtiles_out: Path,
    layer_name: str,
    minimum_zoom: int,
    maximum_zoom: int,
    docker_tippecanoe_image: str,
    docker_pmtiles_image: str,
):
    if not has_docker():
        raise SystemExit("Docker is required when the local PMTiles toolchain is unavailable.")

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="crmp-da-render-", dir=TMP_DIR) as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        mbtiles_path = temp_dir / "da_boundaries_available.mbtiles"

        subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{ROOT.resolve()}:/workspace",
                "--entrypoint",
                "tippecanoe",
                docker_tippecanoe_image,
                "--force",
                "--read-parallel",
                "--detect-shared-borders",
                "--drop-densest-as-needed",
                "--extend-zooms-if-still-dropping",
                "--no-feature-limit",
                "--no-tile-size-limit",
                "--minimum-zoom",
                str(minimum_zoom),
                "--maximum-zoom",
                str(maximum_zoom),
                "--layer",
                layer_name,
                "--output",
                container_path(mbtiles_path),
                container_path(combined_geojson),
            ],
            check=True,
        )

        pmtiles_out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{ROOT.resolve()}:/workspace",
                docker_pmtiles_image,
                "convert",
                container_path(mbtiles_path),
                container_path(pmtiles_out),
            ],
            check=True,
        )


def build_pmtiles(
    combined_geojson: Path,
    pmtiles_out: Path,
    layer_name: str,
    minimum_zoom: int,
    maximum_zoom: int,
    max_pmtiles_mb: float,
    docker_tippecanoe_image: str,
    docker_pmtiles_image: str,
):
    if has_local_pmtiles_toolchain():
        build_pmtiles_with_local(
            combined_geojson,
            pmtiles_out,
            layer_name,
            minimum_zoom,
            maximum_zoom,
        )
    elif has_docker():
        build_pmtiles_with_docker(
            combined_geojson,
            pmtiles_out,
            layer_name,
            minimum_zoom,
            maximum_zoom,
            docker_tippecanoe_image,
            docker_pmtiles_image,
        )
    else:
        raise SystemExit(
            "No PMTiles build toolchain is available. Install tippecanoe + pmtiles locally or enable Docker Desktop."
        )

    pmtiles_size_mb = pmtiles_out.stat().st_size / (1024 * 1024)
    if pmtiles_size_mb > max_pmtiles_mb:
        raise SystemExit(
            f"Generated PMTiles is {pmtiles_size_mb:.2f} MB, above the {max_pmtiles_mb:.2f} MB limit. "
            "Raise --max-pmtiles-mb or split the DA archive into multiple PMTiles shards."
        )


def main():
    args = parse_args()
    metadata_dir = Path(args.metadata_dir).expanduser().resolve()
    profiles_path = Path(args.profiles).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    manifest_out = Path(args.manifest_out).expanduser().resolve()

    rollout_lookup = load_rollout_lookup()
    profiles_by_dguid = load_profiles(profiles_path)
    assets, combined_features = load_metadata_assets(metadata_dir)

    sorted_features = sorted(
        combined_features,
        key=lambda feature: normalize_text(feature.get("properties", {}).get("DGUID")),
    )
    labels_geojson = build_label_geojson(sorted_features, profiles_by_dguid)

    output_dir.mkdir(parents=True, exist_ok=True)
    combined_geojson_path = output_dir / "da_boundaries_available.geojson"
    labels_geojson_path = output_dir / "da_labels_available.geojson"
    pmtiles_path = output_dir / "da_boundaries_available.pmtiles"

    write_json(labels_geojson_path, labels_geojson)

    if args.keep_combined_geojson:
        combined_geojson = {
            "type": "FeatureCollection",
            "features": sorted_features,
        }
        write_json(combined_geojson_path, combined_geojson)
        pmtiles_input_path = combined_geojson_path
    else:
        ensure_removed(combined_geojson_path)
        TMP_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".geojson",
            prefix="da-boundaries-",
            dir=TMP_DIR,
            delete=False,
            encoding="utf-8",
        ) as handle:
            pmtiles_input_path = Path(handle.name)
            json.dump(
                {
                    "type": "FeatureCollection",
                    "features": sorted_features,
                },
                handle,
                ensure_ascii=False,
            )

    try:
        if args.skip_pmtiles:
            if not pmtiles_path.exists():
                raise SystemExit(
                    f"--skip-pmtiles was provided, but no existing PMTiles bundle exists at {pmtiles_path}"
                )
        else:
            build_pmtiles(
                pmtiles_input_path,
                pmtiles_path,
                args.layer_name,
                args.minimum_zoom,
                args.maximum_zoom,
                args.max_pmtiles_mb,
                args.docker_tippecanoe_image,
                args.docker_pmtiles_image,
            )
    finally:
        if not args.keep_combined_geojson:
            ensure_removed(pmtiles_input_path)

    manifest_assets = []
    for asset in sorted(assets, key=lambda item: item["fedNum"]):
        rollout_meta = rollout_lookup.get(asset["fedNum"], {})
        manifest_assets.append(
            {
                "fedNum": asset["fedNum"],
                "fedName": rollout_meta.get("fedName", f"FED {asset['fedNum']}"),
                "provinceCode": rollout_meta.get("provinceCode", ""),
                "metadataGeojsons": asset["metadataGeojsons"],
                "shardCount": len(asset["metadataGeojsons"]),
                "renderIncluded": True,
                "featureCount": asset["featureCount"],
            }
        )

    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "combined": {
            "renderPmtiles": "render/da_boundaries_available.pmtiles",
            "renderGeojsonFallback": "render/da_boundaries_available.geojson"
            if args.keep_combined_geojson
            else "",
            "labelGeojson": "render/da_labels_available.geojson",
            "sourceLayer": args.layer_name,
            "minZoom": args.minimum_zoom,
            "maxZoom": args.maximum_zoom,
        },
        "profiles": {
            "json": "indexes/da_profile_index.json" if profiles_path.exists() else "",
        },
        "assets": manifest_assets,
    }

    write_json(manifest_out, manifest)

    if args.skip_pmtiles:
        print(f"[done] Reused existing PMTiles: {pmtiles_path}")
    else:
        print(f"[done] Built PMTiles: {pmtiles_path}")
    print(f"[done] DA labels GeoJSON: {labels_geojson_path}")
    print(f"[done] Manifest: {manifest_out}")
    print(f"[done] Enabled FED count: {len(manifest_assets)}")


if __name__ == "__main__":
    main()

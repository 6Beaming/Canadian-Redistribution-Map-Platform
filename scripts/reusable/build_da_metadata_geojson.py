#!/usr/bin/env python3
"""Build per-FED DA metadata GeoJSON files from the raw CRMP bundle.

This module supports both:
  1. CLI execution on a local machine or Colab runtime
  2. direct import from a notebook such as build_da_metadata_geojson.ipynb

Outputs:
  any chosen output directory, typically `src/data/map/metadata/`
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from metadata_utils import remove_existing_metadata_geojson, write_metadata_shards

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROVINCES = ("ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt")


def require_geopandas():
    try:
        import geopandas as gpd
    except ImportError as exc:
        raise SystemExit(
            "geopandas is required for scripts/reusable/build_da_metadata_geojson.py. "
            "Run this script in Colab or install geopandas locally first."
        ) from exc
    return gpd


def resolve_repo_root(repo_root: Path | str | None = None) -> Path:
    if repo_root is None:
        return ROOT
    return Path(repo_root).expanduser().resolve()


def get_fed_boundaries_geojson_path(repo_root: Path) -> Path:
    return repo_root / "src" / "data" / "map" / "reference" / "fed_boundaries_2023.geojson"


def get_metadata_output_dir(repo_root: Path) -> Path:
    return repo_root / "src" / "data" / "map" / "metadata"


def resolve_raw_root(raw_root: Path) -> Path:
    raw_root = raw_root.expanduser().resolve()

    direct_candidates = (
        raw_root,
        raw_root / "raw_data",
        raw_root / "raw-data",
        raw_root / "CRMP-full-data",
        raw_root / "CRMP-full-data" / "raw_data",
        raw_root / "CRMP-full-data" / "raw-data",
    )

    for candidate in direct_candidates:
        if (candidate / "statistics_canada" / "census_boundaries").exists():
            return candidate.resolve()

    raise SystemExit(
        "Could not locate the extracted CRMP raw bundle. "
        "Pass either the bundle root that contains raw_data/ or the raw_data/ directory itself."
    )


def da_gpkg_path(raw_root: Path, province_code: str) -> Path:
    return (
        raw_root
        / "statistics_canada"
        / "census_boundaries"
        / province_code
        / f"{province_code}_dissemination_areas.gpkg"
    )


def load_fed_boundaries(gpd, fed_boundaries_geojson: Path):
    if not fed_boundaries_geojson.exists():
        raise SystemExit(f"Missing local FED boundary GeoJSON: {fed_boundaries_geojson}")

    fed_gdf = gpd.read_file(fed_boundaries_geojson)
    if fed_gdf.crs is None:
        fed_gdf = fed_gdf.set_crs("EPSG:4326")
    else:
        fed_gdf = fed_gdf.to_crs("EPSG:4326")

    fed_gdf["fed_num"] = fed_gdf["fed_num"].astype(str)
    return fed_gdf[["fed_num", "geometry"]].copy()


def load_da_boundaries(gpd, gpkg_path: Path):
    da_gdf = gpd.read_file(gpkg_path)
    if da_gdf.empty:
        return da_gdf

    if da_gdf.crs is None:
        da_gdf = da_gdf.set_crs("EPSG:4326")
    else:
        da_gdf = da_gdf.to_crs("EPSG:4326")

    keep_columns = [column for column in ("DGUID", "DAUID", "LANDAREA", "PRUID") if column in da_gdf.columns]
    keep_columns.append("geometry")
    da_gdf = da_gdf[keep_columns].copy()
    da_gdf["DGUID"] = da_gdf["DGUID"].astype(str)

    if "DAUID" not in da_gdf.columns:
        da_gdf["DAUID"] = da_gdf["DGUID"].str[-8:]
    else:
        da_gdf["DAUID"] = da_gdf["DAUID"].astype(str)

    if "PRUID" in da_gdf.columns:
        da_gdf["PRUID"] = da_gdf["PRUID"].astype(str).str.zfill(2)

    return da_gdf


def build_unique_lookup(frame, key_column: str, value_column: str):
    if frame.empty:
        return {}

    duplicate_rows = frame[frame.duplicated(subset=[key_column], keep=False)]
    if not duplicate_rows.empty:
        duplicate_count = duplicate_rows[key_column].nunique()
        print(
            f"[warn] {duplicate_count} {key_column} value(s) matched multiple {value_column} records; "
            "keeping the first spatial match.",
        )

    deduped = frame.dropna(subset=[key_column, value_column]).drop_duplicates(
        subset=[key_column],
        keep="first",
    )
    return deduped.set_index(key_column)[value_column].to_dict()


def assign_fed_numbers(gpd, da_gdf, fed_gdf):
    points = da_gdf[["DGUID", "geometry"]].copy()
    points["geometry"] = da_gdf.representative_point()

    joined = gpd.sjoin(points, fed_gdf, how="left", predicate="within")
    fed_num_by_dguid = build_unique_lookup(joined, "DGUID", "fed_num")

    assigned = da_gdf.copy()
    assigned["fed_num"] = assigned["DGUID"].map(fed_num_by_dguid)

    missing = assigned["fed_num"].isna()
    if missing.any():
        try:
            nearest = gpd.sjoin_nearest(points.loc[missing], fed_gdf, how="left", distance_col="_distance")
            nearest_lookup = build_unique_lookup(nearest, "DGUID", "fed_num")
            assigned.loc[missing, "fed_num"] = assigned.loc[missing, "DGUID"].map(nearest_lookup)
        except Exception:
            pass

    assigned = assigned.loc[assigned["fed_num"].notna()].copy()
    assigned["fed_num"] = assigned["fed_num"].astype(str)
    return assigned


def export_grouped_metadata_geojson(grouped_gdf, metadata_dir: Path, max_file_bytes: int):
    summary = []

    for fed_num, fed_group in grouped_gdf:
        fed_group = fed_group.sort_values("DGUID").reset_index(drop=True)
        payload = fed_group.to_json(drop_id=True)
        features = json.loads(payload).get("features", [])
        written_paths = write_metadata_shards(
            metadata_dir,
            str(fed_num),
            features,
            max_bytes=max_file_bytes,
        )
        summary.append(
            {
                "fedNum": str(fed_num),
                "featureCount": len(features),
                "paths": [str(path).replace("\\", "/") for path in written_paths],
            }
        )

    return summary


def pd_concat(frames):
    try:
        import pandas as pd
    except ImportError as exc:
        raise SystemExit("pandas is required alongside geopandas for this build step.") from exc
    return pd.concat(frames, ignore_index=True)


def build_metadata_geojson(
    raw_root: Path | str,
    province_codes: tuple[str, ...] | list[str] | None = None,
    clean: bool = False,
    repo_root: Path | str | None = None,
    fed_boundaries_geojson: Path | str | None = None,
    metadata_out_dir: Path | str | None = None,
    max_file_mb: float = 49.0,
):
    gpd = require_geopandas()
    resolved_repo_root = resolve_repo_root(repo_root)
    resolved_fed_boundaries_geojson = (
        Path(fed_boundaries_geojson).expanduser().resolve()
        if fed_boundaries_geojson is not None
        else get_fed_boundaries_geojson_path(resolved_repo_root)
    )
    resolved_metadata_out_dir = (
        Path(metadata_out_dir).expanduser().resolve()
        if metadata_out_dir is not None
        else get_metadata_output_dir(resolved_repo_root)
    )
    resolved_raw_root = resolve_raw_root(Path(raw_root))
    selected_provinces = tuple(code.lower() for code in (province_codes or DEFAULT_PROVINCES))

    resolved_metadata_out_dir.mkdir(parents=True, exist_ok=True)
    if clean:
        remove_existing_metadata_geojson(resolved_metadata_out_dir)

    fed_gdf = load_fed_boundaries(gpd, resolved_fed_boundaries_geojson)
    all_frames = []
    discovered_paths = []

    for province_code in selected_provinces:
        gpkg = da_gpkg_path(resolved_raw_root, province_code)
        if not gpkg.exists():
            print(f"[skip] Missing {province_code} DA GeoPackage: {gpkg}")
            continue

        da_gdf = load_da_boundaries(gpd, gpkg)
        if da_gdf.empty:
            print(f"[skip] Empty {province_code} DA GeoPackage: {gpkg}")
            continue

        assigned = assign_fed_numbers(gpd, da_gdf, fed_gdf)
        if assigned.empty:
            print(f"[skip] No FED matches found for {province_code}: {gpkg}")
            continue

        all_frames.append(assigned)
        discovered_paths.append(gpkg)
        print(f"[ok] {province_code}: {len(assigned)} DA features matched to 2023 FED boundaries")

    if not all_frames:
        raise SystemExit("No DA GeoPackages were processed. Nothing to export.")

    combined = gpd.GeoDataFrame(
        pd_concat(all_frames),
        geometry="geometry",
        crs="EPSG:4326",
    )
    grouped = combined.groupby("fed_num", sort=True)
    summary = export_grouped_metadata_geojson(
        grouped,
        resolved_metadata_out_dir,
        max_file_bytes=int(max_file_mb * 1024 * 1024),
    )

    print()
    print(f"[done] Wrote {len(summary)} per-FED metadata group(s) to {resolved_metadata_out_dir}")
    print(f"[done] Source GeoPackages: {len(discovered_paths)}")

    return {
        "repo_root": str(resolved_repo_root),
        "raw_root": str(resolved_raw_root),
        "fed_boundaries_geojson": str(resolved_fed_boundaries_geojson),
        "metadata_out_dir": str(resolved_metadata_out_dir),
        "province_codes": list(selected_provinces),
        "source_gpkgs": [str(path) for path in discovered_paths],
        "summary": summary,
    }


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--raw-root",
        required=True,
        help="Path to the extracted CRMP bundle root or its raw_data directory.",
    )
    parser.add_argument(
        "--repo-root",
        default=str(ROOT),
        help="Path to the repository root that contains src/data/map.",
    )
    parser.add_argument(
        "--fed-boundaries-geojson",
        help="Optional explicit path to fed_boundaries_2023.geojson. Use this in standalone Colab mode.",
    )
    parser.add_argument(
        "--output-dir",
        help="Optional explicit output directory for fed_<FED_NUM>.geojson files. Use this in standalone Colab mode.",
    )
    parser.add_argument(
        "--province",
        action="append",
        dest="provinces",
        help="Province or territory code to include. Repeat to limit the build.",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete existing src/data/map/metadata/fed_*.geojson files before rebuilding.",
    )
    parser.add_argument(
        "--max-file-mb",
        type=float,
        default=49.0,
        help="Maximum size for each emitted metadata shard.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    build_metadata_geojson(
        raw_root=Path(args.raw_root),
        province_codes=args.provinces,
        clean=args.clean,
        repo_root=Path(args.repo_root),
        fed_boundaries_geojson=Path(args.fed_boundaries_geojson) if args.fed_boundaries_geojson else None,
        metadata_out_dir=Path(args.output_dir) if args.output_dir else None,
        max_file_mb=args.max_file_mb,
    )


if __name__ == "__main__":
    main()

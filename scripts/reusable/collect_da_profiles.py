#!/usr/bin/env python3
"""Build src/data/map/indexes/da_profile_index.json from metadata GeoJSON plus StatCan sources.

This pipeline now supports three enrichment stages:
  1. Local StatCan DA CSV files already downloaded under data/external/statcan.
  2. Official StatCan Census Profile WDS batches for missing DA population rows.
  3. Official StatCan CSD boundary matching so DA panels can show human-readable
     community names using the same centroid-to-CSD principle as the Yukon pilot.
"""

from __future__ import annotations

import argparse
import csv
import http.client
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from metadata_utils import iter_metadata_geojson_paths, load_json, normalize_text

ROOT = Path(__file__).resolve().parents[2]
METADATA_DIR = ROOT / "src" / "data" / "map" / "metadata"
CSV_ROOT = ROOT / "data" / "external" / "statcan"
CSD_CACHE_DIR = CSV_ROOT / "csd_cache"
PROFILES_OUT = ROOT / "src" / "data" / "map" / "indexes" / "da_profile_index.json"

MISSING_NAME = "missing name"
CSV_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")

STATCAN_PROFILE_SOURCE = {
    "label": "Statistics Canada Census Profile 2021 DA CSV",
    "url": "https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/download-telecharger.cfm?Lang=E",
}
STATCAN_WDS_SOURCE = {
    "label": "Statistics Canada Census Profile 2021 DA WDS",
    "url": "https://www12.statcan.gc.ca/wds-sdw/2021profile-profil2021-eng.cfm",
}
STATCAN_CSD_ARCGIS_SOURCE = {
    "label": "Statistics Canada 2021 census subdivision boundaries (spatial lookup)",
    "url": "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/9",
}
STATCAN_WDS_BASE = (
    "https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data/STC_CP,DF_DA/"
)
STATCAN_CSD_QUERY = (
    "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/"
    "Cartographic_boundary_files/MapServer/9/query"
)

GENERIC_CSD = frozenset(
    {
        "Unorganized",
        "Yukon, Unorganized",
        "Whitehorse, Unorganized",
    }
)
MAP_LABEL_CSD_DUPLICATE_THRESHOLD = 3
STATUS_RANK = {"missing": 0, "partial": 1, "ok": 2}
EPSILON = 1e-12
NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, http.client.HTTPException, OSError)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-dir", default=str(METADATA_DIR))
    parser.add_argument("--csv-root", default=str(CSV_ROOT))
    parser.add_argument("--out", default=str(PROFILES_OUT))
    parser.add_argument("--api", action="store_true")
    parser.add_argument("--api-batch-size", type=int, default=400)
    parser.add_argument("--api-delay", type=float, default=0.05)
    parser.add_argument("--api-timeout", type=float, default=45.0)
    parser.add_argument("--enrich-community", action="store_true")
    parser.add_argument("--enrich-delay", type=float, default=0.05)
    parser.add_argument("--csd-cache-dir", default=str(CSD_CACHE_DIR))
    parser.add_argument("--csd-refresh-cache", action="store_true")
    parser.add_argument("--csd-batch-size", type=int, default=100)
    return parser.parse_args()

def read_text_with_fallback(path: Path):
    raw = path.read_bytes()
    last_error = None
    for encoding in CSV_ENCODINGS:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError as error:
            last_error = error
    if last_error:
        raise last_error
    return raw.decode("utf-8", errors="replace")


def read_csv_dict_rows(path: Path):
    return list(csv.DictReader(io.StringIO(read_text_with_fallback(path))))


def fetch_json(url: str, params: dict[str, object], timeout: float, retries: int = 3):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{url}?{query}",
        headers={"User-Agent": "course-project-five-guys/da-profile-builder"},
    )
    last_error = None
    for attempt in range(1, max(retries, 1) + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read())
        except NETWORK_ERRORS as error:
            last_error = error
            if attempt >= max(retries, 1):
                raise
            time.sleep(min(1.0, 0.2 * attempt))
    if last_error:
        raise last_error
    raise RuntimeError("fetch_json failed without an exception")


def fetch_text(url: str, params: dict[str, object], timeout: float, retries: int = 3):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{url}?{query}",
        headers={"User-Agent": "course-project-five-guys/da-profile-builder"},
    )
    last_error = None
    for attempt in range(1, max(retries, 1) + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8-sig", errors="replace")
        except NETWORK_ERRORS as error:
            last_error = error
            if attempt >= max(retries, 1):
                raise
            time.sleep(min(1.0, 0.2 * attempt))
    if last_error:
        raise last_error
    raise RuntimeError("fetch_text failed without an exception")


def chunked(values, size: int):
    for index in range(0, len(values), max(size, 1)):
        yield values[index : index + max(size, 1)]


def ring_centroid(ring):
    if len(ring) < 3:
        lng = sum(point[0] for point in ring) / max(len(ring), 1)
        lat = sum(point[1] for point in ring) / max(len(ring), 1)
        return lng, lat

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
    if abs(area) < EPSILON:
        lng = sum(point[0] for point in ring) / len(ring)
        lat = sum(point[1] for point in ring) / len(ring)
        return lng, lat

    return cx / (6.0 * area), cy / (6.0 * area)


def geometry_polygons(geometry):
    geom_type = normalize_text((geometry or {}).get("type"))
    coords = (geometry or {}).get("coordinates") or []
    if geom_type == "Polygon":
        return [coords]
    if geom_type == "MultiPolygon":
        return coords
    return []


def largest_polygon_rings(feature):
    polygons = geometry_polygons(feature.get("geometry") or {})
    if not polygons:
        return []
    return max(polygons, key=lambda polygon: len(polygon[0]) if polygon else 0)


def feature_centroid(feature):
    geometry = feature.get("geometry") or {}
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates") or []

    if geom_type == "Point" and len(coords) >= 2:
        return coords[0], coords[1]
    if geom_type == "Polygon" and coords:
        return ring_centroid(coords[0])
    if geom_type == "MultiPolygon" and coords:
        largest = max(coords, key=lambda polygon: len(polygon[0]) if polygon else 0)
        if largest:
            return ring_centroid(largest[0])
    return 0.0, 0.0


def geometry_bbox(geometry):
    polygons = geometry_polygons(geometry)
    xs = []
    ys = []
    for polygon in polygons:
        for ring in polygon:
            for lng, lat in ring:
                xs.append(lng)
                ys.append(lat)
    if not xs or not ys:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def point_on_segment(point, start, end):
    px, py = point
    x1, y1 = start
    x2, y2 = end
    cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1)
    if abs(cross) > EPSILON:
        return False
    dot = (px - x1) * (px - x2) + (py - y1) * (py - y2)
    return dot <= EPSILON


def point_in_ring(point, ring):
    inside = False
    px, py = point
    if not ring:
        return False

    for index, start in enumerate(ring):
        end = ring[(index + 1) % len(ring)]
        if point_on_segment(point, start, end):
            return True

        x1, y1 = start
        x2, y2 = end
        intersects = (y1 > py) != (y2 > py)
        if not intersects:
            continue

        if abs(y2 - y1) < EPSILON:
            continue

        x_intersection = ((x2 - x1) * (py - y1) / (y2 - y1)) + x1
        if px < x_intersection:
            inside = not inside

    return inside


def point_in_polygon(point, polygon_rings):
    if not polygon_rings:
        return False
    if not point_in_ring(point, polygon_rings[0]):
        return False
    for hole in polygon_rings[1:]:
        if point_in_ring(point, hole):
            return False
    return True


def point_in_geometry(point, geometry):
    for polygon in geometry_polygons(geometry):
        if point_in_polygon(point, polygon):
            return True
    return False


def relative_path_text(path: Path):
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def iter_metadata_paths(metadata_dir: Path):
    paths = iter_metadata_geojson_paths(metadata_dir)
    if paths:
        return paths
    raise SystemExit("No metadata DA GeoJSON files were found.")


def load_metadata_features(metadata_dir: Path):
    feature_index = {}

    for path in iter_metadata_paths(metadata_dir):
        payload = load_json(path)
        for feature in payload.get("features", []):
            props = dict(feature.get("properties") or {})
            dguid = normalize_text(props.get("DGUID"))
            if not dguid:
                continue

            props["fed_num"] = normalize_text(props.get("fed_num"))
            props["DAUID"] = normalize_text(props.get("DAUID")) or dguid[-8:]
            props["PRUID"] = normalize_text(props.get("PRUID"))
            feature["properties"] = props
            feature_index[dguid] = feature

    if not feature_index:
        raise SystemExit("The metadata DA GeoJSON files contain no DGUID values.")

    return dict(sorted(feature_index.items()))


def build_base_profiles(feature_index):
    profiles = {}
    for dguid, feature in feature_index.items():
        props = feature.get("properties") or {}
        da_code = normalize_text(props.get("DAUID")) or dguid[-8:]
        profiles[dguid] = {
            "da_code": da_code,
            "fed_num": normalize_text(props.get("fed_num")),
            "pruid": normalize_text(props.get("PRUID")),
            "geo_name": MISSING_NAME,
            "name_source": None,
            "population": None,
            "status": "missing",
            "source": None,
            "community_name": None,
            "community_source": None,
            "community_display": None,
            "is_unorganized": False,
            "panel_title": f"Unnamed DA: DA {da_code}",
            "display_label": f"DA {da_code}",
            "map_label": da_code,
        }
    return profiles


def parse_statcan_profile_csv(path: Path):
    rows = read_csv_dict_rows(path)
    names = {}
    populations = {}

    for row in rows:
        dguid = normalize_text(row.get("DGUID"))
        if not dguid:
            continue

        geo_level = normalize_text(row.get("GEO_LEVEL")).lower()
        if "dissemination area" not in geo_level:
            continue

        geo_name = normalize_text(row.get("GEO_NAME"))
        if geo_name:
            names[dguid] = geo_name

        if normalize_text(row.get("CHARACTERISTIC_ID")) == "1":
            raw_population = normalize_text(row.get("C1_COUNT_TOTAL")).replace(",", "")
            if raw_population.isdigit():
                populations[dguid] = int(raw_population)

    source = {
        "label": STATCAN_PROFILE_SOURCE["label"],
        "path": relative_path_text(path),
        "url": STATCAN_PROFILE_SOURCE["url"],
    }

    parsed = {}
    for dguid in sorted(set(names) | set(populations)):
        da_code = names.get(dguid, "")
        population = populations.get(dguid)
        parsed[dguid] = {
            "da_code": da_code or None,
            "geo_name": da_code or MISSING_NAME,
            "name_source": source,
            "population": population,
            "status": "ok" if da_code and population is not None else "partial",
            "source": source,
        }

    return parsed


def iter_statcan_csv_paths(csv_root: Path):
    if not csv_root.exists():
        return []

    paths = []
    for path in sorted(csv_root.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() != ".csv":
            continue
        if "english_csv_data" not in path.name.lower():
            continue
        paths.append(path)
    return paths


def merge_profile(base_profile, patch):
    merged = dict(base_profile)

    for key, value in patch.items():
        if key == "status":
            continue
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        merged[key] = value

    incoming_status = normalize_text(patch.get("status")) or merged.get("status", "missing")
    current_status = normalize_text(merged.get("status")) or "missing"
    if STATUS_RANK.get(incoming_status, 0) >= STATUS_RANK.get(current_status, 0):
        merged["status"] = incoming_status

    return merged


def merge_csv_profiles(profiles, csv_root: Path):
    source_paths = []
    for csv_path in iter_statcan_csv_paths(csv_root):
        parsed = parse_statcan_profile_csv(csv_path)
        source_paths.append(relative_path_text(csv_path))
        print(f"[ok] Parsed {len(parsed)} DA profile rows from {csv_path.name}")
        for dguid, patch in parsed.items():
            if dguid not in profiles:
                continue
            profiles[dguid] = merge_profile(profiles[dguid], patch)
    return source_paths


def fetch_wds_population_batch(dguids, timeout: float):
    if not dguids:
        return {}

    key = f"A5.{'+'.join(dguids)}.1.1.1"
    text = fetch_text(
        STATCAN_WDS_BASE + key,
        {"detail": "dataonly", "format": "csv"},
        timeout,
    )

    parsed = {}
    rows = csv.DictReader(io.StringIO(text))
    for row in rows:
        dguid = normalize_text(row.get("REF_AREA"))
        if not dguid:
            continue

        raw_population = normalize_text(row.get("OBS_VALUE")).replace(",", "")
        if not raw_population:
            continue

        try:
            population = int(float(raw_population))
        except ValueError:
            continue

        da_code = normalize_text(row.get("ALT_GEO_CODE")) or dguid[-8:]
        source = dict(STATCAN_WDS_SOURCE)
        parsed[dguid] = {
            "da_code": da_code,
            "geo_name": da_code,
            "name_source": source,
            "population": population,
            "status": "ok",
            "source": source,
        }

    return parsed


def merge_api_profiles(profiles, batch_size: int, delay: float, timeout: float):
    candidates = [
        dguid
        for dguid, profile in sorted(profiles.items())
        if profile.get("population") is None
    ]
    if not candidates:
        return 0

    enriched = 0
    batches = list(chunked(candidates, batch_size))
    for index, batch in enumerate(batches, start=1):
        print(
            f"[wds] ({index}/{len(batches)}) requesting population for "
            f"{len(batch)} DAs"
        )
        try:
            parsed = fetch_wds_population_batch(batch, timeout=timeout)
        except NETWORK_ERRORS + (json.JSONDecodeError, ValueError) as error:
            print(f"      -> request failed: {error}")
            parsed = {}

        for dguid, patch in parsed.items():
            if dguid not in profiles:
                continue
            if profiles[dguid].get("population") is None and patch.get("population") is not None:
                enriched += 1
            profiles[dguid] = merge_profile(profiles[dguid], patch)

        print(f"      -> merged {len(parsed)} WDS rows")
        if delay > 0 and index < len(batches):
            time.sleep(delay)

    return enriched


def merge_legacy_yt_profiles(profiles, legacy_path: Path):
    if not legacy_path.exists():
        return False

    payload = load_json(legacy_path)
    legacy_profiles = payload.get("profiles") or {}
    merged_count = 0

    for dguid, legacy_profile in legacy_profiles.items():
        if dguid not in profiles:
            continue
        profiles[dguid] = merge_profile(profiles[dguid], legacy_profile)
        merged_count += 1

    print(f"[ok] Merged {merged_count} Yukon fallback profile(s) from {legacy_path.name}")
    return merged_count > 0


def cache_path_for_pruid(cache_dir: Path, pruid: str):
    return cache_dir / f"csd_{pruid}.geojson"


def fetch_csd_feature_page(object_ids, timeout: float):
    return fetch_json(
        STATCAN_CSD_QUERY,
        {
            "objectIds": ",".join(str(value) for value in object_ids),
            "outFields": "CSDNAME,PRUID,CSDUID,DGUID,OBJECTID",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        },
        timeout,
    )


def fetch_csd_feature_page_resilient(object_ids, timeout: float):
    if not object_ids:
        return []

    try:
        payload = fetch_csd_feature_page(object_ids, timeout=timeout)
        return payload.get("features") or []
    except NETWORK_ERRORS + (json.JSONDecodeError, ValueError):
        if len(object_ids) == 1:
            raise
        midpoint = len(object_ids) // 2
        left = fetch_csd_feature_page_resilient(object_ids[:midpoint], timeout)
        right = fetch_csd_feature_page_resilient(object_ids[midpoint:], timeout)
        return left + right


def fetch_csd_features_for_pruid(
    pruid: str,
    cache_dir: Path,
    refresh_cache: bool,
    batch_size: int,
    timeout: float,
):
    cache_path = cache_path_for_pruid(cache_dir, pruid)
    if cache_path.exists() and not refresh_cache:
        return (load_json(cache_path).get("features") or [])

    ids_payload = fetch_json(
        STATCAN_CSD_QUERY,
        {
            "where": f"PRUID='{pruid}'",
            "returnIdsOnly": "true",
            "f": "json",
        },
        timeout,
    )
    object_ids = ids_payload.get("objectIds") or []
    features = []
    for ids_chunk in chunked(object_ids, batch_size):
        features.extend(fetch_csd_feature_page_resilient(ids_chunk, timeout=timeout))

    filtered = [
        feature
        for feature in features
        if normalize_text(feature.get("properties", {}).get("PRUID")) == pruid
    ]
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": filtered}, ensure_ascii=False),
        encoding="utf-8",
    )
    return filtered


def prepare_csd_lookup(features):
    prepared = []
    for feature in features:
        geometry = feature.get("geometry") or {}
        bbox = geometry_bbox(geometry)
        if not bbox:
            continue
        prepared.append(
            {
                "name": normalize_text(feature.get("properties", {}).get("CSDNAME")),
                "bbox": bbox,
                "geometry": geometry,
            }
        )
    return prepared


def bbox_contains(point, bbox):
    lng, lat = point
    min_lng, min_lat, max_lng, max_lat = bbox
    return min_lng <= lng <= max_lng and min_lat <= lat <= max_lat


def match_csd_name(point, prepared_lookup):
    for item in prepared_lookup:
        if not item["name"]:
            continue
        if not bbox_contains(point, item["bbox"]):
            continue
        if point_in_geometry(point, item["geometry"]):
            return item["name"]
    return None


def fetch_csd_name_at_point(lng: float, lat: float, pruid: str, timeout: float = 30.0):
    params = {
        "geometry": f"{lng},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "CSDNAME",
        "f": "json",
    }
    if pruid:
        params["where"] = f"PRUID='{pruid}'"

    payload = fetch_json(STATCAN_CSD_QUERY, params, timeout)
    features = payload.get("features") or []
    if not features:
        return None

    name = normalize_text(features[0].get("attributes", {}).get("CSDNAME"))
    return name or None


def fetch_csd_name_for_feature(feature, pruid: str, timeout: float = 30.0):
    rings = largest_polygon_rings(feature)
    if not rings:
        return None

    params = {
        "geometry": json.dumps({"rings": rings, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPolygon",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "CSDNAME",
        "returnGeometry": "false",
        "f": "json",
    }
    if pruid:
        params["where"] = f"PRUID='{pruid}'"

    payload = fetch_json(STATCAN_CSD_QUERY, params, timeout)
    features = payload.get("features") or []
    if not features:
        return None

    name = normalize_text(features[0].get("attributes", {}).get("CSDNAME"))
    return name or None


def shorten_csd_name(name: str):
    text = normalize_text(name)
    if text.startswith("Yukon, "):
        return text[len("Yukon, ") :].strip()
    return text


def is_uninformative_csd(name: str):
    text = normalize_text(name)
    if not text:
        return False
    if text in GENERIC_CSD:
        return True
    return shorten_csd_name(text) == "Unorganized"


def enrich_community_names(
    profiles,
    feature_index,
    delay: float,
    cache_dir: Path,
    refresh_cache: bool,
    batch_size: int,
    timeout: float,
):
    grouped = defaultdict(list)
    for dguid, profile in sorted(profiles.items()):
        if normalize_text(profile.get("community_name")):
            continue
        pruid = normalize_text(profile.get("pruid")) or normalize_text(
            feature_index.get(dguid, {}).get("properties", {}).get("PRUID")
        )
        if not pruid:
            continue
        grouped[pruid].append(dguid)

    enriched = 0
    fallback_attempts = 0
    for pruid, dguids in sorted(grouped.items()):
        print(f"[csd] loading PRUID {pruid} for {len(dguids)} DA centroids")
        try:
            csd_features = fetch_csd_features_for_pruid(
                pruid,
                cache_dir=cache_dir,
                refresh_cache=refresh_cache,
                batch_size=batch_size,
                timeout=timeout,
            )
        except NETWORK_ERRORS + (json.JSONDecodeError, ValueError) as error:
            print(f"      -> CSD cache fetch failed: {error}")
            csd_features = []

        lookup = prepare_csd_lookup(csd_features)
        unmatched = []
        for dguid in dguids:
            feature = feature_index.get(dguid)
            if not feature:
                continue
            profile = profiles[dguid]
            name = match_csd_name(feature_centroid(feature), lookup)
            if name:
                profile["community_name"] = name
                profile["community_source"] = dict(STATCAN_CSD_ARCGIS_SOURCE)
                enriched += 1
            else:
                unmatched.append(dguid)

        print(f"      -> centroid matched {len(dguids) - len(unmatched)} / {len(dguids)}")
        for dguid in unmatched:
            feature = feature_index.get(dguid)
            if not feature:
                continue
            profile = profiles[dguid]
            try:
                name = fetch_csd_name_for_feature(feature, pruid, timeout=timeout) or fetch_csd_name_at_point(
                    *feature_centroid(feature),
                    pruid,
                    timeout=timeout,
                )
            except NETWORK_ERRORS + (json.JSONDecodeError, ValueError):
                name = None

            fallback_attempts += 1
            if name:
                profile["community_name"] = name
                profile["community_source"] = dict(STATCAN_CSD_ARCGIS_SOURCE)
                enriched += 1

            if delay > 0 and fallback_attempts % 10 == 0:
                time.sleep(delay)

    return enriched


def finalize_display_labels(profiles):
    preferred_name = {}
    duplicate_counts = Counter()

    for dguid, profile in profiles.items():
        da_code = normalize_text(profile.get("da_code")) or dguid[-8:]
        community_name = normalize_text(profile.get("community_name"))
        geo_name = normalize_text(profile.get("geo_name"))
        geo_name_is_human = bool(
            geo_name and geo_name != MISSING_NAME and geo_name != da_code and not geo_name.isdigit()
        )

        candidate = community_name or (geo_name if geo_name_is_human else "")
        if not candidate or is_uninformative_csd(candidate):
            preferred_name[dguid] = None
            continue

        short_name = shorten_csd_name(candidate)
        preferred_name[dguid] = short_name
        duplicate_counts[(normalize_text(profile.get("pruid")), short_name)] += 1

    for dguid, profile in profiles.items():
        da_code = normalize_text(profile.get("da_code")) or dguid[-8:]
        short_name = preferred_name.get(dguid)
        geo_name = normalize_text(profile.get("geo_name"))
        has_geo_name = bool(geo_name and geo_name != MISSING_NAME)
        has_population = profile.get("population") is not None

        if not short_name:
            profile["community_display"] = None
            profile["is_unorganized"] = is_uninformative_csd(
                normalize_text(profile.get("community_name"))
            )
            profile["panel_title"] = f"Unnamed DA: DA {da_code}"
            profile["display_label"] = f"DA {da_code}"
            profile["map_label"] = da_code
        else:
            key = (normalize_text(profile.get("pruid")), short_name)
            profile["community_display"] = short_name
            profile["is_unorganized"] = False
            profile["panel_title"] = short_name
            profile["display_label"] = short_name
            profile["map_label"] = (
                da_code
                if duplicate_counts[key] > MAP_LABEL_CSD_DUPLICATE_THRESHOLD
                else short_name
            )

        profile["status"] = (
            "ok"
            if has_geo_name and has_population
            else "partial"
            if has_geo_name or has_population or short_name
            else "missing"
        )


def write_profiles(
    out_path: Path,
    profiles,
    sources,
    legacy_yt_used: bool,
    api_enriched: bool,
    community_enriched: bool,
    cache_dir: Path,
):
    ok_count = sum(1 for profile in profiles.values() if profile.get("status") == "ok")
    partial_count = sum(
        1 for profile in profiles.values() if profile.get("status") == "partial"
    )
    missing_count = sum(
        1 for profile in profiles.values() if profile.get("status") == "missing"
    )

    payload = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "dguid_count": len(profiles),
            "ok": ok_count,
            "partial": partial_count,
            "missing": missing_count,
            "sources": sources,
            "missing_name_literal": MISSING_NAME,
            "collection_pipeline": "metadata_geojson_plus_csv_plus_wds_plus_csd_matching",
            "legacy_yt_fallback_used": False,
            "wds_population_enriched": api_enriched,
            "community_enriched": community_enriched,
            "statcan_profile_source": STATCAN_PROFILE_SOURCE,
            "statcan_wds_source": STATCAN_WDS_SOURCE,
            "statcan_csd_source": STATCAN_CSD_ARCGIS_SOURCE,
            "csd_cache_dir": relative_path_text(cache_dir),
        },
        "profiles": dict(sorted(profiles.items())),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    args = parse_args()

    metadata_dir = Path(args.metadata_dir).expanduser().resolve()
    csv_root = Path(args.csv_root).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()
    cache_dir = Path(args.csd_cache_dir).expanduser().resolve()

    feature_index = load_metadata_features(metadata_dir)
    profiles = build_base_profiles(feature_index)
    sources = merge_csv_profiles(profiles, csv_root)

    api_enriched = False
    if args.api:
        count = merge_api_profiles(
            profiles,
            batch_size=args.api_batch_size,
            delay=args.api_delay,
            timeout=args.api_timeout,
        )
        api_enriched = count > 0
        if api_enriched:
            sources.append(STATCAN_WDS_SOURCE["url"])
        print(f"[ok] Enriched {count} DA population row(s) via StatCan WDS")

    community_enriched = False
    if args.enrich_community:
        count = enrich_community_names(
            profiles,
            feature_index,
            delay=args.enrich_delay,
            cache_dir=cache_dir,
            refresh_cache=args.csd_refresh_cache,
            batch_size=args.csd_batch_size,
            timeout=max(args.api_timeout, 45.0),
        )
        community_enriched = count > 0
        print(f"[ok] Enriched {count} DA community name(s) via StatCan CSD lookup")

    finalize_display_labels(profiles)
    write_profiles(
        out_path,
        profiles,
        sources,
        False,
        api_enriched,
        community_enriched,
        cache_dir,
    )

    meta = {
        "profiles": len(profiles),
        "sources": len(sources),
        "out": relative_path_text(out_path),
    }
    print(
        f"[done] Wrote {meta['profiles']} profiles to {meta['out']} from "
        f"{meta['sources']} source(s)"
    )


if __name__ == "__main__":
    main()

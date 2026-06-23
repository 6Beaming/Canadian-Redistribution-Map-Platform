#!/usr/bin/env python3
"""Collect per-DA GEO_NAME and 2021 population for Yukon DAs (external sources).

The CRMP bundle does not include 006/territories.csv. This script fills
src/data/map/yt_da_profiles.json from **outside** the zip:

  1. StatCan Census Profile CSV (recommended) — must contain **Dissemination area**
     rows (`GEO_LEVEL`). For Yukon that is product **98-401-X2021006** (territories,
     includes DAs), *not* 98-401-X2021008 (economic regions only).
     Download “Territories only” from StatCan and pass --csv path/to/*_English_CSV_data.csv

  2. StatCan Census Profile Web Data Service (SDMX) — per-DGUID API attempts
     (--api). May require network access from Colab or a machine that can reach
     api.statcan.gc.ca.

  3. Placeholders — any DGUID still unmatched gets geo_name="missing name",
     population=null, status="missing".

Usage:
  python scripts/collect_yt_da_profiles.py --init
  python scripts/collect_yt_da_profiles.py --csv /path/to/territories_profile.csv
  python scripts/collect_yt_da_profiles.py --api
  python scripts/collect_yt_da_profiles.py --csv file.csv --api   # CSV first, API fills gaps
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DA_GEOJSON = ROOT / "src" / "data" / "map" / "single_fed_das.geojson"
PROFILES_OUT = ROOT / "src" / "data" / "map" / "yt_da_profiles.json"

MISSING_NAME = "missing name"

STATCAN_PROFILE_SOURCE = {
    "label": "Statistics Canada — Census Profile 2021 (98-401-X2021006, Territories)",
    "url": "https://www150.statcan.gc.ca/n1/en/catalogue/98-401-X2021006",
}
STATCAN_CSD_ARCGIS_SOURCE = {
    "label": "Statistics Canada — 2021 census subdivision boundaries (spatial lookup)",
    "url": "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/9",
}
STATCAN_CSD_QUERY = (
    "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/"
    "Cartographic_boundary_files/MapServer/9/query"
)

STATCAN_WDS_BASE = (
    "https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data/STC_CP,DF_DA"
)
CSV_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")

# SDMX key patterns to try per DGUID (API dimension order varies by release)
WDS_KEY_SUFFIXES = (
    ".A1..",
    "..A1.",
    ".1..",
    "..1.",
    "...",
    "..",
    ".",
)


def read_csv_dict_rows(path: Path) -> list[dict[str, str]]:
    raw = path.read_bytes()
    last_error: Exception | None = None
    for encoding in CSV_ENCODINGS:
        try:
            text = raw.decode(encoding)
            return list(csv.DictReader(io.StringIO(text)))
        except UnicodeDecodeError as error:
            last_error = error
    if last_error:
        raise last_error
    return list(csv.DictReader(raw.decode(CSV_ENCODINGS[0]).splitlines()))


def feature_centroid(feature: dict) -> tuple[float, float]:
    geometry = feature["geometry"]
    geom_type = geometry["type"]
    coords = geometry["coordinates"]
    if geom_type == "Point":
        return coords[0], coords[1]
    ring = coords[0] if geom_type == "Polygon" else coords[0][0]
    lng = sum(p[0] for p in ring) / len(ring)
    lat = sum(p[1] for p in ring) / len(ring)
    return lng, lat


def load_da_features() -> dict[str, dict]:
    payload = json.loads(DA_GEOJSON.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for feature in payload.get("features", []):
        dguid = str(feature.get("properties", {}).get("DGUID", "")).strip()
        if dguid:
            out[dguid] = feature
    return out


def fetch_csd_name_at_point(lng: float, lat: float, timeout: float = 30.0) -> str | None:
    """Official StatCan CSD name containing (lng, lat) — Yukon PRUID 60."""
    import urllib.parse

    params = {
        "geometry": f"{lng},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "CSDNAME",
        "where": "PRUID='60'",
        "f": "json",
    }
    url = STATCAN_CSD_QUERY + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    features = data.get("features") or []
    if not features:
        return None
    name = str(features[0].get("attributes", {}).get("CSDNAME", "")).strip()
    return name or None


GENERIC_CSD = frozenset({
    "Unorganized",
    "Yukon, Unorganized",
    "Whitehorse, Unorganized",
})
# When more than this many DAs share one CSD, map labels show DA code only (e.g. Whitehorse ×28).
MAP_LABEL_CSD_DUPLICATE_THRESHOLD = 3


def shorten_csd_name(csd: str) -> str:
    """Drop territory prefix already implied by the Yukon pilot UI."""
    text = csd.strip()
    if text.startswith("Yukon, "):
        text = text[len("Yukon, ") :].strip()
    return text


def is_uninformative_csd(csd: str) -> bool:
    """StatCan 'Unorganized' CSDs have no municipal name — use DA code instead."""
    if csd in GENERIC_CSD:
        return True
    return shorten_csd_name(csd) == "Unorganized"


def finalize_display_labels(profiles: dict[str, dict]) -> None:
    """Build display_label / map_label; hide generic 'Unorganized' CSD wording."""
    from collections import Counter

    csd_counts = Counter(
        p.get("community_name")
        for p in profiles.values()
        if p.get("community_name")
    )
    for profile in profiles.values():
        csd = profile.get("community_name")
        da_code = str(profile.get("da_code") or "").strip()
        if not da_code:
            continue
        if not csd:
            profile["is_unorganized"] = False
            profile["panel_title"] = f"Unnamed DA: DA {da_code}"
            profile["display_label"] = f"DA {da_code}"
            profile["map_label"] = da_code
            continue
        if is_uninformative_csd(csd):
            profile["community_display"] = None
            profile["is_unorganized"] = True
            profile["panel_title"] = f"Unnamed DA: DA {da_code}"
            profile["display_label"] = f"DA {da_code}"
            profile["map_label"] = da_code
            continue
        short = shorten_csd_name(csd)
        profile["community_display"] = short
        profile["is_unorganized"] = False
        profile["panel_title"] = short
        profile["display_label"] = short
        if csd_counts[csd] > MAP_LABEL_CSD_DUPLICATE_THRESHOLD:
            profile["map_label"] = da_code
        else:
            profile["map_label"] = short


def enrich_community_names(
    profiles: dict[str, dict],
    da_features: dict[str, dict],
    delay: float,
) -> int:
    """Add community_name via StatCan ArcGIS CSD polygon lookup at DA centroid."""
    enriched = 0
    targets = [
        (dguid, profile)
        for dguid, profile in sorted(profiles.items())
        if profile.get("status") != "missing"
    ]
    for index, (dguid, profile) in enumerate(targets, start=1):
        feature = da_features.get(dguid)
        if not feature:
            continue
        lng, lat = feature_centroid(feature)
        print(f"[CSD] ({index}/{len(targets)}) {dguid} …", flush=True)
        community = fetch_csd_name_at_point(lng, lat)
        if community:
            da_code = profile.get("da_code") or profile.get("geo_name", "")
            profile["community_name"] = community
            profile["community_source"] = dict(STATCAN_CSD_ARCGIS_SOURCE)
            enriched += 1
            print(f"      -> CSD {community!r}")
        else:
            print("      -> no CSD match")
        if delay > 0 and index < len(targets):
            time.sleep(delay)
    return enriched


def load_dguids() -> list[str]:
    if not DA_GEOJSON.exists():
        raise SystemExit(f"Missing DA GeoJSON: {DA_GEOJSON}")
    payload = json.loads(DA_GEOJSON.read_text(encoding="utf-8"))
    dguids: list[str] = []
    for feature in payload.get("features", []):
        dguid = str(feature.get("properties", {}).get("DGUID", "")).strip()
        if dguid:
            dguids.append(dguid)
    if not dguids:
        raise SystemExit(f"No DGUID values in {DA_GEOJSON}")
    return sorted(set(dguids))


def missing_profile() -> dict:
    return {
        "geo_name": MISSING_NAME,
        "population": None,
        "status": "missing",
        "source": None,
    }


def parse_statcan_profile_csv(path: Path) -> dict[str, dict]:
    """DGUID -> {geo_name, population} from long-format StatCan profile CSV."""
    rows = read_csv_dict_rows(path)
    names: dict[str, str] = {}
    populations: dict[str, int] = {}

    for row in rows:
        dguid = str(row.get("DGUID", "")).strip()
        if not dguid:
            continue
        level = str(row.get("GEO_LEVEL", "")).lower()
        if "dissemination area" not in level:
            continue
        geo_name = str(row.get("GEO_NAME", "")).strip()
        if geo_name:
            names[dguid] = geo_name
        char_id = str(row.get("CHARACTERISTIC_ID", "")).strip()
        if char_id == "1":
            raw_pop = str(row.get("C1_COUNT_TOTAL", "")).replace(",", "").strip()
            if raw_pop.isdigit():
                populations[dguid] = int(raw_pop)

    out: dict[str, dict] = {}
    for dguid in set(names) | set(populations):
        da_code = names.get(dguid, "")
        out[dguid] = {
            "da_code": da_code if da_code else None,
            "geo_name": da_code or MISSING_NAME,
            "population": populations.get(dguid),
            "status": "ok"
            if da_code and dguid in populations
            else "partial",
            "source": dict(STATCAN_PROFILE_SOURCE),
        }
    return out


def _parse_wds_json(body: bytes) -> tuple[str | None, int | None]:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None, None

    text = json.dumps(payload)
    name_match = re.search(r'"GEO_NAME"[^"]*"([^"]{2,120})"', text)
    pop_match = re.search(r'"C1_COUNT_TOTAL"[^0-9]*(\d+)', text)
    if not pop_match:
        pop_match = re.search(r'"value"\s*:\s*"?(\d{1,7})"?', text)

    name = name_match.group(1).strip() if name_match else None
    pop = int(pop_match.group(1)) if pop_match else None
    return name, pop


def fetch_wds_profile(dguid: str, timeout: float = 45.0) -> dict | None:
    for suffix in WDS_KEY_SUFFIXES:
        url = (
            f"{STATCAN_WDS_BASE}/{dguid}{suffix}"
            f"?dimensionAtObservation=AllDimensions&format=json"
        )
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                name, pop = _parse_wds_json(resp.read(500_000))
                if name or pop is not None:
                    return {
                        "geo_name": name or MISSING_NAME,
                        "population": pop,
                        "status": "ok" if name and pop is not None else "partial",
                        "source": "statcan_wds",
                    }
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            continue
    return None


def fetch_profile_page(dguid: str, timeout: float = 30.0) -> dict | None:
    url = (
        "https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/page.cfm"
        f"?Lang=E&DGUID={dguid}"
    )
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError):
        return None

    if "File not found" in html or "Fichier non trouv" in html:
        return None

    title = re.search(
        r'class="geoName"[^>]*>([^<]+)<', html, re.I
    ) or re.search(r"<h1[^>]*>([^<]+)</h1>", html, re.I)
    pop = re.search(
        r"Population,?\s*2021[^0-9]{0,40}([\d,]+)", html, re.I | re.S
    )
    name = title.group(1).strip() if title else None
    population = int(pop.group(1).replace(",", "")) if pop else None
    if not name and population is None:
        return None
    return {
        "geo_name": name or MISSING_NAME,
        "population": population,
        "status": "ok" if name and population is not None else "partial",
        "source": "statcan_profile_page",
    }


def collect_from_api(dguids: list[str], delay: float) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for index, dguid in enumerate(dguids, start=1):
        print(f"[API] ({index}/{len(dguids)}) {dguid} …", flush=True)
        profile = fetch_wds_profile(dguid) or fetch_profile_page(dguid)
        if profile:
            out[dguid] = profile
            print(f"      -> {profile['geo_name']!r}, pop={profile['population']}")
        else:
            print("      -> no match")
        if delay > 0 and index < len(dguids):
            time.sleep(delay)
    return out


def build_profiles(
    dguids: list[str],
    csv_path: Path | None,
    use_api: bool,
    api_delay: float,
    enrich_community: bool,
    enrich_delay: float,
) -> dict[str, dict]:
    profiles: dict[str, dict] = {dguid: missing_profile() for dguid in dguids}

    if csv_path:
        if not csv_path.exists():
            raise SystemExit(f"CSV not found: {csv_path}")
        from_csv = parse_statcan_profile_csv(csv_path)
        print(f"[OK] Parsed {len(from_csv)} DA rows from {csv_path.name}")
        if not from_csv:
            print(
                "[WARN] CSV has no dissemination-area rows — "
                "Yukon needs product 98-401-X2021006 (territories), not 98-401-X2021008 (economic regions)."
            )
        for dguid in dguids:
            if dguid in from_csv:
                profiles[dguid] = from_csv[dguid]

    if use_api:
        pending = [d for d in dguids if profiles[d]["status"] == "missing"]
        if pending:
            print(f"[INFO] API lookup for {len(pending)} DGUID(s)")
            profiles.update(collect_from_api(pending, api_delay))

    if enrich_community:
        da_features = load_da_features()
        count = enrich_community_names(profiles, da_features, enrich_delay)
        print(f"[OK] Enriched {count} community name(s) via StatCan CSD boundaries")

    finalize_display_labels(profiles)

    return profiles


def write_profiles(profiles: dict[str, dict], sources: list[str]) -> None:
    ok = sum(1 for p in profiles.values() if p["status"] == "ok")
    partial = sum(1 for p in profiles.values() if p["status"] == "partial")
    missing = sum(1 for p in profiles.values() if p["status"] == "missing")

    payload = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "dguid_count": len(profiles),
            "ok": ok,
            "partial": partial,
            "missing": missing,
            "sources": sources,
            "missing_name_literal": MISSING_NAME,
            "collection_pipeline": "csv_da_level_then_api",
            "statcan_profile_source": STATCAN_PROFILE_SOURCE,
            "statcan_csd_source": STATCAN_CSD_ARCGIS_SOURCE,
        },
        "profiles": profiles,
    }
    PROFILES_OUT.parent.mkdir(parents=True, exist_ok=True)
    PROFILES_OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n[OK] Wrote {PROFILES_OUT}")
    print(f"     ok={ok} partial={partial} missing={missing}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--init",
        action="store_true",
        help="Write placeholder profiles for all DGUIDs in single_fed_das.geojson",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        help="External StatCan long-format profile CSV with DA-level rows (e.g. 98-401-X2021006 territories)",
    )
    parser.add_argument(
        "--api",
        action="store_true",
        help="Query StatCan WDS / profile page per DGUID (slow; fills gaps after --csv)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.35,
        help="Seconds between API requests (default: 0.35)",
    )
    parser.add_argument(
        "--enrich-community",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Look up CSD community names via StatCan ArcGIS at DA centroids (default: on)",
    )
    parser.add_argument(
        "--enrich-delay",
        type=float,
        default=0.2,
        help="Seconds between CSD ArcGIS requests (default: 0.2)",
    )
    parser.add_argument(
        "--finalize-only",
        action="store_true",
        help="Recompute display_label/map_label on existing yt_da_profiles.json (no network)",
    )
    args = parser.parse_args()

    if args.finalize_only:
        if not PROFILES_OUT.exists():
            raise SystemExit(f"Missing {PROFILES_OUT}")
        payload = json.loads(PROFILES_OUT.read_text(encoding="utf-8"))
        profiles = payload.get("profiles", {})
        finalize_display_labels(profiles)
        payload["profiles"] = profiles
        payload["_meta"]["display_finalized_at"] = datetime.now(timezone.utc).isoformat()
        PROFILES_OUT.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[OK] Finalized display labels -> {PROFILES_OUT}")
        return 0

    if not args.init and not args.csv and not args.api:
        parser.print_help()
        print(
            "\nTip: run --init for placeholders, or --csv with a StatCan territories download.",
            file=sys.stderr,
        )
        return 1

    dguids = load_dguids()
    sources: list[str] = []

    if args.init and not args.csv and not args.api:
        profiles = {dguid: missing_profile() for dguid in dguids}
        sources.append("placeholder_init")
        write_profiles(profiles, sources)
        return 0

    if args.csv:
        sources.append(f"csv:{args.csv}")
    if args.api:
        sources.append("statcan_api")

    profiles = build_profiles(
        dguids,
        args.csv,
        args.api,
        args.delay,
        args.enrich_community,
        args.enrich_delay,
    )
    write_profiles(profiles, sources)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Generate map-mvp/data/fed_labels.geojson from external FED name table.

MVP FED labels use scripts/data/fed_names_2023.json (Elections Canada 2023 RO
name list, 343 entries) — not the bundle-derived 338-name merge.

  python scripts/generate_fed_labels.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "map-mvp" / "data"
FED_NAMES = Path(__file__).resolve().parent / "data" / "fed_names_2023.json"
FED_GEOJSON = DATA_DIR / "fed_boundaries_2023.geojson"
FED_LABELS_OUT = DATA_DIR / "fed_labels.geojson"


def ring_centroid(ring: list[list[float]]) -> tuple[float, float]:
    if len(ring) < 3:
        lng = sum(p[0] for p in ring) / len(ring)
        lat = sum(p[1] for p in ring) / len(ring)
        return lng, lat

    area = 0.0
    cx = 0.0
    cy = 0.0
    for i, point in enumerate(ring):
        nxt = ring[(i + 1) % len(ring)]
        cross = point[0] * nxt[1] - nxt[0] * point[1]
        area += cross
        cx += (point[0] + nxt[0]) * cross
        cy += (point[1] + nxt[1]) * cross

    area *= 0.5
    if abs(area) < 1e-12:
        lng = sum(p[0] for p in ring) / len(ring)
        lat = sum(p[1] for p in ring) / len(ring)
        return lng, lat

    return cx / (6.0 * area), cy / (6.0 * area)


def geometry_centroid(geometry: dict) -> tuple[float, float]:
    geom_type = geometry["type"]
    coords = geometry["coordinates"]

    if geom_type == "Polygon":
        return ring_centroid(coords[0])
    if geom_type == "MultiPolygon":
        largest = coords[0]
        largest_area = 0.0
        for polygon in coords:
            ring = polygon[0]
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            area = abs((max(xs) - min(xs)) * (max(ys) - min(ys)))
            if area > largest_area:
                largest_area = area
                largest = polygon
        return ring_centroid(largest[0])
    if geom_type == "Point":
        return coords[0], coords[1]
    return 0.0, 0.0


def load_fed_names() -> dict[str, str]:
    if not FED_NAMES.exists():
        raise SystemExit(f"Missing FED name table: {FED_NAMES}")
    payload = json.loads(FED_NAMES.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "names" in payload:
        return {str(k): str(v) for k, v in payload["names"].items()}
    return {str(k): str(v) for k, v in payload.items()}


def main() -> None:
    if not FED_GEOJSON.exists():
        raise SystemExit(f"Missing FED GeoJSON: {FED_GEOJSON}")

    fed_names = load_fed_names()
    fed_geojson = json.loads(FED_GEOJSON.read_text(encoding="utf-8"))
    features = []

    for feature in fed_geojson.get("features", []):
        fed_num = str(feature.get("properties", {}).get("fed_num", "")).strip()
        if not fed_num:
            continue
        lng, lat = geometry_centroid(feature["geometry"])
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lng, lat]},
                "properties": {
                    "name": fed_names.get(fed_num, f"FED {fed_num}"),
                    "fed_num": fed_num,
                    "source": "fed_names_2023.json",
                },
            }
        )

    features.sort(key=lambda f: f["properties"]["fed_num"])
    out = {"type": "FeatureCollection", "features": features}
    FED_LABELS_OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"[OK] Wrote {len(features)} FED labels -> {FED_LABELS_OUT}")


if __name__ == "__main__":
    main()

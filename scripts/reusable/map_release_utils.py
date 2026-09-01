from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Iterable, Iterator


MAP_ROOT = Path("src/data/map")
MAX_GIT_FILE_BYTES = 80 * 1024 * 1024


def canonical_json_bytes(value) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as target:
        json.dump(
            value,
            target,
            ensure_ascii=False,
            sort_keys=True,
            indent=None if compact else 2,
            separators=(",", ":") if compact else None,
        )
        target.write("\n")


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as source:
        return json.load(source)


def find_feature_array_start(data: bytes) -> int:
    marker = b'"features"'
    marker_at = data.find(marker)
    if marker_at < 0:
        raise ValueError("GeoJSON does not contain a features property.")

    cursor = marker_at + len(marker)
    while cursor < len(data) and data[cursor] in b" \t\r\n":
        cursor += 1
    if cursor >= len(data) or data[cursor] != ord(":"):
        raise ValueError("GeoJSON features property is malformed.")
    cursor += 1
    while cursor < len(data) and data[cursor] in b" \t\r\n":
        cursor += 1
    if cursor >= len(data) or data[cursor] != ord("["):
        raise ValueError("GeoJSON features value is not an array.")
    return cursor + 1


def iter_feature_slices(data: bytes) -> Iterator[tuple[int, int]]:
    """Yield UTF-8 byte ranges for each top-level Feature object.

    The scanner deliberately does not decode the complete shard. It tracks JSON
    string escapes and nested object/array depth so offsets remain valid for
    non-ASCII feature properties.
    """

    cursor = find_feature_array_start(data)
    data_length = len(data)

    while cursor < data_length:
        while cursor < data_length and data[cursor] in b" \t\r\n,":
            cursor += 1
        if cursor >= data_length or data[cursor] == ord("]"):
            return
        if data[cursor] != ord("{"):
            raise ValueError(f"Expected Feature object at byte {cursor}.")

        start = cursor
        object_depth = 0
        array_depth = 0
        in_string = False
        escaped = False

        while cursor < data_length:
            byte = data[cursor]
            if in_string:
                if escaped:
                    escaped = False
                elif byte == ord("\\"):
                    escaped = True
                elif byte == ord('"'):
                    in_string = False
            elif byte == ord('"'):
                in_string = True
            elif byte == ord("{"):
                object_depth += 1
            elif byte == ord("}"):
                object_depth -= 1
                if object_depth == 0 and array_depth == 0:
                    yield start, cursor + 1
                    cursor += 1
                    break
            elif byte == ord("["):
                array_depth += 1
            elif byte == ord("]"):
                array_depth -= 1
            cursor += 1
        else:
            raise ValueError(f"Unterminated Feature object at byte {start}.")


def iter_positions(geometry) -> Iterator[tuple[float, float]]:
    if not isinstance(geometry, dict):
        return

    def visit(value):
        if (
            isinstance(value, list)
            and len(value) >= 2
            and isinstance(value[0], (int, float))
            and isinstance(value[1], (int, float))
        ):
            yield normalize_coordinate(value)
            return
        if isinstance(value, list):
            for child in value:
                yield from visit(child)

    yield from visit(geometry.get("coordinates"))


def iter_rings(geometry) -> Iterator[tuple[int, int, list]]:
    if not isinstance(geometry, dict):
        return
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon" and isinstance(coordinates, list):
        for ring_index, ring in enumerate(coordinates):
            if isinstance(ring, list):
                yield 0, ring_index, ring
    elif geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        for polygon_index, polygon in enumerate(coordinates):
            if not isinstance(polygon, list):
                continue
            for ring_index, ring in enumerate(polygon):
                if isinstance(ring, list):
                    yield polygon_index, ring_index, ring


def normalize_coordinate(value, precision: int = 8) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError("Coordinate must contain longitude and latitude.")
    longitude = float(value[0])
    latitude = float(value[1])
    if not math.isfinite(longitude) or not math.isfinite(latitude):
        raise ValueError("Coordinate must be finite.")
    if longitude < -180 or longitude > 180 or latitude < -90 or latitude > 90:
        raise ValueError("Coordinate falls outside longitude/latitude bounds.")
    return round(longitude, precision), round(latitude, precision)


def coordinate_key(value, precision: int = 8) -> str:
    longitude, latitude = normalize_coordinate(value, precision)
    return f"{longitude:.{precision}f},{latitude:.{precision}f}"


def edge_key(first, second, precision: int = 8) -> str:
    first_key = coordinate_key(first, precision)
    second_key = coordinate_key(second, precision)
    return "|".join(sorted((first_key, second_key)))


def get_dguid(feature) -> str:
    properties = feature.get("properties") if isinstance(feature, dict) else None
    value = (properties or {}).get("DGUID") or feature.get("id")
    return str(value or "").strip()


def get_fed_num(feature) -> str:
    properties = feature.get("properties") if isinstance(feature, dict) else None
    return str((properties or {}).get("fed_num") or "").strip()


def get_pruid(feature) -> str:
    properties = feature.get("properties") if isinstance(feature, dict) else None
    return str((properties or {}).get("PRUID") or (properties or {}).get("pruid") or "").strip()


def validate_feature(feature) -> list[str]:
    errors: list[str] = []
    dguid = get_dguid(feature)
    if not dguid:
        errors.append("missing DGUID")
    if feature.get("type") != "Feature":
        errors.append("type is not Feature")
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") not in {
        "Polygon",
        "MultiPolygon",
    }:
        errors.append("geometry is not Polygon/MultiPolygon")
        return errors

    position_count = 0
    try:
        for _ in iter_positions(geometry):
            position_count += 1
    except (TypeError, ValueError) as error:
        errors.append(str(error))
    if position_count == 0:
        errors.append("geometry has no coordinates")

    for polygon_index, ring_index, ring in iter_rings(geometry):
        if len(ring) < 4:
            errors.append(f"ring {polygon_index}/{ring_index} has fewer than four positions")
            continue
        try:
            if normalize_coordinate(ring[0]) != normalize_coordinate(ring[-1]):
                errors.append(f"ring {polygon_index}/{ring_index} is not closed")
        except (TypeError, ValueError) as error:
            errors.append(f"ring {polygon_index}/{ring_index}: {error}")
    return errors


def artifact_record(path: Path, root: Path, *, records: int | None = None) -> dict:
    record = {
        "path": path.relative_to(root).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": f"sha256:{sha256_file(path)}",
    }
    if records is not None:
        record["records"] = records
    return record


def iter_geojson_features(path: Path) -> Iterator[tuple[dict, int, int]]:
    data = path.read_bytes()
    for start, end in iter_feature_slices(data):
        yield json.loads(data[start:end].decode("utf-8")), start, end - start


def canonical_pair(first: str, second: str) -> tuple[str, str]:
    first = str(first).strip()
    second = str(second).strip()
    if not first or not second or first == second:
        raise ValueError("A canonical pair requires two distinct DGUIDs.")
    return tuple(sorted((first, second)))


def pair_key(first: str, second: str) -> str:
    return "|".join(canonical_pair(first, second))


def parse_coordinate_key(value: str) -> tuple[float, float]:
    longitude, latitude = value.split(",", 1)
    return float(longitude), float(latitude)


def vertex_id(release_id: str, pair: str, coordinate: str) -> str:
    payload = f"{release_id}\0{pair}\0{coordinate}".encode("utf-8")
    return f"v1_{hashlib.sha256(payload).hexdigest()[:24]}"


def perpendicular_distance(point, first, last) -> float:
    px, py = point
    ax, ay = first
    bx, by = last
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    ratio = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    projected = (ax + ratio * dx, ay + ratio * dy)
    return math.hypot(px - projected[0], py - projected[1])


def simplify_line(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Iterative Douglas-Peucker with stable endpoints and bounded stack use."""

    if len(points) <= 2 or tolerance <= 0:
        return list(points)
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        start, end = pending.pop()
        furthest_index = -1
        furthest_distance = tolerance
        for index in range(start + 1, end):
            distance = perpendicular_distance(points[index], points[start], points[end])
            if distance > furthest_distance:
                furthest_distance = distance
                furthest_index = index
        if furthest_index >= 0:
            keep.add(furthest_index)
            pending.append((start, furthest_index))
            pending.append((furthest_index, end))
    return [points[index] for index in sorted(keep)]


def stable_hash_rows(rows: Iterable[tuple[str, str]]) -> str:
    digest = hashlib.sha256()
    for key, value in sorted(rows):
        digest.update(key.encode("utf-8"))
        digest.update(b"\0")
        digest.update(value.encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()

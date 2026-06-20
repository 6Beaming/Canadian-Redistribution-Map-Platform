#!/usr/bin/env python3
"""Compare bundle-derived FED names (338) vs external fed_names_2023.json (343).

For audit / testing only — the map MVP does not use this output.

Requires electoral GPKG copies under scripts/data/bundle/ (see README.md).

  python scripts/data/bundle/compare_fed_names.py
  python scripts/data/bundle/compare_fed_names.py --bundle /path/to/CRMP-full-data/raw_data
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[2]
DEFAULT_BUNDLE = SCRIPT_DIR
EXTERNAL_NAMES = ROOT / "scripts" / "data" / "fed_names_2023.json"
OUTPUT_DIR = SCRIPT_DIR / "output"

PROVINCES = ("on", "qc", "bc", "ab", "mb", "sk", "ns", "nb", "nl", "pe", "nt", "nu", "yt")


def read_fed_names_from_gpkg(path: Path) -> dict[str, str]:
    names: dict[str, str] = {}
    uri = f"file:{path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    cur = conn.cursor()
    cur.execute(
        "SELECT table_name FROM gpkg_contents WHERE data_type = 'features' LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        conn.close()
        return names
    layer = row[0]
    cur.execute(f'PRAGMA table_info("{layer}")')
    columns = {r[1].upper(): r[1] for r in cur.fetchall()}
    fed_col = columns.get("FEDUID") or columns.get("FED_NUM")
    name_col = columns.get("FEDNAME") or columns.get("ED_NAME")
    if not fed_col or not name_col:
        conn.close()
        return names
    cur.execute(f'SELECT "{fed_col}", "{name_col}" FROM "{layer}"')
    for fed_id, fed_name in cur.fetchall():
        key = str(fed_id).strip()
        label = str(fed_name).strip()
        if key and label:
            names[key] = label
    conn.close()
    return names


def merge_bundle_fed_names(bundle: Path) -> dict[str, str]:
    merged: dict[str, str] = {}
    sources: list[str] = []

    for prov in PROVINCES:
        for pattern in (
            f"census_boundaries/{prov}/{prov}_electoral_districts.gpkg",
            f"census_boundaries/{prov}/{prov}_electoral_districts_2013ro.gpkg",
            f"census_boundaries/{prov}/{prov}_electoral_districts_2003ro.gpkg",
        ):
            path = bundle / pattern
            if path.exists():
                chunk = read_fed_names_from_gpkg(path)
                if chunk:
                    merged.update(chunk)
                    sources.append(str(path.relative_to(bundle)))

        pd_path = bundle / f"elections_canada/fed2021_pd/fed2021_{prov}_polling_districts.gpkg"
        if not pd_path.exists():
            continue
        uri = f"file:{pd_path.as_posix()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
        cur = conn.cursor()
        cur.execute(
            "SELECT table_name FROM gpkg_contents WHERE data_type = 'features' LIMIT 1"
        )
        layer_row = cur.fetchone()
        if layer_row:
            layer = layer_row[0]
            cur.execute(f'SELECT DISTINCT "FED_NUM", "ed_name" FROM "{layer}"')
            for fed_num, ed_name in cur.fetchall():
                key = str(fed_num).strip()
                label = str(ed_name).strip()
                if key and label:
                    merged.setdefault(key, label)
            sources.append(str(pd_path.relative_to(bundle)))
        conn.close()

    return dict(sorted(merged.items(), key=lambda item: item[0])), sources


def load_external_names() -> dict[str, str]:
    payload = json.loads(EXTERNAL_NAMES.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "names" in payload:
        return {str(k): str(v) for k, v in payload["names"].items()}
    return {str(k): str(v) for k, v in payload.items()}


def compare(bundle_names: dict[str, str], external: dict[str, str]) -> dict:
    bundle_keys = set(bundle_names)
    external_keys = set(external)
    only_bundle = sorted(bundle_keys - external_keys)
    only_external = sorted(external_keys - bundle_keys)
    name_diffs = []
    for key in sorted(bundle_keys & external_keys):
        if bundle_names[key] != external[key]:
            name_diffs.append(
                {
                    "fed_num": key,
                    "bundle_name": bundle_names[key],
                    "external_name": external[key],
                }
            )
    return {
        "bundle_count": len(bundle_names),
        "external_count": len(external),
        "only_in_bundle": only_bundle,
        "only_in_external": only_external,
        "name_mismatches": name_diffs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bundle",
        type=Path,
        default=DEFAULT_BUNDLE,
        help="Bundle root (default: scripts/data/bundle)",
    )
    args = parser.parse_args()

    if not EXTERNAL_NAMES.exists():
        print(f"[ERROR] Missing {EXTERNAL_NAMES}", file=sys.stderr)
        return 1

    bundle_names, sources = merge_bundle_fed_names(args.bundle)
    if not bundle_names:
        print(
            "[WARN] No FED names from bundle — copy electoral GPKGs per README.md",
            file=sys.stderr,
        )

    external = load_external_names()
    result = compare(bundle_names, external)
    result["bundle_sources_scanned"] = sources

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUTPUT_DIR / "fed_names_comparison.json"
    txt_path = OUTPUT_DIR / "fed_names_comparison.txt"

    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "FED name comparison — bundle merge vs external fed_names_2023.json",
        "=" * 72,
        f"Bundle merge count:  {result['bundle_count']}",
        f"External list count: {result['external_count']}",
        f"Only in bundle:      {len(result['only_in_bundle'])}",
        f"Only in external:    {len(result['only_in_external'])}",
        f"Same fed_num, different name: {len(result['name_mismatches'])}",
        "",
    ]
    if result["only_in_external"]:
        lines.append("--- fed_num only in external (2023 RO list) ---")
        for fed in result["only_in_external"][:30]:
            lines.append(f"  {fed}  {external[fed]}")
        if len(result["only_in_external"]) > 30:
            lines.append(f"  … and {len(result['only_in_external']) - 30} more")
        lines.append("")

    if result["name_mismatches"]:
        lines.append("--- Name mismatches (sample) ---")
        for row in result["name_mismatches"][:25]:
            lines.append(
                f"  {row['fed_num']}: bundle={row['bundle_name']!r} | external={row['external_name']!r}"
            )
        if len(result["name_mismatches"]) > 25:
            lines.append(f"  … and {len(result['name_mismatches']) - 25} more")

    txt_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"[OK] Bundle merge: {result['bundle_count']} names from {len(sources)} file(s)")
    print(f"[OK] External list: {result['external_count']} names")
    print(f"[OK] Wrote {json_path}")
    print(f"[OK] Wrote {txt_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

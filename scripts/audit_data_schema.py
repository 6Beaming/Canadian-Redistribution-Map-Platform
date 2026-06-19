#!/usr/bin/env python3
"""
Extract nested zip archives in-place and audit file schemas against project docs.

Designed for Colab (Drive) and local runs. Writes a .txt report — does not load
full datasets into memory.

Colab: open scripts/audit_data_schema.ipynb (loads .py from Drive Data/decompressor/)
Local: python scripts/audit_data_schema.py /path/to/CRMP-full-data.zip -o report.txt --extract-on-drive
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sqlite3
import struct
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable, Iterator, TextIO

PROVINCES = ("on", "qc", "bc", "ab", "mb", "sk", "ns", "nb", "nl", "pe", "nt", "nu", "yt")

# --- Document expectations (from local/Raw_Data_Schema.md + local/Raw_Data_redist-mini-guide.md) ---

DOC_DA_PROFILE_CSVS = (
    "atlantic.csv",
    "quebec.csv",
    "ontario.csv",
    "prairies.csv",
    "bc.csv",
    "territories.csv",
)

DOC_DA_GPKG_SUFFIX = "_dissemination_areas.gpkg"
DOC_FED2021_PD_SUFFIX = "_polling_districts.gpkg"
DOC_PMTILES = (
    "fed_boundaries_2003.pmtiles",
    "fed_boundaries_2015.pmtiles",
    "fed_boundaries_2023.pmtiles",
)

DOC_PROFILE_FOLDERS = (
    "002_cmas_cas",
    "006_dissemination_areas",
    "007_census_tracts",
    "012_adas",
    "029_feds_2023ro",
)

SCHEMA_HINTS = {
    "da_profile_csv": {"DGUID", "CHARACTERISTIC_ID", "C1_COUNT_TOTAL"},
    "da_gpkg": {"DGUID", "DAUID", "LANDAREA", "PRUID"},
    "fed2021_pd": {"LPC", "CPC", "NDP", "total_votes"},
    "fed_pmtiles": {"fed_num", "rep_order", "year"},
}


class ExtractRecord:
    __slots__ = ("zip_path", "out_dir", "status")

    def __init__(self, zip_path: Path, out_dir: Path, status: str) -> None:
        self.zip_path = zip_path
        self.out_dir = out_dir
        self.status = status


class SchemaRecord:
    def __init__(
        self,
        rel_path: str,
        kind: str,
        size_bytes: int,
        summary: str,
        *,
        columns: list[str] | None = None,
        layers: list[str] | None = None,
        row_count: int | None = None,
        feature_count: int | None = None,
        crs: str | None = None,
        doc_mentions: list[str] | None = None,
        notes: list[str] | None = None,
        error: str | None = None,
    ) -> None:
        self.rel_path = rel_path
        self.kind = kind
        self.size_bytes = size_bytes
        self.summary = summary
        self.columns = columns or []
        self.layers = layers or []
        self.row_count = row_count
        self.feature_count = feature_count
        self.crs = crs
        self.doc_mentions = doc_mentions or []
        self.notes = notes or []
        self.error = error


def format_size(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f} KB"
    if num_bytes < 1024 * 1024 * 1024:
        return f"{num_bytes / (1024 * 1024):.2f} MB"
    return f"{num_bytes / (1024 * 1024 * 1024):.2f} GB"


def resolve_work_dir(root: Path, work_dir: Path | None, *, extract_on_drive: bool) -> Path:
    """
    Choose where the outer zip is extracted.

    extract_on_drive=True (Colab + Drive):
      CRMP-full-data.zip -> {zip_parent}/CRMP-full-data/   (all on Drive)
    Otherwise:
      uses work_dir or /tmp/crmp_audit_work
    """
    if work_dir is not None:
        return work_dir
    if extract_on_drive:
        return root.parent if root.is_file() else root
    return Path("/tmp/crmp_audit_work")


def resolve_bundle_root(root: Path, work_dir: Path) -> Path:
    """If root is a .zip, extract once to work_dir and return that folder."""
    root = root.resolve()
    if root.is_file() and root.suffix.lower() == ".zip":
        bundle_dir = work_dir / root.stem
        if not bundle_dir.exists() or not any(bundle_dir.iterdir()):
            bundle_dir.mkdir(parents=True, exist_ok=True)
            print(f"[INFO] Extracting outer zip -> {bundle_dir}")
            with zipfile.ZipFile(root) as archive:
                archive.extractall(bundle_dir)
        else:
            print(f"[INFO] Reusing existing extract: {bundle_dir}")
        inner = bundle_dir / bundle_dir.name
        if inner.is_dir() and (inner / "raw_data").exists():
            return inner
        if (bundle_dir / "raw_data").exists():
            return bundle_dir
        return bundle_dir
    if root.is_dir():
        return root
    raise FileNotFoundError(f"Not a directory or zip: {root}")


def extract_nested_zips(
    root: Path,
    *,
    skip_if_exists: bool = True,
    max_rounds: int = 8,
) -> list[ExtractRecord]:
    """Extract every .zip under root to {parent}/{zip_stem}/ (same parent path)."""
    records: list[ExtractRecord] = []
    for round_num in range(1, max_rounds + 1):
        pending = sorted(root.rglob("*.zip"))
        changed = False
        for zip_path in pending:
            out_dir = zip_path.parent / zip_path.stem
            if skip_if_exists and out_dir.is_dir() and any(out_dir.iterdir()):
                records.append(ExtractRecord(zip_path, out_dir, "skipped_exists"))
                continue
            try:
                out_dir.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(zip_path) as archive:
                    archive.extractall(out_dir)
                records.append(ExtractRecord(zip_path, out_dir, "extracted"))
                changed = True
                print(f"[OK] Round {round_num}: {zip_path.relative_to(root)} -> {out_dir.name}/")
            except zipfile.BadZipFile as exc:
                records.append(ExtractRecord(zip_path, out_dir, f"error:{exc}"))
        if not changed:
            break
    return records


def iter_data_files(root: Path) -> Iterator[Path]:
    skip_dirs = {".git", "__pycache__"}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith(".")]
        for name in filenames:
            if name.startswith("."):
                continue
            path = Path(dirpath) / name
            if path.suffix.lower() == ".zip":
                continue
            yield path


def rel_posix(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def classify_doc_mentions(rel: str) -> list[str]:
    mentions: list[str] = []
    lower = rel.lower()

    if DOC_DA_GPKG_SUFFIX in lower and "/census_boundaries/" in lower:
        mentions.append("mini-guide + Schema: DA polygons ({prov}_dissemination_areas.gpkg)")
    if "/006_dissemination_areas/" in lower and lower.endswith(".csv"):
        mentions.append("mini-guide: DA census profile CSV (006)")
    if "/012_adas/" in lower:
        mentions.append("mini-guide: ADA profiles (012)")
    if "/029_feds_2023ro/" in lower:
        mentions.append("mini-guide + Schema: FED 2023 RO profiles (029)")
    if "/fed2021_pd/" in lower and lower.endswith(".gpkg"):
        mentions.append("Schema + mini-guide: 2021 polling districts")
    if "/historical/" in lower and lower.endswith(".pmtiles"):
        mentions.append("Schema: FED boundary PMTiles")
    if lower.endswith(".pmtiles"):
        mentions.append("Schema: PMTiles")
    if "/statscan_" in lower and lower.endswith(".csv"):
        mentions.append("Schema: historical FED census profiles (statscan_*_fednum_*)")
    if "polling_districts_results" in lower:
        mentions.append("UNDOCUMENTED in Schema/mini-guide (found in bundle)")
    if "/014_dissolved_csds/" in lower:
        mentions.append("UNDOCUMENTED folder (014_dissolved_csds)")
    if "/016_028_province_csds/" in lower:
        mentions.append("UNDOCUMENTED folder (016_028_province_csds)")
    if "/profile_2021/raw/" in lower:
        mentions.append("Schema: profile_2021/raw nested StatCan product zips")
    if "_geo_index.csv" in lower:
        mentions.append("Bundle index CSV (geo_index — not the profile table mini-guide names)")

    if not mentions:
        mentions.append("Other / not explicitly named in Schema or mini-guide")
    return mentions


def read_csv_sample(path: Path, max_rows: int = 3) -> tuple[list[str], list[dict], str | None]:
    raw = path.read_bytes()[:65536]
    for encoding in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            text = None
    if text is None:
        raise ValueError("Could not decode CSV header")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return [], [], None
    columns = [c.strip() for c in reader.fieldnames if c]
    rows: list[dict] = []
    for i, row in enumerate(reader):
        if i >= max_rows:
            break
        rows.append({k: row.get(k, "") for k in columns[:12]})
    return columns, rows, encoding


def count_csv_rows_fast(path: Path, limit: int | None = 5000) -> int | str | None:
    try:
        with path.open("r", encoding="latin-1", errors="replace") as handle:
            total = -1
            for total, _ in enumerate(handle):
                if limit is not None and total >= limit:
                    return f">{limit}"
            return total + 1
    except OSError:
        return None


def sniff_csv(path: Path) -> SchemaRecord:
    rel = str(path)
    rec = SchemaRecord(rel_path=rel, kind="csv", size_bytes=path.stat().st_size, summary="")
    try:
        columns, rows, encoding = read_csv_sample(path)
        rec.columns = columns
        row_info = count_csv_rows_fast(path)
        rec.row_count = row_info if isinstance(row_info, int) else None
        row_label = row_info if row_info is not None else "?"
        rec.summary = f"encoding≈{encoding}; columns={len(columns)}; rows≈{row_label}"

        colset = {c.upper() for c in columns}
        if "DGUID" in colset and "CHARACTERISTIC_ID" in colset:
            rec.notes.append("Looks like long-format Census Profile (matches mini-guide 006 pattern)")
            missing = SCHEMA_HINTS["da_profile_csv"] - colset
            if missing:
                rec.notes.append(f"Missing expected profile cols: {sorted(missing)}")
        elif "GEO_UID" in colset or "ALT_GEO_CODE" in colset:
            rec.notes.append("Looks like geo_index / geography listing (NOT the regional profile CSV)")
        elif path.name.endswith("_geo_index.csv"):
            rec.notes.append("geo_index file — index only, not ontario.csv-style profile data")

        if "/006_dissemination_areas/" in rel:
            expected_names = set(DOC_DA_PROFILE_CSVS)
            if path.name not in expected_names:
                rec.notes.append(
                    f"Path is 006_dissemination_areas but filename '{path.name}' "
                    f"is NOT one of mini-guide names: {list(DOC_DA_PROFILE_CSVS)}"
                )
    except Exception as exc:
        rec.error = str(exc)
        rec.summary = "CSV read failed"
    return rec


def sniff_gpkg(path: Path) -> SchemaRecord:
    rel = str(path)
    rec = SchemaRecord(rel_path=rel, kind="gpkg", size_bytes=path.stat().st_size, summary="")
    uri = f"file:{path.as_posix()}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
        cur = conn.cursor()
        cur.execute(
            "SELECT table_name, data_type, identifier, srs_id FROM gpkg_contents "
            "WHERE data_type IN ('features', 'attributes')"
        )
        layers = [row[0] for row in cur.fetchall()]
        rec.layers = layers

        layer = layers[0] if layers else None
        if layer:
            cur.execute(f'PRAGMA table_info("{layer}")')
            rec.columns = [row[1] for row in cur.fetchall()]
            cur.execute(f'SELECT COUNT(*) FROM "{layer}"')
            rec.feature_count = cur.fetchone()[0]
            try:
                cur.execute(
                    'SELECT organization_coordsys_id FROM gpkg_geometry_columns '
                    f'WHERE table_name = "{layer}" LIMIT 1'
                )
                srs = cur.fetchone()
                if srs:
                    rec.crs = f"EPSG/org={srs[0]}"
            except sqlite3.Error:
                pass
        conn.close()

        rec.summary = f"layers={layers}; features≈{rec.feature_count}; cols={len(rec.columns)}"
        colset = {c.upper() for c in rec.columns}
        if DOC_DA_GPKG_SUFFIX.replace(".gpkg", "") in path.name:
            missing = SCHEMA_HINTS["da_gpkg"] - colset
            if missing:
                rec.notes.append(f"DA gpkg missing expected cols: {sorted(missing)}")
        if "/fed2021_pd/" in rel:
            missing = SCHEMA_HINTS["fed2021_pd"] - colset
            if missing:
                rec.notes.append(f"fed2021_pd missing some vote cols: {sorted(missing)}")
    except Exception as exc:
        rec.error = str(exc)
        rec.summary = "GPKG read failed"
    return rec


def sniff_pmtiles(path: Path) -> SchemaRecord:
    rec = SchemaRecord(
        rel_path=str(path),
        kind="pmtiles",
        size_bytes=path.stat().st_size,
        summary="",
    )
    try:
        with path.open("rb") as handle:
            header = handle.read(127)
        if len(header) < 8 or header[:7] != b"PMTiles":
            rec.summary = "Not a PMTiles v3 header (still listed as .pmtiles)"
            return rec

        def read_u64(offset: int) -> int:
            return struct.unpack_from("<Q", header, offset)[0]

        root_offset = read_u64(8)
        root_length = read_u64(16)
        json_length = read_u64(24)
        json_start = root_offset + root_length
        with path.open("rb") as handle:
            handle.seek(json_start)
            meta_raw = handle.read(json_length)
        meta = json.loads(meta_raw.decode("utf-8"))
        vector_layers = meta.get("vector_layers") or []
        layer_ids = [layer.get("id") for layer in vector_layers if layer.get("id")]
        rec.layers = layer_ids
        fields = []
        if vector_layers:
            fields = list((vector_layers[0].get("fields") or {}).keys())
        rec.columns = fields
        rec.summary = f"vector_layers={layer_ids}; fields={fields}"
        if "fed_num" not in fields and "fed2023" in path.name:
            rec.notes.append("2023 PMTiles metadata lacks fed_num in sampled fields")
    except Exception as exc:
        rec.error = str(exc)
        rec.summary = "PMTiles metadata read failed"
    return rec


def sniff_text(path: Path, limit: int = 400) -> SchemaRecord:
    rec = SchemaRecord(
        rel_path=str(path),
        kind=path.suffix.lower().lstrip(".") or "text",
        size_bytes=path.stat().st_size,
        summary="",
    )
    try:
        snippet = path.read_text(encoding="utf-8", errors="replace")[:limit]
        rec.summary = snippet.replace("\n", " ")[:200]
    except Exception as exc:
        rec.error = str(exc)
    return rec


def sniff_file(path: Path, root: Path) -> SchemaRecord:
    rel = rel_posix(path, root)
    suffix = path.suffix.lower()
    if suffix == ".csv":
        rec = sniff_csv(path)
    elif suffix == ".gpkg":
        rec = sniff_gpkg(path)
    elif suffix == ".pmtiles":
        rec = sniff_pmtiles(path)
    elif suffix in {".md", ".txt"}:
        rec = sniff_text(path)
    else:
        rec = SchemaRecord(
            rel_path=rel,
            kind=suffix.lstrip(".") or "binary",
            size_bytes=path.stat().st_size,
            summary="(schema scan skipped for this extension)",
        )
    rec.rel_path = rel
    rec.doc_mentions = classify_doc_mentions(rel)
    return rec


def validate_against_docs(root: Path) -> dict[str, list[str]]:
    """Return missing / misplaced / extra path findings."""
    findings: dict[str, list[str]] = defaultdict(list)
    all_rels = {rel_posix(p, root) for p in iter_data_files(root)}

    profile_006 = root / "raw_data/statistics_canada/census_profiles/profile_2021/006_dissemination_areas"
    if profile_006.is_dir():
        present_csvs = {p.name for p in profile_006.glob("*.csv")}
        for name in DOC_DA_PROFILE_CSVS:
            if name not in present_csvs:
                findings["missing_doc_expected"].append(
                    f"006_dissemination_areas/{name} (mini-guide expected regional profile CSV)"
                )
        for name in sorted(present_csvs):
            if name not in DOC_DA_PROFILE_CSVS:
                findings["unexpected_name_at_006"].append(
                    f"006_dissemination_areas/{name} — present but NOT a mini-guide profile filename "
                    f"(expected {list(DOC_DA_PROFILE_CSVS)})"
                )

    fed029 = root / "raw_data/statistics_canada/census_profiles/profile_2021/029_feds_2023ro"
    if not fed029.exists():
        findings["missing_doc_expected"].append(
            "profile_2021/029_feds_2023ro/ (mini-guide + Schema expected folder — absent)"
        )

    for prov in PROVINCES:
        gpkg = root / f"raw_data/statistics_canada/census_boundaries/{prov}/{prov}_dissemination_areas.gpkg"
        if not gpkg.exists():
            findings["missing_da_gpkg"].append(f"{prov}/{prov}_dissemination_areas.gpkg")

    hist = root / "raw_data/elections_canada/historical"
    for name in DOC_PMTILES:
        if not (hist / name).exists():
            findings["missing_doc_expected"].append(f"elections_canada/historical/{name}")

    raw_nested = root / "raw_data/statistics_canada/census_profiles/profile_2021/raw"
    if raw_nested.is_dir():
        extracted = [p for p in raw_nested.iterdir() if p.is_dir()]
        if extracted:
            findings["nested_extract_present"].append(
                f"profile_2021/raw/ has {len(extracted)} extracted folder(s) — check for profile CSVs inside"
            )

    for rel in sorted(all_rels):
        if "polling_districts_results_2006_2023.csv" in rel:
            findings["undocumented_but_present"].append(rel)
        if "/014_dissolved_csds/" in rel:
            findings["undocumented_but_present"].append(rel)

    return findings


def write_schema_report(
    out: TextIO,
    *,
    bundle_root: Path,
    extract_records: list[ExtractRecord],
    schemas: list[SchemaRecord],
    doc_findings: dict[str, list[str]],
) -> None:
    out.write("=" * 80 + "\n")
    out.write("CRMP DATA SCHEMA AUDIT REPORT\n")
    out.write("=" * 80 + "\n")
    out.write(f"Bundle root: {bundle_root}\n")
    out.write(f"Generated: {datetime.now().isoformat(timespec='seconds')}\n\n")

    out.write("-" * 80 + "\n")
    out.write("1. NESTED ZIP EXTRACTION (same parent -> {zip_stem}/)\n")
    out.write("-" * 80 + "\n")
    if not extract_records:
        out.write("(no zip files processed)\n")
    else:
        counts = Counter(r.status for r in extract_records)
        out.write(f"Total zip operations: {len(extract_records)} ({dict(counts)})\n\n")
        for rec in extract_records:
            try:
                rel_zip = rec.zip_path.relative_to(bundle_root)
            except ValueError:
                rel_zip = rec.zip_path
            out.write(f"  [{rec.status}] {rel_zip}\n")
            out.write(f"           -> {rec.out_dir.name}/\n")

    out.write("\n" + "-" * 80 + "\n")
    out.write("2. DOCUMENT VALIDATION (Schema + mini-guide expectations)\n")
    out.write("-" * 80 + "\n")
    section_titles = {
        "missing_doc_expected": "MISSING (documented but not in bundle)",
        "missing_da_gpkg": "MISSING DA GeoPackage by province",
        "unexpected_name_at_006": "MISPLACED / WRONG NAME at 006_dissemination_areas",
        "undocumented_but_present": "PRESENT but NOT in Schema/mini-guide",
        "nested_extract_present": "Nested zip extract notes",
    }
    for key, title in section_titles.items():
        items = doc_findings.get(key, [])
        out.write(f"\n### {title}\n")
        if not items:
            out.write("  (none)\n")
        else:
            for item in items:
                out.write(f"  - {item}\n")

    out.write("\n" + "-" * 80 + "\n")
    out.write("3. PER-FILE SCHEMA SAMPLES (not full data scan)\n")
    out.write("-" * 80 + "\n")

    by_kind = defaultdict(list)
    for schema in schemas:
        by_kind[schema.kind].append(schema)

    for kind in sorted(by_kind.keys()):
        out.write(f"\n### .{kind} ({len(by_kind[kind])} files)\n")
        for rec in sorted(by_kind[kind], key=lambda r: r.rel_path):
            out.write(f"\n  PATH: {rec.rel_path}\n")
            out.write(f"  SIZE: {format_size(rec.size_bytes)}\n")
            out.write(f"  DOC:  {'; '.join(rec.doc_mentions)}\n")
            if rec.layers:
                out.write(f"  LAYERS: {rec.layers}\n")
            if rec.columns:
                cols_preview = rec.columns[:20]
                suffix = " ..." if len(rec.columns) > 20 else ""
                out.write(f"  COLUMNS ({len(rec.columns)}): {cols_preview}{suffix}\n")
            if rec.feature_count is not None:
                out.write(f"  FEATURES: {rec.feature_count}\n")
            if rec.row_count is not None:
                out.write(f"  ROWS (sampled): {rec.row_count}\n")
            if rec.crs:
                out.write(f"  CRS: {rec.crs}\n")
            out.write(f"  SUMMARY: {rec.summary}\n")
            for note in rec.notes:
                out.write(f"  NOTE: {note}\n")
            if rec.error:
                out.write(f"  ERROR: {rec.error}\n")

    out.write("\n" + "-" * 80 + "\n")
    out.write("4. DOC ACCURACY JUDGEMENT (automated hints — verify manually)\n")
    out.write("-" * 80 + "\n")
    hints = [
        "mini-guide lists 006_dissemination_areas/*.csv as atlantic.csv … territories.csv.",
        "Bundle often has *_geo_index.csv instead — population profiles may live under profile_2021/raw/*.zip.",
        "After nested zip extraction, re-scan 006 and raw/ subfolders for Characteristic long-format CSVs.",
        "029_feds_2023ro/ is documented but was missing from the 212-file zip inventory.",
        "Ontario on_dissemination_areas.gpkg was missing — mini-guide path is correct, bundle is incomplete.",
        "polling_districts_results_2006_2023.csv exists but is not described in Schema/mini-guide.",
        "Folders 014_dissolved_csds, 016_028_province_csds exist with meta/geo_index only — extend Schema docs.",
    ]
    for hint in hints:
        out.write(f"  * {hint}\n")

    out.write("\n" + "=" * 80 + "\n")
    out.write(f"Files scanned: {len(schemas)}\n")


def run_audit(
    root: Path,
    *,
    work_dir: Path | None = None,
    extract_on_drive: bool = False,
    extract_nested: bool = True,
    output_path: Path | None = None,
) -> str:
    resolved_work = resolve_work_dir(root, work_dir, extract_on_drive=extract_on_drive)
    bundle_root = resolve_bundle_root(root, resolved_work)

    extract_records: list[ExtractRecord] = []
    if extract_nested:
        print(f"[INFO] Extracting nested zips under {bundle_root}")
        extract_records = extract_nested_zips(bundle_root)

    print("[INFO] Sniffing file schemas (sample only)...")
    schemas: list[SchemaRecord] = []
    for path in sorted(iter_data_files(bundle_root)):
        suffix = path.suffix.lower()
        if suffix not in {".csv", ".gpkg", ".pmtiles", ".md", ".txt"}:
            continue
        schemas.append(sniff_file(path, bundle_root))

    doc_findings = validate_against_docs(bundle_root)

    buffer = io.StringIO()
    write_schema_report(
        buffer,
        bundle_root=bundle_root,
        extract_records=extract_records,
        schemas=schemas,
        doc_findings=doc_findings,
    )
    report = buffer.getvalue()

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(report, encoding="utf-8")
        print(f"[OK] Wrote report: {output_path}")

    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract nested zips and audit CRMP data schemas.")
    parser.add_argument(
        "root",
        help="Path to CRMP-full-data folder or CRMP-full-data.zip",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="data_schema_audit_report.txt",
        help="Output report path (default: data_schema_audit_report.txt)",
    )
    parser.add_argument(
        "--work-dir",
        default=None,
        help="Outer zip extract directory (default: zip parent if --extract-on-drive, else /tmp/crmp_audit_work)",
    )
    parser.add_argument(
        "--extract-on-drive",
        action="store_true",
        help="Extract outer zip next to the .zip file (use with paths under /content/drive/...)",
    )
    parser.add_argument(
        "--no-extract-nested",
        action="store_true",
        help="Skip nested zip extraction",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = Path(args.root)
    if not root.exists():
        print(f"[ERROR] Path not found: {root}", file=sys.stderr)
        return 1

    work_dir = Path(args.work_dir) if args.work_dir else None

    report = run_audit(
        root,
        work_dir=work_dir,
        extract_on_drive=args.extract_on_drive,
        extract_nested=not args.no_extract_nested,
        output_path=Path(args.output),
    )
    preview = report[:3500]
    print(preview)
    if len(report) > len(preview):
        print(f"\n... [preview truncated; see {args.output} for full report] ...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

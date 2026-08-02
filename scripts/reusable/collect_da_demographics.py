#!/usr/bin/env python3
"""Build a versioned, compact local 2021 Census DA demographics index."""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from statcan_wds import fetch_cached_bytes, sha256_bytes


ROOT = Path(__file__).resolve().parents[2]
INDEX_DIR = ROOT / "src" / "data" / "map" / "indexes"
CATALOG_PATH = INDEX_DIR / "da_demographics_catalog.json"
PROFILE_PATH = INDEX_DIR / "da_profile_index.json"
MANIFEST_PATH = ROOT / "src" / "data" / "map" / "manifests" / "da_asset_manifest.json"
OUTPUT_PATH = INDEX_DIR / "da_demographics_index.json"
REPORT_PATH = INDEX_DIR / "da_demographics_coverage.json"
CACHE_DIR = ROOT / "data" / "external" / "statcan" / "demographics_cache"
DATAFLOW_URL = "https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/dataflow/STC_CP/DF_DA/latest"
DATAFLOW_FULL_URL = f"{DATAFLOW_URL}?references=all"
DATA_URL = "https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data/STC_CP,DF_DA,{version}/{key}?detail=full&format=csv"
EXPECTED_HEADER = {
    "REF_AREA", "GENDER", "CHARACTERISTIC", "STATISTIC", "OBS_VALUE", "FLAG",
    "RELEASE_DATE", "DATA_QUALITY_FLAG", "TNR_LF", "TNR_SF",
}
DGUID_PATTERN = re.compile(r"^2021S0512\d{8}$")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=CATALOG_PATH)
    parser.add_argument("--profiles", type=Path, default=PROFILE_PATH)
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--out", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--report", type=Path, default=REPORT_PATH)
    parser.add_argument("--cache-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--version", default="")
    parser.add_argument("--batch-size", type=int, default=40)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--sample", type=int, default=0)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--skip-full-metadata", action="store_true")
    return parser.parse_args()


def canonical_bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def load_json(path: Path):
    return json.loads(path.read_text("utf-8"))


def atomic_json(path: Path, value, *, compact: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    if compact:
        serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        serialized = json.dumps(value, ensure_ascii=False, indent=2)
    temporary.write_text(serialized + "\n", "utf-8")
    os.replace(temporary, path)


def resolve_version(args) -> tuple[str, str]:
    metadata_url = DATAFLOW_URL if args.skip_full_metadata else DATAFLOW_FULL_URL
    body, content_type, _ = fetch_cached_bytes(
        metadata_url,
        args.cache_dir,
        timeout=args.timeout,
        expected_content_types=("sdmx.structure", "xml"),
        offline=args.offline,
    )
    if b"<html" in body[:500].lower() or b"Dataflow" not in body:
        raise RuntimeError("StatCan DF_DA metadata is not a valid SDMX structure response.")
    match = re.search(rb'<structure:Dataflow[^>]+id="DF_DA"[^>]+version="([^"]+)"', body)
    if not match:
        match = re.search(rb'<structure:Dataflow[^>]+version="([^"]+)"[^>]+id="DF_DA"', body)
    if not match:
        raise RuntimeError("Unable to resolve the DF_DA version from StatCan metadata.")
    if not args.skip_full_metadata:
        list_start = body.find(b'DimensionList id="DimensionDescriptor"')
        list_end = body.find(b"</structure:DimensionList>", list_start)
        if list_start < 0 or list_end < 0:
            raise RuntimeError("StatCan DF_DA metadata does not contain a dimension descriptor.")
        dimensions = re.findall(
            rb'<structure:(?:Dimension|TimeDimension|MeasureDimension) id="([^"]+)" position="([^"]+)"',
            body[list_start:list_end],
        )
        series_order = [identifier.decode("ascii") for identifier, _position in dimensions if identifier != b"TIME_PERIOD"]
        if series_order != ["FREQ", "REF_AREA", "GENDER", "CHARACTERISTIC", "STATISTIC"]:
            raise RuntimeError(f"Unexpected DF_DA series-key dimension order: {series_order}")
    latest = match.group(1).decode("ascii")
    if args.version and args.version != latest:
        # A pinned historical version is allowed only when its canary succeeds below.
        return args.version, sha256_bytes(body)
    return args.version or latest, sha256_bytes(body)


def parse_csv(body: bytes):
    text = body.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or not EXPECTED_HEADER.issubset(set(reader.fieldnames)):
        raise RuntimeError(f"Unexpected StatCan CSV header: {reader.fieldnames}")
    return list(reader)


def make_key(dguids, indicators):
    characteristics = sorted({str(item["sourceCharacteristicId"]) for item in indicators}, key=int)
    statistics = sorted({str(item["statisticCode"]) for item in indicators}, key=int)
    genders = sorted({str(item["genderCode"]) for item in indicators}, key=int)
    if genders != ["1"]:
        raise RuntimeError("CP7 catalog currently requires total-gender code 1 only.")
    return f"A5.{'+'.join(dguids)}.1.{'+'.join(characteristics)}.{'+'.join(statistics)}"


def fetch_batch(args, version, dguids, indicators):
    key = make_key(dguids, indicators)
    url = DATA_URL.format(version=version, key=key)
    body, content_type, cached = fetch_cached_bytes(
        url,
        args.cache_dir,
        timeout=args.timeout,
        expected_content_types=("sdmx.data+csv", "text/csv", "csv"),
        offline=args.offline,
    )
    return parse_csv(body), {
        "url": url,
        "sha256": sha256_bytes(body),
        "contentType": content_type,
        "cached": cached,
    }


def numeric(value):
    try:
        parsed = float(str(value).strip())
        return int(parsed) if parsed.is_integer() else parsed
    except (TypeError, ValueError):
        return None


def status_for(row):
    value = numeric(row.get("OBS_VALUE"))
    flag = str(row.get("FLAG") or "").strip()
    if value is not None:
        return value, "available"
    if flag.lower() == "x":
        return None, "suppressed"
    if flag in {"...", ".."}:
        return None, "not_applicable"
    return None, "unavailable"


def quality_warning(flag, tnr_lf):
    value = numeric(tnr_lf)
    if flag and flag != "00000":
        return "Statistics Canada reports a data-quality flag for this DA."
    if value is not None and value >= 25:
        return "Use caution: the long-form non-response rate is high."
    return None


def main():
    args = parse_args()
    catalog = load_json(args.catalog)
    profiles = load_json(args.profiles).get("profiles", {})
    manifest = load_json(args.manifest)
    enabled_assets = [
        asset for asset in manifest.get("assets", [])
        if asset.get("renderIncluded") is True and asset.get("metadataGeojsons")
    ]
    enabled_feds = {str(asset.get("fedNum", "")).strip() for asset in enabled_assets}
    if not enabled_feds:
        raise RuntimeError("The DA asset manifest contains no render-included FED metadata assets.")
    invalid_profiles = [
        dguid for dguid, profile in profiles.items()
        if DGUID_PATTERN.fullmatch(dguid)
        and (not str(profile.get("fed_num", "")).strip() or not re.fullmatch(r"\d{2}", str(profile.get("pruid", ""))))
    ]
    if invalid_profiles:
        raise RuntimeError(f"Local DA profiles have invalid FED/PRUID authority: {invalid_profiles[:5]}")
    dguids = sorted(
        dguid for dguid, profile in profiles.items()
        if DGUID_PATTERN.fullmatch(dguid) and str(profile.get("fed_num", "")).strip() in enabled_feds
    )
    expected_feature_count = sum(int(asset.get("featureCount") or 0) for asset in enabled_assets)
    if len(dguids) != expected_feature_count:
        raise RuntimeError(
            f"Enabled manifest/profile coverage mismatch: {expected_feature_count} manifest features, {len(dguids)} profiles."
        )
    if args.sample:
        dguids = dguids[: max(1, args.sample)]
    if not dguids:
        raise RuntimeError("No local DA DGUIDs were found.")
    indicators = sorted(catalog["indicators"], key=lambda item: item["displayOrder"])
    indicator_key = {
        (item["genderCode"], item["sourceCharacteristicId"], item["statisticCode"]): index
        for index, item in enumerate(indicators)
    }
    if len(indicator_key) != len(indicators):
        raise RuntimeError("The indicator catalog contains a duplicate source series.")

    version, metadata_checksum = resolve_version(args)
    canary_rows, canary_request = fetch_batch(args, version, [dguids[0]], indicators)
    canary_keys = {
        (row["GENDER"], row["CHARACTERISTIC"], row["STATISTIC"])
        for row in canary_rows
    }
    missing_catalog_series = sorted(set(indicator_key) - canary_keys)
    if missing_catalog_series:
        raise RuntimeError(f"Catalog series failed the canary query: {missing_catalog_series}")

    batches = [dguids[index:index + max(1, args.batch_size)] for index in range(0, len(dguids), max(1, args.batch_size))]
    rows_by_dguid = {dguid: {} for dguid in dguids}
    quality_by_dguid = {}
    requests = [canary_request]
    seen_series = set()
    duplicates = []

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {executor.submit(fetch_batch, args, version, batch, indicators): batch for batch in batches}
        for completed, future in enumerate(as_completed(futures), start=1):
            rows, request_meta = future.result()
            requests.append(request_meta)
            for row in rows:
                dguid = row.get("REF_AREA", "")
                source_key = (row.get("GENDER", ""), row.get("CHARACTERISTIC", ""), row.get("STATISTIC", ""))
                indicator_index = indicator_key.get(source_key)
                if dguid not in rows_by_dguid or indicator_index is None:
                    continue
                unique_key = (dguid, *source_key)
                if unique_key in seen_series:
                    duplicates.append(unique_key)
                    continue
                seen_series.add(unique_key)
                rows_by_dguid[dguid][indicator_index] = row
                quality_by_dguid.setdefault(dguid, {
                    "dataQualityFlag": str(row.get("DATA_QUALITY_FLAG") or ""),
                    "tnrLongForm": numeric(row.get("TNR_LF")),
                    "tnrShortForm": numeric(row.get("TNR_SF")),
                    "releaseDate": str(row.get("RELEASE_DATE") or ""),
                })
            print(f"Fetched {completed}/{len(batches)} StatCan demographics batches", flush=True)
    if duplicates:
        raise RuntimeError(f"Unexpected duplicate StatCan series: {duplicates[:5]}")

    records = {}
    missing_values = 0
    unavailable_dguids = []
    partial_dguids = []
    for dguid in dguids:
        values = []
        available = 0
        for index, _indicator in enumerate(indicators):
            row = rows_by_dguid[dguid].get(index)
            if row:
                value, status = status_for(row)
                flag = str(row.get("FLAG") or "") or None
                note = str(row.get("NOTE") or "") or None
            else:
                value, status, flag, note = None, "unavailable", None, None
            if status == "available":
                available += 1
            else:
                missing_values += 1
            values.append([value, status, flag, note])
        quality = quality_by_dguid.get(dguid, {
            "dataQualityFlag": "", "tnrLongForm": None, "tnrShortForm": None, "releaseDate": "",
        })
        quality["warning"] = quality_warning(quality["dataQualityFlag"], quality["tnrLongForm"])
        records[dguid] = {"quality": quality, "values": values}
        if available == 0:
            unavailable_dguids.append(dguid)
        elif available < len(indicators):
            partial_dguids.append(dguid)

    request_checksums = sorted({item["sha256"] for item in requests})
    retrieved_at = datetime.now(timezone.utc).isoformat()
    dataset = {
        "censusYear": 2021,
        "source": "Statistics Canada, 2021 Census Profile",
        "dataflow": "DF_DA",
        "version": version,
        "releaseDate": max((value["quality"]["releaseDate"] for value in records.values()), default=""),
        "sourceUrl": DATAFLOW_URL.replace("latest", version),
        "retrievedAt": retrieved_at,
        "etlVersion": catalog["etlVersion"],
        "metadataSha256": metadata_checksum,
        "rawResponseSetSha256": sha256_bytes("\n".join(request_checksums).encode("ascii")),
    }
    payload = {
        "schemaVersion": 1,
        "dataset": dataset,
        "catalogSha256": sha256_bytes(canonical_bytes(catalog)),
        "recordCount": len(records),
        "recordsSha256": sha256_bytes(canonical_bytes(records)),
        "records": records,
    }
    report = {
        "schemaVersion": 1,
        "targetDguidCount": len(dguids),
        "recordCount": len(records),
        "indicatorCount": len(indicators),
        "missingValueCount": missing_values,
        "partialDguids": partial_dguids,
        "unavailableDguids": unavailable_dguids,
        "duplicateSeries": [],
        "requestCount": len(requests),
        "dataset": dataset,
    }
    # The runtime index is deliberately compact so the complete Enabled-DA
    # release stays below the sharding threshold. The human audit report
    # remains formatted for review.
    atomic_json(args.out, payload, compact=True)
    atomic_json(args.report, report)
    print(json.dumps({
        "out": str(args.out),
        "records": len(records),
        "indicators": len(indicators),
        "partial": len(partial_dguids),
        "unavailable": len(unavailable_dguids),
        "version": version,
    }, indent=2))


if __name__ == "__main__":
    main()

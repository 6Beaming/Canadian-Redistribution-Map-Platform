"""Small, cache-aware helpers for official Statistics Canada WDS pipelines."""

from __future__ import annotations

import hashlib
import time
import urllib.error
import urllib.request
from pathlib import Path


RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def fetch_cached_bytes(
    url: str,
    cache_dir: Path,
    *,
    timeout: float = 60,
    retries: int = 4,
    expected_content_types: tuple[str, ...] = (),
    offline: bool = False,
) -> tuple[bytes, str, bool]:
    """Return body, content type and whether the body came from the raw cache."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = sha256_bytes(url.encode("utf-8"))
    body_path = cache_dir / f"{key}.body"
    type_path = cache_dir / f"{key}.content-type"
    if body_path.exists() and type_path.exists():
        return body_path.read_bytes(), type_path.read_text("utf-8"), True
    if offline:
        raise RuntimeError(f"No cached StatCan response for {url}")

    last_error = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(url, headers={
            "Accept": "text/csv,application/vnd.sdmx.data+csv,application/vnd.sdmx.structure+xml",
            "User-Agent": "course-project-five-guys/demographics-etl",
        })
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                content_type = response.headers.get("Content-Type", "").lower()
                if expected_content_types and not any(value in content_type for value in expected_content_types):
                    raise RuntimeError(f"Unexpected StatCan content type {content_type!r} for {url}")
                body_path.write_bytes(body)
                type_path.write_text(content_type, "utf-8")
                return body, content_type, False
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in RETRYABLE_STATUS:
                raise RuntimeError(f"StatCan contract request failed with HTTP {error.code}: {url}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
        if attempt < retries:
            time.sleep(min(8, 0.5 * (2 ** (attempt - 1))))
    raise RuntimeError(f"StatCan request failed after {retries} attempts: {url}") from last_error

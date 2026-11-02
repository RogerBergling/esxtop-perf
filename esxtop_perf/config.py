"""Environment-driven safety limits and session settings."""

from __future__ import annotations

import os


def _int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, value)


def max_upload_bytes() -> int:
    return _int("ESXTOP_MAX_UPLOAD_MB", 512) * 1024 * 1024


def max_decompressed_bytes() -> int:
    return _int("ESXTOP_MAX_DECOMPRESSED_MB", 1536) * 1024 * 1024


def max_series() -> int:
    return _int("ESXTOP_MAX_SERIES", 120_000)


def max_rows() -> int:
    return _int("ESXTOP_MAX_ROWS", 50_000)


def max_cells() -> int:
    return _int("ESXTOP_MAX_CELLS", 12_000_000)


def session_ttl_seconds() -> int:
    return _int("ESXTOP_SESSION_TTL_MINUTES", 30) * 60


def max_sessions() -> int:
    return _int("ESXTOP_MAX_SESSIONS", 4)


def max_request_series() -> int:
    return _int("ESXTOP_MAX_REQUEST_SERIES", 200)


def max_request_cells() -> int:
    return _int("ESXTOP_MAX_REQUEST_CELLS", 5_000_000)


def session_dir() -> str | None:
    value = os.environ.get("ESXTOP_SESSION_DIR", "").strip()
    return value or None


def public_limits() -> dict[str, int | str]:
    return {
        "uploadBytes": max_upload_bytes(),
        "decompressedBytes": max_decompressed_bytes(),
        "maxSeries": max_series(),
        "maxRows": max_rows(),
        "maxCells": max_cells(),
        "sessionTtlSeconds": session_ttl_seconds(),
        "maxSessions": max_sessions(),
        "maxRequestSeries": max_request_series(),
        "maxRequestCells": max_request_cells(),
    }

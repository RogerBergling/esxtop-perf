"""Environment-driven safety limits and session settings."""

from __future__ import annotations

import hmac
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
    return _int("ESXTOP_MAX_SERIES", 200_000)


def max_rows() -> int:
    return _int("ESXTOP_MAX_ROWS", 50_000)


def max_cells() -> int:
    return _int("ESXTOP_MAX_CELLS", 20_000_000)


def session_ttl_seconds() -> int:
    return _int("ESXTOP_SESSION_TTL_MINUTES", 30) * 60


def max_sessions() -> int:
    return _int("ESXTOP_MAX_SESSIONS", 4)


def max_request_series() -> int:
    return _int("ESXTOP_MAX_REQUEST_SERIES", 200)


def max_request_cells() -> int:
    return _int("ESXTOP_MAX_REQUEST_CELLS", 5_000_000)


def max_concurrent_analyses() -> int:
    return _int("ESXTOP_MAX_CONCURRENT_ANALYSES", 1)


def max_concurrent_requests() -> int:
    return _int("ESXTOP_MAX_CONCURRENT_REQUESTS", 32)


def request_timeout_seconds() -> int:
    return _int("ESXTOP_REQUEST_TIMEOUT_SECONDS", 120)


def upload_password() -> str:
    """Return the optional upload password.

    An empty value disables the upload gate. When set, the password is checked
    server-side; it is never embedded in the frontend bundle.
    """

    return os.environ.get("ESXTOP_UPLOAD_PASSWORD", "")


def upload_auth_required() -> bool:
    return bool(upload_password())


def verify_upload_password(provided: str | None) -> bool:
    expected = upload_password()
    if not expected:
        return True
    return hmac.compare_digest(str(provided or "").encode("utf-8"), expected.encode("utf-8"))


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
        "maxConcurrentAnalyses": max_concurrent_analyses(),
        "maxConcurrentRequests": max_concurrent_requests(),
        "requestTimeoutSeconds": request_timeout_seconds(),
    }

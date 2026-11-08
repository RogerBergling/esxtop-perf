"""Environment-driven safety limits and session settings."""

from __future__ import annotations

import hmac
import os
from pathlib import Path


def _load_env_file(path: str | Path | None = None) -> None:
    """Load simple KEY=VALUE entries from ``.env`` for direct start.py runs.

    Compose reads ``.env`` for interpolation on its own. This loader gives the
    same behaviour when the app is started with ``python3 start.py`` or a
    service manager. Real environment variables always win.
    """

    env_path = Path(path) if path is not None else Path(__file__).resolve().parent.parent / ".env"
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        entry = line.strip()
        if not entry or entry.startswith("#"):
            continue
        if entry.startswith("export "):
            entry = entry[7:].lstrip()
        key, separator, value = entry.partition("=")
        key = key.strip()
        if not separator or not key.isidentifier():
            continue
        value = value.strip()
        if value[:1] in ("'", '"'):
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end != -1 else value[1:]
        else:
            comment = value.find(" #")
            if comment != -1:
                value = value[:comment].rstrip()
        os.environ.setdefault(key, value)


_load_env_file()


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


def max_line_bytes() -> int:
    """Maximum physical CSV line length before field parsing.

    A single hostile line can otherwise expand into millions of Python string
    objects even when the total decompressed byte cap is respected.
    """

    return _int("ESXTOP_MAX_LINE_MB", 32) * 1024 * 1024


def session_ttl_seconds() -> int:
    return _int("ESXTOP_SESSION_TTL_MINUTES", 30) * 60


def session_max_lifetime_seconds() -> int:
    """Absolute session lifetime, even when the session is accessed repeatedly."""

    configured = _int("ESXTOP_SESSION_MAX_LIFETIME_MINUTES", 0, minimum=0)
    if configured > 0:
        return configured * 60
    return session_ttl_seconds() * 2


def session_sweep_seconds() -> int:
    return _int("ESXTOP_SESSION_SWEEP_SECONDS", 30)


def max_sessions() -> int:
    return _int("ESXTOP_MAX_SESSIONS", 4)


def max_concurrent_demos() -> int:
    return _int("ESXTOP_MAX_CONCURRENT_DEMOS", 1)


def allowed_hosts() -> frozenset[str]:
    """Host header allowlist, including an optional configured public host."""

    hosts = {"localhost", "127.0.0.1", "::1"}
    raw = ",".join(
        value
        for value in (
            os.environ.get("ESXTOP_ALLOWED_HOSTS", ""),
            os.environ.get("ESXTOP_PUBLIC_HOST", ""),
        )
        if value
    )
    for entry in raw.split(","):
        host = entry.strip().lower().rstrip(".")
        if host.startswith("[") and host.endswith("]"):
            host = host[1:-1]
        if host:
            hosts.add(host)
    return frozenset(hosts)


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
        "maxLineBytes": max_line_bytes(),
        "maxSeries": max_series(),
        "maxRows": max_rows(),
        "maxCells": max_cells(),
        "sessionTtlSeconds": session_ttl_seconds(),
        "sessionMaxLifetimeSeconds": session_max_lifetime_seconds(),
        "sessionSweepSeconds": session_sweep_seconds(),
        "maxSessions": max_sessions(),
        "maxRequestSeries": max_request_series(),
        "maxRequestCells": max_request_cells(),
        "maxConcurrentAnalyses": max_concurrent_analyses(),
        "maxConcurrentDemos": max_concurrent_demos(),
        "maxConcurrentRequests": max_concurrent_requests(),
        "requestTimeoutSeconds": request_timeout_seconds(),
    }

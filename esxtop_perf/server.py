"""HTTP server for ESXtop Lens.

The application is deliberately dependency-free: Python's standard library
serves the SPA and parses uploads; the browser does the visualisation. Captures
are processed in temporary files. A short-lived SQLite session stores series
values for lazy chart loading and is removed after the session TTL or at exit.
"""

from __future__ import annotations

import argparse
import contextlib
import gzip
import http.server
import ipaddress
import json
import signal
import socket
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import webbrowser
from pathlib import Path

from . import config
from .analysis import build_analysis
from .catalog import APP_VERSION, PARSER_VERSION
from .parser import CaptureError, parse_capture
from .sessions import SessionError, SessionStore

ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = ROOT / "public"
WEB_ROOT_REAL = WEB_ROOT.resolve()
DEMO_FILE = WEB_ROOT / "demo" / "esxtop-demo.csv"
PORT_RANGE = range(8080, 8100)
NO_CACHE = "no-store, no-cache, must-revalidate, max-age=0"
LOCAL_HOST_SUFFIXES = (".localhost", ".local", ".lan", ".home.arpa", ".internal")

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "frame-ancestors 'none'; "
        "frame-src 'none'; "
        "worker-src 'none'; "
        "form-action 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow",
}

BUSY_RESPONSE = (
    b"HTTP/1.1 503 Service Unavailable\r\n"
    b"Content-Type: application/json; charset=utf-8\r\n"
    b"Content-Length: 0\r\n"
    b"Retry-After: 5\r\n"
    b"Connection: close\r\n"
    b"\r\n"
)

SESSIONS = SessionStore()
UPLOAD_PASSWORD_HEADER = "X-ESXTOP-Upload-Password"
ANALYSIS_SLOTS = threading.BoundedSemaphore(config.max_concurrent_analyses())
DEMO_SLOTS = threading.BoundedSemaphore(config.max_concurrent_demos())
DEMO_LOCK = threading.Lock()
DEMO_CACHE: dict[str, object] = {}
AUTH_FAILURE_LIMIT = 5
AUTH_FAILURE_WINDOW_SECONDS = 60
AUTH_FAILURE_MAX_ENTRIES = 4096
AUTH_FAILURES: dict[str, list[float]] = {}
AUTH_FAILURES_LOCK = threading.Lock()


def _normalize_host(value: str) -> str:
    host = value.strip().lower().rstrip(".")
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    return host


def _authority(value: str | None) -> tuple[str, int | None] | None:
    """Parse a Host/authority value into (hostname, explicit port)."""

    if not value:
        return None
    value = value.strip()
    if not value or any(char in value for char in " \t,;/@"):
        return None
    try:
        parsed = urllib.parse.urlsplit("//" + value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    if (
        not hostname
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
    ):
        return None
    return _normalize_host(hostname), port


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def host_allowed(host_name: str) -> bool:
    """Return whether a Host name is safe to accept.

    The explicit allowlist defends against DNS rebinding: an attacker-owned
    public domain that resolves to this server must not become trusted just
    because the browser sends a matching Origin. IP literals, single-label
    names and local-only suffixes cannot be registered in public DNS, so they
    are accepted to keep direct LAN and desktop access working without
    configuration. Other hostnames must be added with ESXTOP_ALLOWED_HOSTS or
    ESXTOP_PUBLIC_HOST.
    """

    host = _normalize_host(host_name)
    if not host:
        return False
    if host in config.allowed_hosts():
        return True
    if _is_ip_literal(host):
        return True
    if "." not in host:
        return True
    return host.endswith(LOCAL_HOST_SUFFIXES)


def origin_allowed(origin: str | None, host_header: str | None) -> bool:
    """Validate Host and Origin against the explicit host allowlist."""

    authority = _authority(host_header)
    if authority is None:
        return False
    host_name, host_port = authority
    if not host_allowed(host_name):
        return False
    if not origin:
        return True
    if origin.strip().lower() == "null":
        return False
    try:
        parsed = urllib.parse.urlsplit(origin.strip())
        origin_host = parsed.hostname
        origin_port = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme not in {"http", "https"}
        or not origin_host
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        return False
    origin_name = _normalize_host(origin_host)
    if not host_allowed(origin_name) or origin_name != host_name:
        return False
    default_port = 443 if parsed.scheme == "https" else 80
    return (origin_port or default_port) == (host_port or default_port)


def _prune_auth_failures_locked(now: float) -> None:
    """Drop stale IPs and bound the failure map's memory footprint."""

    for ip, stamps in list(AUTH_FAILURES.items()):
        fresh = [
            stamp
            for stamp in stamps
            if now - stamp < AUTH_FAILURE_WINDOW_SECONDS
        ]
        if fresh:
            AUTH_FAILURES[ip] = fresh
        else:
            AUTH_FAILURES.pop(ip, None)
    excess = len(AUTH_FAILURES) - AUTH_FAILURE_MAX_ENTRIES
    if excess > 0:
        oldest = sorted(
            AUTH_FAILURES.items(),
            key=lambda item: item[1][-1] if item[1] else 0.0,
        )
        for ip, _ in oldest[:excess]:
            AUTH_FAILURES.pop(ip, None)


def _reset_demo_cache() -> None:
    with DEMO_LOCK:
        DEMO_CACHE.clear()


def _json_bytes(document: dict) -> bytes:
    return json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


class BoundedThreadingHTTPServer(http.server.ThreadingHTTPServer):
    """Threading server with a hard cap on simultaneous request handlers."""

    daemon_threads = True

    def __init__(self, *args, max_workers: int = 32, **kwargs):
        super().__init__(*args, **kwargs)
        self._request_slots = threading.BoundedSemaphore(max(1, max_workers))

    def process_request(self, request, client_address):
        if not self._request_slots.acquire(blocking=False):
            try:
                request.sendall(BUSY_RESPONSE)
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()


def _analyze_file(path: str, filename: str, *, protected: bool = False) -> dict:
    parsed = build_analysis(parse_capture(path, filename))
    document = {**parsed, "ok": True, "appVersion": APP_VERSION, "parserVersion": PARSER_VERSION}
    session_id = SESSIONS.create(document, protected=protected)
    document["meta"]["sessionId"] = session_id
    return document


def _demo_payload() -> bytes:
    """Return a cached demo response and one protected, reusable session."""

    with DEMO_LOCK:
        session_id = DEMO_CACHE.get("session")
        payload = DEMO_CACHE.get("payload")
        if isinstance(session_id, str) and isinstance(payload, bytes) and SESSIONS.has(session_id, touch=True):
            return payload
        if not DEMO_FILE.exists():
            raise CaptureError("The bundled demo capture is missing.", status=404)
        document = _analyze_file(str(DEMO_FILE), DEMO_FILE.name, protected=True)
        document["meta"]["demo"] = True
        payload = _json_bytes(document)
        DEMO_CACHE["session"] = document["meta"]["sessionId"]
        DEMO_CACHE["payload"] = payload
        return payload


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static app shell plus the small analysis API."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".md": "text/markdown; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".xml": "application/xml; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".gz": "application/gzip",
    }
    server_version = "ESXtopLens"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    timeout = config.request_timeout_seconds()

    def version_string(self) -> str:
        return self.server_version

    def end_headers(self) -> None:
        self.send_header("Cache-Control", NO_CACHE)
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        super().end_headers()

    def list_directory(self, path):  # noqa: N802
        self.send_error(404, "Not found")
        return None

    def translate_path(self, path: str) -> str:  # noqa: N802
        translated = super().translate_path(path)
        resolved = Path(translated).resolve()
        if resolved != WEB_ROOT_REAL and WEB_ROOT_REAL not in resolved.parents:
            return str(WEB_ROOT_REAL / "__not_found__")
        return translated

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/health":
            self._send_json(
                {
                    "status": "ok",
                    "limits": config.public_limits(),
                    "demo": DEMO_FILE.exists(),
                    "uploadAuthRequired": config.upload_auth_required(),
                }
            )
            return
        if path == "/api/upload-auth":
            if not self._upload_auth_ok():
                return
            self._send_json({"ok": True})
            return
        if path == "/api/demo":
            self._handle_demo()
            return
        if path.startswith("/api/"):
            self._send_json({"ok": False, "error": "Not found."}, status=404)
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/"):
            self.send_response(200 if path in {"/api/health", "/api/demo"} else 404)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlparse(self.path).path
        if path not in {"/api/analyze", "/api/series"}:
            self.close_connection = True
            self._send_json({"ok": False, "error": "Not found."}, status=404)
            return
        if not self._origin_ok():
            return
        if path == "/api/series":
            self._handle_series()
            return
        self._handle_analyze()

    def _handle_demo(self) -> None:
        if not DEMO_SLOTS.acquire(blocking=False):
            self.close_connection = True
            self._send_json(
                {
                    "ok": False,
                    "code": "demo_busy",
                    "error": "The demo is already being prepared. Retry shortly.",
                },
                status=429,
                extra_headers=[("Retry-After", "5")],
            )
            return
        try:
            payload = _demo_payload()
            self._send_bytes(payload, "application/json; charset=utf-8", compress=True)
        except CaptureError as exc:
            self._send_json({"ok": False, "error": exc.message}, status=exc.status)
        except Exception:
            traceback.print_exc()
            self._send_json({"ok": False, "error": "Could not load the demo capture."}, status=500)
        finally:
            DEMO_SLOTS.release()

    def _origin_ok(self) -> bool:
        if not origin_allowed(self.headers.get("Origin"), self.headers.get("Host")):
            self.close_connection = True
            self._send_json(
                {
                    "ok": False,
                    "error": (
                        "Cross-origin requests are not allowed. Open the app through "
                        "localhost, a LAN IP or a local hostname, or add the hostname "
                        "to ESXTOP_ALLOWED_HOSTS."
                    ),
                },
                status=403,
            )
            return False
        return True

    def _content_length(self, maximum: int | None = None) -> int | None:
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            self.close_connection = True
            self._send_json({"ok": False, "error": "Content-Length is required."}, status=411)
            return None
        try:
            length = int(length_header)
        except ValueError:
            self.close_connection = True
            self._send_json({"ok": False, "error": "Invalid Content-Length."}, status=400)
            return None
        if length <= 0:
            self._send_json({"ok": False, "error": "The request body is empty."}, status=400)
            return None
        if maximum is not None and length > maximum:
            self.close_connection = True
            self._send_json(
                {"ok": False, "error": f"The request body is larger than the {maximum // 1024} KB limit."},
                status=413,
            )
            return None
        return length

    def _handle_series(self) -> None:
        length = self._content_length(min(1024 * 1024, config.max_upload_bytes()))
        if length is None:
            return
        try:
            body = self.rfile.read(length)
            payload = json.loads(body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("The request body must be a JSON object.")
            session_id = payload.get("session")
            series_ids = payload.get("ids")
            values = SESSIONS.get_values(session_id, series_ids)
            self._send_json({"ok": True, "session": session_id, "series": values})
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            self._send_json({"ok": False, "error": f"Invalid series request: {exc}"}, status=400)
        except SessionError as exc:
            self._send_json({"ok": False, "error": exc.message}, status=exc.status)
        except TimeoutError:
            self.close_connection = True
            self._send_json({"ok": False, "error": "The series request timed out."}, status=408)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            traceback.print_exc()
            self._send_json({"ok": False, "error": "The requested series could not be loaded."}, status=500)

    def _client_ip(self) -> str:
        return str(self.client_address[0]) if self.client_address else "unknown"

    def _auth_rate_limited(self) -> bool:
        ip = self._client_ip()
        now = time.monotonic()
        with AUTH_FAILURES_LOCK:
            _prune_auth_failures_locked(now)
            failures = AUTH_FAILURES.get(ip, [])
            return len(failures) >= AUTH_FAILURE_LIMIT

    def _record_auth_failure(self) -> None:
        ip = self._client_ip()
        now = time.monotonic()
        with AUTH_FAILURES_LOCK:
            _prune_auth_failures_locked(now)
            failures = AUTH_FAILURES.get(ip, [])
            failures.append(now)
            AUTH_FAILURES[ip] = failures[-AUTH_FAILURE_LIMIT:]
            _prune_auth_failures_locked(now)

    def _clear_auth_failures(self) -> None:
        with AUTH_FAILURES_LOCK:
            _prune_auth_failures_locked(time.monotonic())
            AUTH_FAILURES.pop(self._client_ip(), None)

    def _upload_auth_ok(self) -> bool:
        if not config.upload_auth_required():
            return True
        if self._auth_rate_limited():
            self.close_connection = True
            self._send_json(
                {"ok": False, "error": "Too many attempts. Wait a minute and try again."},
                status=429,
                extra_headers=[("Retry-After", str(AUTH_FAILURE_WINDOW_SECONDS))],
            )
            return False
        if config.verify_upload_password(self.headers.get(UPLOAD_PASSWORD_HEADER)):
            self._clear_auth_failures()
            return True
        self._record_auth_failure()
        self.close_connection = True
        self._send_json(
            {"ok": False, "error": "Upload password required or incorrect."},
            status=401,
        )
        return False

    def _handle_analyze(self) -> None:
        if not self._upload_auth_ok():
            return
        if not ANALYSIS_SLOTS.acquire(blocking=False):
            maximum = config.max_concurrent_analyses()
            self.close_connection = True
            self._send_json(
                {
                    "ok": False,
                    "code": "analysis_busy",
                    "error": (
                        "The analysis queue is full "
                        f"({maximum} of {maximum} slot{'s' if maximum != 1 else ''} in use). "
                        "The previous capture is still being processed. Retry shortly; "
                        "raise ESXTOP_MAX_CONCURRENT_ANALYSES only if the host has enough memory."
                    ),
                },
                status=429,
                extra_headers=[("Retry-After", "5")],
            )
            return
        try:
            self._handle_analyze_unlocked()
        finally:
            ANALYSIS_SLOTS.release()

    def _handle_analyze_unlocked(self) -> None:
        limit = config.max_upload_bytes()
        length = self._content_length(limit)
        if length is None:
            return
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        filename = query.get("name", ["esxtop-capture.csv"])[0]
        filename = Path(filename).name[:160] or "esxtop-capture.csv"

        started = time.monotonic()
        temporary_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(prefix="esxtop-", suffix=".upload", delete=False) as temporary:
                temporary_path = temporary.name
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise CaptureError("The upload ended before Content-Length bytes arrived.", status=400)
                    temporary.write(chunk)
                    remaining -= len(chunk)
            document = _analyze_file(temporary_path, filename)
            document["meta"]["processingMs"] = round((time.monotonic() - started) * 1000, 1)
            payload = _json_bytes(document)
            self._send_bytes(payload, "application/json; charset=utf-8", compress=True)
        except CaptureError as exc:
            self._send_json({"ok": False, "error": exc.message}, status=exc.status)
        except TimeoutError:
            self.close_connection = True
            self._send_json({"ok": False, "error": "The upload timed out while being read."}, status=408)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            traceback.print_exc()
            self._send_json(
                {"ok": False, "error": "The capture could not be processed. Check the server log for details."},
                status=500,
            )
        finally:
            if temporary_path:
                with contextlib.suppress(OSError):
                    Path(temporary_path).unlink()

    def _send_json(
        self,
        document: dict,
        status: int = 200,
        extra_headers: list[tuple[str, str]] | None = None,
    ) -> None:
        payload = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self._send_bytes(
            payload,
            "application/json; charset=utf-8",
            status=status,
            compress=True,
            extra_headers=extra_headers,
        )

    def _send_bytes(
        self,
        payload: bytes,
        content_type: str,
        status: int = 200,
        compress: bool = False,
        extra_headers: list[tuple[str, str]] | None = None,
    ) -> None:
        body = payload
        encoding = None
        if compress and len(payload) > 1024 and "gzip" in self.headers.get("Accept-Encoding", "").lower():
            body = gzip.compress(payload, compresslevel=6)
            encoding = "gzip"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in extra_headers or []:
            self.send_header(name, value)
        if encoding:
            self.send_header("Content-Encoding", encoding)
            self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        message = "".join(
            char if char.isprintable() else " "
            for char in (fmt % args)
        )
        if len(message) > 512:
            message = f"{message[:509]}..."
        sys.stderr.write("  %s\n" % message)


def port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def choose_port(host: str, requested: int | None) -> int:
    if requested:
        if port_available(host, requested):
            return requested
        print(f"Port {requested} is busy; looking for a free port instead…")
    for port in PORT_RANGE:
        if port_available(host, port):
            return port
    raise SystemExit("No free port in 8080–8099. Pass --port with another number.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve the ESXtop Lens application.")
    parser.add_argument("--port", type=int, default=None, help="preferred port (default: first free 8080–8099)")
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser")
    args = parser.parse_args(argv)

    if not (WEB_ROOT / "index.html").exists():
        print(f"Could not find {WEB_ROOT / 'index.html'}.", file=sys.stderr)
        return 1

    port = choose_port(args.host, args.port)
    handler = lambda *a, **kw: Handler(*a, directory=str(WEB_ROOT), **kw)  # noqa: E731
    try:
        server = BoundedThreadingHTTPServer(
            (args.host, port),
            handler,
            max_workers=config.max_concurrent_requests(),
        )
    except OSError as exc:
        print(f"Could not start the server: {exc}", file=sys.stderr)
        return 1
    server.daemon_threads = True

    def _stop(signum, frame):  # noqa: ARG001
        raise KeyboardInterrupt

    with contextlib.suppress(ValueError, OSError):
        signal.signal(signal.SIGTERM, _stop)

    shown_host = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    url = f"http://{shown_host}:{port}/"

    print()
    print("  ESXtop Lens")
    print("  --------------------")
    print(f"  Version : {APP_VERSION}")
    print(f"  Serving : {WEB_ROOT}")
    print(f"  Open    : {url}")
    print(f"  Upload  : up to {config.max_upload_bytes() // (1024 * 1024)} MB")
    print(
        f"  Limits  : {config.max_series():,} columns · {config.max_rows():,} samples · "
        f"{config.max_cells():,} cells"
    )
    print(
        f"  Workers : {config.max_concurrent_analyses()} analyse · "
        f"{config.max_concurrent_requests()} HTTP"
    )
    print(f"  Password: {'required' if config.upload_auth_required() else 'not set'}")
    print("  Stop    : Ctrl+C")
    print()

    if not args.no_browser:
        timer = threading.Timer(0.7, lambda: webbrowser.open(url))
        timer.daemon = True
        timer.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
    finally:
        server.server_close()
        SESSIONS.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

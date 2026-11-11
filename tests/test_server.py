from __future__ import annotations

import json
import os
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

from esxtop_perf import server as server_module
from esxtop_perf.sessions import SessionStore

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "public" / "demo" / "esxtop-demo.csv"


class OriginPolicyTests(unittest.TestCase):
    def test_default_local_hosts_are_allowed(self) -> None:
        for host in ("localhost:8080", "127.0.0.1:8080", "[::1]:8080"):
            with self.subTest(host=host):
                self.assertTrue(server_module.origin_allowed(None, host))
                self.assertTrue(
                    server_module.origin_allowed(f"http://{host}", host)
                )

    def test_dns_rebinding_style_host_is_rejected(self) -> None:
        self.assertFalse(server_module.origin_allowed(None, "localhost.evil.example:8080"))
        self.assertFalse(server_module.origin_allowed(None, "127.0.0.1.nip.io:8080"))
        self.assertFalse(server_module.origin_allowed(None, "esxtop.example.com:8080"))

    def test_lan_ip_and_local_hostnames_are_allowed(self) -> None:
        for host in (
            "192.168.6.60:8080",
            "10.0.0.5:8080",
            "[fe80::1]:8080",
            "esxtop-lens:8080",
            "esxtop.local:8080",
            "esxtop.lan:8080",
            "esxtop.home.arpa:8080",
            "esxtop.internal:8080",
            "esxtop.localhost:8080",
        ):
            with self.subTest(host=host):
                self.assertTrue(server_module.origin_allowed(None, host))
                self.assertTrue(
                    server_module.origin_allowed(f"http://{host}", host)
                )

    def test_lan_host_does_not_trust_an_external_origin(self) -> None:
        self.assertFalse(
            server_module.origin_allowed(
                "https://evil.example", "192.168.6.60:8080"
            )
        )

    def test_cross_origin_scheme_host_and_port_are_rejected(self) -> None:
        cases = [
            ("https://evil.example", "127.0.0.1:8080"),
            ("http://127.0.0.1:9999", "127.0.0.1:8080"),
            ("ftp://127.0.0.1:8080", "127.0.0.1:8080"),
            ("null", "127.0.0.1:8080"),
            ("http://127.0.0.1:8080", "localhost:8080"),
            ("http://127.0.0.1:8080/path", "127.0.0.1:8080"),
        ]
        for origin, host in cases:
            with self.subTest(origin=origin, host=host):
                self.assertFalse(server_module.origin_allowed(origin, host))

    def test_configured_public_host_is_allowed(self) -> None:
        with patch.dict(
            os.environ,
            {"ESXTOP_PUBLIC_HOST": "lens.example.com"},
        ):
            self.assertTrue(
                server_module.origin_allowed(
                    "https://lens.example.com", "lens.example.com"
                )
            )
            self.assertFalse(
                server_module.origin_allowed(
                    "https://lens.example.com.evil.example", "lens.example.com"
                )
            )


class AuthFailureTests(unittest.TestCase):
    class FakeHandler:
        client_address = ("203.0.113.5", 1234)
        _client_ip = server_module.Handler._client_ip
        _auth_rate_limited = server_module.Handler._auth_rate_limited
        _record_auth_failure = server_module.Handler._record_auth_failure
        _clear_auth_failures = server_module.Handler._clear_auth_failures

    def setUp(self) -> None:
        with server_module.AUTH_FAILURES_LOCK:
            server_module.AUTH_FAILURES.clear()

    def tearDown(self) -> None:
        with server_module.AUTH_FAILURES_LOCK:
            server_module.AUTH_FAILURES.clear()

    def test_five_failures_lock_for_the_window_then_expire(self) -> None:
        handler = self.FakeHandler()
        with patch.object(server_module.time, "monotonic", return_value=100.0):
            for _ in range(server_module.AUTH_FAILURE_LIMIT):
                handler._record_auth_failure()
            self.assertTrue(handler._auth_rate_limited())
        with patch.object(server_module.time, "monotonic", return_value=159.0):
            self.assertTrue(handler._auth_rate_limited())
        with patch.object(server_module.time, "monotonic", return_value=160.1):
            self.assertFalse(handler._auth_rate_limited())
        with server_module.AUTH_FAILURES_LOCK:
            self.assertNotIn(handler._client_ip(), server_module.AUTH_FAILURES)

    def test_failure_map_is_bounded(self) -> None:
        with server_module.AUTH_FAILURES_LOCK:
            for index in range(server_module.AUTH_FAILURE_MAX_ENTRIES + 25):
                server_module.AUTH_FAILURES[f"198.51.100.{index}"] = [100.0]
            server_module._prune_auth_failures_locked(100.0)
            self.assertLessEqual(
                len(server_module.AUTH_FAILURES),
                server_module.AUTH_FAILURE_MAX_ENTRIES,
            )

    def test_successful_auth_clears_failures(self) -> None:
        handler = self.FakeHandler()
        with patch.object(server_module.time, "monotonic", return_value=100.0):
            handler._record_auth_failure()
            handler._clear_auth_failures()
            with server_module.AUTH_FAILURES_LOCK:
                self.assertNotIn(handler._client_ip(), server_module.AUTH_FAILURES)


class DemoSessionIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sessions = SessionStore()
        self.old_sessions = server_module.SESSIONS
        self.old_demo_slots = server_module.DEMO_SLOTS
        self.old_analysis_slots = server_module.ANALYSIS_SLOTS
        server_module.SESSIONS = self.sessions
        server_module.DEMO_SLOTS = threading.BoundedSemaphore(1)
        server_module.ANALYSIS_SLOTS = threading.BoundedSemaphore(1)
        server_module._reset_demo_cache()

        handler = lambda *args, **kwargs: server_module.Handler(  # noqa: E731
            *args, directory=str(server_module.WEB_ROOT), **kwargs
        )
        self.httpd = server_module.BoundedThreadingHTTPServer(
            ("127.0.0.1", 0), handler, max_workers=4
        )
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.port}"
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.sessions.close()
        server_module.SESSIONS = self.old_sessions
        server_module.DEMO_SLOTS = self.old_demo_slots
        server_module.ANALYSIS_SLOTS = self.old_analysis_slots
        server_module._reset_demo_cache()

    def _post_json(
        self, path: str, payload: dict, headers: dict | None = None
    ) -> dict:
        request_headers = {
            "Content-Type": "application/json",
            "Accept-Encoding": "identity",
            **(headers or {}),
        }
        request = urllib.request.Request(
            f"{self.base}{path}",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers=request_headers,
        )
        with self.opener.open(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))

    def test_demo_series_work_when_opened_through_a_lan_ip(self) -> None:
        with self.opener.open(f"{self.base}/api/demo", timeout=30) as response:
            demo = json.loads(response.read().decode("utf-8"))
        numeric = next(
            series for series in demo["series"] if series["kind"] == "numeric"
        )
        lan_host = f"192.168.6.60:{self.port}"
        values = self._post_json(
            "/api/series",
            {"session": demo["meta"]["sessionId"], "ids": [numeric["id"]]},
            headers={"Host": lan_host, "Origin": f"http://{lan_host}"},
        )
        self.assertTrue(values["ok"])
        self.assertEqual(len(values["series"][numeric["id"]]), 60)

    def test_ten_demo_requests_do_not_evict_an_upload_session(self) -> None:
        with patch.dict(os.environ, {"ESXTOP_MAX_SESSIONS": "1"}):
            upload_request = urllib.request.Request(
                f"{self.base}/api/analyze?name=upload.csv",
                data=DEMO.read_bytes(),
                method="POST",
                headers={"Content-Type": "text/csv", "Accept-Encoding": "identity"},
            )
            with self.opener.open(upload_request, timeout=60) as response:
                upload = json.loads(response.read().decode("utf-8"))
            session_id = upload["meta"]["sessionId"]
            numeric = next(
                series for series in upload["series"] if series["kind"] == "numeric"
            )

            demo_sessions = []
            for _ in range(10):
                with self.opener.open(f"{self.base}/api/demo", timeout=30) as response:
                    demo = json.loads(response.read().decode("utf-8"))
                self.assertTrue(demo["meta"]["demo"])
                demo_sessions.append(demo["meta"]["sessionId"])

            self.assertEqual(len(set(demo_sessions)), 1)
            values = self._post_json(
                "/api/series", {"session": session_id, "ids": [numeric["id"]]}
            )
            self.assertTrue(values["ok"])
            self.assertEqual(len(values["series"][numeric["id"]]), 60)

    def test_demo_uses_a_separate_semaphore_from_uploads(self) -> None:
        self.assertTrue(server_module.ANALYSIS_SLOTS.acquire(blocking=False))
        try:
            with self.opener.open(f"{self.base}/api/demo", timeout=30) as response:
                document = json.loads(response.read().decode("utf-8"))
            self.assertTrue(document["ok"])
        finally:
            server_module.ANALYSIS_SLOTS.release()


if __name__ == "__main__":
    unittest.main()

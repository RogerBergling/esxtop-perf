#!/usr/bin/env python3
"""Start the real HTTP server and exercise the API with a real capture."""

from __future__ import annotations

import gzip
import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "public" / "demo" / "esxtop-demo.csv"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class SmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.port = free_port()
        cls.log = tempfile.NamedTemporaryFile("w+", prefix="esxtop-smoke-", suffix=".log", delete=False)
        cls.process = subprocess.Popen(
            [sys.executable, "start.py", "--host", "127.0.0.1", "--port", str(cls.port), "--no-browser"],
            cwd=ROOT,
            stdout=cls.log,
            stderr=subprocess.STDOUT,
        )
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.time() + 12
        while time.time() < deadline:
            try:
                cls.opener.open(f"{cls.base}/api/health", timeout=1).read()
                return
            except Exception:
                if cls.process.poll() is not None:
                    break
                time.sleep(0.15)
        cls.tearDownClass()
        raise RuntimeError(f"server did not start\n{cls.log_text()}")

    @classmethod
    def log_text(cls) -> str:
        try:
            cls.log.flush()
            cls.log.seek(0)
            return cls.log.read()
        except Exception:
            return "<no log>"

    @classmethod
    def tearDownClass(cls) -> None:
        process = getattr(cls, "process", None)
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        log = getattr(cls, "log", None)
        if log:
            log.close()

    def get(self, path: str):
        return self.opener.open(f"{self.base}{path}", timeout=20)

    def test_static_shell_and_headers(self) -> None:
        response = self.get("/")
        body = response.read().decode("utf-8")
        self.assertIn("ESXtop Lens", body)
        self.assertIn("/assets/js/app.js", body)
        self.assertIn("default-src 'self'", response.headers.get("Content-Security-Policy", ""))
        self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertIn("no-store", response.headers.get("Cache-Control", ""))

    def test_assets_and_guide(self) -> None:
        for path, expected in [
            ("/assets/js/app.js", "init()"),
            ("/assets/js/pages.js", "renderOverview"),
            ("/assets/css/app.css", "--accent"),
            ("/docs/esxtop-field-guide.md", "esxtop -b -a"),
            ("/version.json", "version"),
            ("/api/health", '"limits"'),
        ]:
            with self.subTest(path=path):
                response = self.get(path)
                text = response.read().decode("utf-8")
                self.assertIn(expected, text)
                self.assertEqual(response.status, 200)

    def test_demo_api(self) -> None:
        response = self.get("/api/demo")
        document = json.loads(response.read().decode("utf-8"))
        self.assertTrue(document["ok"])
        self.assertEqual(document["meta"]["host"], "esxi01")
        self.assertEqual(document["meta"]["sampleCount"], 60)
        self.assertGreater(len(document["series"]), 900)
        self.assertGreater(len(document["findings"]), 0)
        self.assertEqual(document["summary"]["status"], "critical")
        self.assertTrue(document["meta"].get("demo"))
        self.assertIn("sessionId", document["meta"])
        self.assertNotIn("values", document["series"][0])
        numeric = next(series for series in document["series"] if series["kind"] == "numeric")
        request = urllib.request.Request(
            f"{self.base}/api/series",
            data=json.dumps({"session": document["meta"]["sessionId"], "ids": [numeric["id"]]}).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "Accept-Encoding": "identity"},
        )
        response = self.opener.open(request, timeout=20)
        payload = json.loads(response.read().decode("utf-8"))
        self.assertTrue(payload["ok"])
        self.assertEqual(len(payload["series"][numeric["id"]]), 60)

    def test_gzip_upload_and_analysis(self) -> None:
        payload = gzip.compress(DEMO.read_bytes(), compresslevel=1)
        request = urllib.request.Request(
            f"{self.base}/api/analyze?name=demo-upload.csv.gz",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/gzip", "Accept-Encoding": "identity"},
        )
        response = self.opener.open(request, timeout=60)
        self.assertEqual(response.status, 200)
        document = json.loads(response.read().decode("utf-8"))
        self.assertTrue(document["ok"])
        self.assertTrue(document["meta"]["compressed"])
        self.assertEqual(document["meta"]["columns"], 936)
        self.assertEqual(len(document["findings"]), 37)
        self.assertIn("metrics", document)
        self.assertIn("references", document)

    def test_rejected_input(self) -> None:
        request = urllib.request.Request(
            f"{self.base}/api/analyze?name=not-a-capture.csv",
            data=b"not a PDH capture\n",
            method="POST",
            headers={"Content-Type": "text/csv"},
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.opener.open(request, timeout=20)
        self.assertEqual(context.exception.code, 422)
        payload = json.loads(context.exception.read().decode("utf-8"))
        self.assertFalse(payload["ok"])
        self.assertIn("PDH-CSV", payload["error"])
        context.exception.close()

        cross_origin = urllib.request.Request(
            f"{self.base}/api/analyze?name=cross-origin.csv",
            data=b"whatever",
            method="POST",
            headers={"Content-Type": "text/csv", "Origin": "https://evil.example"},
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.opener.open(cross_origin, timeout=20)
        self.assertEqual(context.exception.code, 403)
        context.exception.close()

    def test_missing_routes(self) -> None:
        for path in ("/missing.js", "/api/nope"):
            with self.subTest(path=path):
                with self.assertRaises(urllib.error.HTTPError) as context:
                    self.get(path)
                self.assertEqual(context.exception.code, 404)
                context.exception.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)

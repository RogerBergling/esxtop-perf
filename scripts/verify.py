#!/usr/bin/env python3
"""Dependency-free repository and packaging checks for ESXtop Lens."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAILURES: list[str] = []
CHECKS = 0


def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not condition:
        FAILURES.append(message)


def main() -> int:
    required = [
        "README.md",
        "LICENSE",
        "Dockerfile",
        "compose.yaml",
        ".dockerignore",
        "start.py",
        "start.sh",
        "start.bat",
        "esxtop_perf/__init__.py",
        "esxtop_perf/catalog.py",
        "esxtop_perf/config.py",
        "esxtop_perf/parser.py",
        "esxtop_perf/analysis.py",
        "esxtop_perf/sessions.py",
        "esxtop_perf/server.py",
        "public/index.html",
        "public/version.json",
        "public/assets/css/app.css",
        "public/assets/js/app.js",
        "public/assets/js/theme-init.js",
        "public/assets/js/pages.js",
        "public/assets/js/charts.js",
        "public/assets/js/components.js",
        "public/assets/js/markdown.js",
        "public/docs/esxtop-field-guide.md",
        "public/demo/esxtop-demo.csv",
        "tests/test_esxtop.py",
        "tests/test_sessions.py",
        ".github/workflows/ci.yml",
        ".github/workflows/docker-publish.yml",
        ".github/dependabot.yml",
    ]
    for relative in required:
        check((ROOT / relative).is_file(), f"missing required file: {relative}")

    try:
        version = json.loads((ROOT / "public/version.json").read_text(encoding="utf-8"))
    except Exception as exc:
        version = {}
        FAILURES.append(f"public/version.json is not valid JSON: {exc}")
    check(bool(version.get("version")), "public/version.json must contain a version")
    check(version.get("version") != "0.0.0", "version must not be a placeholder")
    check("1.2.0" in (ROOT / "esxtop_perf/catalog.py").read_text(encoding="utf-8"), "APP_VERSION is not 1.2.0")
    package = (ROOT / "esxtop_perf/catalog.py").read_text(encoding="utf-8")
    check('APP_VERSION = "1.2.0"' in package, "catalog APP_VERSION must match public/version.json")

    index = (ROOT / "public/index.html").read_text(encoding="utf-8")
    check("/assets/css/app.css" in index, "index.html does not load the stylesheet")
    check("/assets/js/app.js" in index, "index.html does not load the app module")
    check("ESXtop Lens" in index, "index.html title/brand missing")
    check("noscript" in index, "index.html should keep a noscript warning")

    # Local ES-module imports must resolve so a missing file fails CI, not the browser.
    import_pattern = re.compile(r"(?:from|import)\s+['\"](\.[^'\"]+)['\"]")
    for js_file in (ROOT / "public/assets/js").glob("*.js"):
        source = js_file.read_text(encoding="utf-8")
        for target in import_pattern.findall(source):
            resolved = (js_file.parent / target).resolve()
            check(resolved.is_file(), f"{js_file.relative_to(ROOT)} imports missing module {target}")

    css = (ROOT / "public/assets/css/app.css").read_text(encoding="utf-8")
    check("--accent" in css and "--danger" in css, "CSS design tokens are missing")
    check("@media (max-width: 860px)" in css, "responsive breakpoint missing")
    check("@media print" in css, "print stylesheet missing")

    guide = (ROOT / "public/docs/esxtop-field-guide.md").read_text(encoding="utf-8")
    check("## 2. The capture command, token by token" in guide, "field guide lacks capture-command section")
    check("## 5. CPU counters" in guide, "field guide lacks CPU section")
    check("### Focused capture with `-c`" in guide, "field guide lacks focused capture manual")
    check("## 7. Storage counters" in guide, "field guide lacks storage section")
    for url in (
        "https://knowledge.broadcom.com/external/article/382249/",
        "https://knowledge.broadcom.com/external/article/344099",
        "https://www.yellow-bricks.com/esxtop/",
    ):
        check(url in guide, f"field guide missing reference: {url}")

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for phrase in ("Quick start", "Docker", "GHCR", "Watchtower", "Validation", "Project structure"):
        check(phrase.lower() in readme.lower(), f"README is missing section/keyword: {phrase}")
    check("ghcr.io/rogerbergling/esxtop-perf" in readme, "README does not name the GHCR image")

    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    check("USER app" in dockerfile, "Dockerfile must run as an unprivileged user")
    check("HEALTHCHECK" in dockerfile, "Dockerfile must define a healthcheck")
    check("CMD" in dockerfile, "Dockerfile must define a CMD")
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    check("ghcr.io/rogerbergling/esxtop-perf:latest" in compose, "compose does not use the GHCR image")
    check("com.centurylinklabs.watchtower.enable=true" in compose, "compose is missing Watchtower enable label")
    check("profiles: [\"auto-update\"]" in compose, "Watchtower must be opt-in")

    workflow = (ROOT / ".github/workflows/docker-publish.yml").read_text(encoding="utf-8")
    check("packages: write" in workflow, "publish workflow lacks packages permission")
    check("linux/amd64,linux/arm64" in workflow, "publish workflow should build multi-arch")
    check("secrets.GITHUB_TOKEN" in workflow, "publish workflow should use GITHUB_TOKEN")

    # A few frontend route smoke assertions are cheap and catch accidental drift.
    app_js = (ROOT / "public/assets/js/app.js").read_text(encoding="utf-8")
    for marker in ("#/guide", "#/capture", "#/metrics", "#/insights", "renderOverview", "renderCapture", "uploadFile", "ensureSeries", "/api/series"):
        check(marker in app_js, f"app.js missing route/feature marker: {marker}")

    if FAILURES:
        print(f"FAILED: {len(FAILURES)} issue(s) across {CHECKS} checks")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    print(f"OK: {CHECKS} repository, packaging, reference and frontend integrity checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

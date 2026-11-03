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
        "public/assets/js/report.js",
        "public/assets/js/technical.js",
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
    package = (ROOT / "esxtop_perf/catalog.py").read_text(encoding="utf-8")
    match = re.search(r'APP_VERSION = "([^"]+)"', package)
    check(bool(match), "catalog.py must declare APP_VERSION")
    check(match and match.group(1) == version.get("version"), "catalog APP_VERSION must match public/version.json")

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
    check("Multiple storage panels in one rc file" in guide, "field guide lacks multi-panel rc guidance")
    check("### What the other panels contain" in guide, "field guide lacks c/m/n/i/p panel explanations")
    check("| `i` | Interrupts |" in guide, "field guide lacks interrupt panel explanation")
    check("| `p` | CPU Power |" in guide, "field guide lacks CPU power panel explanation")
    check("Clear all if you only need storage" in guide, "field guide lacks storage-only field guidance")
    check("There is no separate Datastore panel" in guide, "field guide must explain that Datastore is not an esxtop panel")
    check("ABCDEfGHIJkl" in guide, "field guide lacks the annotated .esxtop60rc example")
    check("### Sizing large captures" in guide, "field guide lacks large-capture sizing guidance")
    check("1.23 GiB" in guide, "field guide lacks the measured memory baseline")
    check("ESXTOP_MAX_CELLS: \"100000000\"" in guide, "field guide lacks the 10 GB / 100M-cell example")
    check("### Core counter relationships" in guide, "field guide lacks core counter relationships")
    check("GAVG = DAVG + KAVG" in guide, "field guide lacks the storage latency relationship")
    check("system worlds" in guide, "field guide must explain system worlds versus VMs")
    check("ESXi 8.0 U3" in guide, "field guide must identify the real rc example as ESXi 8.0 U3")
    check("ESXi 6.0" not in guide, "field guide must not label the ESXi 8.0 U3 rc as ESXi 6.0")
    check("## 7. Storage counters" in guide, "field guide lacks storage section")
    for url in (
        "https://knowledge.broadcom.com/external/article/382249/",
        "https://knowledge.broadcom.com/external/article/344099",
        "https://www.yellow-bricks.com/esxtop/",
    ):
        check(url in guide, f"field guide missing reference: {url}")

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    guide = (ROOT / "public/docs/esxtop-field-guide.md").read_text(encoding="utf-8")
    for marker in ("Field coverage and presence-aware views", "Present and zero", "Status semantics: Healthy, Warning, Critical, Info and No rule", "No rule", "vSAN requires vSAN to be enabled", "Application security and uploads", "ESXTOP_UPLOAD_PASSWORD", "Interrupts"):
        check(marker in guide, f"field guide missing field/security documentation: {marker}")

    for phrase in ("The easy way to get it running", "Detailed setup", "Docker", "GHCR", "Validation", "Project structure"):
        check(phrase.lower() in readme.lower(), f"README is missing section/keyword: {phrase}")
    check("### Sizing large captures" in readme, "README lacks large-capture sizing guidance")
    check("peak memory ≈ 0.6 GB" in readme, "README lacks the memory sizing formula")
    check("## Reports" in readme, "README lacks the report documentation")
    check("## Reports" in readme and "What to do next" in readme, "README lacks the report action-plan documentation")
    check("ghcr.io/rogerbergling/esxtop-perf" in readme, "README does not name the GHCR image")
    check("### Report scope" in readme, "README lacks report host/VM scope documentation")
    check("### Field coverage and presence-aware views" in readme, "README lacks field coverage/presence documentation")
    check("### Upload password and public exposure" in readme, "README lacks upload-password security documentation")
    check("### Status semantics: Healthy, Warning, Critical, Info and No rule" in readme, "README lacks status semantics documentation")
    for status in ("Healthy", "Warning", "Critical", "Info", "No rule"):
        check(status in readme, f"README lacks status definition: {status}")
    for phrase in ("Hosts + VMs", "Hosts only", "Selected VMs only", "metric-category checkboxes", "Interrupts", "filter the report capture-wide", "grouped by entity", "Only metrics present in the capture are rendered", "vSAN fields are emitted only when vSAN is enabled", "ESXTOP_UPLOAD_PASSWORD", "never embedded in the frontend"):
        check(phrase.lower() in readme.lower(), f"README lacks report/field/security documentation: {phrase}")

    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    check("USER app" in dockerfile, "Dockerfile must run as an unprivileged user")
    check("HEALTHCHECK" in dockerfile, "Dockerfile must define a healthcheck")
    check("CMD" in dockerfile, "Dockerfile must define a CMD")
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    check("ghcr.io/rogerbergling/esxtop-perf:latest" in compose, "compose does not use the GHCR image")
    check('ESXTOP_UPLOAD_PASSWORD' in compose, "compose does not pass ESXTOP_UPLOAD_PASSWORD")
    check('ESXTOP_MAX_CONCURRENT_ANALYSES' in compose, "compose does not pass ESXTOP_MAX_CONCURRENT_ANALYSES")
    check('ESXTOP_MAX_CONCURRENT_REQUESTS' in compose, "compose does not pass ESXTOP_MAX_CONCURRENT_REQUESTS")
    check('ESXTOP_REQUEST_TIMEOUT_SECONDS' in compose, "compose does not pass ESXTOP_REQUEST_TIMEOUT_SECONDS")
    env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
    check("ESXTOP_UPLOAD_PASSWORD" in env_example, ".env.example lacks ESXTOP_UPLOAD_PASSWORD")
    check("ESXTOP_MAX_CONCURRENT_REQUESTS" in env_example, ".env.example lacks ESXTOP_MAX_CONCURRENT_REQUESTS")
    check("ESXTOP_REQUEST_TIMEOUT_SECONDS" in env_example, ".env.example lacks ESXTOP_REQUEST_TIMEOUT_SECONDS")
    check("containrrr/" not in compose, "compose must not include a container auto-updater image")
    check("/var/run/docker.sock" not in compose, "compose must not mount the Docker socket")

    workflow = (ROOT / ".github/workflows/docker-publish.yml").read_text(encoding="utf-8")
    check("packages: write" in workflow, "publish workflow lacks packages permission")
    check("linux/amd64,linux/arm64" in workflow, "publish workflow should build multi-arch")
    check("secrets.GITHUB_TOKEN" in workflow, "publish workflow should use GITHUB_TOKEN")
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    check("node scripts/test_csv_safety.mjs" in ci, "CI does not run the CSV safety test")

    # A few frontend route smoke assertions are cheap and catch accidental drift.
    app_js = (ROOT / "public/assets/js/app.js").read_text(encoding="utf-8")
    for marker in ("#/guide", "#/capture", "#/metrics", "#/insights", "#/report", "renderOverview", "renderCapture", "renderReport", "uploadFile", "ensureSeries", "/api/series", "/api/upload-auth", "checkUploadPassword", "UPLOAD_PASSWORD_KEY", "X-ESXTOP-Upload-Password", "uploadAuthRequired"):
        check(marker in app_js, f"app.js missing route/feature marker: {marker}")

    config_py = (ROOT / "esxtop_perf/config.py").read_text(encoding="utf-8")
    for marker in ("ESXTOP_UPLOAD_PASSWORD", "upload_auth_required", "verify_upload_password", "hmac.compare_digest", "max_concurrent_analyses", "max_concurrent_requests", "request_timeout_seconds"):
        check(marker in config_py, f"config.py missing upload-password marker: {marker}")
    server_py = (ROOT / "esxtop_perf/server.py").read_text(encoding="utf-8")
    for marker in ("UPLOAD_PASSWORD_HEADER", "_upload_auth_ok", "uploadAuthRequired", "status=401", "ANALYSIS_SLOTS", "status=429", "BoundedThreadingHTTPServer", "BUSY_RESPONSE", "request_timeout_seconds", "X-Robots-Tag", "/api/upload-auth"):
        check(marker in server_py, f"server.py missing upload-password marker: {marker}")

    parser_py = (ROOT / "esxtop_perf/parser.py").read_text(encoding="utf-8")
    check('"hosts": hosts' in parser_py, "parser must expose all capture hosts")
    check('"hostCount": len(hosts)' in parser_py, "parser must expose hostCount")
    analysis_py = (ROOT / "esxtop_perf/analysis.py").read_text(encoding="utf-8")
    check('"host": item.get("host", "")' in analysis_py, "findings must retain the ESXi host")

    report_js = (ROOT / "public/assets/js/report.js").read_text(encoding="utf-8")
    for marker in ("VM storage detail", "Per-virtual-disk latency and I/O", "VM memory and network detail", "reportVmStorage(doc", "reportVmMemoryNetwork(doc", "DAVG", "QUED", "maxMetrics", "Host snapshot", "Host storage entities", "reportHost(doc", "reportHostStorageRows(doc", "report-card-grid", "report-entity-card", "Complete metric appendix", "reportMetricAppendix(doc, categories)", "Every captured series is included below", "report-appendix-entity", "reportHostNames(doc)", "reportVmNames(doc", "reportScopedVmNames(doc", "reportBody(doc, scope = {})", "All ESXi hosts", "Selected VMs · capture report", "mode === 'all'", "reportCategorySet(scope)", "visibleRows.map", "categories.has('storage') ? reportHostStorageRows", "hasMetric(doc", "reportTechnical(findings, categories, doc)", "reportActions(findings, categories, doc)"):
        check(marker in report_js, f"report.js missing report detail marker: {marker}")

    pages_js = (ROOT / "public/assets/js/pages.js").read_text(encoding="utf-8")
    for marker in ("Storage bundle: Adapter + Device + VM Disk", "There is no separate Datastore panel in esxtop", "Real file · ESXi 8.0 U3", "Anatomy of a real <code>.esxtop60rc</code>", "ABCDEfGHIJkl", "Large sample count?", "Sizing large captures", "Capture report", "Export HTML", "Export PDF", "Export filtered metrics CSV", "report-metrics-csv", "reportBody(doc, generatedScope)", "report-hosts", "report-vms", "report-clear-vms", "report-scope-card", "report-generate", "data-report-mode", "report-scope-modes", "data-report-category", "report-categories-all", "All capture", "Hosts + VMs", "Hosts only", "Selected VMs only", "upload-password", "hasMetric(doc", "vmColumns", "categorySeriesTable", "Interrupts", "Estimated capture window", "Delay between samples", "Number of snapshots", "capture-duration", "Technical vocabulary", "Technical detail", "How these counters fit together", "Support workflow", "Internal ESXi system worlds", "What <code>c</code>, <code>m</code>, <code>n</code>, <code>i</code> and <code>p</code> contain", "panel-reference-grid", "Storage-only sequence"):
        check(marker in pages_js, f"Capture page missing multi-panel marker: {marker}")
    check("Real file · ESXi 6.0" not in pages_js, "Capture page must not label the ESXi 8.0 U3 rc as ESXi 6.0")

    parser_py = (ROOT / "esxtop_perf/parser.py").read_text(encoding="utf-8")
    check('"hosts": hosts' in parser_py, "parser must expose all capture hosts")
    check('"hostCount": len(hosts)' in parser_py, "parser must expose hostCount")
    analysis_py = (ROOT / "esxtop_perf/analysis.py").read_text(encoding="utf-8")
    check('"host": item.get("host", "")' in analysis_py, "findings must retain the ESXi host")

    report_js = (ROOT / "public/assets/js/report.js").read_text(encoding="utf-8")
    for marker in ("downloadReportHTML", "openReportPrintWindow", "reportBody", "reportStyles", "Save as PDF", "Internal ESXi system worlds", "What to do next", "Technical reference", "Decision guide", "Change control", "KAVG", "DAVG", "GAVG"):
        check(marker in report_js, f"report.js missing export marker: {marker}")

    technical_js = (ROOT / "public/assets/js/technical.js").read_text(encoding="utf-8")
    for marker in ("TECHNICAL_REFERENCE", "TECHNICAL_RELATIONSHIPS", "KAVG/cmd", "DAVG/cmd", "GAVG/cmd", "what:", "check:"):
        check(marker in technical_js, f"technical.js missing reference marker: {marker}")

    if FAILURES:
        print(f"FAILED: {len(FAILURES)} issue(s) across {CHECKS} checks")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    print(f"OK: {CHECKS} repository, packaging, reference and frontend integrity checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

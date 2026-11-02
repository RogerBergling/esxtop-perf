# ESXtop Lens

[![CI](https://github.com/RogerBergling/esxtop-perf/actions/workflows/ci.yml/badge.svg)](https://github.com/RogerBergling/esxtop-perf/actions/workflows/ci.yml)
[![Publish Docker image](https://github.com/RogerBergling/esxtop-perf/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/RogerBergling/esxtop-perf/actions/workflows/docker-publish.yml)

**Turn a raw ESXi `esxtop` batch capture into a drillable performance diagnosis.**

ESXtop Lens imports the PDH-CSV (or gzip) produced by `esxtop -b`, parses every counter, draws SVG time-series charts, applies transparent threshold rules, and explains what to check next with links to Broadcom and Yellow Bricks. It is a local-first troubleshooting workbench, not a monitoring platform.

```
esxtop -b -a -d 2 -n 100 | gzip -9c > /vmfs/volumes/SAS.-LOCAL/perf.csv
```

That file is actually gzip data despite the `.csv` extension. ESXtop Lens sniffs the magic bytes, so both plain CSV and gzip work under any filename.

## Screenshots

| Dark control room | Light theme |
| --- | --- |
| ![Overview in dark theme](docs/screenshots/overview-dark.png) | ![Overview in light theme](docs/screenshots/overview-light.png) |

Both screenshots use the bundled synthetic demo capture. The demo contains intentional CPU, memory, NUMA, storage and network pressure so every state can be inspected without a real ESXi host.

## What it does

- **Imports real esxtop output** — PDH-CSV 4.0, gzip, case-insensitive counter names, human-readable labels (`% Ready`) and short abbreviations (`%RDY`).
- **Drills into every metric** — search all columns, chart any series, inspect all samples, and export raw series to CSV.
- **CPU, memory, storage, network, VM** — host cores, Group Cpu, Vcpu, Group Memory, Virtual Disk, Disk Device/Adapter, Network Port, power and vSAN.
- **Green / yellow / red** — a transparent rule engine with sustained percentile checks, not a single-spike alarm.
- **Evidence and references** — every finding shows the observed value, guardrail, why it matters, a next action and Broadcom/Yellow Bricks sources.
- **Written field guide** — the capture command explained token by token, CSV anatomy, counter semantics, playbooks and caveats.
- **Focused capture manual** — a step-by-step `-c` workflow with a command builder, verification recipe and the traps that make a configuration silently ineffective.
- **Local-only processing** — captures are parsed into a short-lived local session. No analytics, no third-party upload; the session is removed after 30 minutes or on restart.
- **Docker + GHCR + Watchtower** — multi-arch image publishing and opt-in automatic updates, following the same delivery pattern as [Learning](https://github.com/RogerBergling/Learning).

## Quick start

### Docker (recommended)

```bash
curl -O https://raw.githubusercontent.com/RogerBergling/esxtop-perf/main/compose.yaml
docker compose up -d
```

Open **http://localhost:8004** and drop in a capture, or click **Load demo capture**.

If GHCR returns an authentication error, the package is still private. Authenticate with a token that has `read:packages`:

```bash
echo "$CR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

or make the package public once under **Packages → esxtop-perf → Package settings → Change visibility → Public**.

Update manually:

```bash
docker compose pull
docker compose up -d --force-recreate
curl -s http://localhost:8004/version.json | python3 -m json.tool
```

Enable Watchtower (opt-in profile):

```bash
docker compose --profile auto-update up -d
```

Watchtower mounts `/var/run/docker.sock`, which is host-level privilege. It is deliberately not started by default. The compose labels scope it to the `esxtop` service only.

### Local Python

Requirement: **Python 3.10+**. No `pip install` is needed.

```bash
./start.sh
# or
python3 start.py
# no browser
python3 start.py --no-browser
# fixed host/port
python3 start.py --host 0.0.0.0 --port 8080 --no-browser
```

On Windows, double-click `start.bat`, or run `py -3 start.py`.

The launcher serves the app on the first free port in **8080–8099** unless `--port` is supplied. Open the site through the server, not as a `file://` URL.

### Build the image

```bash
docker build \
  --build-arg APP_VERSION=1.2.0 \
  --build-arg IMAGE_TAG=local \
  --build-arg GIT_SHA="$(git rev-parse --short HEAD)" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t esxtop-lens .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=2g -m 2g esxtop-lens
```

## Build system and dependencies

There is no bundler, framework, CDN, external font or runtime dependency.

| Layer | Technology | Why |
| --- | --- | --- |
| HTTP/API | Python 3 standard library (`http.server`, `csv`, `gzip`, `json`, `sqlite3`) | Portable, auditable, no supply-chain surface |
| Parser/analysis | Python 3 standard library | Streaming file handling, deterministic rules, easy unit tests |
| Series store | Temporary SQLite in `/tmp` | Lazy-load chart data without keeping the whole JSON response in browser memory |
| Frontend | Native ES modules, HTML, CSS | No build step, no dependency drift |
| Charts | Hand-written SVG + pointer events | No charting library, responsive and accessible |
| Container | `python:3.12-alpine`, non-root, read-only | Small attack surface |
| Delivery | GitHub Actions → GHCR, Compose + Watchtower | Same model as the Learning project |

Node is not required to run the app. It is used only in CI for `node --check`.

## Architecture

```text
Browser
  └─ File picker / drag-drop / Load demo
       │  XMLHttpRequest POST (raw bytes, filename in query)
       ▼
Python server
  ├─ sniff gzip magic, stream-decompress with limits
  ├─ parse PDH-CSV header and rows
  ├─ normalise counter names and entity instances
  ├─ compute per-series statistics (avg, min, p05, p50, p95, max, first, last)
  ├─ apply threshold rules and group duplicate host CPU signals
  ├─ pack sample arrays into a short-lived SQLite session
  └─ return metadata, stats and findings only, gzip-compressed over HTTP
       ▼
Vanilla ES-module SPA
  ├─ hash router and capture state in memory
  ├─ KPI cards, findings, tables, metric explorer
  ├─ fetch only the visible series from /api/series
  └─ custom SVG line charts with hover, legend toggles and thresholds
```

### Project structure

```text
esxtop-perf/
├── esxtop_perf/
│   ├── catalog.py          Metric aliases, units, descriptions, KB references
│   ├── config.py           Environment-driven limits and session settings
│   ├── parser.py           PDH-CSV/gzip streaming parser and statistics
│   ├── analysis.py         Threshold rules, findings, score, category summary
│   ├── sessions.py         Temporary SQLite series store for lazy chart loading
│   └── server.py           Static server, upload/session APIs, healthcheck
├── public/
│   ├── index.html          App shell
│   ├── version.json        Local fallback; overwritten by Docker build
│   ├── assets/
│   │   ├── css/app.css     Design system, responsive and print styles
│   │   └── js/
│   │       ├── app.js      Hash router, theme, upload lifecycle
│   │       ├── theme-init.js Pre-paint local theme
│   │       ├── pages.js    Overview, category pages, VM, insights, explorer
│   │       ├── charts.js   SVG line chart, tooltip, legend, sparklines
│   │       ├── components.js UI helpers and formatting
│   │       └── markdown.js Dependency-free Markdown renderer
│   ├── demo/               Deterministic synthetic capture for the demo
│   └── docs/               Deep esxtop field guide (Markdown, served and rendered)
├── scripts/
│   ├── make_demo.py        Regenerate the demo capture
│   ├── verify.py           Repo, packaging, docs and module-integrity checks
│   └── smoke.py            Starts the real server and tests HTTP/API
├── tests/test_esxtop.py    Parser, normalisation, gzip, findings, grouping
├── docs/screenshots/        README screenshots from the running app
├── start.py                Python entry point
├── start.sh / start.bat    Linux/macOS and Windows launchers
├── Dockerfile
├── compose.yaml
└── .github/workflows/
    ├── ci.yml
    └── docker-publish.yml
```

## The esxtop command explained

The app has a full field guide at **Field guide** in the UI, and the same Markdown is in [`public/docs/esxtop-field-guide.md`](public/docs/esxtop-field-guide.md).

Short version of the supplied command:

| Token | Meaning |
| --- | --- |
| `esxtop` | ESXi performance utility; needs a privileged shell. |
| `-b` | Batch mode: no interactive screen, write PDH-CSV to stdout. The entity set is locked at the first snapshot. |
| `-a` | Collect all fields, ignoring the saved field layout. Widest capture. |
| `-d 2` | Two seconds between samples. |
| `-n 100` | Roughly 100 samples. Nominal coverage is `n × d`; timestamps in the file are authoritative. |
| `gzip -9c` | Compress stdout at maximum gzip level. The output is binary, not plain text CSV. |
| `>` | Shell redirect to a datastore path. Ensure free space and do not target the datastore under investigation. |

For a real incident, use a unique file name:

```text
esxtop -b -a -d 2 -n 300 \
  | gzip -9c > /vmfs/volumes/SAS.-LOCAL/esxtop-$(hostname)-$(date +%FT%H%M).csv.gz
```

### Focused capture with `-c`

When an all-metric capture is too large, prepare a repeatable field layout interactively:

1. Run `esxtop` on the ESXi host.
2. Switch to the panel: `u` Disk Device, `d` Disk Adapter, `c` CPU, `m` memory, `n` network.
3. Press `f` to enable/disable fields and `o` to reorder if needed.
4. Repeat for every panel you want to include or exclude; the configuration file stores all panel layouts.
5. Press uppercase **`W`**. At the prompt, enter an absolute datastore path such as `/vmfs/volumes/datastore1/esxtop-disk.rc`.
6. Validate with a short `-n 2` test, then run the real capture.

```text
esxtop -b -c /vmfs/volumes/datastore1/esxtop-disk.rc -d 5 -n 60 \
  > /vmfs/volumes/datastore1/esxtop_disk.csv
```

**Do not add `-a`** to a focused command — Broadcom documents that `-a` overrides the configuration and collects all statistics. `-c` takes an absolute path; `.esxtoprc` is not a guaranteed default name. The exact default varies by ESXi release and is shown in the `W` prompt. Do not keep the only copy under `/tmp` or on an unhealthy datastore.

The app includes a step-by-step **Capture** page and command builder at `#/capture`. A detailed version is also in the [field guide](public/docs/esxtop-field-guide.md#focused-capture-with--c).

Read the [field guide](public/docs/esxtop-field-guide.md) for the world/group model, every important CPU/memory/storage/network counter, the GAVG = DAVG + KAVG rule, practical threshold rationale and troubleshooting playbooks.

## Analysis model

Rules are defined in `esxtop_perf/analysis.py` and documented in the field guide. Each finding contains:

- severity (`critical`, `warning`, `info`) and category;
- entity, metric, observed percentile and guardrail;
- affected series and the worst series to inspect;
- a recommendation and source references.

The engine uses P95 for sustained conditions, P05 for “lower is worse” metrics such as NUMA locality, and the maximum for hard error counters such as aborts and failed ATS/UNMAP. Equivalent host CPU counters (`PCPU %`, `% Util Time`, `% Core Util Time`) are grouped into one finding to avoid duplicate noise.

The **signal score** is the percentage of rule-evaluated series currently inside their guardrail. It is a triage aid, not a capacity-planning metric and not a vSphere alarm score.

> Performance is contextual. A red signal is not automatically the root cause, and a clean report is not proof that the host is healthy. Confirm every recommendation in your own guest, array and network.

## Input and session limits

The current all-metric defaults are deliberately sized to handle the known 120,000-column scenario:

| Limit | Default | Environment variable |
| --- | --- | --- |
| Upload | 512 MB | `ESXTOP_MAX_UPLOAD_MB` |
| Decompressed stream | 1.5 GB | `ESXTOP_MAX_DECOMPRESSED_MB` |
| Total data cells | 12,000,000 | `ESXTOP_MAX_CELLS` |
| Metric columns | 120,000 | `ESXTOP_MAX_SERIES` |
| Samples | 50,000 | `ESXTOP_MAX_ROWS` |
| Session TTL | 30 minutes | `ESXTOP_SESSION_TTL_MINUTES` |
| Concurrent sessions | 4 | `ESXTOP_MAX_SESSIONS` |
| Series per value request | 200 | `ESXTOP_MAX_REQUEST_SERIES` |
| Cells per value request | 5,000,000 | `ESXTOP_MAX_REQUEST_CELLS` |

These are safety settings, not esxtop limits. Increase them for a larger single-user box; lower them for an exposed/multi-user deployment. The browser does **not** receive all sample arrays up front. Only metadata, statistics and findings are sent initially; charts fetch their visible series from `/api/series`, and the session database is deleted after the TTL or server shutdown.

The 8M-cell/50k-column caps from the earlier version are gone. A 120,000-column × 100-sample capture fits inside the default cell limit; larger captures can raise `ESXTOP_MAX_CELLS` when the container has enough memory and `/tmp` space.

## API

| Endpoint | Method | Description |
| --- | --- | --- |
| `/` | GET | App shell |
| `/api/health` | GET | Version, limits and health |
| `/api/demo` | GET | Bundled synthetic analysis |
| `/api/analyze?name=...` | POST | Raw CSV/gzip body; returns metadata, stats, findings and a session ID |
| `/api/series` | POST | `{session, ids}`; returns only the requested sample arrays |
| `/version.json` | GET | Build metadata |

The server sends `Content-Encoding: gzip` when the client accepts it, `Cache-Control: no-store`, CSP and related security headers. There is no CORS surface and no permanent database. Series sessions are temporary SQLite files in `/tmp`; override the location with `ESXTOP_SESSION_DIR` only if that path is private.

## Validation

```bash
python3 -m compileall -q esxtop_perf start.py scripts tests
python3 scripts/verify.py
python3 -m unittest discover -s tests -v
python3 scripts/smoke.py
find public/assets/js -name '*.js' -print0 | xargs -0 -n1 node --check
```

The tests cover:

- real demo capture metadata and category counts;
- gzip detection by magic bytes, not filename;
- PDH-CSV parsing, quoted fields, human-readable and abbreviated counters;
- Vcpu/network/disk instance extraction and VM deduplication;
- textual series preservation;
- threshold findings and equivalent host CPU finding grouping;
- temporary session storage and lazy series retrieval;
- HTTP shell, CSP, static assets, field guide, demo and real gzip upload.

CI runs Python 3.10 and 3.12, JavaScript syntax checks, the smoke test and a Docker build on every push/PR.

## GHCR and automatic publishing

`.github/workflows/docker-publish.yml` runs on every push and manual dispatch. It builds `linux/amd64` and `linux/arm64` and pushes to:

```text
ghcr.io/rogerbergling/esxtop-perf
```

| Trigger | Tags |
| --- | --- |
| Push to `main` | `latest`, `main`, `sha-<short>` |
| Push to another branch | `<branch>`, `sha-<short>` |
| Tag `v1.2.0` | `v1.2.0`, `sha-<short>` |
| Manual run | Tags for the selected ref |

No repository secrets are required; the workflow uses `GITHUB_TOKEN`. A new GHCR package is private by default. Make it public once, or authenticate the host with `read:packages`.

Verify a running container:

```bash
curl -s http://localhost:8004/version.json | python3 -m json.tool

docker inspect ghcr.io/rogerbergling/esxtop-perf:latest \
  --format '{{index .Config.Labels "io.esxtoplens.build.version"}} {{index .Config.Labels "io.esxtoplens.build.image-tag"}} {{index .Config.Labels "io.esxtoplens.build.revision"}} {{index .Config.Labels "io.esxtoplens.build.date"}}'
```

## Design notes

The visual language follows the Learning Lab control-room system: dark-by-default, cyan/violet accents, tabular telemetry, compact pills, sticky capture metadata and responsive two-column drilldowns. The app remains fully usable in light mode and when printed.

Main design choices:

- **Import is the hero** until a capture exists; after import the same shell becomes a dense performance console.
- **Color is semantic, not decorative**: green means a ruled signal is inside its guardrail; yellow/red always correspond to a stated rule.
- **No hidden magic**: every finding can be opened as a raw series with all samples and the original header path.
- **Privacy by construction**: no external fonts, CDN, analytics or third-party requests.

## References

- [vSphere 8.0 — Using the esxtop Utility](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance/performance-monitoring-utilities-resxtop-and-esxtop/using-the-esxtop-utility.html)
- [vSphere 8.0 — Using Batch Mode](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance/performance-monitoring-utilities-resxtop-and-esxtop/using-batch-mode.html)
- [Broadcom 370279 — Collecting esxtop batch data](https://knowledge.broadcom.com/external/article/370279/collecting-esxtop-batch-data-for-esxi-pe.html)
- [Broadcom 326309 — Exporting esxtop performance data as CSV](https://knowledge.broadcom.com/external/article/326309/exporting-esxtop-performance-data-as-a-c.html)
- [Broadcom 382249 — Using ESXTop and interpreting statistics](https://knowledge.broadcom.com/external/article/382249/using-esxtop-and-interpreting-esxtop-sta.html)
- [Broadcom 344099 — Using esxtop to identify storage performance issues](https://knowledge.broadcom.com/external/article/344099)
- [Broadcom 304594 — Troubleshooting VM performance issues](https://knowledge.broadcom.com/external/article?legacyId=2001003)
- [Broadcom 326270 — Impact of VM memory and CPU limits](https://knowledge.broadcom.com/external/article/326270/impact-of-virtual-machine-memory-and-cpu.html)
- [vSphere 8.0 — vSphere Monitoring and Performance](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance.html)
- [Yellow Bricks — ESXTOP metric thresholds](https://www.yellow-bricks.com/esxtop/)

## License / disclaimer

MIT. See [LICENSE](LICENSE).

ESXtop Lens is unofficial and not affiliated with Broadcom or VMware. It is a troubleshooting aid, not a replacement for the official documentation, vSphere alarms, array tooling or a full performance review.

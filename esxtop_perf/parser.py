"""Streaming parser for esxtop batch-mode CSV captures."""

from __future__ import annotations

import csv
import gzip
import io
import math
import re
import statistics
from array import array
from datetime import datetime
from pathlib import Path
from typing import Any, BinaryIO

from . import config
from .catalog import PARSER_VERSION, canonical_metric, group_family, infer_unit, metric_definition

GZIP_MAGIC = b"\x1f\x8b"
UTF16_BOMS = (b"\xff\xfe", b"\xfe\xff")
_TIME_FORMATS = (
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M:%S.%f",
    "%m/%d/%Y %I:%M:%S %p",
    "%m/%d/%Y %I:%M:%S.%f %p",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M:%S.%f",
    "%m/%d/%y %H:%M:%S",
)

_SYSTEM_GROUP_NAMES = {
    "system",
    "helper",
    "idle",
    "vmkernel",
    "vmk",
    "driver",
    "console",
    "management",
    "drivers",
    "ft",
    "net",
    "userworld",
    "virtscsi",
    "vmotion",
    "vsan",
    "vsphere",
    "vpx",
    "vobd",
    "hostd",
    "dcui",
    "ntpd",
    "snmpd",
    "sshd",
    "storage",
}

# ESXi system worlds often carry a world ID suffix, for example
# ``hostd.20994601`` or ``python.20979311``. These are not VM groups.
_SYSTEM_WORLD_SUFFIX_RE = re.compile(r"\.\d{6,}$")
_SYSTEM_NAME_RE = re.compile(
    r"^(?:"
    r"system\d*|helper\d*|idle\d*|"
    r"hostd(?:cgiserver|-probe)?|vpxa|etcd|envoy|"
    r"infravisor(?:-spherelet)?|net-lacp|clusteragent|vmkeventd|"
    r"init|vobd|dcui|ntpd|snmpd|sshd|"
    r"vmkernel|vmk|driver|console|management|vsan|vsphere|storage"
    r")(?:[.:-].*)?$",
    re.IGNORECASE,
)


class CaptureError(Exception):
    """An error that should be returned to the client as a 4xx response."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


class _ReadLimit(io.RawIOBase):
    """Count bytes read from a stream and fail before memory/disk blow-up."""

    def __init__(self, raw: io.BufferedIOBase, limit: int):
        self.raw = raw
        self.limit = limit
        self.count = 0

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: bytearray) -> int:  # type: ignore[override]
        size = self.raw.readinto(buffer)
        if not size:
            return 0
        self.count += size
        if self.count > self.limit:
            raise CaptureError(
                "The decompressed capture is larger than the safety limit. "
                "Reduce the number of iterations or metrics in the esxtop command.",
                status=413,
            )
        return size

    def close(self) -> None:
        try:
            self.raw.close()
        finally:
            super().close()


def _open_text_stream(upload: BinaryIO) -> tuple[io.TextIOWrapper, bool]:
    head = upload.peek(4)[:4] if hasattr(upload, "peek") else upload.read(4)
    if hasattr(upload, "seek"):
        upload.seek(0)
    compressed = head.startswith(GZIP_MAGIC)
    raw: BinaryIO
    if compressed:
        raw = gzip.GzipFile(fileobj=upload, mode="rb")  # type: ignore[arg-type]
    else:
        raw = upload

    buffered = raw if isinstance(raw, io.BufferedReader) else io.BufferedReader(raw)
    # Peek decompressed bytes to detect UTF-16 BOMs before TextIOWrapper takes
    # ownership. BufferedReader keeps the peeked bytes for the next read.
    try:
        sample = buffered.peek(4)[:4]
    except (AttributeError, OSError):
        sample = b""
    encoding = "utf-16" if sample.startswith(UTF16_BOMS) else "utf-8-sig"
    limited = _ReadLimit(buffered, config.max_decompressed_bytes())
    text = io.TextIOWrapper(limited, encoding=encoding, errors="replace", newline="")
    return text, compressed


def _csv_rows(reader: Any):
    """Yield CSV rows while converting stream/format faults into a 422 error."""

    try:
        yield from reader
    except (csv.Error, OSError, EOFError, UnicodeError) as exc:
        raise CaptureError(
            "The capture could not be decoded as PDH-CSV. It may be corrupt, "
            "truncated, or compressed with an unsupported stream.",
            status=422,
        ) from exc


def _parse_timestamp(value: str) -> datetime | None:
    value = value.strip()
    if not value:
        return None
    # Some PDH writers suffix a timezone name such as " (UTC)". The first cell
    # normally carries the timezone, but strip a trailing zone defensively.
    value = re.sub(r"\s+\([A-Za-z]{2,6}\)$", "", value)
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    # Last resort: ISO 8601 with an explicit offset.
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None)
    except ValueError:
        return None


_MISSING_NUMBERS = frozenset({"n/a", "na", "nan", "null", "none", "-", "--"})
_NAN = float("nan")


def _parse_number(value: str) -> float | str | None:
    raw = value.strip()
    if raw == "":
        return None
    # esxtop captures are overwhelmingly numeric. Try the direct conversion
    # first so the common path avoids lower-casing and replacing every cell.
    try:
        number = float(raw)
    except ValueError:
        if raw.lower() in _MISSING_NUMBERS:
            return None
        # Counter values sometimes use a localised decimal comma inside quotes.
        candidate = raw.replace(" ", "")
        if "," in candidate and "." not in candidate:
            candidate = candidate.replace(",", ".")
        try:
            number = float(candidate)
        except ValueError:
            return raw
    if not math.isfinite(number):
        return None
    return number


def _parse_header_path(raw: str) -> dict[str, str]:
    """Split ``\\\\host\\Group(instance)\\Counter`` into parts.

    The fallback keeps malformed columns visible instead of dropping data.
    """

    value = raw.strip()
    if value.startswith("\\\\"):
        value = value[2:]
    elif value.startswith("\\"):
        value = value[1:]
    parts = value.split("\\")
    if len(parts) >= 3:
        host = parts[0]
        group_instance = "\\".join(parts[1:-1])
        counter = parts[-1]
    elif len(parts) == 2:
        host, group_instance = parts
        counter = ""
    else:
        host = ""
        group_instance = ""
        counter = raw.strip()

    group = group_instance.strip()
    instance = ""
    if group.endswith(")") and "(" in group:
        group, _, instance = group.partition("(")
        instance = instance[:-1]
        group = group.strip()

    return {
        "raw": raw.strip(),
        "host": host.strip(),
        "group": group,
        "instance": instance.strip(),
        "counter": counter.strip(),
    }


def _parse_vcpu_instance(instance: str) -> tuple[str, str]:
    """Return (VM name, world label) from a Vcpu instance string.

    Typical forms:
        10882:DNS-MAIL:2100233:vmx-vcpu-0:DNS-MAIL
        1:system:2097859:tq:incompatTQ
        123:VM Name:456:vmx-vcpu-0
        123:VM Name:456

    The second field is the group name. The fourth and later fields are the
    world label; some ESXi releases append the group name again at the end of
    helper worlds. World labels themselves can contain colons, so do not use
    ``parts[1:-2]``.
    """

    parts = instance.split(":")
    if len(parts) < 2:
        return instance.strip(), ""
    vm_name = parts[1].strip()
    world = ":".join(parts[3:]).strip() if len(parts) >= 4 else ""
    if vm_name and world.endswith(f":{vm_name}"):
        world = world[: -(len(vm_name) + 1)]
    return vm_name, world.strip()


def _parse_virtual_disk_instance(instance: str) -> str:
    # "SQL01 (104c07ff-...):scsi0:0" -> SQL01
    match = re.match(r"^(.*?)(?:\s+\([0-9a-fA-F-]{8,}\))?(?::scsi\d+:\d+)?$", instance.strip())
    if match and match.group(1).strip():
        return match.group(1).strip()
    return instance.strip()


def _systemish(name: str) -> bool:
    lowered = name.strip().lower()
    if not lowered:
        return True
    if lowered in _SYSTEM_GROUP_NAMES:
        return True
    if _SYSTEM_WORLD_SUFFIX_RE.search(lowered):
        return True
    if _SYSTEM_NAME_RE.match(lowered):
        return True
    return any(lowered.startswith(prefix) for prefix in ("idle", "helper", "system:"))


def _entity_for(header: dict[str, str]) -> dict[str, str]:
    group = header["group"]
    instance = header["instance"]
    family = group_family(group)
    lowered = group.lower()

    if lowered.startswith("vcpu"):
        vm_name, world = _parse_vcpu_instance(instance)
        if _systemish(vm_name):
            return {
                "scope": "host",
                "entity": header.get("host", ""),
                "vm": "",
                "world": world,
                "entityKind": "system vCPU",
            }
        return {
            "scope": "vm",
            "entity": vm_name or instance,
            "vm": vm_name,
            "world": world,
            "entityKind": "vCPU",
        }

    if lowered.startswith(("group cpu", "group memory")):
        gid, _, name = instance.partition(":")
        display = name or gid or instance
        is_vm = not _systemish(display)
        return {
            "scope": "vm" if is_vm else "host",
            "entity": display if is_vm else header.get("host", ""),
            "vm": display if is_vm else "",
            "groupInstance": display,
            "entityKind": "VM" if is_vm else "system group",
        }

    if lowered.startswith("virtual disk"):
        vm_name = _parse_virtual_disk_instance(instance)
        if _systemish(vm_name):
            return {
                "scope": "host",
                "entity": header.get("host", ""),
                "vm": "",
                "entityKind": "system virtual disk",
            }
        return {
            "scope": "vm",
            "entity": vm_name or instance,
            "vm": vm_name,
            "entityKind": "virtual disk",
        }

    if family == "storage":
        return {
            "scope": "host",
            "entity": instance or header.get("host", ""),
            "vm": "",
            "entityKind": "storage",
        }

    if family == "network":
        # Network port instances vary by release. If the instance includes a
        # VM-like .eth suffix, expose that VM; otherwise treat the port as host.
        match = re.search(r"(.+?)\.eth\d+", instance, re.IGNORECASE)
        if match:
            vm_name = match.group(1).strip().rsplit(":", 1)[-1]
            if _systemish(vm_name):
                return {
                    "scope": "host",
                    "entity": instance or header.get("host", ""),
                    "vm": "",
                    "entityKind": "system network port",
                }
            return {
                "scope": "vm",
                "entity": vm_name,
                "vm": vm_name,
                "entityKind": "network port",
            }
        return {
            "scope": "host",
            "entity": instance or header.get("host", ""),
            "vm": "",
            "entityKind": "network",
        }

    return {
        "scope": "host",
        "entity": header.get("host", ""),
        "vm": "",
        "entityKind": family,
    }


def _stats(values: Any, missing: int = 0) -> dict[str, float | int | None]:
    """Summarise a numeric column stored as an ``array('d')``.

    ``missing`` is the number of NaN placeholders, so the common all-numeric
    path can sort the compact array without first building another list.
    """

    if not values or missing >= len(values):
        return {
            "count": 0,
            "min": None,
            "max": None,
            "avg": None,
            "p05": None,
            "p50": None,
            "p95": None,
            "first": None,
            "last": None,
        }
    if missing:
        numbers = [value for value in values if not math.isnan(value)]
        if not numbers:
            return _stats([])
    else:
        numbers = values
    ordered = sorted(numbers)
    p05 = _percentile(ordered, 0.05)
    p95 = _percentile(ordered, 0.95)
    p50 = _percentile(ordered, 0.50)
    return {
        "count": len(numbers),
        "min": round(ordered[0], 6),
        "max": round(ordered[-1], 6),
        "avg": round(statistics.fmean(numbers), 6),
        "p05": round(p05, 6),
        "p50": round(p50, 6),
        "p95": round(p95, 6),
        "first": round(numbers[0], 6),
        "last": round(numbers[-1], 6),
    }


def _percentile(ordered: list[float], fraction: float) -> float:
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _short_time(moment: datetime | None, fallback: str, index: int, elapsed: float) -> str:
    if moment is not None:
        return moment.strftime("%H:%M:%S")
    if fallback.strip():
        return fallback.strip()
    total = int(round(elapsed))
    return f"T+{total // 3600:02d}:{(total % 3600) // 60:02d}:{total % 60:02d}"


def parse_capture(path: str | Path, filename: str) -> dict[str, Any]:
    """Parse a capture file and return a JSON-friendly analysis-ready document."""

    source = Path(path)
    file_bytes = source.stat().st_size
    with source.open("rb") as upload:
        text, compressed = _open_text_stream(upload)
        try:
            reader = csv.reader(text)
            rows = _csv_rows(reader)
            try:
                raw_header = next(rows)
            except StopIteration as exc:
                raise CaptureError("The file is empty.", status=422) from exc
            if not raw_header or "PDH-CSV" not in raw_header[0].upper():
                raise CaptureError(
                    "This does not look like an esxtop batch capture. "
                    "Expected a PDH-CSV 4.0 header in the first cell.",
                    status=422,
                )

            active_columns: list[tuple[int, dict[str, str], dict[str, Any], dict[str, str]]] = []
            host_counts: dict[str, int] = {}
            for index, raw in enumerate(raw_header[1:], start=1):
                if not raw.strip():
                    continue
                header = _parse_header_path(raw)
                if header["host"]:
                    host_counts[header["host"]] = host_counts.get(header["host"], 0) + 1
                metric_id = canonical_metric(header["group"], header["counter"])
                definition = metric_definition(metric_id, header["counter"])
                entity = _entity_for(header)
                category = definition.get("category") if definition.get("known") else None
                if not category or category == "other":
                    category = infer_unit_category(header["group"], header["counter"], metric_id)
                active_columns.append(
                    (
                        index,
                        header,
                        {
                            "metric": metric_id,
                            "definition": definition,
                            "category": category,
                        },
                        entity,
                    )
                )

            if not active_columns:
                raise CaptureError("The capture has no metric columns.", status=422)
            max_series = config.max_series()
            max_rows = config.max_rows()
            max_cells = config.max_cells()
            if len(active_columns) > max_series:
                raise CaptureError(
                    f"Capture contains {len(active_columns):,} metric columns; "
                    f"the current safety limit is {max_series:,}. "
                    "Raise ESXTOP_MAX_SERIES or capture fewer fields.",
                    status=413,
                )

            host = max(host_counts, key=host_counts.get) if host_counts else ""
            column_count = len(active_columns)
            source_indices = [item[0] for item in active_columns]
            # Store numeric samples in an array('d') instead of a Python list.
            # A 54k-column capture otherwise creates 54 million boxed floats.
            # Text is rare in esxtop output, so only allocate a bucket when a
            # column actually contains a non-numeric value.
            values: list[array] = [array("d") for _ in range(column_count)]
            text_cells: list[dict[int, str] | None] = [None] * column_count
            numeric_counts = [0] * column_count
            text_counts = [0] * column_count
            missing_counts = [0] * column_count
            raw_times: list[str] = []
            parsed_times: list[datetime | None] = []
            mismatched_rows = 0
            blank_rows = 0
            expected_length = len(raw_header)
            parse_number = _parse_number

            for row in rows:
                if not row or not any(cell.strip() for cell in row):
                    blank_rows += 1
                    continue
                row_length = len(row)
                if row_length != expected_length:
                    mismatched_rows += 1
                if len(raw_times) >= max_rows:
                    raise CaptureError(
                        f"Capture contains more than {max_rows:,} samples; "
                        "raise ESXTOP_MAX_ROWS, reduce -n, or split the capture.",
                        status=413,
                    )
                if (len(raw_times) + 1) * column_count > max_cells:
                    raise CaptureError(
                        "This capture is larger than the configured parser limit "
                        f"({max_cells:,} data cells). Raise ESXTOP_MAX_CELLS, "
                        "reduce the number of iterations or capture fewer fields.",
                        status=413,
                    )
                # Pad truncated rows once so the hot column loop needs no bounds
                # check for every one of the millions of cells.
                if row_length < expected_length:
                    row = row + [""] * (expected_length - row_length)
                sample_index = len(raw_times)
                raw_times.append(row[0])
                parsed_times.append(_parse_timestamp(row[0]))
                for column_index, source_index in enumerate(source_indices):
                    parsed = parse_number(row[source_index])
                    if parsed is None:
                        values[column_index].append(_NAN)
                        missing_counts[column_index] += 1
                    elif isinstance(parsed, float):
                        values[column_index].append(parsed)
                        numeric_counts[column_index] += 1
                    else:
                        values[column_index].append(_NAN)
                        text_counts[column_index] += 1
                        bucket = text_cells[column_index]
                        if bucket is None:
                            bucket = text_cells[column_index] = {}
                        bucket[sample_index] = parsed

            if not raw_times:
                raise CaptureError("The capture contains a header but no samples.", status=422)

            start = parsed_times[0]
            elapsed: list[float] = []
            if start is not None and all(moment is not None for moment in parsed_times):
                last = 0.0
                for moment in parsed_times:
                    assert moment is not None
                    delta = (moment - start).total_seconds()
                    # A non-monotonic clock is safer represented by sample order
                    # than by a negative x-axis.
                    if delta < last:
                        delta = last
                    elapsed.append(round(delta, 3))
                    last = delta
            else:
                elapsed = [float(index) for index in range(len(raw_times))]

            differences = [
                round(elapsed[i] - elapsed[i - 1], 3)
                for i in range(1, len(elapsed))
                if elapsed[i] > elapsed[i - 1]
            ]
            interval = statistics.median(differences) if differences else None
            duration = elapsed[-1] if elapsed else None

            series: list[dict[str, Any]] = []
            sample_count = len(raw_times)
            for column_index, (source_index, header, metric, entity) in enumerate(active_columns):
                definition = metric["definition"]
                numeric = numeric_counts[column_index] >= text_counts[column_index] and numeric_counts[column_index] > 0
                if numeric:
                    kind = "numeric"
                    cleaned: Any = values[column_index]
                    # Text cells in a mostly numeric column are represented as
                    # NaN too, so include them in the missing count.
                    stats = _stats(
                        cleaned,
                        missing_counts[column_index] + text_counts[column_index],
                    )
                else:
                    kind = "text"
                    # The NaN array is not needed for a text series; release it
                    # before the next column is finalised.
                    values[column_index] = array("d")
                    bucket = text_cells[column_index]
                    cleaned = (
                        [bucket.get(index) for index in range(sample_count)]
                        if bucket
                        else [None] * sample_count
                    )
                    stats = _stats([])
                unit = definition.get("unit") or infer_unit(header["counter"])
                label = header["counter"]
                if header["instance"]:
                    label = f"{header['group']}({header['instance']}) · {header['counter']}"
                series.append(
                    {
                        "id": f"s{source_index}",
                        "column": source_index,
                        "rawHeader": header["raw"],
                        "group": header["group"],
                        "instance": header["instance"],
                        "counter": header["counter"],
                        "label": label,
                        "host": header["host"] or host,
                        "metric": metric["metric"],
                        "metricName": definition.get("name", header["counter"]),
                        "known": bool(definition.get("known")),
                        "category": metric["category"],
                        "unit": unit,
                        "scope": entity["scope"],
                        "entity": entity["entity"],
                        "entityKind": entity.get("entityKind", ""),
                        "vm": entity.get("vm", ""),
                        "world": entity.get("world", ""),
                        "kind": kind,
                        "values": cleaned,
                        "stats": stats,
                        "description": definition.get("description", ""),
                        "thresholdNote": definition.get("threshold_note", ""),
                    }
                )

            labels = [
                _short_time(parsed_times[index], raw_times[index], index, elapsed[index])
                for index in range(len(raw_times))
            ]
            start_label = raw_times[0]
            end_label = raw_times[-1]
            warnings: list[str] = []
            hosts = sorted(host_counts, key=lambda name: (-host_counts[name], name.lower()))
            if mismatched_rows:
                warnings.append(
                    f"{mismatched_rows} row(s) had a different number of fields than the header; "
                    "missing cells were treated as empty."
                )
            if len(hosts) > 1:
                warnings.append(
                    f"Capture contains {len(hosts)} ESXi host names. Use the report host scope to inspect each host; global summaries remain capture-wide."
                )
            if compressed:
                warnings.append("The upload was gzip-compressed and was decompressed in memory.")
            if interval is not None and interval <= 0:
                warnings.append("Sample timestamps did not advance; the elapsed axis uses sample order.")

            vms = sorted({item["vm"] for item in series if item.get("vm")})
            groups: dict[str, dict[str, Any]] = {}
            for item in series:
                group = groups.setdefault(
                    item["group"],
                    {
                        "name": item["group"],
                        "category": item["category"],
                        "seriesCount": 0,
                        "instances": set(),
                        "counters": set(),
                    },
                )
                group["seriesCount"] += 1
                if item["instance"]:
                    group["instances"].add(item["instance"])
                group["counters"].add(item["counter"])
            group_list = []
            for group in groups.values():
                group["instances"] = sorted(group["instances"])[:200]
                group["counters"] = sorted(group["counters"])
                group_list.append(group)
            group_list.sort(key=lambda item: (item["category"], item["name"].lower()))

            return {
                "meta": {
                    "filename": filename or source.name,
                    "host": host,
                    "hosts": hosts,
                    "hostCount": len(hosts),
                    "captureStart": start_label,
                    "captureEnd": end_label,
                    "durationSeconds": duration,
                    "intervalSeconds": interval,
                    "sampleCount": len(raw_times),
                    "columns": len(active_columns),
                    "groupCount": len(group_list),
                    "vmCount": len(vms),
                    "fileBytes": file_bytes,
                    "compressed": compressed,
                    "parserVersion": PARSER_VERSION,
                    "pdhHeader": raw_header[0],
                    "warnings": warnings,
                },
                "time": {
                    "labels": labels,
                    "rawLabels": raw_times,
                    "elapsed": elapsed,
                    "startLabel": start_label,
                    "endLabel": end_label,
                    "durationSeconds": duration,
                    "intervalSeconds": interval,
                },
                "series": series,
                "groups": group_list,
                "vms": vms,
            }
        finally:
            try:
                text.close()
            except Exception:
                pass


def infer_unit_category(group: str, counter: str, metric_id: str) -> str:
    """Fallback category for metrics not curated in the catalogue."""

    from .catalog import infer_category

    return infer_category(group, counter, metric_id)


def parse_text_capture(text: str, filename: str = "capture.csv") -> dict[str, Any]:
    """Convenience helper for tests and small in-memory captures."""

    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".csv", encoding="utf-8", delete=False) as handle:
        handle.write(text)
        name = handle.name
    try:
        return parse_capture(name, filename)
    finally:
        Path(name).unlink(missing_ok=True)

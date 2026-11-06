from __future__ import annotations

import gzip
import os
import tempfile
import unittest
from array import array
from pathlib import Path
from unittest.mock import patch

from esxtop_perf import config
from esxtop_perf.analysis import RULES, build_analysis
from esxtop_perf.catalog import METRIC_DEFS, canonical_metric, group_family, infer_unit, metric_definition
from esxtop_perf.parser import CaptureError, _parse_vcpu_instance, _systemish, parse_capture

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "public" / "demo" / "esxtop-demo.csv"


def _series(metric: str, value: float, *, statistic: str = "p95", scope: str = "vm", group: str = "Virtual Disk", unit: str = "ms", entity: str = "VM1") -> dict:
    stats = {
        "count": 3,
        "min": value,
        "max": value,
        "avg": value,
        "last": value,
        "p05": value,
        "p50": value,
        "p95": value,
    }
    stats[statistic] = value
    return {
        "id": f"{metric}:{entity}:{scope}",
        "metric": metric,
        "counter": metric,
        "kind": "numeric",
        "scope": scope,
        "group": group,
        "groupInstance": entity,
        "instance": entity,
        "entity": entity,
        "entityKind": "virtual disk" if scope == "vm" else "storage",
        "vm": entity if scope == "vm" else "",
        "host": "esxi01",
        "unit": unit,
        "category": "storage",
        "stats": stats,
    }


def _analyze(*series: dict) -> dict:
    return build_analysis({"series": list(series)})



class ConfigLimitTests(unittest.TestCase):
    def test_default_series_limit_supports_observed_capture(self) -> None:
        with patch.dict(os.environ, {"ESXTOP_MAX_SERIES": ""}):
            self.assertEqual(config.max_series(), 200_000)

    def test_default_cell_limit_preserves_100_samples(self) -> None:
        with patch.dict(os.environ, {"ESXTOP_MAX_CELLS": ""}):
            self.assertEqual(config.max_cells(), 20_000_000)
            self.assertGreaterEqual(config.max_cells(), 200_000 * 100)

    def test_series_limit_remains_configurable(self) -> None:
        with patch.dict(os.environ, {"ESXTOP_MAX_SERIES": "250000"}):
            self.assertEqual(config.max_series(), 250_000)

    def test_concurrent_analysis_limit_is_configurable(self) -> None:
        with patch.dict(os.environ, {"ESXTOP_MAX_CONCURRENT_ANALYSES": "3"}):
            self.assertEqual(config.max_concurrent_analyses(), 3)
        with patch.dict(os.environ, {"ESXTOP_MAX_CONCURRENT_ANALYSES": ""}):
            self.assertEqual(config.max_concurrent_analyses(), 1)

    def test_request_limits_are_configurable(self) -> None:
        with patch.dict(os.environ, {"ESXTOP_MAX_CONCURRENT_REQUESTS": "12", "ESXTOP_REQUEST_TIMEOUT_SECONDS": "45"}):
            self.assertEqual(config.max_concurrent_requests(), 12)
            self.assertEqual(config.request_timeout_seconds(), 45)
        with patch.dict(os.environ, {"ESXTOP_MAX_CONCURRENT_REQUESTS": "", "ESXTOP_REQUEST_TIMEOUT_SECONDS": ""}):
            self.assertEqual(config.max_concurrent_requests(), 32)
            self.assertEqual(config.request_timeout_seconds(), 120)

    def test_dotenv_loader_supports_quotes_and_environment_precedence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "# comment\n"
                "export ESXTOP_DOTENV_ONE=123\n"
                'ESXTOP_DOTENV_TWO="hello world" # trailing comment\n'
                "ESXTOP_DOTENV_ONE=fromfile\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"ESXTOP_DOTENV_ONE": "fromenv"}, clear=False):
                config._load_env_file(path)
                self.assertEqual(os.environ["ESXTOP_DOTENV_ONE"], "fromenv")
                self.assertEqual(os.environ["ESXTOP_DOTENV_TWO"], "hello world")

    def test_upload_password_gate(self) -> None:
        with patch.dict(os.environ, {"ESXTOP_UPLOAD_PASSWORD": "correct horse battery staple"}):
            self.assertTrue(config.upload_auth_required())
            self.assertTrue(config.verify_upload_password("correct horse battery staple"))
            self.assertFalse(config.verify_upload_password("wrong"))
            self.assertFalse(config.verify_upload_password(""))
        with patch.dict(os.environ, {"ESXTOP_UPLOAD_PASSWORD": ""}):
            self.assertFalse(config.upload_auth_required())
            self.assertTrue(config.verify_upload_password(None))


class DemoAnalysisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.parsed = parse_capture(str(DEMO), "esxtop-demo.csv")
        cls.doc = build_analysis(cls.parsed)

    def test_meta(self) -> None:
        self.assertEqual(self.doc["meta"]["host"], "esxi01")
        self.assertEqual(self.doc["meta"]["sampleCount"], 60)
        self.assertEqual(self.doc["meta"]["intervalSeconds"], 2.0)
        self.assertEqual(self.doc["meta"]["durationSeconds"], 118.0)
        self.assertEqual(self.doc["meta"]["columns"], 936)
        self.assertEqual(self.doc["meta"]["vmCount"], 6)
        self.assertFalse(self.doc["meta"]["compressed"])

    def test_vms_are_deduplicated(self) -> None:
        self.assertEqual(
            self.doc["vms"],
            ["APP-01", "DC-01", "ERP-SQL01", "FILE-01", "WEB-01", "WEB-02"],
        )
        self.assertFalse(any(":" in vm for vm in self.doc["vms"]))

    def test_human_readable_counters_are_normalised(self) -> None:
        ready = [item for item in self.doc["series"] if item["metric"] == "%RDY"]
        self.assertTrue(ready)
        self.assertTrue(all(item["known"] for item in ready))
        self.assertIn("%RDY", self.doc["metrics"])

    def test_status_colours_and_findings(self) -> None:
        summary = self.doc["summary"]
        self.assertEqual(summary["status"], "critical")
        self.assertGreater(summary["critical"], 0)
        self.assertIsNotNone(summary["score"])
        self.assertGreaterEqual(summary["score"], 0)
        self.assertLessEqual(summary["score"], 100)
        self.assertTrue(self.doc["findings"])
        for finding in self.doc["findings"]:
            self.assertIn(finding["severity"], {"critical", "warning", "info"})
            self.assertTrue(finding["references"])
            self.assertTrue(finding["worstSeries"])

    def test_expected_critical_signals(self) -> None:
        titles = {(item["title"], item["entity"]) for item in self.doc["findings"]}
        self.assertIn(("vCPU ready time is elevated", "ERP-SQL01"), titles)
        self.assertIn(("CPU limit is throttling the VM", "ERP-SQL01"), titles)
        self.assertIn(("Memory is being reclaimed by ballooning", "WEB-01"), titles)
        self.assertIn(("Host-wide ballooning is active", "esxi01"), titles)
        self.assertIn(("Physical CPU utilisation is high", "esxi01"), titles)

    def test_equivalent_host_cpu_findings_are_grouped(self) -> None:
        host_cpu_findings = [
            item for item in self.doc["findings"]
            if item["title"] == "Physical CPU utilisation is high" and item["entity"] == "esxi01"
        ]
        self.assertEqual(len(host_cpu_findings), 1)
        self.assertGreater(len(host_cpu_findings[0]["seriesIds"]), 1)

    def test_text_series_are_preserved(self) -> None:
        text = [item for item in self.doc["series"] if item["kind"] == "text"]
        self.assertTrue(text)
        self.assertTrue(all(item["stats"]["count"] == 0 for item in text))
        self.assertTrue(any("Link Up?" in item["counter"] for item in text))

    def test_numeric_series_use_compact_arrays(self) -> None:
        numeric = [item for item in self.parsed["series"] if item["kind"] == "numeric"]
        self.assertTrue(numeric)
        self.assertTrue(all(isinstance(item["values"], array) for item in numeric))
        self.assertTrue(all(item["values"].typecode == "d" for item in numeric))

    def test_category_counts_are_consistent(self) -> None:
        categories = self.doc["summary"]["categories"]
        self.assertEqual(categories["cpu"]["series"], 540)
        self.assertEqual(categories["memory"]["series"], 181)
        self.assertEqual(categories["storage"]["series"], 146)
        self.assertEqual(categories["network"]["series"], 60)
        self.assertEqual(categories["power"]["series"], 9)
        self.assertEqual(categories["interrupt"]["series"], 0)
        self.assertEqual(categories["other"]["series"], 0)
        self.assertEqual(
            sum(item["series"] for item in categories.values()),
            len(self.doc["series"]),
        )


class RuleCoverageTests(unittest.TestCase):
    def test_new_storage_latency_rules_use_layer_guardrails(self) -> None:
        cases = (
            (("LAT/rd", "LAT/wr", "GAVG/rd", "GAVG/wr", "DAVG/rd", "DAVG/wr"), 10.0, 25.0),
            (("KAVG/rd", "KAVG/wr"), 2.0, 5.0),
            (("QAVG/rd", "QAVG/wr"), 5.0, 10.0),
        )
        for metrics, warn, critical in cases:
            for metric in metrics:
                with self.subTest(metric=metric, level="warning"):
                    item = _analyze(_series(metric, warn))["series"][0]
                    self.assertEqual(item["status"], "warn")
                    self.assertEqual(item["threshold"], warn)
                with self.subTest(metric=metric, level="critical"):
                    item = _analyze(_series(metric, critical))["series"][0]
                    self.assertEqual(item["status"], "critical")
                    self.assertEqual(item["threshold"], critical)
                with self.subTest(metric=metric, level="ok"):
                    item = _analyze(_series(metric, warn / 2))["series"][0]
                    self.assertEqual(item["status"], "ok")
                    self.assertIsNone(item["threshold"])

    def test_storage_latency_findings_group_split_and_combined(self) -> None:
        document = _analyze(
            _series("GAVG/cmd", 25.0),
            _series("GAVG/rd", 25.0),
            _series("LAT/rd", 25.0),
        )
        findings = [
            finding for finding in document["findings"]
            if finding["title"] == "Guest storage latency is elevated"
        ]
        self.assertEqual(len(findings), 1)
        self.assertEqual(len(findings[0]["seriesIds"]), 3)

    def test_load_and_overcommit_variants_use_same_guardrails(self) -> None:
        for metric in ("LOAD5", "LOAD15"):
            for value, expected in ((1.0, "warn"), (2.0, "critical"), (0.5, "ok")):
                with self.subTest(metric=metric, value=value):
                    item = _analyze(
                        _series(metric, value, scope="host", group="Physical Cpu Load", unit="", entity="esxi01")
                    )["series"][0]
                    self.assertEqual(item["status"], expected)

        for metric in ("OVERCOMMIT1", "OVERCOMMIT5", "OVERCOMMIT15"):
            for value, expected in ((1.0, "info"), (5.0, "info"), (0.5, "ok")):
                with self.subTest(metric=metric, value=value):
                    item = _analyze(
                        _series(metric, value, scope="host", group="Memory", unit="", entity="esxi01")
                    )["series"][0]
                    self.assertEqual(item["status"], expected)
                    self.assertIsNone(item["criticalThreshold"])

    def test_hard_storage_failure_counters_are_never_healthy(self) -> None:
        cases = (
            ("FCMDS/s", "host", "Disk Device", "/s", "Storage I/O failures are reported"),
            ("FREAD/s", "host", "Disk Device", "/s", "Storage I/O failures are reported"),
            ("FWRITE/s", "host", "Disk Device", "/s", "Storage I/O failures are reported"),
            ("FMBRD/s", "host", "Disk Device", "B/s", "Storage I/O failures are reported"),
            ("FMBWR/s", "host", "Disk Device", "B/s", "Storage I/O failures are reported"),
            ("FRESV/s", "host", "Disk Device", "/s", "Storage I/O failures are reported"),
            ("FAILED_IO", "vm", "Virtual Disk", "", "Storage I/O failures are reported"),
            ("UNMAP_FAIL/s", "vm", "Virtual Disk", "/s", "UNMAP operations are failing"),
            ("UNMAP_FAIL_MB/s", "vm", "Virtual Disk", "MB/s", "UNMAP operations are failing"),
            ("CLONE_F", "vm", "Virtual Disk", "", "VAAI operations are failing"),
            ("LCLONE_F", "vm", "Virtual Disk", "", "VAAI operations are failing"),
            ("EXTSTATS_F", "vm", "Virtual Disk", "", "VAAI operations are failing"),
            ("RESSPACE_F", "vm", "Virtual Disk", "", "VAAI operations are failing"),
            ("ZERO_F", "vm", "Virtual Disk", "", "VAAI operations are failing"),
        )
        for metric, scope, group, unit, expected_title in cases:
            with self.subTest(metric=metric, value=1):
                document = _analyze(
                    _series(metric, 1.0, statistic="max", scope=scope, group=group, unit=unit)
                )
                self.assertEqual(document["series"][0]["status"], "warn")
                self.assertTrue(any(finding["title"] == expected_title for finding in document["findings"]))
            with self.subTest(metric=metric, value=0):
                document = _analyze(
                    _series(metric, 0.0, statistic="max", scope=scope, group=group, unit=unit)
                )
                self.assertEqual(document["series"][0]["status"], "ok")
                self.assertEqual(document["findings"], [])

    def test_workload_and_ambiguous_storage_metrics_stay_unruled(self) -> None:
        cases = (
            ("CMDS/s", 10000.0, "vm", "Virtual Disk", "/s"),
            ("READS/s", 10000.0, "vm", "Virtual Disk", "/s"),
            ("WRITES/s", 10000.0, "vm", "Virtual Disk", "/s"),
            ("MBREAD/s", 1000.0, "vm", "Virtual Disk", "MB/s"),
            ("MBWRTN/s", 1000.0, "vm", "Virtual Disk", "MB/s"),
            ("ACTV", 512.0, "host", "Disk Device", ""),
            ("TOTAL_IO", 999999.0, "vm", "Virtual Disk", ""),
            ("VSCSI_LATENCY", 100.0, "vm", "Virtual Disk", "ms"),
            ("SPLTCMD/s", 100.0, "host", "Disk Device", "/s"),
            ("AQLEN", 1024.0, "host", "Disk Device", ""),
        )
        for metric, value, scope, group, unit in cases:
            with self.subTest(metric=metric):
                item = _analyze(
                    _series(metric, value, scope=scope, group=group, unit=unit)
                )["series"][0]
                self.assertEqual(item["status"], "neutral")
                self.assertEqual(item["statusText"], "No automatic threshold")

    def test_rule_ids_and_metrics_are_catalogued(self) -> None:
        ids = [rule.id for rule in RULES]
        self.assertEqual(len(ids), len(set(ids)), "rule ids must be unique")
        for rule in RULES:
            with self.subTest(rule=rule.id):
                self.assertIn(rule.metric, METRIC_DEFS)
                self.assertTrue(rule.title)
                self.assertTrue(rule.summary)
                self.assertTrue(rule.recommendation)
                self.assertTrue(rule.refs)
        ruled_metrics = {rule.metric for rule in RULES}
        for metric in ("CMDS/s", "READS/s", "WRITES/s", "MBREAD/s", "MBWRTN/s", "VSCSI_LATENCY"):
            self.assertNotIn(metric, ruled_metrics)


class ParserEdgeTests(unittest.TestCase):
    def test_gzip_is_detected_by_magic_bytes_not_name(self) -> None:
        payload = gzip.compress(DEMO.read_bytes(), compresslevel=1)
        with tempfile.NamedTemporaryFile(suffix=".csv.gz", delete=False) as handle:
            handle.write(payload)
            name = handle.name
        try:
            parsed = parse_capture(name, "not-really.csv")
            self.assertTrue(parsed["meta"]["compressed"])
            self.assertEqual(parsed["meta"]["sampleCount"], 60)
            self.assertEqual(parsed["meta"]["columns"], 936)
        finally:
            Path(name).unlink(missing_ok=True)

    def test_minimal_capture_and_vcpu_names(self) -> None:
        header = (
            '"(PDH-CSV 4.0) (UTC)(0)",'
            '"\\\\lab\\Group Cpu(42:DB01)\\% Ready",'
            '"\\\\lab\\Vcpu(42:DB01:77:vmx-vcpu-0)\\% Ready",'
            '"\\\\lab\\Network Port(100:DB01.eth0)\\% Outbound Packets Dropped",'
            '"\\\\lab\\Disk Device(naa.1234)\\% Used"'
        )
        body = "\n".join(
            f'"11/02/2026 12:00:0{index}","{value}","{value}","{value}","{value}"'
            for index, value in enumerate((0, 1, 2))
        )
        text = f"{header}\n{body}\n"
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as handle:
            handle.write(text)
            name = handle.name
        try:
            parsed = parse_capture(name, "minimal.csv")
        finally:
            Path(name).unlink(missing_ok=True)
        vcpu = next(item for item in parsed["series"] if item["group"] == "Vcpu")
        self.assertEqual(vcpu["vm"], "DB01")
        self.assertEqual(vcpu["world"], "vmx-vcpu-0")
        network = next(item for item in parsed["series"] if item["group"] == "Network Port")
        self.assertEqual(network["vm"], "DB01")
        disk = next(item for item in parsed["series"] if item["group"] == "Disk Device")
        self.assertEqual(disk["metric"], "%USD")
        self.assertEqual(parsed["vms"], ["DB01"])

    def test_vcpu_helper_worlds_do_not_create_fake_vms(self) -> None:
        header = (
            '"(PDH-CSV 4.0) (UTC)(0)",'
            '"\\\\lab\\Vcpu(10882:DNS-MAIL:2100228:vmx-filtPoll:DNS-MAIL)\\% Used",'
            '"\\\\lab\\Vcpu(10882:DNS-MAIL:2100233:vmx-vcpu-0:DNS-MAIL)\\% Ready",'
            '"\\\\lab\\Vcpu(1:drivers:2099001:vmx-vcpu-0)\\% Ready",'
            '"\\\\lab\\Vcpu(1:system:2097153:idle1)\\% Ready"'
        )
        body = "\n".join(
            f'"11/02/2026 12:00:0{index}","0","0","0","0"'
            for index in range(2)
        )
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as handle:
            handle.write(f"{header}\n{body}\n")
            name = handle.name
        try:
            parsed = parse_capture(name, "vcpu-helpers.csv")
        finally:
            Path(name).unlink(missing_ok=True)
        self.assertEqual(parsed["vms"], ["DNS-MAIL"])
        self.assertEqual(parsed["meta"]["vmCount"], 1)
        worlds = {
            item["world"]
            for item in parsed["series"]
            if item["vm"] == "DNS-MAIL"
        }
        self.assertEqual(worlds, {"vmx-filtPoll", "vmx-vcpu-0"})
        self.assertTrue(all(item["scope"] == "host" for item in parsed["series"] if item["host"] and item["vm"] == ""))

    def test_system_worlds_are_not_classified_as_vms(self) -> None:
        header = (
            '"(PDH-CSV 4.0) (UTC)(0)",'
            '"\\\\lab\\Vcpu(100:system1:200:vmx-vcpu-0)\\% Ready",'
            '"\\\\lab\\Vcpu(101:WEB01:201:vmx-vcpu-0)\\% Ready",'
            '"\\\\lab\\Vcpu(102:hostd.20994601:202:vmx-vcpu-0)\\% Ready",'
            '"\\\\lab\\Group Cpu(103:hostd.20994601)\\% Used",'
            '"\\\\lab\\Group Memory(104:python.20979311)\\Numa % Local",'
            '"\\\\lab\\Group Memory(105:WEB01)\\Numa % Local",'
            '"\\\\lab\\Group Cpu(106:WEB01)\\% Used"'
        )
        values = ("72.7", "12.0", "30.0", "5.0", "0", "40", "20")
        body = "\n".join(
            f'"11/02/2026 12:00:0{index}",' + ",".join(f'"{value}"' for value in values)
            for index in range(3)
        )
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as handle:
            handle.write(f"{header}\n{body}\n")
            name = handle.name
        try:
            parsed = parse_capture(name, "system-worlds.csv")
            document = build_analysis(parsed)
        finally:
            Path(name).unlink(missing_ok=True)

        self.assertEqual(parsed["vms"], ["WEB01"])
        self.assertEqual(parsed["meta"]["vmCount"], 1)

        def series_with(fragment: str, metric: str) -> dict:
            return next(
                item for item in parsed["series"]
                if fragment in item["instance"] and item["metric"] == metric
            )

        system_ready = series_with("system1", "%RDY")
        hostd_ready = series_with("hostd.20994601", "%RDY")
        python_numa = series_with("python.20979311", "N%L")
        hostd_cpu = series_with("hostd.20994601", "%USED")
        web_ready = next(item for item in parsed["series"] if item["vm"] == "WEB01" and item["metric"] == "%RDY")

        for item in (system_ready, hostd_ready, python_numa, hostd_cpu):
            self.assertEqual(item["scope"], "host")
            self.assertEqual(item["vm"], "")
        self.assertEqual(web_ready["scope"], "vm")
        self.assertEqual(web_ready["vm"], "WEB01")

        ready_entities = {
            finding["entity"] for finding in document["findings"]
            if finding["title"] == "vCPU ready time is elevated"
        }
        self.assertIn("WEB01", ready_entities)
        self.assertNotIn("system1", ready_entities)
        self.assertNotIn("hostd.20994601", ready_entities)

        numa_entities = {
            finding["entity"] for finding in document["findings"]
            if finding["title"] == "NUMA locality is poor"
        }
        self.assertIn("WEB01", numa_entities)
        self.assertNotIn("python.20979311", numa_entities)

    def test_corrupt_gzip_is_rejected(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".csv.gz", delete=False) as handle:
            handle.write(b"\x1f\x8b" + b"this is not a valid gzip stream")
            name = handle.name
        try:
            with self.assertRaises(CaptureError) as context:
                parse_capture(name, "corrupt.csv.gz")
            self.assertEqual(context.exception.status, 422)
        finally:
            Path(name).unlink(missing_ok=True)

    def test_healthy_capture_is_green(self) -> None:
        header = (
            '"(PDH-CSV 4.0) (UTC)(0)",'
            '"\\\\lab\\Physical Cpu(_Total)\\% Processor Time",'
            '"\\\\lab\\Vcpu(42:DB01:77:vmx-vcpu-0)\\% Ready"'
        )
        body = "\n".join(
            f'"11/02/2026 12:00:0{index}","{value}","{value / 10}"'
            for index, value in enumerate((10, 11, 9))
        )
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as handle:
            handle.write(f"{header}\n{body}\n")
            name = handle.name
        try:
            document = build_analysis(parse_capture(name, "healthy.csv"))
        finally:
            Path(name).unlink(missing_ok=True)
        self.assertEqual(document["summary"]["status"], "ok")
        self.assertEqual(document["summary"]["score"], 100)
        self.assertEqual(document["summary"]["critical"], 0)
        self.assertEqual(document["summary"]["warning"], 0)


    def test_multi_host_metadata_and_report_scope_inputs(self) -> None:
        header = (
            '"(PDH-CSV 4.0) (UTC)(0)",'
            '"\\\\h1\\Physical Cpu(_Total)\\% Processor Time",'
            '"\\\\h2\\Physical Cpu(_Total)\\% Processor Time"'
        )
        body = "\n".join(
            f'"11/02/2026 12:00:0{index}","{h1_value}","{h2_value}"'
            for index, (h1_value, h2_value) in enumerate(((10, 11), (11, 95), (9, 96)))
        )
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as handle:
            handle.write(f"{header}\n{body}\n")
            name = handle.name
        try:
            document = build_analysis(parse_capture(name, "multi-host.csv"))
        finally:
            Path(name).unlink(missing_ok=True)
        self.assertEqual(document["meta"]["hosts"], ["h1", "h2"])
        self.assertEqual(document["meta"]["hostCount"], 2)
        self.assertEqual({item["host"] for item in document["series"]}, {"h1", "h2"})
        self.assertTrue(any(
            finding["host"] == "h2" and finding["metric"] == "PCPU %"
            for finding in document["findings"]
        ))

    def test_non_pdh_file_is_rejected(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as handle:
            handle.write('"not a capture","1"\n')
            name = handle.name
        try:
            with self.assertRaises(CaptureError):
                parse_capture(name, "bad.csv")
        finally:
            Path(name).unlink(missing_ok=True)

    def test_canonical_metric_context(self) -> None:
        self.assertEqual(canonical_metric("Physical Cpu(0)", "% Used"), "%USED")
        self.assertEqual(canonical_metric("Disk Device(naa.1)", "% Used"), "%USD")
        self.assertEqual(group_family("Group Cpu(1:VM)"), "cpu")
        self.assertEqual(group_family("Virtual Disk(VM:scsi0:0)"), "storage")
        self.assertEqual(group_family("Numa Node(0)"), "numa")
        self.assertEqual(canonical_metric("Memory", "Swap MBytes Read/sec"), "SWAP_READ")
        self.assertEqual(canonical_metric("Memory", "Swap Target MBytes"), "SWAP_TARGET_MB")
        self.assertEqual(canonical_metric("Group Memory(1:VM)", "Swap Target MBytes"), "SWTGT")
        self.assertEqual(canonical_metric("Group Memory(1:VM)", "Memctl Target MBytes"), "MCTLTGT")
        self.assertEqual(canonical_metric("Memory", "Memctl Target MBytes"), "MEMCTL_TARGET_MB")
        self.assertEqual(canonical_metric("Virtual Disk(VM (uuid):scsi0:0)", "Average Guest MilliSec/Command"), "GAVG/cmd")
        # Allocation names are shared by the CPU and memory panels but mean
        # different things and use different units.
        self.assertEqual(canonical_metric("Group Cpu(1:VM)", "Alloc Min"), "CPU_ALLOC_MIN")
        self.assertEqual(canonical_metric("Group Memory(1:VM)", "Alloc Min"), "MEM_ALLOC_MIN")
        self.assertEqual(canonical_metric("Vcpu(1:VM:2:vmx)", "Members"), "CPU_MEMBERS")
        self.assertEqual(canonical_metric("Group Memory(1:VM)", "Members"), "MEM_MEMBERS")
        self.assertEqual(canonical_metric("Memory", "PShare Common MBytes"), "PSHARE_COMMON_MB")
        self.assertEqual(canonical_metric("Memory", "PShare Shared MBytes"), "PSHARE_SHARED_MB")
        self.assertEqual(canonical_metric("Group Memory(1:VM)", "Guest Memory on Numa Node 3"), "GUEST_MEM_NUMA")
        self.assertEqual(canonical_metric("Virtual Disk(VM)", "Average MilliSec/Read"), "LAT/rd")
        self.assertEqual(canonical_metric("Network Port(vmnic0)", "Link Speed (Mb/s)"), "SPEED")
        self.assertEqual(canonical_metric("VSAN", "Enabled?"), "VSAN_ENABLED")
        self.assertEqual(canonical_metric("Interrupt Cookie(0x0:CPU0)", "Interrupts/second"), "INT_COUNT/s")
        self.assertEqual(metric_definition("INT_TIME/us", "Processing Time MicroSec/Interrupt")["unit"], "µs")
        self.assertEqual(metric_definition("QAVG/rd", "Average Queue MilliSec/Read")["unit"], "ms")
        self.assertEqual(metric_definition("MEM_ALLOC_MIN", "Alloc Min")["unit"], "MB")
        self.assertEqual(infer_unit("Link Speed (Mb/s)"), "Mbps")

    def test_vcpu_instance_forms_and_system_groups(self) -> None:
        self.assertEqual(
            _parse_vcpu_instance("10882:DNS-MAIL:2100228:vmx-filtPoll:DNS-MAIL"),
            ("DNS-MAIL", "vmx-filtPoll"),
        )
        self.assertEqual(
            _parse_vcpu_instance("10882:DNS-MAIL:2100233:vmx-vcpu-0:DNS-MAIL"),
            ("DNS-MAIL", "vmx-vcpu-0"),
        )
        self.assertEqual(
            _parse_vcpu_instance("1:system:2097859:tq:incompatTQ"),
            ("system", "tq:incompatTQ"),
        )
        self.assertEqual(
            _parse_vcpu_instance("1:system:2098101:0000:19:00.0-helper"),
            ("system", "0000:19:00.0-helper"),
        )
        self.assertEqual(_parse_vcpu_instance("42:DB01:77:vmx-vcpu-0"), ("DB01", "vmx-vcpu-0"))
        self.assertEqual(_parse_vcpu_instance("42:DB01:77"), ("DB01", ""))
        for name in ("drivers", "ft", "net", "userworld", "virtscsi", "vmotion", "system", "hostd.20994601"):
            self.assertTrue(_systemish(name), name)
        for name in ("DNS-MAIL", "WIN11", "vCLS-4c4c4544-0058-4d10-805a-c7c04f534333"):
            self.assertFalse(_systemish(name), name)

    def test_all_field_human_names_are_catalogued(self) -> None:
        header = (
            '"(PDH-CSV 4.0) (UTC)(0)",'
            '"\\\\lab\\Group Cpu(1:DB01)\\Alloc Min",'
            '"\\\\lab\\Group Memory(1:DB01)\\Commit Pages Per Share",'
            '"\\\\lab\\Virtual Disk(DB01)\\Average MilliSec/Read",'
            '"\\\\lab\\Physical Disk SCSI Device(naa.1)\\Average Success Latency ms/ATS",'
            '"\\\\lab\\Interrupt Cookie(0x0:CPU0)\\Interrupts/second",'
            '"\\\\lab\\Interrupt Cookie(0x0:CPU0)\\Processing Time MicroSec/Interrupt",'
            '"\\\\lab\\PCPU Power State(PCPU 0)\\%C-State C0",'
            '"\\\\lab\\Network Port(100:DB01.eth0)\\Link Speed (Mb/s)",'
            '"\\\\lab\\VSAN\\Enabled?",'
            '"\\\\lab\\Memory\\PShare Common MBytes"'
        )
        body = "\n".join(
            f'"11/02/2026 12:00:0{index}",' + ",".join('"0"' for _ in range(10))
            for index in range(2)
        )
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as handle:
            handle.write(f"{header}\n{body}\n")
            name = handle.name
        try:
            parsed = parse_capture(name, "all-fields.csv")
            document = build_analysis(parsed)
        finally:
            Path(name).unlink(missing_ok=True)

        self.assertEqual(parsed["meta"]["columns"], 10)
        self.assertTrue(all(item["known"] for item in parsed["series"]))
        self.assertTrue(all(
            item["category"] in {"cpu", "memory", "storage", "network", "power", "interrupt", "other"}
            for item in parsed["series"]
        ))
        interrupt = [item for item in document["series"] if item["category"] == "interrupt"]
        self.assertEqual(len(interrupt), 2)
        self.assertEqual(document["summary"]["categories"]["interrupt"]["series"], 2)
        self.assertTrue(all(item["stats"]["count"] == 2 for item in interrupt))
        self.assertTrue(any(obs["id"] == "vsan-not-enabled" for obs in document["observations"]))


if __name__ == "__main__":
    unittest.main()

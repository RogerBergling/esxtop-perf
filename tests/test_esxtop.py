from __future__ import annotations

import gzip
import tempfile
import unittest
from pathlib import Path

from esxtop_perf.analysis import build_analysis
from esxtop_perf.catalog import canonical_metric, group_family
from esxtop_perf.parser import CaptureError, parse_capture

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "public" / "demo" / "esxtop-demo.csv"


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

    def test_category_counts_are_consistent(self) -> None:
        categories = self.doc["summary"]["categories"]
        self.assertEqual(categories["cpu"]["series"], 547)
        self.assertEqual(categories["memory"]["series"], 181)
        self.assertEqual(categories["storage"]["series"], 146)
        self.assertEqual(categories["network"]["series"], 60)
        self.assertEqual(
            sum(item["series"] for item in categories.values()),
            len(self.doc["series"]),
        )


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


if __name__ == "__main__":
    unittest.main()

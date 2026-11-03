"""Threshold analysis and triage findings for esxtop captures.

The rule engine is deliberately transparent: every finding carries the metric,
the observed percentile, the threshold that was crossed and the sources behind
the interpretation. It is a triage aid, not a vSphere alarm engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .catalog import REFERENCES, expand_refs, metric_definition, public_catalog


@dataclass(frozen=True)
class Rule:
    id: str
    metric: str
    title: str
    category: str
    statistic: str
    warn: float | None = None
    critical: float | None = None
    direction: str = "high"
    scope: str | None = None
    groups: tuple[str, ...] = ()
    info: bool = False
    summary: str = ""
    recommendation: str = ""
    refs: tuple[str, ...] = field(default_factory=tuple)


RULES: tuple[Rule, ...] = (
    Rule(
        id="cpu.ready",
        metric="%RDY",
        title="vCPU ready time is elevated",
        category="cpu",
        statistic="p95",
        warn=5.0,
        critical=10.0,
        scope="vm",
        groups=("vcpu",),
        summary=(
            "The vCPU was ready to run but waited for a physical CPU. "
            "This is host scheduling contention, not guest compute time."
        ),
        recommendation=(
            "Check host CPU load and vCPU oversubscription. Compare %RDY with %MLMTD: "
            "if MLMTD is non-zero, remove or raise the CPU limit before adding capacity. "
            "Otherwise reduce vCPUs, move the VM, or add host capacity."
        ),
        refs=("vm_performance", "yellow_bricks", "esxtop_metrics"),
    ),
    Rule(
        id="cpu.limit",
        metric="%MLMTD",
        title="CPU limit is throttling the VM",
        category="cpu",
        statistic="p95",
        warn=0.1,
        critical=5.0,
        scope="vm",
        groups=("vcpu", "group cpu"),
        summary=(
            "The VM was ready but deliberately not scheduled because a VM or resource-pool "
            "CPU limit would have been exceeded. %MLMTD is included in %RDY."
        ),
        recommendation=(
            "Inspect the VM and resource-pool CPU limit. If the limit is intentional, "
            "treat this as expected policy; otherwise raise or remove it. Adding physical "
            "CPU capacity will not fix a limit-induced ready time."
        ),
        refs=("resource_limits", "yellow_bricks"),
    ),
    Rule(
        id="cpu.costop",
        metric="%CSTP",
        title="SMP co-stop is delaying vCPUs",
        category="cpu",
        statistic="p95",
        warn=3.0,
        critical=5.0,
        scope="vm",
        groups=("vcpu",),
        summary=(
            "A vCPU waited for its siblings to become co-schedulable. This commonly appears "
            "when a multi-vCPU VM runs a workload that cannot use all vCPUs evenly."
        ),
        recommendation=(
            "Review vCPU count and guest workload balance. A VM with more vCPUs than the "
            "workload can use is often faster with fewer vCPUs. Check %RDY and %CSTP together."
        ),
        refs=("yellow_bricks", "esxtop_metrics"),
    ),
    Rule(
        id="cpu.swapwait",
        metric="%SWPWT",
        title="vCPU is waiting on swapped memory",
        category="memory",
        statistic="p95",
        warn=1.0,
        critical=5.0,
        scope="vm",
        groups=("vcpu", "group cpu"),
        summary=(
            "The VM waited for the VMkernel to read swapped pages back from disk. "
            "This is a severe memory-pressure symptom because swap-in is synchronous."
        ),
        recommendation=(
            "Check host free memory, MCTLSZ and SWCUR for this VM. Remove memory limits if "
            "they are artificially low, right-size reservations, add host memory, or move "
            "the VM. Do not treat this as a storage-only problem."
        ),
        refs=("yellow_bricks", "resource_limits", "vm_performance"),
    ),
    Rule(
        id="cpu.host_core",
        metric="PCPU %",
        title="Physical CPU utilisation is high",
        category="cpu",
        statistic="p95",
        warn=80.0,
        critical=90.0,
        scope="host",
        summary=(
            "One or more physical CPUs are spending most of their time busy. Sustained host "
            "saturation increases vCPU ready time and can starve storage and network worlds."
        ),
        recommendation=(
            "Correlate with vCPU %RDY and host load average. Reduce vCPU density, move VMs "
            "off the host, or add CPU capacity. Review whether one workload is responsible."
        ),
        refs=("esxtop_metrics", "vm_performance"),
    ),
    Rule(
        id="cpu.host_core_util",
        metric="PCPU_UTIL",
        title="Physical CPU utilisation is high",
        category="cpu",
        statistic="p95",
        warn=80.0,
        critical=90.0,
        scope="host",
        summary=(
            "One or more physical CPUs are spending most of their time busy. Sustained host "
            "saturation increases vCPU ready time and can starve storage and network worlds."
        ),
        recommendation=(
            "Correlate with vCPU %RDY and host load average. Reduce vCPU density, move VMs "
            "off the host, or add CPU capacity."
        ),
        refs=("esxtop_metrics", "vm_performance"),
    ),
    Rule(
        id="cpu.host_core_util2",
        metric="CORE_UTIL",
        title="Physical CPU utilisation is high",
        category="cpu",
        statistic="p95",
        warn=80.0,
        critical=90.0,
        scope="host",
        summary=(
            "Core-level utilisation is sustained above the guardrail. A socket-level total can "
            "hide a saturated core."
        ),
        recommendation=(
            "Check per-core load and vCPU scheduling. Consider moving workloads or adding capacity."
        ),
        refs=("esxtop_metrics",),
    ),
    Rule(
        id="cpu.load",
        metric="LOAD1",
        title="Host CPU load average is over 1.0",
        category="cpu",
        statistic="p95",
        warn=1.0,
        critical=2.0,
        scope="host",
        summary=(
            "Broadcom describes a load average near 1.0 as fully utilised and 2.0 as an "
            "overloaded host. Use the 5- and 15-minute load averages to judge duration."
        ),
        recommendation=(
            "Check %RDY and host CPU utilisation. If the high load is sustained, reduce vCPU "
            "allocation or add capacity. A single short spike is usually not actionable."
        ),
        refs=("vm_performance",),
    ),
    Rule(
        id="mem.overcommit",
        metric="OVERCOMMIT1",
        title="Memory is overcommitted",
        category="memory",
        statistic="p95",
        warn=1.0,
        critical=2.0,
        scope="host",
        info=True,
        summary=(
            "The host's requested memory exceeds managed memory. Overcommit is a planning "
            "signal; it becomes a performance problem only when reclaim (ballooning or swap) "
            "is active."
        ),
        recommendation=(
            "Do not resize based on overcommit alone. Correlate with MCTLSZ, SWCUR, SWR/s, "
            "SWW/s and guest performance. Confirm whether VM memory limits or reservations "
            "are distorting the ratio."
        ),
        refs=("vm_performance", "esxtop_metrics"),
    ),
    Rule(
        id="mem.balloon",
        metric="MCTLSZ",
        title="Memory is being reclaimed by ballooning",
        category="memory",
        statistic="p95",
        warn=1.0,
        critical=1024.0,
        scope="vm",
        summary=(
            "The balloon driver is reclaiming guest memory because the host is under memory "
            "pressure or a VM memory limit is configured."
        ),
        recommendation=(
            "Check the VM's memory limit and reservation, then host free memory and swap. "
            "A small balloon can be benign; large or growing ballooning requires right-sizing "
            "or more host memory. See Broadcom 326270 for the limit interaction."
        ),
        refs=("yellow_bricks", "resource_limits", "vm_performance"),
    ),
    Rule(
        id="mem.host_balloon",
        metric="MEMCTL_CURRENT_MB",
        title="Host-wide ballooning is active",
        category="memory",
        statistic="p95",
        warn=1.0,
        critical=1024.0,
        scope="host",
        summary="The host is reclaiming memory through the balloon driver.",
        recommendation=(
            "Find the VMs carrying MCTLSZ. Check host free memory, VM memory limits and "
            "reservations, and whether the host is overcommitted."
        ),
        refs=("vm_performance", "yellow_bricks"),
    ),
    Rule(
        id="mem.swapcur",
        metric="SWCUR",
        title="VM memory has been swapped",
        category="memory",
        statistic="p95",
        warn=0.1,
        critical=1024.0,
        scope="vm",
        summary=(
            "Guest physical memory is currently stored in the VMkernel swap file. "
            "This is host swapping, not guest operating-system paging."
        ),
        recommendation=(
            "Check for a memory limit, host memory pressure and active swap I/O. "
            "A non-zero current swap after pressure has passed can persist; focus on "
            "SWR/s and SWW/s to see whether it is still active."
        ),
        refs=("yellow_bricks", "resource_limits", "vm_performance"),
    ),
    Rule(
        id="mem.host_swapcur",
        metric="SWAP_USED_MB",
        title="Host swap is in use",
        category="memory",
        statistic="p95",
        warn=0.1,
        critical=1024.0,
        scope="host",
        summary="The host has VM memory swapped out to disk.",
        recommendation=(
            "Identify the VMs with SWCUR/SWR/s/SWW/s. Check memory limits and host free "
            "memory. Persistent host swapping is a serious performance risk."
        ),
        refs=("vm_performance", "yellow_bricks"),
    ),
    Rule(
        id="mem.swapin",
        metric="SWR/s",
        title="VM memory is being swapped in",
        category="memory",
        statistic="p95",
        warn=0.01,
        critical=1.0,
        scope="vm",
        summary=(
            "Pages are being read back from swap. Swap-in is synchronous and can appear as "
            "large, intermittent guest latency."
        ),
        recommendation=(
            "Treat active swap-in as a memory-pressure incident. Check the VM memory limit, "
            "host capacity and overcommit, then reduce pressure or move the VM."
        ),
        refs=("yellow_bricks", "vm_performance"),
    ),
    Rule(
        id="mem.swapout",
        metric="SWW/s",
        title="VM memory is being swapped out",
        category="memory",
        statistic="p95",
        warn=0.01,
        critical=1.0,
        scope="vm",
        summary="Pages are being written to the VMkernel swap file.",
        recommendation=(
            "Check host memory pressure and VM limits. Escalate if swapping continues; "
            "the host may need more memory or a lower consolidation ratio."
        ),
        refs=("yellow_bricks", "vm_performance"),
    ),
    Rule(
        id="mem.host_swapin",
        metric="SWAP_READ",
        title="Host memory is being swapped in",
        category="memory",
        statistic="p95",
        warn=0.01,
        critical=1.0,
        scope="host",
        summary="The host is reading swapped pages back from disk.",
        recommendation=(
            "Find the affected VMs and check MCTLSZ, SWCUR and memory limits. "
            "Active host swap-in is a priority-one memory-pressure signal."
        ),
        refs=("vm_performance", "yellow_bricks"),
    ),
    Rule(
        id="mem.host_swapout",
        metric="SWAP_WRITE",
        title="Host memory is being swapped out",
        category="memory",
        statistic="p95",
        warn=0.01,
        critical=1.0,
        scope="host",
        summary="The host is writing pages to swap.",
        recommendation=(
            "Check host free memory and VM limits. Reduce memory pressure before the "
            "swap-in path becomes active."
        ),
        refs=("vm_performance", "yellow_bricks"),
    ),
    Rule(
        id="mem.compression",
        metric="CACHEUSD",
        title="Compressed memory is in use",
        category="memory",
        statistic="p95",
        warn=1.0,
        critical=1024.0,
        scope="vm",
        summary=(
            "The compression cache contains guest pages. Compression is cheaper than "
            "swapping but still indicates that the host is reclaiming memory."
        ),
        recommendation=(
            "Correlate with ballooning and swap. If compression is persistent, review host "
            "memory pressure and VM memory limits."
        ),
        refs=("yellow_bricks", "esxtop_metrics"),
    ),
    Rule(
        id="mem.numa",
        metric="N%L",
        title="NUMA locality is poor",
        category="memory",
        statistic="p05",
        warn=80.0,
        critical=50.0,
        direction="low",
        scope="vm",
        summary=(
            "A large part of VM memory is remote to the NUMA node running its vCPUs. "
            "Remote memory increases latency and reduces throughput."
        ),
        recommendation=(
            "Check VM size versus each NUMA node's memory and vCPU count. Reduce the VM's "
            "vCPU/memory footprint, use NUMA-aware sizing, or let vSphere place it on a "
            "suitable node. Verify NRMEM and NLMEM."
        ),
        refs=("yellow_bricks", "esxtop_metrics"),
    ),
    Rule(
        id="storage.gavg",
        metric="GAVG/cmd",
        title="Guest storage latency is elevated",
        category="storage",
        statistic="p95",
        warn=10.0,
        critical=25.0,
        summary=(
            "The guest is waiting for storage. GAVG = DAVG + KAVG; split the number before "
            "blaming the array."
        ),
        recommendation=(
            "Compare DAVG (device) and KAVG (VMkernel). High DAVG points to the array, SAN, "
            "or path; high KAVG points to VMkernel queueing or the vSCSI path. Check QUED, "
            "ACTV, %USD and LOAD, then review array-side latency and path health."
        ),
        refs=("esxtop_storage", "yellow_bricks"),
    ),
    Rule(
        id="storage.davg",
        metric="DAVG/cmd",
        title="Device storage latency is elevated",
        category="storage",
        statistic="p95",
        warn=10.0,
        critical=25.0,
        summary=(
            "The device driver is seeing slow completions. This usually points at the "
            "storage array, fabric, path, or an undersized backend."
        ),
        recommendation=(
            "Check array and SAN switch latency for the same device, path failover state, "
            "and whether the device is saturated. Compare read/write-specific DAVG."
        ),
        refs=("esxtop_storage", "yellow_bricks"),
    ),
    Rule(
        id="storage.kavg",
        metric="KAVG/cmd",
        title="VMkernel storage latency is elevated",
        category="storage",
        statistic="p95",
        warn=2.0,
        critical=5.0,
        summary=(
            "Commands are spending significant time inside ESXi. High KAVG commonly means "
            "queuing or a queue-depth mismatch rather than a slow array."
        ),
        recommendation=(
            "Check QUED, ACTV, %USD, LOAD and the adapter/device queue depths. If the array "
            "supports deeper queues and is not saturated, verify queue-depth tuning. "
            "Also check for CPU saturation and storage aborts."
        ),
        refs=("esxtop_storage", "yellow_bricks"),
    ),
    Rule(
        id="storage.qavg",
        metric="QAVG/cmd",
        title="Storage queue latency is elevated",
        category="storage",
        statistic="p95",
        warn=5.0,
        critical=10.0,
        summary="Commands are waiting in the storage queue before service.",
        recommendation=(
            "Check outstanding commands (ACTV), queue usage, LOAD and array queue depth. "
            "A burst can be normal; sustained queue latency usually means saturation."
        ),
        refs=("esxtop_storage", "esxtop_metrics"),
    ),
    Rule(
        id="storage.qued",
        metric="QUED",
        title="Storage commands are queueing",
        category="storage",
        statistic="p95",
        warn=1.0,
        critical=10.0,
        summary=(
            "Commands are waiting for a free queue slot. Sustained queuing can be caused by "
            "an overloaded array or by queue-depth limits."
        ),
        recommendation=(
            "Check ACTV, %USD, LOAD and DAVG. Confirm the array and path can handle more "
            "outstanding I/O before raising queue depth. Never tune queue depth without the "
            "array vendor's guidance."
        ),
        refs=("yellow_bricks", "esxtop_metrics"),
    ),
    Rule(
        id="storage.queueused",
        metric="%USD",
        title="Storage queue is close to full",
        category="storage",
        statistic="p95",
        warn=80.0,
        critical=95.0,
        summary="The active-command queue is close to its configured depth.",
        recommendation=(
            "Correlate with QUED and DAVG. If latency is also high, the storage path is "
            "saturated. Check queue-depth settings and array health."
        ),
        refs=("esxtop_metrics", "esxtop_storage"),
    ),
    Rule(
        id="storage.load",
        metric="LOAD",
        title="Storage queue load is above 1",
        category="storage",
        statistic="p95",
        warn=1.0,
        critical=2.0,
        summary=(
            "Active plus queued commands exceed the configured queue depth. This is a direct "
            "indicator of a queue bottleneck."
        ),
        recommendation=(
            "Check QUED and DAVG. Confirm queue depth is appropriate for the array and that "
            "the workload is not overwhelming the device."
        ),
        refs=("esxtop_metrics",),
    ),
    Rule(
        id="storage.aborts",
        metric="ABRTS/s",
        title="Storage commands are aborting",
        category="storage",
        statistic="max",
        warn=0.0001,
        critical=1.0,
        summary=(
            "Guests or the VMkernel are aborting commands. This often follows a storage "
            "timeout and indicates that I/O is not completing in time."
        ),
        recommendation=(
            "Treat this as a storage incident. Check DAVG/KAVG, path state, array health, "
            "vmkernel.log and guest timeout events. If latency is above 5000 ms, ESXi can "
            "time out the command."
        ),
        refs=("yellow_bricks", "esxtop_storage"),
    ),
    Rule(
        id="storage.resets",
        metric="RESETS/s",
        title="Storage command resets are occurring",
        category="storage",
        statistic="max",
        warn=0.0001,
        critical=1.0,
        summary="Commands are being reset, which typically means path or timeout trouble.",
        recommendation=(
            "Check path failover, resets and SCSI sense errors in vmkernel.log. Review array "
            "and fabric health."
        ),
        refs=("yellow_bricks", "esxtop_storage"),
    ),
    Rule(
        id="storage.conflicts",
        metric="CONS/s",
        title="SCSI reservation conflicts are high",
        category="storage",
        statistic="p95",
        warn=20.0,
        critical=50.0,
        summary=(
            "SCSI reservation conflicts can stall VMFS I/O while metadata locks are held."
        ),
        recommendation=(
            "Check for simultaneous metadata operations, cloning, or a workload that is "
            "not suited to a shared VMFS datastore. Review array and VMFS locking behaviour."
        ),
        refs=("yellow_bricks",),
    ),
    Rule(
        id="storage.ats_failed",
        metric="ATSF",
        title="Atomic Test and Set operations are failing",
        category="storage",
        statistic="max",
        warn=0.0001,
        critical=None,
        summary="Failed ATS operations indicate a VAAI/storage-path problem.",
        recommendation=(
            "Check VMFS heartbeat and locking health, array VAAI support, and vmkernel.log. "
            "A non-zero failed-command counter should not be ignored."
        ),
        refs=("yellow_bricks",),
    ),
    Rule(
        id="storage.unmap_failed",
        metric="DELETE_F",
        title="UNMAP operations are failing",
        category="storage",
        statistic="max",
        warn=0.0001,
        critical=None,
        summary="Failed UNMAP/delete operations indicate a storage or VAAI issue.",
        recommendation=(
            "Check whether the array supports UNMAP, whether the datastore is thin-provisioned, "
            "and whether vmkernel.log reports repeated failures."
        ),
        refs=("yellow_bricks",),
    ),
    Rule(
        id="storage.vsan_lat",
        metric="SDLAT",
        title="vSAN latency variation is high",
        category="storage",
        statistic="p95",
        warn=5.0,
        critical=10.0,
        summary=(
            "vSAN standard-deviation latency is elevated, indicating inconsistent I/O service."
        ),
        recommendation=(
            "Use vSAN Observer or Skyline for deeper analysis. Check disk group health, "
            "network latency, congestion and component resync activity."
        ),
        refs=("yellow_bricks",),
    ),
    Rule(
        id="net.drops_tx",
        metric="%DRPTX",
        title="Transmit packet drops are elevated",
        category="network",
        statistic="p95",
        warn=1.0,
        critical=5.0,
        summary=(
            "A material percentage of transmitted packets is being dropped. This can be an "
            "uplink bottleneck, CPU scheduling issue, or physical-network problem."
        ),
        recommendation=(
            "Check physical NIC link speed, errors and teaming, vSwitch/port-group shaping, "
            "and host CPU readiness. Rule out CPU contention before blaming the network."
        ),
        refs=("yellow_bricks", "vm_performance"),
    ),
    Rule(
        id="net.drops_rx",
        metric="%DRPRX",
        title="Receive packet drops are elevated",
        category="network",
        statistic="p95",
        warn=1.0,
        critical=5.0,
        summary=(
            "A material percentage of received packets is being dropped. Investigate the "
            "physical switch, uplink, and host processing capacity."
        ),
        recommendation=(
            "Check the physical switchport for drops/errors, NIC ring buffers, link speed, "
            "and host CPU load. Validate with pktcap-uw if the source is unclear."
        ),
        refs=("yellow_bricks", "vm_performance"),
    ),
)


def _rule_applies(rule: Rule, series: dict[str, Any]) -> bool:
    if series.get("metric") != rule.metric:
        return False
    if series.get("kind") != "numeric":
        return False
    if rule.scope and series.get("scope") != rule.scope:
        return False
    group = str(series.get("group", "")).lower()
    if rule.groups and not any(group.startswith(prefix) for prefix in rule.groups):
        return False
    return True


def _observed(rule: Rule, series: dict[str, Any]) -> float | None:
    stats = series.get("stats", {})
    value = stats.get(rule.statistic)
    if value is None:
        return None
    return float(value)


def _evaluate(rule: Rule, series: dict[str, Any]) -> dict[str, Any] | None:
    if not _rule_applies(rule, series):
        return None
    observed = _observed(rule, series)
    if observed is None:
        return None
    severity = "ok"
    threshold = None
    if rule.direction == "high":
        if rule.critical is not None and observed >= rule.critical:
            severity = "critical"
            threshold = rule.critical
        elif rule.warn is not None and observed >= rule.warn:
            severity = "warning"
            threshold = rule.warn
    else:
        if rule.critical is not None and observed <= rule.critical:
            severity = "critical"
            threshold = rule.critical
        elif rule.warn is not None and observed <= rule.warn:
            severity = "warning"
            threshold = rule.warn

    if severity == "warning" and rule.info:
        severity = "info"

    return {
        "rule": rule,
        "observed": observed,
        "severity": severity,
        "threshold": threshold,
        "statistic": rule.statistic,
    }


def _summary_for(rule: Rule, observed: float, unit: str) -> str:
    label = {
        "p95": "95th percentile",
        "p05": "5th percentile",
        "max": "peak",
        "avg": "average",
        "p50": "median",
    }.get(rule.statistic, rule.statistic)
    if unit == "%":
        value = f"{observed:.1f}%"
    elif unit:
        value = f"{observed:.2f} {unit}"
    else:
        value = f"{observed:.2f}"
    return f"{label}: {value}. {rule.summary}"


def _category_status(findings: list[dict[str, Any]], fallback: str = "neutral") -> str:
    if any(item["severity"] == "critical" for item in findings):
        return "critical"
    if any(item["severity"] == "warning" for item in findings):
        return "warn"
    if any(item["severity"] == "info" for item in findings):
        return "info"
    return fallback


def build_analysis(parsed: dict[str, Any]) -> dict[str, Any]:
    """Attach metric metadata, per-series status, findings and a triage summary."""

    series = parsed["series"]
    metric_meta: dict[str, dict[str, Any]] = {}
    candidates: list[dict[str, Any]] = []
    status_counts = {"ok": 0, "warn": 0, "critical": 0, "neutral": 0, "info": 0}
    evaluated_any = False

    for item in series:
        metric_id = item["metric"]
        if metric_id not in metric_meta:
            definition = metric_definition(metric_id, item["counter"])
            known = bool(definition.get("known"))
            metric_meta[metric_id] = {
                "id": metric_id,
                "name": definition.get("name", item["counter"]),
                "unit": definition.get("unit") or item.get("unit", ""),
                "category": definition.get("category") if known else item.get("category", "other"),
                "description": definition.get("description", ""),
                "thresholdNote": definition.get("threshold_note", ""),
                "known": known,
                "references": expand_refs(definition.get("refs", [])),
            }

        best: dict[str, Any] | None = None
        for rule in RULES:
            evaluation = _evaluate(rule, item)
            if not evaluation:
                continue
            evaluated_any = True
            if best is None or _severity_rank(evaluation["severity"]) > _severity_rank(best["severity"]):
                best = evaluation
            if evaluation["severity"] in {"warning", "critical", "info"}:
                candidates.append({"series": item, **evaluation})

        if best:
            item["status"] = "ok" if best["severity"] == "ok" else ("warn" if best["severity"] == "warning" else ("info" if best["severity"] == "info" else "critical"))
            item["ruleId"] = best["rule"].id
            item["observed"] = round(best["observed"], 4)
            item["threshold"] = best["threshold"]
            item["warnThreshold"] = best["rule"].warn
            item["criticalThreshold"] = best["rule"].critical
            item["statistic"] = best["statistic"]
            item["statusText"] = (
                f"{best['rule'].statistic.upper()} {best['observed']:.2f} "
                f"{item.get('unit', '')}".strip()
                if best["severity"] != "ok"
                else "Within guardrail"
            )
            item["statusSummary"] = f"{best['rule'].title}. {best['rule'].summary}"
        else:
            item["status"] = "neutral"
            item["ruleId"] = ""
            item["observed"] = None
            item["threshold"] = None
            item["warnThreshold"] = None
            item["criticalThreshold"] = None
            item["statistic"] = ""
            item["statusText"] = "No automatic threshold"
            item["statusSummary"] = "This counter has no curated threshold rule. Review it in context."

        status_counts[item["status"]] += 1
        # Keep the payload compact; metadata is deduplicated in ``metrics``.
        item.pop("description", None)
        item.pop("thresholdNote", None)

    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for candidate in candidates:
        item = candidate["series"]
        rule = candidate["rule"]
        # Alternative counters can describe the same condition (for example
        # PCPU %, % Util Time and % Core Util Time). Group by the finding name,
        # entity and category rather than by individual metric to avoid noise.
        key = (rule.title, item.get("host", ""), item.get("entity", ""), item.get("category", rule.category))
        finding = grouped.get(key)
        if finding is None:
            finding = {
                "id": f"f{len(grouped) + 1}",
                "ruleId": rule.id,
                "severity": "warning" if candidate["severity"] == "warning" else candidate["severity"],
                "category": rule.category,
                "title": rule.title,
                "summary": rule.summary,
                "recommendation": rule.recommendation,
                "scope": item.get("scope", ""),
                "host": item.get("host", ""),
                "entity": item.get("entity", ""),
                "entityKind": item.get("entityKind", ""),
                "metric": rule.metric,
                "metricName": metric_meta.get(rule.metric, {}).get("name", rule.metric),
                "unit": item.get("unit", ""),
                "statistic": rule.statistic,
                "observed": candidate["observed"],
                "threshold": candidate["threshold"],
                "samples": item.get("stats", {}).get("count", 0),
                "seriesIds": [],
                "instances": [],
                "worstSeries": item["id"],
                "references": expand_refs(list(rule.refs)),
            }
            grouped[key] = finding
        # Severity precedence.
        if _severity_rank(candidate["severity"]) > _severity_rank(finding["severity"]):
            finding["severity"] = "warning" if candidate["severity"] == "warning" else candidate["severity"]
            finding["ruleId"] = rule.id
            finding["metric"] = rule.metric
            finding["metricName"] = metric_meta.get(rule.metric, {}).get("name", rule.metric)
            finding["unit"] = item.get("unit", "")
            finding["observed"] = candidate["observed"]
            finding["threshold"] = candidate["threshold"]
            finding["statistic"] = rule.statistic
            finding["recommendation"] = rule.recommendation
            finding["references"] = expand_refs(list(rule.refs))
            finding["worstSeries"] = item["id"]
        if item["id"] not in finding["seriesIds"]:
            finding["seriesIds"].append(item["id"])
        instance = item.get("instance") or item.get("entity")
        if instance and instance not in finding["instances"]:
            finding["instances"].append(instance)
        finding["samples"] = max(finding.get("samples", 0), item.get("stats", {}).get("count", 0))

    findings = list(grouped.values())
    for finding in findings:
        finding["summary"] = _summary_for(
            next(rule for rule in RULES if rule.id == finding["ruleId"]),
            float(finding["observed"]),
            finding.get("unit", ""),
        )
        finding["instances"] = finding["instances"][:8]
        finding["seriesIds"] = finding["seriesIds"][:40]
        finding["affectedSeries"] = len(finding["seriesIds"])

    order = {"critical": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda item: (order.get(item["severity"], 3), item["category"], item["title"]))
    for index, finding in enumerate(findings, start=1):
        finding["id"] = f"f{index}"

    critical = sum(1 for item in findings if item["severity"] == "critical")
    warnings = sum(1 for item in findings if item["severity"] == "warning")
    info = sum(1 for item in findings if item["severity"] == "info")
    if critical:
        status = "critical"
    elif warnings:
        status = "warn"
    elif evaluated_any:
        status = "ok"
    else:
        status = "neutral"

    # A deliberately simple "signals within guardrail" score. It answers one
    # narrow question: of the counters that have a curated rule, how many are
    # currently inside their guardrail? It is not a capacity-planning metric.
    evaluated = status_counts["ok"] + status_counts["warn"] + status_counts["critical"]
    score = round(100 * status_counts["ok"] / evaluated) if evaluated else None
    if critical:
        headline = f"{critical} critical finding{'s' if critical != 1 else ''} need attention."
    elif warnings:
        headline = f"{warnings} warning{'s' if warnings != 1 else ''} need review."
    elif info:
        headline = "No threshold breach; informational signals are available."
    elif status == "ok":
        headline = "No threshold breaches in the curated rule set."
    else:
        headline = "Capture loaded; no curated rules matched these counters."

    categories = ("cpu", "memory", "storage", "network", "power", "interrupt", "other")
    category_summary: dict[str, dict[str, Any]] = {}
    for category in categories:
        category_findings = [item for item in findings if item["category"] == category]
        category_series = [item for item in series if item["category"] == category]
        category_summary[category] = {
            "status": _category_status(category_findings),
            "present": bool(category_series),
            "findings": len(category_findings),
            "critical": sum(1 for item in category_findings if item["severity"] == "critical"),
            "warning": sum(1 for item in category_findings if item["severity"] == "warning"),
            "info": sum(1 for item in category_findings if item["severity"] == "info"),
            "series": len(category_series),
            "ok": sum(1 for item in category_series if item["status"] == "ok"),
            "warn": sum(1 for item in category_series if item["status"] == "warn"),
            "criticalSeries": sum(1 for item in category_series if item["status"] == "critical"),
        }

    observations = [
        {
            "id": "method",
            "severity": "info",
            "title": "How these findings are produced",
            "text": (
                "Rules use sustained percentiles (mostly p95) rather than a single maximum, "
                "except for hard error counters. Thresholds are triage guardrails that combine "
                "Broadcom guidance with Yellow Bricks field thresholds; they are not vSphere "
                "alarms and do not replace a full performance review."
            ),
        },
        {
            "id": "scope",
            "severity": "info",
            "title": "Missing metrics mean missing evidence",
            "text": (
                "A capture only proves what it contains. If a counter or panel was excluded "
                "from the esxtop command, this analysis cannot evaluate it. Use -a for a "
                "broad first look, then capture focused fields when a problem is suspected."
            ),
        },
    ]

    # A low-cost capture-quality observation helps explain empty results.
    if not any(item["scope"] == "vm" and item["category"] == "cpu" for item in series):
        observations.append(
            {
                "id": "no-vm-cpu",
                "severity": "info",
                "title": "No per-VM CPU metrics found",
                "text": (
                    "The capture does not appear to contain Group Cpu or Vcpu counters. "
                    "If VM CPU troubleshooting is required, capture with the CPU panel "
                    "expanded or use -a."
                ),
            }
        )

    panel_labels = {
        "cpu": "CPU",
        "memory": "memory",
        "storage": "storage",
        "network": "network",
        "power": "power",
        "interrupt": "interrupt",
    }
    missing_panels = [
        label for category, label in panel_labels.items()
        if not any(item["category"] == category for item in series)
    ]
    if missing_panels:
        observations.append(
            {
                "id": "missing-panels",
                "severity": "info",
                "title": "Some panels were not captured",
                "text": (
                    "No " + ", ".join(missing_panels) + " counters are present in this capture. "
                    "ESXtop Lens only renders counters that exist in the uploaded file; it does not "
                    "invent rows or columns for fields that were disabled or excluded. Use -a or "
                    "enable the relevant panel fields before the capture if that evidence is needed."
                ),
            }
        )

    vsan = next((item for item in series if item["metric"] == "VSAN_ENABLED"), None)
    if vsan is not None:
        vsan_last = vsan.get("stats", {}).get("last")
        if vsan_last in (0, 0.0):
            observations.append(
                {
                    "id": "vsan-not-enabled",
                    "severity": "info",
                    "title": "vSAN statistics are not present",
                    "text": (
                        "The capture reports vSAN as disabled (VSAN\\Enabled? = 0). "
                        "vSAN-specific counters are emitted only when vSAN is enabled on the host. "
                        "This is expected and is not a parser or capture defect."
                    ),
                }
            )

    parsed["series"] = series
    parsed["findings"] = findings
    parsed["metrics"] = metric_meta
    parsed["references"] = REFERENCES
    parsed["observations"] = observations
    parsed["summary"] = {
        "status": status,
        "score": score,
        "scoreBasis": "Percentage of rule-evaluated series currently inside their guardrail",
        "headline": headline,
        "critical": critical,
        "warning": warnings,
        "info": info,
        "counts": status_counts,
        "categories": category_summary,
        "metricCount": len(series),
        "ruleCount": len(RULES),
        "evaluated": evaluated_any,
    }
    parsed["catalog"] = public_catalog()
    return parsed


def _severity_rank(severity: str) -> int:
    return {
        "critical": 4,
        "warning": 3,
        "info": 2,
        "ok": 1,
        "neutral": 0,
    }.get(severity, 0)

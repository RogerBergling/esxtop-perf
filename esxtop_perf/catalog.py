"""Metric catalogue and group classification for esxtop batch captures.

esxtop emits PDH-style counter paths:

    \\\\host\\Group(instance)\\Counter

The counter names differ between releases. Older captures use short names such
as ``%RDY``; newer captures use human-readable names such as ``% Ready``. This
module normalises both forms into stable metric IDs so the UI and the rule
engine do not need per-version special cases.
"""

from __future__ import annotations

import re
from typing import Any

APP_VERSION = "1.3.1"
PARSER_VERSION = "1.3.0"

REFERENCES: dict[str, dict[str, str]] = {
    "esxtop_metrics": {
        "title": "Using ESXTop and Interpreting ESXTop Statistics (Broadcom 382249)",
        "url": "https://knowledge.broadcom.com/external/article/382249/using-esxtop-and-interpreting-esxtop-sta.html",
    },
    "esxtop_storage": {
        "title": "Using esxtop to identify storage performance issues for ESXi (Broadcom 344099)",
        "url": "https://knowledge.broadcom.com/external/article/344099",
    },
    "vm_performance": {
        "title": "Troubleshooting ESX/ESXi virtual machine performance issues (Broadcom 304594)",
        "url": "https://knowledge.broadcom.com/external/article?legacyId=2001003",
    },
    "resource_limits": {
        "title": "Impact of virtual machine memory and CPU resource limits (Broadcom 326270)",
        "url": "https://knowledge.broadcom.com/external/article/326270/impact-of-virtual-machine-memory-and-cpu.html",
    },
    "capture_batch": {
        "title": "Collecting esxtop batch data for ESXi performance troubleshooting (Broadcom 370279)",
        "url": "https://knowledge.broadcom.com/external/article/370279/collecting-esxtop-batch-data-for-esxi-pe.html",
    },
    "export_csv": {
        "title": "Exporting esxtop performance data as a CSV file (Broadcom 326309)",
        "url": "https://knowledge.broadcom.com/external/article/326309/exporting-esxtop-performance-data-as-a-c.html",
    },
    "batch_mode": {
        "title": "vSphere 8.0 — Using Batch Mode",
        "url": "https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance/performance-monitoring-utilities-resxtop-and-esxtop/using-batch-mode.html",
    },
    "esxtop_command": {
        "title": "vSphere 8.0 — Using the esxtop Utility",
        "url": "https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance/performance-monitoring-utilities-resxtop-and-esxtop/using-the-esxtop-utility.html",
    },
    "yellow_bricks": {
        "title": "ESXTOP metric thresholds — Yellow Bricks (Duncan Epping)",
        "url": "https://www.yellow-bricks.com/esxtop/",
    },
    "vsphere_perf": {
        "title": "vSphere Monitoring and Performance",
        "url": "https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance.html",
    },
}

# Reference keys are expanded to objects in the API response.
METRIC_DEFS: dict[str, dict[str, Any]] = {
    # ------------------------------------------------------------------ CPU
    "%USED": {
        "name": "CPU used",
        "unit": "%",
        "category": "cpu",
        "description": "Physical CPU core cycles accounted to the world or group. %USED = %RUN + %SYS - %OVRLP and can exceed 100% for a multi-vCPU group.",
        "threshold_note": "No fixed upper limit: compare with host capacity and with %RDY. A single VM at 100% is not a bottleneck by itself.",
        "refs": ["esxtop_metrics", "yellow_bricks"],
    },
    "%RUN": {
        "name": "CPU run time",
        "unit": "%",
        "category": "cpu",
        "description": "Share of scheduled CPU time for the world. On hyper-threaded hosts it can be about twice %USED because it does not discount system time.",
        "refs": ["esxtop_metrics"],
    },
    "%SYS": {
        "name": "System time",
        "unit": "%",
        "category": "cpu",
        "description": "Time the VMkernel spent on behalf of the world for interrupts and system work. Persistently high %SYS often follows high I/O activity.",
        "refs": ["esxtop_metrics"],
    },
    "%WAIT": {
        "name": "Wait time",
        "unit": "%",
        "category": "cpu",
        "description": "Time the world was blocked or busy-waiting. It includes idle and swap-wait time, so a high value is not automatically a problem.",
        "refs": ["esxtop_metrics"],
    },
    "%VMWAIT": {
        "name": "VM wait time",
        "unit": "%",
        "category": "cpu",
        "description": "Time vCPUs spent blocked waiting for events, excluding idle and swap wait. A high value usually points to the guest workload waiting on I/O or a lock.",
        "refs": ["esxtop_metrics"],
    },
    "%RDY": {
        "name": "CPU ready",
        "unit": "%",
        "category": "cpu",
        "description": "Time the world was ready to run but waiting for a physical CPU. If %MLMTD is also non-zero, part of the wait is caused by an administrative CPU limit, not host contention.",
        "threshold_note": "Broadcom describes <5% as normal; Yellow Bricks uses 10% per world as a contention warning. Read per vCPU, not only at VM group level.",
        "refs": ["vm_performance", "yellow_bricks", "esxtop_metrics"],
    },
    "%IDLE": {
        "name": "vCPU idle time",
        "unit": "%",
        "category": "cpu",
        "description": "Time a vCPU world was in the guest idle loop. It is included in %WAIT and only meaningful for vCPU worlds.",
        "refs": ["esxtop_metrics"],
    },
    "%OVRLP": {
        "name": "CPU overlap",
        "unit": "%",
        "category": "cpu",
        "description": "System time spent servicing another world while this world was running. It is already included in the other world's %SYS.",
        "refs": ["esxtop_metrics"],
    },
    "%CSTP": {
        "name": "CPU co-stop",
        "unit": "%",
        "category": "cpu",
        "description": "Ready time caused by co-scheduling constraints in an SMP VM. A vCPU can be held back because its sibling vCPUs are not progressing together.",
        "threshold_note": "Yellow Bricks flags sustained values above 3%. Consider fewer vCPUs or a more balanced guest workload.",
        "refs": ["yellow_bricks", "esxtop_metrics"],
    },
    "%MLMTD": {
        "name": "CPU limit throttling",
        "unit": "%",
        "category": "cpu",
        "description": "Time the world was ready but deliberately not scheduled because of a CPU limit. The value is part of %RDY.",
        "threshold_note": "Any sustained value above 0 means a VM or resource-pool CPU limit is throttling the workload.",
        "refs": ["resource_limits", "yellow_bricks"],
    },
    "%SWPWT": {
        "name": "Swap wait",
        "unit": "%",
        "category": "memory",
        "description": "Time the world waited for the VMkernel to swap memory pages in. It is included in %WAIT and signals host memory pressure or a memory limit.",
        "threshold_note": "Yellow Bricks flags above 5%; any sustained swap wait deserves investigation.",
        "refs": ["yellow_bricks", "resource_limits"],
    },
    "%LAT_C": {
        "name": "CPU latency",
        "unit": "%",
        "category": "cpu",
        "description": "Time the world was ready but not scheduled because of CPU resource contention.",
        "refs": ["esxtop_metrics"],
    },
    "%LAT_M": {
        "name": "Memory latency",
        "unit": "%",
        "category": "cpu",
        "description": "Time the world was ready but not scheduled because of memory resource contention.",
        "refs": ["esxtop_metrics"],
    },
    "%DMD": {
        "name": "CPU demand",
        "unit": "%",
        "category": "cpu",
        "description": "Average active CPU demand over the last minute.",
        "refs": ["esxtop_metrics"],
    },
    "PCPU %": {
        "name": "Physical CPU utilisation",
        "unit": "%",
        "category": "cpu",
        "description": "Percentage of processor time consumed on the physical CPU (core or logical processor depending on release). Sustained host-wide saturation limits every VM on the host.",
        "threshold_note": "This tool starts warning at 80% and marks critical at 90%; these are operational guardrails, not vSphere alarms.",
        "refs": ["esxtop_metrics", "yellow_bricks"],
    },
    "PCPU_UTIL": {
        "name": "Physical CPU utilisation",
        "unit": "%",
        "category": "cpu",
        "description": "Alternative vSphere counter for physical CPU utilisation. The exact accounting depends on hyper-threading and release.",
        "threshold_note": "Warning starts at 80%, critical at 90%.",
        "refs": ["esxtop_metrics"],
    },
    "CORE_UTIL": {
        "name": "Physical core utilisation",
        "unit": "%",
        "category": "cpu",
        "description": "Core-level utilisation. Useful for spotting a saturated core even when a socket-level total looks healthy.",
        "threshold_note": "Warning starts at 80%, critical at 90%.",
        "refs": ["esxtop_metrics"],
    },
    "LOAD1": {
        "name": "CPU load average (1 minute)",
        "unit": "",
        "category": "cpu",
        "description": "Run-queue load average based on 6-second samples. A value near 1.0 means the physical CPUs are fully utilised; 2.0 means the host is heavily overcommitted.",
        "threshold_note": "Broadcom's VM performance article describes 1.00 as fully utilised and 2.00 as overloaded.",
        "refs": ["vm_performance"],
    },
    "LOAD5": {
        "name": "CPU load average (5 minutes)",
        "unit": "",
        "category": "cpu",
        "description": "Five-minute EWMA of CPU load. Use it to distinguish a spike from a sustained condition.",
        "refs": ["vm_performance"],
    },
    "LOAD15": {
        "name": "CPU load average (15 minutes)",
        "unit": "",
        "category": "cpu",
        "description": "Fifteen-minute EWMA of CPU load. Use it as the baseline view of host pressure.",
        "refs": ["vm_performance"],
    },
    "SWITCHES": {
        "name": "World switches",
        "unit": "/s",
        "category": "cpu",
        "description": "Context switches between worlds per second.",
        "refs": ["esxtop_metrics"],
    },
    "MIGRATES": {
        "name": "Scheduler migrations",
        "unit": "/s",
        "category": "cpu",
        "description": "World migrations between physical CPUs per second, used by the scheduler for load balancing.",
        "refs": ["esxtop_metrics"],
    },
    "QUANTUM": {
        "name": "Quantum expirations",
        "unit": "/s",
        "category": "cpu",
        "description": "Times the scheduler time quantum expired before the world blocked.",
        "refs": ["esxtop_metrics"],
    },
    "WAKEUPS": {
        "name": "World wakeups",
        "unit": "/s",
        "category": "cpu",
        "description": "Transitions from wait to ready per second.",
        "refs": ["esxtop_metrics"],
    },
    # --------------------------------------------------------------- Memory
    "OVERCOMMIT1": {
        "name": "Memory overcommit (1 minute)",
        "unit": "",
        "category": "memory",
        "description": "Ratio of requested memory to managed memory, minus 1. A value of 0.5 means the VMs request 50% more memory than the host manages.",
        "threshold_note": "Overcommit is a planning signal, not proof of a bottleneck. Confirm with MCTLSZ, SWCUR, SWR/s and guest performance.",
        "refs": ["vm_performance", "esxtop_metrics"],
    },
    "OVERCOMMIT5": {
        "name": "Memory overcommit (5 minutes)",
        "unit": "",
        "category": "memory",
        "description": "Five-minute EWMA of the memory overcommit ratio.",
        "refs": ["vm_performance"],
    },
    "OVERCOMMIT15": {
        "name": "Memory overcommit (15 minutes)",
        "unit": "",
        "category": "memory",
        "description": "Fifteen-minute EWMA of the memory overcommit ratio.",
        "refs": ["vm_performance"],
    },
    "MACHINE_MB": {
        "name": "Machine memory",
        "unit": "MB",
        "category": "memory",
        "description": "Physical machine memory managed by the host.",
        "refs": ["esxtop_metrics"],
    },
    "KERNEL_MB": {
        "name": "Kernel memory",
        "unit": "MB",
        "category": "memory",
        "description": "Memory used by the VMkernel.",
        "refs": ["esxtop_metrics"],
    },
    "NONKERNEL_MB": {
        "name": "Non-kernel memory",
        "unit": "MB",
        "category": "memory",
        "description": "Machine memory not currently attributed to the VMkernel.",
        "refs": ["esxtop_metrics"],
    },
    "FREE_MB": {
        "name": "Free machine memory",
        "unit": "MB",
        "category": "memory",
        "description": "Free physical memory as seen by the host. A low absolute number is not automatically a problem until reclaim activity appears.",
        "refs": ["esxtop_metrics"],
    },
    "KERNEL_MANAGED_MB": {
        "name": "Kernel managed memory",
        "unit": "MB",
        "category": "memory",
        "description": "Memory currently under VMkernel management.",
        "refs": ["esxtop_metrics"],
    },
    "KERNEL_MINFREE_MB": {
        "name": "Kernel minimum free",
        "unit": "MB",
        "category": "memory",
        "description": "The VMkernel's free-memory floor. When free memory approaches this value, reclaim mechanisms become more active.",
        "refs": ["esxtop_metrics"],
    },
    "KERNEL_RESERVED_MB": {
        "name": "Kernel reserved memory",
        "unit": "MB",
        "category": "memory",
        "description": "Memory reserved by the VMkernel.",
        "refs": ["esxtop_metrics"],
    },
    "KERNEL_UNRESERVED_MB": {
        "name": "Kernel unreserved memory",
        "unit": "MB",
        "category": "memory",
        "description": "Memory available to the VMkernel outside its reservation.",
        "refs": ["esxtop_metrics"],
    },
    "NUMA_TOTAL_MB": {
        "name": "NUMA node memory",
        "unit": "MB",
        "category": "memory",
        "description": "Machine memory managed by a NUMA node.",
        "refs": ["esxtop_metrics"],
    },
    "NUMA_FREE_MB": {
        "name": "NUMA node free memory",
        "unit": "MB",
        "category": "memory",
        "description": "Free memory on a NUMA node. Uneven free memory can affect placement decisions.",
        "refs": ["esxtop_metrics"],
    },
    "PSHARE_SHARED_MB": {
        "name": "Page-shared memory",
        "unit": "MB",
        "category": "memory",
        "description": "Guest physical memory backed by shared machine pages.",
        "refs": ["esxtop_metrics"],
    },
    "PSHARE_SAVED_MB": {
        "name": "Memory saved by page sharing",
        "unit": "MB",
        "category": "memory",
        "description": "Estimated machine memory saved by transparent page sharing.",
        "refs": ["esxtop_metrics"],
    },
    "SWAP_USED_MB": {
        "name": "Host swap used",
        "unit": "MB",
        "category": "memory",
        "description": "Current VMkernel swap usage across the host.",
        "threshold_note": "Any persistent swap usage is a memory-pressure signal. Investigate limits, reservation and host sizing.",
        "refs": ["vm_performance", "yellow_bricks"],
    },
    "SWAP_TARGET_MB": {
        "name": "Host swap target",
        "unit": "MB",
        "category": "memory",
        "description": "Target swap usage computed by the VMkernel memory scheduler.",
        "refs": ["esxtop_metrics"],
    },
    "SWAP_READ": {
        "name": "Host swap read rate",
        "unit": "MB/s",
        "category": "memory",
        "description": "Rate at which the VMkernel is reading swapped pages back from disk.",
        "threshold_note": "Any sustained swap-in activity is more serious than a one-off spike.",
        "refs": ["yellow_bricks", "esxtop_metrics"],
    },
    "SWAP_WRITE": {
        "name": "Host swap write rate",
        "unit": "MB/s",
        "category": "memory",
        "description": "Rate at which the VMkernel is writing pages to swap.",
        "threshold_note": "Any sustained swap-out activity indicates host memory pressure.",
        "refs": ["yellow_bricks", "esxtop_metrics"],
    },
    "COMPRESSED_MB": {
        "name": "Compressed memory",
        "unit": "MB",
        "category": "memory",
        "description": "Total memory currently held in the compression cache.",
        "refs": ["esxtop_metrics"],
    },
    "COMPRESSION_SAVED_MB": {
        "name": "Memory saved by compression",
        "unit": "MB",
        "category": "memory",
        "description": "Machine memory saved by compressing guest pages.",
        "refs": ["esxtop_metrics"],
    },
    "MEMCTL_CURRENT_MB": {
        "name": "Balloon current",
        "unit": "MB",
        "category": "memory",
        "description": "Memory currently reclaimed by the balloon driver across the host.",
        "refs": ["vm_performance"],
    },
    "MEMCTL_TARGET_MB": {
        "name": "Balloon target",
        "unit": "MB",
        "category": "memory",
        "description": "Memory the VMkernel is trying to reclaim through ballooning.",
        "refs": ["esxtop_metrics"],
    },
    "MEMCTL_MAX_MB": {
        "name": "Balloon maximum",
        "unit": "MB",
        "category": "memory",
        "description": "Maximum memory the balloon driver may reclaim.",
        "refs": ["esxtop_metrics"],
    },
    "MEMSZ": {
        "name": "Configured VM memory",
        "unit": "MB",
        "category": "memory",
        "description": "Guest physical memory configured for the VM.",
        "refs": ["esxtop_metrics"],
    },
    "GRANT": {
        "name": "Granted memory",
        "unit": "MB",
        "category": "memory",
        "description": "Guest physical memory currently mapped to machine memory. Overhead is excluded.",
        "refs": ["esxtop_metrics"],
    },
    "CNSM": {
        "name": "Consumed memory",
        "unit": "MB",
        "category": "memory",
        "description": "Estimated memory consumed by the VM, net of page sharing and compression savings.",
        "refs": ["esxtop_metrics"],
    },
    "SZTGT": {
        "name": "Memory target",
        "unit": "MB",
        "category": "memory",
        "description": "Target memory size computed by the memory scheduler, including VM overhead.",
        "refs": ["esxtop_metrics"],
    },
    "TCHD": {
        "name": "Touched memory",
        "unit": "MB",
        "category": "memory",
        "description": "Working-set estimate based on recently touched guest pages. Ballooned pages are excluded.",
        "refs": ["esxtop_metrics"],
    },
    "%ACTV": {
        "name": "Active memory",
        "unit": "%",
        "category": "memory",
        "description": "Percentage of guest physical memory recently active.",
        "refs": ["esxtop_metrics"],
    },
    "MCTL?": {
        "name": "Balloon driver present",
        "unit": "",
        "category": "memory",
        "description": "Whether the VMware Tools balloon driver is available in the guest.",
        "refs": ["esxtop_metrics"],
    },
    "MCTLSZ": {
        "name": "Ballooned memory",
        "unit": "MB",
        "category": "memory",
        "description": "Guest physical memory reclaimed by the balloon driver. A large value means the host is applying memory pressure or a limit is configured.",
        "threshold_note": "Yellow Bricks flags values above 1 MB. Correlate with host free memory, swap and the VM's memory limit.",
        "refs": ["yellow_bricks", "resource_limits", "vm_performance"],
    },
    "MCTLTGT": {
        "name": "Balloon target",
        "unit": "MB",
        "category": "memory",
        "description": "Memory the balloon driver is being asked to reclaim.",
        "refs": ["esxtop_metrics"],
    },
    "MCTLMAX": {
        "name": "Balloon maximum",
        "unit": "MB",
        "category": "memory",
        "description": "Maximum memory reclaimable by the balloon driver for this VM.",
        "refs": ["esxtop_metrics"],
    },
    "SWCUR": {
        "name": "VM swapped memory",
        "unit": "MB",
        "category": "memory",
        "description": "Guest physical memory currently swapped by the VMkernel. This is VMkernel swap, not swapping inside the guest OS.",
        "threshold_note": "Yellow Bricks uses 1 MB as the threshold. Persistent swap means host memory pressure or an incorrect memory limit.",
        "refs": ["yellow_bricks", "resource_limits", "vm_performance"],
    },
    "SWTGT": {
        "name": "VM swap target",
        "unit": "MB",
        "category": "memory",
        "description": "Swap target computed by the VMkernel memory scheduler.",
        "refs": ["esxtop_metrics"],
    },
    "SWR/s": {
        "name": "VM swap read rate",
        "unit": "MB/s",
        "category": "memory",
        "description": "Rate at which swapped VM pages are read back from disk. Swap-in is synchronous and usually visible as latency in the guest.",
        "threshold_note": "Any sustained swap-in should be treated as significant.",
        "refs": ["yellow_bricks", "vm_performance"],
    },
    "SWW/s": {
        "name": "VM swap write rate",
        "unit": "MB/s",
        "category": "memory",
        "description": "Rate at which VM pages are written to swap.",
        "threshold_note": "Any sustained swap-out indicates host memory pressure.",
        "refs": ["yellow_bricks", "esxtop_metrics"],
    },
    "LLSWR/s": {
        "name": "Host-cache swap read",
        "unit": "MB/s",
        "category": "memory",
        "description": "Rate at which swapped pages are read from the host cache (for example a local SSD).",
        "refs": ["esxtop_metrics"],
    },
    "LLSWW/s": {
        "name": "Host-cache swap write",
        "unit": "MB/s",
        "category": "memory",
        "description": "Rate at which pages are written to the host cache.",
        "refs": ["esxtop_metrics"],
    },
    "N%L": {
        "name": "NUMA local memory",
        "unit": "%",
        "category": "memory",
        "description": "Percentage of VM memory that is local to the NUMA node(s) where its vCPUs run.",
        "threshold_note": "Yellow Bricks flags values below 80% as poor locality; below 50% is a strong warning sign.",
        "refs": ["yellow_bricks", "esxtop_metrics"],
    },
    "NRMEM": {
        "name": "NUMA remote memory",
        "unit": "MB",
        "category": "memory",
        "description": "VM memory allocated from a remote NUMA node.",
        "refs": ["esxtop_metrics"],
    },
    "NLMEM": {
        "name": "NUMA local memory",
        "unit": "MB",
        "category": "memory",
        "description": "VM memory allocated from a local NUMA node.",
        "refs": ["esxtop_metrics"],
    },
    "SHRD": {
        "name": "Shared memory",
        "unit": "MB",
        "category": "memory",
        "description": "Guest physical memory currently shared with other guests through transparent page sharing.",
        "refs": ["esxtop_metrics"],
    },
    "SHRDSVD": {
        "name": "Memory saved by sharing",
        "unit": "MB",
        "category": "memory",
        "description": "Estimated machine memory saved by page sharing.",
        "refs": ["esxtop_metrics"],
    },
    "CACHESZ": {
        "name": "Compression cache size",
        "unit": "MB",
        "category": "memory",
        "description": "Current size of the VM compression cache.",
        "refs": ["esxtop_metrics"],
    },
    "CACHEUSD": {
        "name": "Compression cache used",
        "unit": "MB",
        "category": "memory",
        "description": "Used compression-cache memory. Non-zero values mean the host is compressing guest pages.",
        "threshold_note": "Yellow Bricks treats values above 0 as a memory-pressure signal.",
        "refs": ["yellow_bricks"],
    },
    "ZIP/s": {
        "name": "Compression rate",
        "unit": "MB/s",
        "category": "memory",
        "description": "Rate at which guest pages are being compressed.",
        "refs": ["yellow_bricks"],
    },
    "UNZIP/s": {
        "name": "Decompression rate",
        "unit": "MB/s",
        "category": "memory",
        "description": "Rate at which compressed pages are being decompressed for access.",
        "refs": ["yellow_bricks"],
    },
    # -------------------------------------------------------------- Storage
    "CMDS/s": {
        "name": "Storage commands",
        "unit": "/s",
        "category": "storage",
        "description": "SCSI commands per second, including I/O and metadata operations. Usually close to IOPS but can be higher during reservations and metadata work.",
        "refs": ["esxtop_storage", "esxtop_metrics"],
    },
    "READS/s": {
        "name": "Storage reads",
        "unit": "/s",
        "category": "storage",
        "description": "Read commands per second at this layer of the storage stack.",
        "refs": ["esxtop_storage"],
    },
    "WRITES/s": {
        "name": "Storage writes",
        "unit": "/s",
        "category": "storage",
        "description": "Write commands per second at this layer of the storage stack.",
        "refs": ["esxtop_storage"],
    },
    "MBREAD/s": {
        "name": "Storage read throughput",
        "unit": "MB/s",
        "category": "storage",
        "description": "Megabytes read per second.",
        "refs": ["esxtop_metrics"],
    },
    "MBWRTN/s": {
        "name": "Storage write throughput",
        "unit": "MB/s",
        "category": "storage",
        "description": "Megabytes written per second.",
        "refs": ["esxtop_metrics"],
    },
    "DAVG/cmd": {
        "name": "Device latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average time per command at the device-driver layer, including the round trip to the storage array. DAVG points at the backend storage when elevated.",
        "threshold_note": "Broadcom says DAVG, KAVG and GAVG should not stay above 10 ms; Yellow Bricks uses 25 ms as a strong warning. This tool warns at 10 ms and marks 25 ms critical.",
        "refs": ["esxtop_storage", "yellow_bricks"],
    },
    "KAVG/cmd": {
        "name": "VMkernel latency",
        "unit": "ms",
        "category": "storage",
        "description": "Time a command spends inside the ESXi VMkernel. It should normally be small relative to DAVG. High KAVG usually means queuing in the VMkernel or vSCSI path.",
        "threshold_note": "Yellow Bricks flags above 2 ms. This tool warns at 2 ms and marks 5 ms critical.",
        "refs": ["esxtop_storage", "yellow_bricks"],
    },
    "GAVG/cmd": {
        "name": "Guest latency",
        "unit": "ms",
        "category": "storage",
        "description": "Latency perceived by the guest. GAVG = DAVG + KAVG. Use DAVG and KAVG to locate the slow layer.",
        "threshold_note": "Broadcom says do not sustain above 10 ms; Yellow Bricks uses 25 ms. This tool warns at 10 ms and marks 25 ms critical.",
        "refs": ["esxtop_storage", "yellow_bricks"],
    },
    "QAVG/cmd": {
        "name": "Queue latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average time a command spent waiting in the storage queue. QAVG is part of KAVG and is useful when latency rises with command rate.",
        "threshold_note": "This tool warns at 5 ms; queue latency is highly array-dependent.",
        "refs": ["esxtop_metrics", "esxtop_storage"],
    },
    "DAVG/rd": {
        "name": "Device read latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average device latency for reads. Compare with writes because read and write cache behaviour differs.",
        "refs": ["esxtop_storage"],
    },
    "DAVG/wr": {
        "name": "Device write latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average device latency for writes.",
        "refs": ["esxtop_storage"],
    },
    "KAVG/rd": {
        "name": "VMkernel read latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average VMkernel time for read commands.",
        "refs": ["esxtop_storage"],
    },
    "KAVG/wr": {
        "name": "VMkernel write latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average VMkernel time for write commands.",
        "refs": ["esxtop_storage"],
    },
    "GAVG/rd": {
        "name": "Guest read latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average guest-observed latency for reads.",
        "refs": ["esxtop_storage"],
    },
    "GAVG/wr": {
        "name": "Guest write latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average guest-observed latency for writes.",
        "refs": ["esxtop_storage"],
    },
    "LAT/rd": {
        "name": "Read latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average latency per read at the virtual-machine disk layer.",
        "refs": ["esxtop_storage"],
    },
    "LAT/wr": {
        "name": "Write latency",
        "unit": "ms",
        "category": "storage",
        "description": "Average latency per write at the virtual-machine disk layer.",
        "refs": ["esxtop_storage"],
    },
    "QUED": {
        "name": "Queued commands",
        "unit": "",
        "category": "storage",
        "description": "Commands waiting for an open queue slot in the VMkernel. A sustained value above 1 can indicate an overloaded array or a queue-depth mismatch.",
        "threshold_note": "Yellow Bricks flags above 1. Check ACTV, %USD, LOAD and the array queue depth.",
        "refs": ["yellow_bricks", "esxtop_metrics"],
    },
    "ACTV": {
        "name": "Active commands",
        "unit": "",
        "category": "storage",
        "description": "Commands currently active in the VMkernel.",
        "refs": ["esxtop_metrics"],
    },
    "LOAD": {
        "name": "Queue load",
        "unit": "",
        "category": "storage",
        "description": "Ratio of active plus queued commands to queue depth. Values above 1 mean outstanding work exceeds the configured queue.",
        "refs": ["esxtop_metrics"],
    },
    "%USD": {
        "name": "Queue depth used",
        "unit": "%",
        "category": "storage",
        "description": "Percentage of the storage queue depth currently used.",
        "refs": ["esxtop_metrics"],
    },
    "AQLEN": {
        "name": "Adapter queue depth",
        "unit": "",
        "category": "storage",
        "description": "Maximum active commands configured for the storage adapter.",
        "refs": ["esxtop_metrics"],
    },
    "DQLEN": {
        "name": "Device queue depth",
        "unit": "",
        "category": "storage",
        "description": "Maximum active commands configured for the device.",
        "refs": ["esxtop_metrics"],
    },
    "LQLEN": {
        "name": "LUN queue depth",
        "unit": "",
        "category": "storage",
        "description": "Maximum active commands allowed for the LUN.",
        "refs": ["esxtop_metrics"],
    },
    "WQLEN": {
        "name": "World queue depth",
        "unit": "",
        "category": "storage",
        "description": "Per-LUN maximum active commands for a world.",
        "refs": ["esxtop_metrics"],
    },
    "ABRTS/s": {
        "name": "Storage aborts",
        "unit": "/s",
        "category": "storage",
        "description": "Commands aborted per second, often issued by a guest after a storage timeout. Windows commonly times out after 60 seconds.",
        "threshold_note": "Any sustained abort is a serious storage-health signal.",
        "refs": ["yellow_bricks", "esxtop_storage"],
    },
    "RESETS/s": {
        "name": "Storage resets",
        "unit": "/s",
        "category": "storage",
        "description": "Command resets per second. Repeated resets usually mean path, array or guest timeout problems.",
        "threshold_note": "Any sustained reset warrants investigation.",
        "refs": ["yellow_bricks"],
    },
    "CONS/s": {
        "name": "SCSI reservation conflicts",
        "unit": "/s",
        "category": "storage",
        "description": "SCSI reservation conflicts per second. High values can degrade VMFS performance because of locking.",
        "threshold_note": "Yellow Bricks flags above 20/s.",
        "refs": ["yellow_bricks"],
    },
    "RESV/s": {
        "name": "SCSI reservations",
        "unit": "/s",
        "category": "storage",
        "description": "SCSI reservation commands per second.",
        "refs": ["esxtop_metrics"],
    },
    "ATSF": {
        "name": "Failed ATS commands",
        "unit": "",
        "category": "storage",
        "description": "Failed Atomic Test and Set operations. On a healthy VAAI array this should stay at zero.",
        "threshold_note": "Any failure is a storage/VAAI health signal.",
        "refs": ["yellow_bricks"],
    },
    "DELETE_F": {
        "name": "Failed UNMAP commands",
        "unit": "",
        "category": "storage",
        "description": "Failed UNMAP/delete operations. Failures should be zero on a supported array.",
        "threshold_note": "Any failure is a storage/VAAI health signal.",
        "refs": ["yellow_bricks"],
    },
    "SPLTCMD/s": {
        "name": "Split commands",
        "unit": "/s",
        "category": "storage",
        "description": "Commands split because a large I/O crossed a boundary. Splitting can increase perceived latency.",
        "refs": ["esxtop_metrics"],
    },
    "SPLTCP/s": {
        "name": "Split copies",
        "unit": "/s",
        "category": "storage",
        "description": "Copies created while splitting commands.",
        "refs": ["esxtop_metrics"],
    },
    "FCMDS/s": {
        "name": "Failed commands",
        "unit": "/s",
        "category": "storage",
        "description": "Failed commands per second at the storage layer.",
        "refs": ["esxtop_metrics"],
    },
    "FREAD/s": {
        "name": "Failed reads",
        "unit": "/s",
        "category": "storage",
        "description": "Failed read commands per second.",
        "refs": ["esxtop_metrics"],
    },
    "FWRITE/s": {
        "name": "Failed writes",
        "unit": "/s",
        "category": "storage",
        "description": "Failed write commands per second.",
        "refs": ["esxtop_metrics"],
    },
    "SDLAT": {
        "name": "vSAN standard-deviation latency",
        "unit": "ms",
        "category": "storage",
        "description": "vSAN latency variation. Yellow Bricks flags values above 5 ms; use vSAN Observer or Skyline for deeper analysis.",
        "refs": ["yellow_bricks"],
    },
    # -------------------------------------------------------------- Network
    "PKTTX/s": {
        "name": "Packets transmitted",
        "unit": "/s",
        "category": "network",
        "description": "Packets transmitted per second on the port.",
        "refs": ["esxtop_metrics"],
    },
    "PKTRX/s": {
        "name": "Packets received",
        "unit": "/s",
        "category": "network",
        "description": "Packets received per second on the port.",
        "refs": ["esxtop_metrics"],
    },
    "MbTX/s": {
        "name": "Transmit throughput",
        "unit": "Mbps",
        "category": "network",
        "description": "Megabits transmitted per second.",
        "refs": ["esxtop_metrics"],
    },
    "MbRX/s": {
        "name": "Receive throughput",
        "unit": "Mbps",
        "category": "network",
        "description": "Megabits received per second.",
        "refs": ["esxtop_metrics"],
    },
    "%DRPTX": {
        "name": "Transmit drops",
        "unit": "%",
        "category": "network",
        "description": "Percentage of transmit packets dropped. A high value can indicate an overloaded uplink, CPU contention or a mis-sized physical network.",
        "threshold_note": "Yellow Bricks flags above 1%.",
        "refs": ["yellow_bricks", "vm_performance"],
    },
    "%DRPRX": {
        "name": "Receive drops",
        "unit": "%",
        "category": "network",
        "description": "Percentage of receive packets dropped. Correlate with physical NIC errors during investigate the switch and host CPU load.",
        "threshold_note": "Yellow Bricks flags above 1%.",
        "refs": ["yellow_bricks", "vm_performance"],
    },
    "PSZTX": {
        "name": "Average transmit packet size",
        "unit": "bytes",
        "category": "network",
        "description": "Average size of transmitted packets.",
        "refs": ["esxtop_metrics"],
    },
    "PSZRX": {
        "name": "Average receive packet size",
        "unit": "bytes",
        "category": "network",
        "description": "Average size of received packets.",
        "refs": ["esxtop_metrics"],
    },
    "SPEED": {
        "name": "Link speed",
        "unit": "Mbps",
        "category": "network",
        "description": "Negotiated physical link speed. Applies to physical NICs.",
        "refs": ["esxtop_metrics"],
    },
    "ACTN/s": {
        "name": "VMkernel network actions",
        "unit": "/s",
        "category": "network",
        "description": "VMkernel actions posted per second; an internal counter.",
        "refs": ["esxtop_metrics"],
    },
    "NUMA_TOTAL_MB": {
        "name": "NUMA node memory",
        "unit": "MB",
        "category": "memory",
        "description": "Physical memory managed by one NUMA node.",
        "refs": ["esxtop_metrics"],
    },
    "NUMA_FREE_MB": {
        "name": "NUMA node free memory",
        "unit": "MB",
        "category": "memory",
        "description": "Free memory on one NUMA node. Uneven free memory can influence placement and remote-memory pressure.",
        "refs": ["esxtop_metrics"],
    },
    "%ACTVS": {
        "name": "Active memory (slow average)",
        "unit": "%",
        "category": "memory",
        "description": "Slow-moving estimate of active guest memory.",
        "refs": ["esxtop_metrics"],
    },
    "%ACTVF": {
        "name": "Active memory (fast average)",
        "unit": "%",
        "category": "memory",
        "description": "Fast-moving estimate of active guest memory.",
        "refs": ["esxtop_metrics"],
    },
    "%ACTVN": {
        "name": "Active memory (next estimate)",
        "unit": "%",
        "category": "memory",
        "description": "Predicted active guest memory at the next sample.",
        "refs": ["esxtop_metrics"],
    },
    "TCHD_W": {
        "name": "Touched write memory",
        "unit": "MB",
        "category": "memory",
        "description": "Guest memory recently written. Working-set estimate for write-heavy workloads.",
        "refs": ["esxtop_metrics"],
    },
    "UPLINK": {
        "name": "Uplink",
        "unit": "",
        "category": "network",
        "description": "Whether the port is a physical uplink. Categorical (Y/N), not a numeric signal.",
        "refs": ["esxtop_metrics"],
    },
    "LINK_UP": {
        "name": "Link up",
        "unit": "",
        "category": "network",
        "description": "Whether a physical NIC link is up. Categorical (Y/N); a down link needs physical investigation.",
        "refs": ["esxtop_metrics"],
    },
    "FDUPLX": {
        "name": "Full duplex",
        "unit": "",
        "category": "network",
        "description": "Whether the physical link is full duplex. Categorical (Y/N).",
        "refs": ["esxtop_metrics"],
    },
    # ---------------------------------------------------------------- Power
    "POWER_NOW": {
        "name": "Power usage",
        "unit": "W",
        "category": "power",
        "description": "Current host or VM power usage reported by the platform.",
        "refs": ["esxtop_metrics"],
    },
    "POWER_CAP": {
        "name": "Power cap",
        "unit": "W",
        "category": "power",
        "description": "Configured power cap. If actual usage sits at the cap for sustained periods, the host may be power-limited.",
        "refs": ["esxtop_metrics"],
    },
    "VSAN_ENABLED": {
        "name": "vSAN enabled",
        "unit": "",
        "category": "storage",
        "description": "Indicates whether vSAN is enabled on the host.",
        "refs": ["esxtop_metrics"],
    },
}

# Human-readable and abbreviated counter names. Keys are lower-case and
# whitespace-collapsed. Context-specific aliases are handled below.
_ALIASES: dict[str, str] = {
    # CPU human names
    "% used": "%USED",
    "% run": "%RUN",
    "% system": "%SYS",
    "% wait": "%WAIT",
    "% vmwait": "%VMWAIT",
    "% ready": "%RDY",
    "% idle": "%IDLE",
    "% overlap": "%OVRLP",
    "% costop": "%CSTP",
    "% max limited": "%MLMTD",
    "% swap wait": "%SWPWT",
    "% cpu latency": "%LAT_C",
    "% memory latency": "%LAT_M",
    "% demand": "%DMD",
    "% processor time": "PCPU %",
    "% util time": "PCPU_UTIL",
    "% core util time": "CORE_UTIL",
    "switches/sec": "SWITCHES",
    "switches/s": "SWITCHES",
    "migrates/sec": "MIGRATES",
    "quantum expires/sec": "QUANTUM",
    "wakeups/sec": "WAKEUPS",
    "cpu load (1 minute avg)": "LOAD1",
    "cpu load (5 minute avg)": "LOAD5",
    "cpu load (15 minute avg)": "LOAD15",
    # Memory human names
    "memory overcommit (1 minute avg)": "OVERCOMMIT1",
    "memory overcommit (5 minute avg)": "OVERCOMMIT5",
    "memory overcommit (15 minute avg)": "OVERCOMMIT15",
    "machine mbytes": "MACHINE_MB",
    "kernel mbytes": "KERNEL_MB",
    "nonkernel mbytes": "NONKERNEL_MB",
    "free mbytes": "FREE_MB",
    "kernel managed mbytes": "KERNEL_MANAGED_MB",
    "kernel minfree mbytes": "KERNEL_MINFREE_MB",
    "kernel reserved mbytes": "KERNEL_RESERVED_MB",
    "kernel unreserved mbytes": "KERNEL_UNRESERVED_MB",
    "total mbytes": "NUMA_TOTAL_MB",
    "pshare shared mbytes": "PSHARE_SHARED_MB",
    "pshare common mbytes": "PSHARE_SHARED_MB",
    "pshare savings mbytes": "PSHARE_SAVED_MB",
    "swap used mbytes": "SWAP_USED_MB",
    "swap target mbytes": "SWAP_TARGET_MB",
    "swap mb read/sec": "SWAP_READ",
    "swap mbytes read/sec": "SWAP_READ",
    "swap mb write/sec": "SWAP_WRITE",
    "swap mbytes write/sec": "SWAP_WRITE",
    "total compressed mbytes": "COMPRESSED_MB",
    "total saved by compression mbytes": "COMPRESSION_SAVED_MB",
    "memctl current mbytes": "MEMCTL_CURRENT_MB",
    "memctl target mbytes": "MEMCTL_TARGET_MB",
    "memctl max mbytes": "MEMCTL_MAX_MB",
    "memory size mbytes": "MEMSZ",
    "memory granted size mbytes": "GRANT",
    "memory consumed size mbytes": "CNSM",
    "target size mbytes": "SZTGT",
    "touched mbytes": "TCHD",
    "% active": "%ACTV",
    "% active slow": "%ACTVS",
    "% active fast": "%ACTVF",
    "% active next": "%ACTVN",
    "memctl?": "MCTL?",
    "memctl mbytes": "MCTLSZ",
    "memctl target mbytes vm": "MCTLTGT",
    "memctl max mbytes vm": "MCTLMAX",
    "swapped mbytes": "SWCUR",
    "swap read mbytes/sec": "SWR/s",
    "swap written mbytes/sec": "SWW/s",
    "llswap read mbytes/sec": "LLSWR/s",
    "llswap written mbytes/sec": "LLSWW/s",
    "numa % local": "N%L",
    "numa remote memory mbytes": "NRMEM",
    "numa local memory mbytes": "NLMEM",
    "shared mbytes": "SHRD",
    "shared saved mbytes": "SHRDSVD",
    "compressed memory mbytes": "CACHESZ",
    "used compressed memory mbytes": "CACHEUSD",
    "compression mbytes/sec": "ZIP/s",
    "decompression mbytes/sec": "UNZIP/s",
    # Storage human names
    "commands/sec": "CMDS/s",
    "commands/s": "CMDS/s",
    "reads/sec": "READS/s",
    "writes/sec": "WRITES/s",
    "mbytes read/sec": "MBREAD/s",
    "mbytes written/sec": "MBWRTN/s",
    "average guest millisec/command": "GAVG/cmd",
    "average guest millisec/read": "GAVG/rd",
    "average guest millisec/write": "GAVG/wr",
    "average driver millisec/command": "DAVG/cmd",
    "average driver millisec/read": "DAVG/rd",
    "average driver millisec/write": "DAVG/wr",
    "average kernel millisec/command": "KAVG/cmd",
    "average kernel millisec/read": "KAVG/rd",
    "average kernel millisec/write": "KAVG/wr",
    "average queue millisec/command": "QAVG/cmd",
    "average queue millisec/read": "QAVG/rd",
    "average queue millisec/write": "QAVG/wr",
    "read latency": "LAT/rd",
    "write latency": "LAT/wr",
    "queued commands": "QUED",
    "active commands": "ACTV",
    "queue load": "LOAD",
    "queue used": "%USD",
    "adapter q depth": "AQLEN",
    "device q depth": "DQLEN",
    "lun q depth": "LQLEN",
    "world q depth": "WQLEN",
    "aborts/sec": "ABRTS/s",
    "resets/sec": "RESETS/s",
    "conflicts/sec": "CONS/s",
    "reserves/sec": "RESV/s",
    "atomic test and set failed": "ATSF",
    "delete failed": "DELETE_F",
    "failed commands/sec": "FCMDS/s",
    "failed reads/sec": "FREAD/s",
    "failed writes/sec": "FWRITE/s",
    "split commands/sec": "SPLTCMD/s",
    "split copies/sec": "SPLTCP/s",
    # Network human names
    "packets transmitted/sec": "PKTTX/s",
    "packets received/sec": "PKTRX/s",
    "mbits transmitted/sec": "MbTX/s",
    "mbits received/sec": "MbRX/s",
    "% outbound packets dropped": "%DRPTX",
    "% received packets dropped": "%DRPRX",
    "average packet size transmitted (bytes)": "PSZTX",
    "average packet size received (bytes)": "PSZRX",
    "link speed": "SPEED",
    "actions posted/sec": "ACTN/s",
    "uplink?": "UPLINK",
    "link up?": "LINK_UP",
    "full duplex?": "FDUPLX",
    "touched write mbytes": "TCHD_W",
    # Power / vSAN
    "power usage now watts": "POWER_NOW",
    "power usage cap watts": "POWER_CAP",
    "vsan enabled?": "VSAN_ENABLED",
    "standard deviation of latency": "SDLAT",
}

# Direct abbreviations are also accepted in case a capture was produced with a
# custom esxtop field order.
for _canonical in METRIC_DEFS:
    _ALIASES.setdefault(_canonical.lower(), _canonical)


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def group_family(group: str) -> str:
    """Map an esxtop group name to a broad resource family."""

    g = (group or "").strip().lower()
    base = g.split("(", 1)[0].strip()
    if g.startswith(("physical cpu", "group cpu", "vcpu")) or base in {"cpu", "physical cpu load"}:
        return "cpu"
    if g.startswith("group memory") or base == "memory":
        return "memory"
    if base == "numa node":
        return "numa"
    if any(token in g for token in ("disk", "storage", "vsan", "lun", "hba")):
        return "storage"
    if any(token in g for token in ("network", "net port", "virtual switch", "uplink", "nic")):
        return "network"
    if "power" in g:
        return "power"
    if "interrupt" in g:
        return "interrupt"
    return "other"


def infer_category(group: str, counter: str, metric_id: str) -> str:
    family = group_family(group)
    if family == "numa":
        if any(token in counter.lower() for token in ("mbytes", "memory")):
            return "memory"
        return "cpu"
    if family in {"cpu", "memory", "storage", "network", "power", "interrupt"}:
        return family
    definition = METRIC_DEFS.get(metric_id)
    if definition:
        return str(definition.get("category", "other"))
    return "other"


def canonical_metric(group: str, counter: str) -> str:
    """Return a stable metric identifier for a group/counter pair."""

    key = _norm(counter)
    family = group_family(group)

    # Context-sensitive aliases. ``% Used`` is CPU utilisation on CPU panels
    # but queue-depth utilisation on storage panels.
    if key == "% used":
        if family == "storage":
            return "%USD"
        return "%USED"
    if key in {"queue used", "% queue used"}:
        return "%USD"
    if key in {"total mbytes", "free mbytes"} and family == "numa":
        return "NUMA_TOTAL_MB" if key == "total mbytes" else "NUMA_FREE_MB"
    if key == "swap target mbytes":
        vm_group = group.strip().lower().startswith("group memory")
        return "SWTGT" if vm_group else "SWAP_TARGET_MB"
    if key in {"memctl target mbytes", "memctl max mbytes"}:
        # The host Memory screen uses Memctl Current/Target/Max MBytes; the
        # per-VM Group Memory screen uses MCTLTGT/MCTLMAX.
        vm_group = group.strip().lower().startswith("group memory")
        if vm_group:
            return "MCTLTGT" if key == "memctl target mbytes" else "MCTLMAX"
        return "MEMCTL_TARGET_MB" if key == "memctl target mbytes" else "MEMCTL_MAX_MB"
    if key == "memory overcommit (1 minute avg)":
        return "OVERCOMMIT1"

    alias = _ALIASES.get(key)
    if alias:
        return alias

    # Some captures keep a unit suffix such as "% Ready " or "%Ready".
    compact = re.sub(r"[\s_]+", "", key)
    for candidate, target in _ALIASES.items():
        if re.sub(r"[\s_]+", "", candidate) == compact:
            return target

    # Unknown metrics keep a readable, deterministic ID.
    return f"RAW:{counter.strip()}"


def metric_definition(metric_id: str, counter: str) -> dict[str, Any]:
    known = metric_id in METRIC_DEFS
    definition = dict(
        METRIC_DEFS.get(
            metric_id,
            {
                "name": counter.strip(),
                "unit": infer_unit(counter),
                "category": "other",
                "description": "Raw esxtop counter. No curated interpretation is available for this metric yet.",
                "refs": ["esxtop_metrics"],
            },
        )
    )
    definition.update({"id": metric_id, "known": known})
    return definition


def infer_unit(counter: str) -> str:
    value = counter.strip().lower()
    if value.startswith("%") or "% " in value or value.endswith(" %"):
        return "%"
    if "mbytes" in value or re.search(r"\bmb\b", value):
        return "MB/s" if "sec" in value else "MB"
    if "millisec" in value or ("latency" in value and "ms" not in value):
        return "ms"
    if "mhz" in value:
        return "MHz"
    if "watt" in value:
        return "W"
    if "mbit" in value or "mbps" in value:
        return "Mbps"
    if "bytes" in value:
        return "bytes"
    if "/sec" in value or "/s" in value:
        return "/s"
    return ""


def expand_refs(keys: list[str]) -> list[dict[str, str]]:
    return [REFERENCES[key] for key in keys if key in REFERENCES]


def public_catalog() -> list[dict[str, Any]]:
    """Compact catalogue used by the UI's metric reference drawer."""

    result = []
    for metric_id, definition in sorted(METRIC_DEFS.items()):
        item = {"id": metric_id, **definition}
        item["references"] = expand_refs(definition.get("refs", []))
        result.append(item)
    return result

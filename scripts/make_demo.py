#!/usr/bin/env python3
"""Generate the bundled deterministic esxtop demo capture.

The data is synthetic. It exercises healthy VMs, CPU contention, an artificial
CPU limit, ballooning/swap, NUMA locality, storage latency and packet drops so
that every visual state can be inspected without a real ESXi host.
"""

from __future__ import annotations

import csv
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "demo" / "esxtop-demo.csv"
HOST = "esxi01"
SAMPLES = 60
INTERVAL = 2
START = datetime(2026, 11, 2, 9, 0, 0)
RNG = random.Random(7)

GLOBAL_GROUP_FIELDS = [
    "Members",
    "% Used",
    "% Run",
    "% System",
    "% Wait",
    "% Ready",
    "% Idle",
    "% Overlap",
    "% CoStop",
    "% Max Limited",
    "% Swap Wait",
    "Switches/sec",
    "Migrates/sec",
    "Quantum Expires/sec",
    "Wakeups/sec",
    "Alloc Min",
    "Alloc Max",
    "Alloc Shares",
    "Alloc Min Limited",
    "% CPU Latency",
    "% Memory Latency",
    "% Demand",
    "Effective Min (MHz)",
    "Timers/sec",
    "Exclusive Affinity",
    "Power Usage Watts",
]

VCPU_FIELDS = [
    "% Used",
    "% Run",
    "% System",
    "% Wait",
    "% VmWait",
    "% Ready",
    "% Idle",
    "% Overlap",
    "% CoStop",
    "% Max Limited",
    "% Swap Wait",
    "Switches/sec",
    "Migrates/sec",
    "Quantum Expires/sec",
    "Wakeups/sec",
    "Alloc Min",
    "Alloc Max",
    "Alloc Shares",
    "Alloc Min Limited",
    "% CPU Latency",
    "% Memory Latency",
    "% Demand",
    "Effective Min (MHz)",
    "Physical Cpu",
    "Exclusive Affiniy",
]

GROUP_MEMORY_FIELDS = [
    "Memory Size MBytes",
    "Memory Granted Size MBytes",
    "Memory Consumed Size MBytes",
    "Target Size MBytes",
    "Touched MBytes",
    "% Active",
    "% Active Slow",
    "% Active Fast",
    "% Active Next",
    "Memctl?",
    "Memctl MBytes",
    "Memctl Target MBytes",
    "Memctl Max MBytes",
    "Swapped MBytes",
    "Swap Target MBytes",
    "Swap Read MBytes/sec",
    "Swap Written MBytes/sec",
    "Llswap Read MBytes/sec",
    "Llswap Written MBytes/sec",
    "Shared MBytes",
    "Shared Saved MBytes",
    "Numa % Local",
]

VIRTUAL_DISK_FIELDS = [
    "Commands/sec",
    "Reads/sec",
    "Writes/sec",
    "MBytes Read/sec",
    "MBytes Written/sec",
    "Average Guest MilliSec/Command",
    "Average Kernel MilliSec/Command",
    "Average Driver MilliSec/Command",
    "Average Queue MilliSec/Command",
    "Average Guest MilliSec/Read",
    "Average Kernel MilliSec/Read",
    "Average Driver MilliSec/Read",
    "Average Guest MilliSec/Write",
    "Average Kernel MilliSec/Write",
    "Average Driver MilliSec/Write",
    "Read Latency",
    "Write Latency",
    "Queued Commands",
    "Active Commands",
    "Aborts/sec",
    "Resets/sec",
]

NETWORK_FIELDS = [
    "Packets Transmitted/sec",
    "Packets Received/sec",
    "MBits Transmitted/sec",
    "MBits Received/sec",
    "Average Packet Size Transmitted (Bytes)",
    "Average Packet Size Received (Bytes)",
    "% Outbound Packets Dropped",
    "% Received Packets Dropped",
    "Uplink?",
    "Link Up?",
]

VMS = [
    {"name": "ERP-SQL01", "gid": 201, "vcpus": 2, "mem": 32768, "cpu": 112, "ready": 13.0, "mlmtd": 7.0, "cstop": 0.4},
    {"name": "APP-01", "gid": 202, "vcpus": 4, "mem": 24576, "cpu": 66, "ready": 5.2, "mlmtd": 0.0, "cstop": 4.1},
    {"name": "WEB-01", "gid": 203, "vcpus": 2, "mem": 8192, "cpu": 28, "ready": 0.7, "mlmtd": 0.0, "cstop": 0.1},
    {"name": "WEB-02", "gid": 204, "vcpus": 2, "mem": 8192, "cpu": 34, "ready": 0.9, "mlmtd": 0.0, "cstop": 0.1},
    {"name": "FILE-01", "gid": 205, "vcpus": 2, "mem": 16384, "cpu": 22, "ready": 0.8, "mlmtd": 0.0, "cstop": 0.1},
    {"name": "DC-01", "gid": 206, "vcpus": 2, "mem": 8192, "cpu": 18, "ready": 0.4, "mlmtd": 0.0, "cstop": 0.0},
]

headers: list[str] = []
columns: list[list[str | int | float]] = []


def add(group: str, counter: str, values: list[str | int | float] | None = None, fn=None) -> None:
    headers.append(f"\\\\{HOST}\\{group}\\{counter}")
    if values is None:
        values = [fn(index) for index in range(SAMPLES)]
    columns.append(values)


def num(value: float, digits: int = 2) -> str:
    return f"{value:.{digits}f}"


def wave(index: int, base: float, amplitude: float, period: float, phase: float = 0.0) -> float:
    return base + amplitude * math.sin(index / period + phase) + RNG.uniform(-amplitude / 4, amplitude / 4)


def main() -> None:
    add("Memory", "Memory Overcommit (1 Minute Avg)", fn=lambda i: num(wave(i, 0.56, 0.02, 12)))
    add("Memory", "Memory Overcommit (5 Minute Avg)", fn=lambda i: num(wave(i, 0.51, 0.01, 20)))
    add("Memory", "Memory Overcommit (15 Minute Avg)", fn=lambda i: num(wave(i, 0.47, 0.01, 30)))
    add("Physical Cpu Load", "Cpu Load (1 Minute Avg)", fn=lambda i: num(wave(i, 1.05 if i > 35 else 0.62, 0.08, 9)))
    add("Physical Cpu Load", "Cpu Load (5 Minute Avg)", fn=lambda i: num(wave(i, 0.84 if i > 35 else 0.58, 0.04, 18)))
    add("Physical Cpu Load", "Cpu Load (15 Minute Avg)", fn=lambda i: num(wave(i, 0.65, 0.03, 30)))

    core_bases = [34, 41, 37, 89, 44, 39, 48, 43]
    for core, base in enumerate(core_bases):
        if core == 3:
            fn = lambda i, b=base: num(min(99, wave(i, 91 if i > 35 else 68, 4.0, 8, 0.4)))
        elif core == 2:
            fn = lambda i, b=base: num(wave(i, 58, 9, 12, 0.6))
        else:
            fn = lambda i, b=base: num(wave(i, b, 5, 11, core / 3))
        add(f"Physical Cpu({core})", "% Processor Time", fn=fn)
        add(f"Physical Cpu({core})", "% Util Time", fn=fn)
        add(f"Physical Cpu({core})", "% Core Util Time", fn=fn)
    add("Physical Cpu(_Total)", "% Processor Time", fn=lambda i: num(wave(i, 58 if i > 35 else 41, 3.5, 10)))
    add("Physical Cpu(_Total)", "% Util Time", fn=lambda i: num(wave(i, 58 if i > 35 else 41, 3.5, 10)))
    add("Physical Cpu(_Total)", "% Core Util Time", fn=lambda i: num(wave(i, 56 if i > 35 else 40, 3.5, 10)))

    for node in (0, 1):
        add(f"Numa Node({node})", "% Processor Time", fn=lambda i, n=node: num(wave(i, 58 if i > 35 else 42, 4, 12, n)))
        add(f"Numa Node({node})", "% Util Time", fn=lambda i, n=node: num(wave(i, 57 if i > 35 else 41, 4, 12, n)))
        add(f"Numa Node({node})", "% Core Util Time", fn=lambda i, n=node: num(wave(i, 55 if i > 35 else 39, 4, 12, n)))
        add(f"Numa Node({node})", "Total MBytes", fn=lambda i, n=node: num(65536, 0))
        add(f"Numa Node({node})", "Free MBytes", fn=lambda i, n=node: num(wave(i, 6100 if n == 0 else 7200, 300, 20, n)))

    add("Memory", "Machine MBytes", fn=lambda i: num(131072, 0))
    add("Memory", "Kernel MBytes", fn=lambda i: num(wave(i, 5100, 80, 16)))
    add("Memory", "NonKernel MBytes", fn=lambda i: num(wave(i, 2390, 50, 21)))
    add("Memory", "Free MBytes", fn=lambda i: num(wave(i, 15400, 900, 19)))
    add("Memory", "Kernel Managed MBytes", fn=lambda i: num(124000, 0))
    add("Memory", "Kernel MinFree MBytes", fn=lambda i: num(4200, 0))
    add("Memory", "Kernel Reserved MBytes", fn=lambda i: num(6200, 0))
    add("Memory", "Kernel Unreserved MBytes", fn=lambda i: num(117800, 0))
    add("Memory", "Kernel State", fn=lambda i: "high")
    add("Memory", "PShare Shared MBytes", fn=lambda i: num(wave(i, 8800, 150, 25)))
    add("Memory", "PShare Common MBytes", fn=lambda i: num(wave(i, 2200, 60, 25)))
    add("Memory", "PShare Savings MBytes", fn=lambda i: num(wave(i, 6100, 120, 25)))
    add("Memory", "Swap Used MBytes", fn=lambda i: num(wave(i, 768, 25, 30)))
    add("Memory", "Swap Target MBytes", fn=lambda i: num(wave(i, 820, 30, 30)))
    add("Memory", "Swap MBytes Read/sec", fn=lambda i: num(wave(i, 0.22, 0.08, 8)))
    add("Memory", "Swap MBytes Write/sec", fn=lambda i: num(wave(i, 0.55, 0.15, 9)))
    add("Memory", "Total Compressed MBytes", fn=lambda i: num(wave(i, 1380, 60, 20)))
    add("Memory", "Total Saved By Compression MBytes", fn=lambda i: num(wave(i, 920, 40, 20)))
    add("Memory", "Memctl Current MBytes", fn=lambda i: num(wave(i, 2048, 20, 25)))
    add("Memory", "Memctl Target MBytes", fn=lambda i: num(wave(i, 2100, 25, 25)))
    add("Memory", "Memctl Max MBytes", fn=lambda i: num(2400, 0))

    # System group. Keep this healthy; it exists to exercise the non-VM path.
    for field in GLOBAL_GROUP_FIELDS:
        if field == "Exclusive Affinity":
            add("Group Cpu(1:system)", field, fn=lambda i: "")
        elif field == "Alloc Max":
            add("Group Cpu(1:system)", field, fn=lambda i: num(-1, 0))
        elif field == "Members":
            add("Group Cpu(1:system)", field, fn=lambda i: num(30, 0))
        elif field == "% Used":
            add("Group Cpu(1:system)", field, fn=lambda i: num(wave(i, 7, 0.8, 12)))
        elif field == "% Swap Wait":
            add("Group Cpu(1:system)", field, fn=lambda i: num(0, 0))
        else:
            add("Group Cpu(1:system)", field, fn=lambda i, f=field: num(wave(i, 2.5, 0.4, 14)))

    for vm in VMS:
        name = vm["name"]
        gid = vm["gid"]
        cpu = vm["cpu"]
        ready = vm["ready"]
        cstop = vm["cstop"]
        mlmtd = vm["mlmtd"]
        vcpu_count = vm["vcpus"]
        group_values: dict[str, float | str] = {
            "Members": vcpu_count + 3,
            "% Used": cpu,
            "% Run": cpu * 0.72,
            "% System": cpu * 0.12,
            "% Wait": max(0.0, 100 - cpu / vcpu_count),
            "% Ready": ready * 0.8,
            "% Idle": max(0.0, 100 - cpu / vcpu_count),
            "% Overlap": 0.4,
            "% CoStop": cstop,
            "% Max Limited": mlmtd * 0.8,
            "% Swap Wait": 0.3 if name == "WEB-01" else 0.0,
            "Switches/sec": 180,
            "Migrates/sec": 0.3,
            "Quantum Expires/sec": 22,
            "Wakeups/sec": 90,
            "Alloc Min": 0,
            "Alloc Max": -1,
            "Alloc Shares": -3,
            "Alloc Min Limited": 0,
            "% CPU Latency": 0.2,
            "% Memory Latency": 0.1 if name == "WEB-01" else 0.0,
            "% Demand": cpu * 1.03,
            "Effective Min (MHz)": 2400,
            "Timers/sec": 9,
            "Power Usage Watts": 38 if cpu > 70 else 22,
        }
        for field in GLOBAL_GROUP_FIELDS:
            if field == "Exclusive Affinity":
                add(f"Group Cpu({gid}:{name})", field, fn=lambda i: "")
            else:
                base = group_values.get(field, 0.0)
                add(
                    f"Group Cpu({gid}:{name})",
                    field,
                    fn=lambda i, b=base, f=field: (
                        num(wave(i, float(b), max(0.02, abs(float(b)) * 0.02), 10))
                        if isinstance(b, (int, float))
                        else str(b)
                    ),
                )

        base_used = cpu / vcpu_count
        for vcpu in range(vcpu_count):
            instance = f"{gid}:{name}:{gid * 10 + vcpu + 1}:vmx-vcpu-{vcpu}"
            vcpu_values: dict[str, float | str] = {
                "% Used": base_used,
                "% Run": base_used * 0.76,
                "% System": base_used * 0.1,
                "% Wait": max(0.0, 100 - base_used),
                "% VmWait": max(0.0, 100 - base_used - 18),
                "% Ready": ready,
                "% Idle": max(0.0, 100 - base_used),
                "% Overlap": 0.2,
                "% CoStop": cstop,
                "% Max Limited": mlmtd,
                "% Swap Wait": 0.8 if name == "WEB-01" else 0.0,
                "Switches/sec": 70,
                "Migrates/sec": 0.2,
                "Quantum Expires/sec": 11,
                "Wakeups/sec": 45,
                "Alloc Min": 0,
                "Alloc Max": -1,
                "Alloc Shares": -3,
                "Alloc Min Limited": 0,
                "% CPU Latency": 0.1,
                "% Memory Latency": 0.1 if name == "WEB-01" else 0.0,
                "% Demand": base_used * 1.03,
                "Effective Min (MHz)": 2400,
                "Physical Cpu": vcpu % 8,
                "Exclusive Affiniy": "",
            }
            for field in VCPU_FIELDS:
                base = vcpu_values.get(field, 0.0)
                add(
                    f"Vcpu({instance})",
                    field,
                    fn=lambda i, b=base, v=vcpu, f=field: (
                        num(wave(i, float(b), max(0.02, abs(float(b)) * 0.03), 9, v))
                        if isinstance(b, (int, float))
                        else str(b)
                    ),
                )

        memory = vm["mem"]
        balloon = 2048 if name == "WEB-01" else 0
        swapcur = 768 if name == "WEB-01" else 0
        swapread = 0.22 if name == "WEB-01" else 0
        swapwrite = 0.55 if name == "WEB-01" else 0
        numa_local = 72 if name == "ERP-SQL01" else 96
        memory_values: dict[str, float | str] = {
            "Memctl?": "Y",
            "Memory Size MBytes": memory,
            "Memory Granted Size MBytes": memory - balloon,
            "Memory Consumed Size MBytes": memory * 0.72,
            "Target Size MBytes": memory - balloon + 300,
            "Touched MBytes": memory * 0.58,
            "% Active": 62,
            "% Active Slow": 58,
            "% Active Fast": 66,
            "% Active Next": 64,
            "Memctl MBytes": balloon,
            "Memctl Target MBytes": balloon + 20,
            "Memctl Max MBytes": memory * 0.5,
            "Swapped MBytes": swapcur,
            "Swap Target MBytes": swapcur + 20,
            "Swap Read MBytes/sec": swapread,
            "Swap Written MBytes/sec": swapwrite,
            "Llswap Read MBytes/sec": 0,
            "Llswap Written MBytes/sec": 0,
            "Shared MBytes": memory * 0.18,
            "Shared Saved MBytes": memory * 0.12,
            "Numa % Local": numa_local,
        }
        for field in GROUP_MEMORY_FIELDS:
            base = memory_values.get(field, 0.0)
            add(
                f"Group Memory({gid}:{name})",
                field,
                fn=lambda i, b=base, f=field: (
                    num(wave(i, float(b), max(0.01, abs(float(b)) * 0.01), 18))
                    if isinstance(b, (int, float)) and float(b) != 0
                    else (num(0, 0) if isinstance(b, (int, float)) else str(b))
                ),
            )

        # Virtual disk
        vdisk = f"{name} (00000000-0000-0000-0000-{gid:012d}):scsi0:0"
        high_io = name == "FILE-01"
        add(f"Virtual Disk({vdisk})", "Commands/sec", fn=lambda i, h=high_io: num(wave(i, 2200 if h else 180, 90 if h else 30, 10)))
        add(f"Virtual Disk({vdisk})", "Reads/sec", fn=lambda i, h=high_io: num(wave(i, 1500 if h else 90, 80 if h else 20, 11)))
        add(f"Virtual Disk({vdisk})", "Writes/sec", fn=lambda i, h=high_io: num(wave(i, 700 if h else 90, 50 if h else 20, 9)))
        add(f"Virtual Disk({vdisk})", "MBytes Read/sec", fn=lambda i, h=high_io: num(wave(i, 80 if h else 4, 12 if h else 1, 12)))
        add(f"Virtual Disk({vdisk})", "MBytes Written/sec", fn=lambda i, h=high_io: num(wave(i, 38 if h else 2, 6 if h else 0.5, 13)))
        add(f"Virtual Disk({vdisk})", "Average Guest MilliSec/Command", fn=lambda i, h=high_io: num(wave(i, 18.4 if h else 3.2, 3.2 if h else 0.6, 8)))
        add(f"Virtual Disk({vdisk})", "Average Kernel MilliSec/Command", fn=lambda i, h=high_io: num(wave(i, 4.1 if h else 0.5, 0.8 if h else 0.1, 8)))
        add(f"Virtual Disk({vdisk})", "Average Driver MilliSec/Command", fn=lambda i, h=high_io: num(wave(i, 14.2 if h else 2.6, 2.4 if h else 0.4, 8)))
        add(f"Virtual Disk({vdisk})", "Average Queue MilliSec/Command", fn=lambda i, h=high_io: num(wave(i, 5.4 if h else 0.4, 1.1 if h else 0.1, 8)))
        add(f"Virtual Disk({vdisk})", "Average Guest MilliSec/Read", fn=lambda i, h=high_io: num(wave(i, 19.0 if h else 3.0, 3.4 if h else 0.5, 8)))
        add(f"Virtual Disk({vdisk})", "Average Kernel MilliSec/Read", fn=lambda i, h=high_io: num(wave(i, 4.2 if h else 0.5, 0.8 if h else 0.1, 8)))
        add(f"Virtual Disk({vdisk})", "Average Driver MilliSec/Read", fn=lambda i, h=high_io: num(wave(i, 14.8 if h else 2.5, 2.6 if h else 0.4, 8)))
        add(f"Virtual Disk({vdisk})", "Average Guest MilliSec/Write", fn=lambda i, h=high_io: num(wave(i, 15.2 if h else 3.4, 2.8 if h else 0.6, 9)))
        add(f"Virtual Disk({vdisk})", "Average Kernel MilliSec/Write", fn=lambda i, h=high_io: num(wave(i, 3.8 if h else 0.4, 0.7 if h else 0.1, 9)))
        add(f"Virtual Disk({vdisk})", "Average Driver MilliSec/Write", fn=lambda i, h=high_io: num(wave(i, 11.6 if h else 2.9, 2.0 if h else 0.5, 9)))
        add(f"Virtual Disk({vdisk})", "Read Latency", fn=lambda i, h=high_io: num(wave(i, 19.0 if h else 3.0, 3.4 if h else 0.5, 8)))
        add(f"Virtual Disk({vdisk})", "Write Latency", fn=lambda i, h=high_io: num(wave(i, 15.2 if h else 3.4, 2.8 if h else 0.6, 9)))
        add(f"Virtual Disk({vdisk})", "Queued Commands", fn=lambda i, h=high_io: num(wave(i, 3.6 if h else 0.2, 1.1 if h else 0.1, 8)))
        add(f"Virtual Disk({vdisk})", "Active Commands", fn=lambda i, h=high_io: num(wave(i, 18.0 if h else 2.0, 3.0 if h else 0.4, 8)))
        add(f"Virtual Disk({vdisk})", "Aborts/sec", fn=lambda i, h=high_io: num(0.08 if h and i > 40 else 0.0))
        add(f"Virtual Disk({vdisk})", "Resets/sec", fn=lambda i, h=high_io: num(0.02 if h and i > 40 else 0.0))

        # Network port
        port = 100000 + gid
        instance = f"{port}:{name}.eth0"
        drops = 2.4 if name == "WEB-02" else (0.6 if name == "FILE-01" else 0.02)
        for field in NETWORK_FIELDS:
            if field == "Uplink?":
                add(f"Network Port({instance})", field, fn=lambda i: "N")
            elif field == "Link Up?":
                add(f"Network Port({instance})", field, fn=lambda i: "Y")
            elif field == "% Outbound Packets Dropped":
                add(f"Network Port({instance})", field, fn=lambda i, d=drops: num(max(0, wave(i, d, 0.4, 9))))
            elif field == "% Received Packets Dropped":
                add(f"Network Port({instance})", field, fn=lambda i, d=drops: num(max(0, wave(i, d * 0.75, 0.3, 9))))
            elif field == "Packets Transmitted/sec":
                add(f"Network Port({instance})", field, fn=lambda i, h=name == "FILE-01": num(wave(i, 90000 if h else 22000, 5000 if h else 3000, 10)))
            elif field == "Packets Received/sec":
                add(f"Network Port({instance})", field, fn=lambda i, h=name == "FILE-01": num(wave(i, 82000 if h else 20000, 5000 if h else 3000, 10)))
            else:
                add(f"Network Port({instance})", field, fn=lambda i, h=name == "FILE-01": num(wave(i, 840 if h else 120, 40 if h else 12, 10)))

    # Storage device and adapter views
    device = "naa.6001405a1b2c3d4e5f60718293a4b5c6"
    for group, prefix in (("Disk Device", ""), ("Disk Adapter", "vmhba0")):
        instance = f"({device})" if group == "Disk Device" else f"({prefix})"
        add(f"{group}{instance}", "Commands/sec", fn=lambda i: num(wave(i, 4200, 220, 9)))
        add(f"{group}{instance}", "Average Guest MilliSec/Command", fn=lambda i: num(wave(i, 19.1, 2.8, 8)))
        add(f"{group}{instance}", "Average Kernel MilliSec/Command", fn=lambda i: num(wave(i, 4.3, 0.7, 8)))
        add(f"{group}{instance}", "Average Driver MilliSec/Command", fn=lambda i: num(wave(i, 14.8, 2.2, 8)))
        add(f"{group}{instance}", "Average Queue MilliSec/Command", fn=lambda i: num(wave(i, 5.1, 1.0, 8)))
        add(f"{group}{instance}", "Queued Commands", fn=lambda i: num(wave(i, 3.8, 1.0, 8)))
        add(f"{group}{instance}", "Active Commands", fn=lambda i: num(wave(i, 19.0, 2.5, 8)))
        if group == "Disk Device":
            add(f"{group}{instance}", "Aborts/sec", fn=lambda i: num(0.06 if i > 40 else 0.0))
            add(f"{group}{instance}", "Resets/sec", fn=lambda i: num(0.02 if i > 40 else 0.0))
            add(f"{group}{instance}", "Conflicts/sec", fn=lambda i: num(wave(i, 1.4, 0.4, 12)))
            add(f"{group}{instance}", "Atomic Test and Set Failed", fn=lambda i: num(0.0))
            add(f"{group}{instance}", "Delete Failed", fn=lambda i: num(0.0))

    add("Power", "Power Usage Now Watts", fn=lambda i: num(wave(i, 424, 16, 14)))
    add("Power", "Power Usage Cap Watts", fn=lambda i: num(500, 0))
    add("VSAN", "Enabled?", fn=lambda i: "N")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, quoting=csv.QUOTE_ALL, lineterminator="\n")
        writer.writerow(["(PDH-CSV 4.0) (UTC)(0)", *headers])
        for index in range(SAMPLES):
            timestamp = (START + timedelta(seconds=index * INTERVAL)).strftime("%m/%d/%Y %H:%M:%S")
            writer.writerow([timestamp, *(column[index] for column in columns)])
    print(f"Wrote {OUT} ({len(headers)} metrics, {SAMPLES} samples)")


if __name__ == "__main__":
    main()

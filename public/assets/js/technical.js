/* Shared technical notes for findings, metric pages and reports. */

export const TECHNICAL_REFERENCE = {
  // ---------------------------------------------------------------- CPU
  "%RDY": {
    name: "CPU ready time",
    unit: "%",
    category: "cpu",
    what:
      "The percentage of time a vCPU was ready to run but had no physical CPU available. It measures scheduler delay, not guest compute time.",
    read:
      "Read it per vCPU, not only at VM-group level. A group aggregate can hide one starved vCPU. Compare %RDY with %MLMTD and %CSTP before concluding that the host is short of CPU capacity.",
    formula:
      "%RDY includes time attributed to %MLMTD (administrative limit) and %CSTP (SMP co-stop).",
    check:
      "If %MLMTD is non-zero, remove or raise the CPU limit first. If %MLMTD is zero, reduce vCPU count, move the VM, or add host capacity.",
    related: ["%MLMTD", "%CSTP", "%USED"],
  },
  "%MLMTD": {
    name: "CPU limit throttling",
    unit: "%",
    category: "cpu",
    what:
      "Ready time caused by a VM or resource-pool CPU limit. The vCPU was runnable but deliberately not scheduled because scheduling it would exceed the configured limit.",
    read:
      "%MLMTD is part of %RDY. Any sustained value above zero means a policy limit is shaping the workload, even if the host has free CPU.",
    formula: "%MLMTD is a subset of %RDY; it is not additional to it.",
    check:
      "Inspect the VM and resource-pool CPU limit. Raise or remove it if it is not intentional; adding physical CPU capacity will not fix a limit-induced wait.",
    related: ["%RDY", "%CSTP"],
  },
  "%CSTP": {
    name: "SMP co-stop",
    unit: "%",
    category: "cpu",
    what:
      "Ready time caused by co-scheduling constraints in an SMP VM. A vCPU can be held back because its sibling vCPUs are not progressing together.",
    read:
      "%CSTP is part of %RDY. It often appears when a VM has more vCPUs than the guest workload can use evenly, or when vCPU scheduling is skewed.",
    check:
      "Review vCPU count and guest workload balance. A VM with more vCPUs than the workload can use is often faster with fewer vCPUs.",
    related: ["%RDY", "%MLMTD"],
  },
  "%SWPWT": {
    name: "Swap wait",
    unit: "%",
    category: "memory",
    what:
      "Time a world waited for the VMkernel to swap memory pages back in. It is included in %WAIT and signals host memory pressure or a memory limit.",
    read:
      "Swap-in is synchronous. Even a small sustained %SWPWT can produce visible guest stalls, especially for latency-sensitive workloads.",
    check:
      "Check host free memory, MCTLSZ and SWCUR. Remove artificial memory limits, right-size reservations, add host memory, or move the VM.",
    related: ["SWCUR", "SWR/s", "MCTLSZ"],
  },
  "%USED": {
    name: "CPU used",
    unit: "%",
    category: "cpu",
    what:
      "The share of physical CPU core cycles accounted to a world or group. A multi-vCPU group can exceed 100%.",
    read:
      "%USED shows demand or consumption; it does not show whether the vCPU had to wait. A VM can be lightly used and still have high %RDY.",
    formula: "%USED = %RUN + %SYS - %OVRLP (approximately; accounting varies by counter source).",
    check:
      "Compare with host PCPU utilisation, %RDY and the guest workload. One VM at 100% is not automatically a host bottleneck.",
    related: ["%RUN", "%SYS", "%RDY"],
  },
  "%RUN": {
    name: "CPU run time",
    unit: "%",
    category: "cpu",
    what:
      "The percentage of total scheduled time a world actually ran. On hyper-threaded hosts it can be about twice %USED because it does not discount system time.",
    read:
      "Use %RUN with %USED and %SYS to understand how much CPU the workload consumed versus how much the VMkernel consumed on its behalf.",
    check:
      "A high %RUN with high %USED is a busy workload; a high %SYS often points to I/O or VMkernel work rather than guest compute.",
    related: ["%USED", "%SYS"],
  },
  "%SYS": {
    name: "System time",
    unit: "%",
    category: "cpu",
    what:
      "Time the VMkernel spent on behalf of the world for interrupts, system calls and other kernel work. Persistently high %SYS often follows high I/O activity.",
    read:
      "%SYS is part of %USED. It is not guest application CPU time.",
    check:
      "Correlate high %SYS with storage and network activity before assuming a CPU problem.",
    related: ["%USED", "%RUN"],
  },
  "%WAIT": {
    name: "Wait time",
    unit: "%",
    category: "cpu",
    what:
      "Time a world was blocked or busy-waiting. It includes idle and swap-wait time, so a high value is not automatically a problem.",
    read:
      "%WAIT can be high for an idle VM. Use %VMWAIT, %IDLE and %SWPWT to understand what the wait is made of.",
    formula: "%WAIT includes %IDLE and %SWPWT; high %WAIT alone is not CPU starvation.",
    check:
      "Do not size CPU from %WAIT alone. Check %RDY, %VMWAIT and the guest workload.",
    related: ["%IDLE", "%SWPWT", "%VMWAIT"],
  },
  "%VMWAIT": {
    name: "VM wait time",
    unit: "%",
    category: "cpu",
    what:
      "Time vCPUs spent blocked waiting for events, excluding idle and swap wait. It usually points to guest I/O, a lock, or an external dependency.",
    read:
      "High %VMWAIT is a guest or dependency signal, not host CPU starvation. Compare it with %WAIT, %IDLE and storage/network latency.",
    check:
      "Inspect guest I/O, application locks, storage latency and network waits. Do not add CPU capacity based on %VMWAIT alone.",
    related: ["%WAIT", "%IDLE", "%SWPWT"],
  },
  "%IDLE": {
    name: "vCPU idle time",
    unit: "%",
    category: "cpu",
    what:
      "Time a vCPU world was in the guest idle loop. It is included in %WAIT and only meaningful for vCPU worlds.",
    read:
      "High %IDLE means the guest CPU was not busy. It helps separate a truly idle VM from one that is blocked on I/O.",
    check:
      "Use with %VMWAIT and %SWPWT. High %IDLE plus high %WAIT usually means the guest is waiting, not CPU-starved.",
    related: ["%WAIT", "%VMWAIT"],
  },
  "%OVRLP": {
    name: "CPU overlap",
    unit: "%",
    category: "cpu",
    what:
      "System time spent servicing another world while this world was running. It is already included in the other world's %SYS.",
    read:
      "Overlap explains why %USED is not simply %RUN + %SYS. It is a normal accounting artifact, not a separate bottleneck.",
    check:
      "Use it only when reconciling CPU accounting; do not tune from %OVRLP alone.",
    related: ["%USED", "%RUN", "%SYS"],
  },
  "PCPU %": {
    name: "Physical CPU utilisation",
    unit: "%",
    category: "cpu",
    what:
      "The percentage of time a physical CPU core was busy. The host rule uses the worst core's P95, not only the host average.",
    read:
      "Sustained high PCPU with high VM %RDY is real host contention. A busy core can be normal if the workload is designed for it.",
    check:
      "Correlate with VM %RDY, run queue/load and the number of vCPUs per core. Add capacity or reduce vCPU density when both are sustained.",
    related: ["%RDY", "PCPU_UTIL", "CORE_UTIL"],
  },
  PCPU_UTIL: {
    name: "CPU utilisation (alternate counter)",
    unit: "%",
    category: "cpu",
    what:
      "An alternate physical CPU utilisation counter used by some esxtop releases. It describes the same host-core pressure as PCPU %.",
    read:
      "Treat it as equivalent to PCPU % when the capture contains it; the rule engine groups equivalent host CPU counters to avoid duplicate findings.",
    check:
      "Use the counter that is present in the capture and correlate it with VM %RDY.",
    related: ["PCPU %", "CORE_UTIL"],
  },
  CORE_UTIL: {
    name: "Core utilisation (alternate counter)",
    unit: "%",
    category: "cpu",
    what:
      "Another physical-core utilisation counter used by some releases. It is grouped with PCPU % and PCPU_UTIL for host CPU findings.",
    read:
      "Higher values mean the core is busy; check whether the workload is latency-sensitive and whether vCPUs are waiting.",
    check:
      "Correlate with %RDY and host load. Do not use core utilisation alone to declare a CPU bottleneck.",
    related: ["PCPU %", "PCPU_UTIL"],
  },
  LOAD1: {
    name: "CPU load average (1 minute)",
    unit: "",
    category: "cpu",
    what:
      "The host load average over one minute. Broadcom describes 1.0 as full utilisation of the physical CPUs and 2.0 as a host that may need twice as many CPUs.",
    read:
      "Load averages include running and ready-to-run worlds. They are a host-level trend, not a per-VM diagnosis.",
    check:
      "Correlate with PCPU %, VM %RDY and the number of running VMs. A high load with low CPU usage can indicate I/O wait or a transient burst.",
    related: ["PCPU %", "%RDY"],
  },

  // -------------------------------------------------------------- Memory
  MEMSZ: {
    name: "Configured memory",
    unit: "MB",
    category: "memory",
    what:
      "The amount of physical memory configured for the VM. This is the VM's memory size, not necessarily the amount currently granted or touched.",
    read:
      "Compare MEMSZ with GRANT, MCTLSZ, SWCUR and %ACTV. A large MEMSZ with low active memory is not automatically a problem.",
    formula: "MEMSZ ≈ GRANT + MCTLSZ + SWCUR + untouched memory (the exact split varies with the VM state).",
    check:
      "Check whether the guest actually uses the configured memory and whether a limit or reservation is distorting the picture.",
    related: ["GRANT", "MCTLSZ", "SWCUR", "%ACTV"],
  },
  GRANT: {
    name: "Granted memory",
    unit: "MB",
    category: "memory",
    what:
      "Guest physical memory currently mapped to machine memory, excluding VM overhead.",
    read:
      "GRANT can be below MEMSZ when the guest has not touched all of its configured memory or when the host has reclaimed pages.",
    check:
      "Compare with MEMSZ and %ACTV. A low GRANT alone is not pressure; check MCTLSZ and SWCUR for reclaim.",
    related: ["MEMSZ", "%ACTV", "MCTLSZ"],
  },
  MCTLSZ: {
    name: "Ballooned memory",
    unit: "MB",
    category: "memory",
    what:
      "Guest physical memory reclaimed by the VMware Tools balloon driver. The balloon inflates inside the guest and returns pages to the host.",
    read:
      "Ballooning is cheaper than swapping, but a sustained value means the host is applying memory pressure or a memory limit is configured. Yellow Bricks flags values above 1 MB.",
    check:
      "Correlate with host free memory, SWCUR, swap rates and the VM memory limit. Remove artificial limits, right-size reservations, add host memory, or move the VM.",
    related: ["SWCUR", "SWR/s", "MEMSZ"],
  },
  SWCUR: {
    name: "VMkernel swapped memory",
    unit: "MB",
    category: "memory",
    what:
      "Guest physical memory currently swapped by the VMkernel. This is VMkernel swap, not paging inside the guest operating system.",
    read:
      "Persistent swap means host memory pressure or an incorrect memory limit. Swap-in is synchronous and usually more damaging than ballooning.",
    check:
      "Check SWR/s and SWW/s for active swap, host free memory, reservations and memory limits. Treat sustained swap as a priority.",
    related: ["SWR/s", "SWW/s", "MCTLSZ"],
  },
  "SWR/s": {
    name: "Swap read rate",
    unit: "MB/s",
    category: "memory",
    what:
      "The rate at which swapped VM pages are read back from disk. Swap-in is synchronous and can appear as guest latency or stalls.",
    read:
      "Any sustained swap-in is significant. It is different from a stale SWCUR value that remains after pressure has passed.",
    check:
      "Correlate with SWCUR, host free memory and guest latency. Add memory or remove limits before tuning storage.",
    related: ["SWCUR", "SWW/s", "%SWPWT"],
  },
  "SWW/s": {
    name: "Swap write rate",
    unit: "MB/s",
    category: "memory",
    what:
      "The rate at which VM pages are written to swap.",
    read:
      "Sustained swap-out indicates host memory pressure. It is a leading indicator, even before the guest reports slowness.",
    check:
      "Check host free memory, ballooning and memory limits. Reduce memory pressure or add capacity.",
    related: ["SWCUR", "SWR/s", "MCTLSZ"],
  },
  "N%L": {
    name: "NUMA local memory",
    unit: "%",
    category: "memory",
    what:
      "The percentage of VM memory that is local to the NUMA node(s) where its vCPUs run. Remote memory has higher latency and lower bandwidth.",
    read:
      "Yellow Bricks flags values below 80% as poor locality; below 50% is a strong warning. One low sample can be transient, so the tool uses P05.",
    check:
      "Compare VM size with each NUMA node's memory and vCPU count. Reduce the VM footprint, use NUMA-aware sizing, or let vSphere place it on a suitable node. Verify NRMEM and NLMEM.",
    related: ["NRMEM", "NLMEM"],
  },
  NRMEM: {
    name: "NUMA remote memory",
    unit: "MB",
    category: "memory",
    what:
      "VM memory allocated from a NUMA node remote to the node running its vCPUs.",
    read:
      "High NRMEM with low N%L confirms remote-memory access. It is a placement/sizing signal, not a guest application bug.",
    check:
      "Review VM size versus NUMA node size, vCPU placement, and whether the VM spans nodes unnecessarily.",
    related: ["N%L", "NLMEM"],
  },
  NLMEM: {
    name: "NUMA local memory",
    unit: "MB",
    category: "memory",
    what:
      "VM memory allocated from the local NUMA node.",
    read:
      "Use with NRMEM to see the local/remote split behind N%L.",
    check:
      "If local memory is low, check VM sizing and placement; do not tune the guest first.",
    related: ["N%L", "NRMEM"],
  },
  OVERCOMMIT1: {
    name: "Memory overcommit",
    unit: "",
    category: "memory",
    what:
      "Requested VM memory divided by managed machine memory, minus one. A value of 0.5 means the VMs request 50% more memory than the host manages.",
    read:
      "Overcommit is a planning signal, not proof of active reclaim. It becomes a problem when free memory is low and ballooning or swapping appears.",
    check:
      "Correlate with FREE_MB, MCTLSZ, SWCUR and host swap. A high overcommit with no reclaim may still be acceptable.",
    related: ["FREE_MB", "MCTLSZ", "SWCUR"],
  },
  "%ACTV": {
    name: "Active memory",
    unit: "%",
    category: "memory",
    what:
      "An estimate of the percentage of guest physical memory that is actively being used.",
    read:
      "Active memory helps distinguish a large but idle VM from a VM that is actually using its configured memory.",
    check:
      "Compare with MEMSZ, GRANT and touched memory. Use it for sizing, not as a pressure alarm by itself.",
    related: ["MEMSZ", "GRANT"],
  },

  // ------------------------------------------------------------- Storage
  "DAVG/cmd": {
    name: "Device latency",
    unit: "ms",
    category: "storage",
    what:
      "Average time per command at the device-driver layer, including the round trip to the storage array. It is the device/array portion of guest latency.",
    read:
      "Elevated DAVG points below ESXi: the array, SAN fabric, HBA, path, or physical media. It is not the VMkernel queue time.",
    formula: "GAVG = DAVG + KAVG. If GAVG is high and DAVG dominates, investigate the storage backend first.",
    check:
      "Check array latency, switch/HBA errors, path state, queue depth and whether the array is servicing other hosts. Correlate with read/write variants.",
    related: ["KAVG/cmd", "GAVG/cmd", "QAVG/cmd"],
  },
  "KAVG/cmd": {
    name: "VMkernel latency",
    unit: "ms",
    category: "storage",
    what:
      "Time a command spends inside the ESXi VMkernel and vSCSI/storage stack, including queueing in the VMkernel. It should normally be small relative to DAVG.",
    read:
      "High KAVG means the delay is inside ESXi, not necessarily the array. It can come from queue depth, path throttling, vSCSI, or host-side contention.",
    formula: "KAVG includes QAVG (queue wait). GAVG = DAVG + KAVG.",
    check:
      "Check QUED, ACTV, %USD, DQLEN/AQLEN, path state, vSCSI latency and host CPU pressure. Compare KAVG/rd and KAVG/wr.",
    related: ["QAVG/cmd", "QUED", "ACTV", "%USD"],
  },
  "GAVG/cmd": {
    name: "Guest latency",
    unit: "ms",
    category: "storage",
    what:
      "The latency perceived by the guest operating system. It is the sum of device latency and VMkernel latency.",
    read:
      "GAVG is the symptom the guest feels, not the location of the problem. Split it into DAVG and KAVG before changing anything.",
    formula: "GAVG = DAVG + KAVG.",
    check:
      "If DAVG is high, investigate the array/fabric. If KAVG is high, investigate the VMkernel queue and paths. If both are low but the guest is slow, look at the guest and application.",
    related: ["DAVG/cmd", "KAVG/cmd", "QAVG/cmd"],
  },
  "QAVG/cmd": {
    name: "Queue latency",
    unit: "ms",
    category: "storage",
    what:
      "Average time a command spent waiting in the storage queue. QAVG is part of KAVG and becomes important when latency rises with command rate.",
    read:
      "High QAVG with high QUED means the queue is backing up. High QAVG with low queue depth may point to path or VMkernel scheduling delays.",
    check:
      "Check QUED, ACTV, %USD, DQLEN/AQLEN and the array's own queue. Reduce queue pressure or fix the slow path.",
    related: ["KAVG/cmd", "QUED", "ACTV"],
  },
  "CMDS/s": {
    name: "Storage commands",
    unit: "/s",
    category: "storage",
    what:
      "Total commands per second, including read/write I/O and other SCSI commands such as reservations, locks and vendor requests.",
    read:
      "CMDS/s is usually close to IOPS, but metadata-heavy workloads can issue many commands without moving much data.",
    check:
      "Compare with MB/s, queue depth and latency. High commands with low throughput can indicate small I/O or metadata overhead.",
    related: ["READS/s", "WRITES/s", "MBREAD/s", "MBWRTN/s"],
  },
  QUED: {
    name: "Queued commands",
    unit: "",
    category: "storage",
    what:
      "The number of commands currently queued in the VMkernel for the device or world.",
    read:
      "Sustained QUED above 1 means commands are waiting for a slot. It is a queue-depth symptom, not a measure of array latency by itself.",
    check:
      "Check ACTV, %USD, DQLEN/AQLEN, CMDS/s and DAVG/KAVG. If the queue is full while latency rises, the storage path is saturated.",
    related: ["ACTV", "%USD", "DQLEN", "AQLEN"],
  },
  ACTV: {
    name: "Active commands",
    unit: "",
    category: "storage",
    what:
      "The number of commands currently active in the VMkernel for a device or world.",
    read:
      "ACTV shows how much work is in flight. Compare it with the configured queue depth and the device's capability.",
    check:
      "Use with QUED and %USD to see whether the queue is busy or saturated.",
    related: ["QUED", "%USD", "DQLEN"],
  },
  "%USD": {
    name: "Queue depth used",
    unit: "%",
    category: "storage",
    what:
      "The percentage of the queue depth currently used by active VMkernel commands.",
    read:
      "A sustained high %USD means the queue is close to its limit. It can be intentional for a busy array, but it raises latency risk.",
    check:
      "Compare with QUED, ACTV, DAVG and the array's queue depth. Increase depth only when the backend can absorb it.",
    related: ["QUED", "ACTV", "DQLEN", "AQLEN"],
  },
  "ABRTS/s": {
    name: "Aborted commands",
    unit: "/s",
    category: "storage",
    what:
      "Storage commands aborted per second. Aborts usually mean the command exceeded a timeout or the path/device was reset.",
    read:
      "Any sustained aborts are a hard error signal. They often accompany path failures, array timeouts or severe queue pressure.",
    check:
      "Check vmkernel.log, path state, array health, timeouts and RESETS/s. Treat this as a storage-path incident, not a tuning problem.",
    related: ["RESETS/s", "CONS/s", "DAVG/cmd"],
  },
  "RESETS/s": {
    name: "Storage resets",
    unit: "/s",
    category: "storage",
    what:
      "Storage commands reset per second, usually after a timeout or path failure.",
    read:
      "Resets indicate the storage stack had to recover a command or path. They are not normal background noise.",
    check:
      "Check path status, HBA logs, array logs and timeouts. Correlate with aborts.",
    related: ["ABRTS/s", "CONS/s"],
  },
  "CONS/s": {
    name: "SCSI reservation conflicts",
    unit: "/s",
    category: "storage",
    what:
      "SCSI reservation conflicts per second. They occur when hosts or worlds contend for a reservation on a VMFS datastore.",
    read:
      "Sustained conflicts can degrade VMFS performance and point to shared-LUN contention. They are often application or cluster related.",
    check:
      "Check which hosts/VMs share the datastore, clustering behaviour and reservation usage. Correlate with GAVG/DAVG.",
    related: ["ABRTS/s", "RESETS/s", "GAVG/cmd"],
  },
  "LAT/rd": {
    name: "Virtual disk read latency",
    unit: "ms",
    category: "storage",
    what:
      "Average guest-observed latency per read on the VM's virtual disk.",
    read:
      "Use it with LAT/wr and the device-level DAVG/KAVG. A high read latency can come from the guest, VMkernel, array or media.",
    check:
      "Split into array (DAVG), VMkernel (KAVG) and guest-observed (GAVG/LAT) and check the guest's own I/O pattern.",
    related: ["LAT/wr", "GAVG/rd", "DAVG/rd", "KAVG/rd"],
  },
  "LAT/wr": {
    name: "Virtual disk write latency",
    unit: "ms",
    category: "storage",
    what:
      "Average guest-observed latency per write on the VM's virtual disk.",
    read:
      "Write latency is often dominated by array cache/write policy and queueing. Compare with read latency and the array's write behaviour.",
    check:
      "Check DAVG/wr, KAVG/wr, array cache policy, queue depth and guest write pattern.",
    related: ["LAT/rd", "GAVG/wr", "DAVG/wr", "KAVG/wr"],
  },
  "MBREAD/s": {
    name: "Storage read throughput",
    unit: "MB/s",
    category: "storage",
    what:
      "Megabytes read per second at the selected storage layer.",
    read:
      "Throughput alone does not prove health. High throughput with low latency is healthy; high throughput with rising queue and latency is saturation.",
    check:
      "Correlate with CMDS/s, queue depth and DAVG/KAVG.",
    related: ["CMDS/s", "QUED", "DAVG/cmd"],
  },
  "MBWRTN/s": {
    name: "Storage write throughput",
    unit: "MB/s",
    category: "storage",
    what:
      "Megabytes written per second at the selected storage layer.",
    read:
      "Write throughput can be limited by array cache, media, queue depth or guest behaviour. Compare with write latency.",
    check:
      "Correlate with MBWRTN/s, KAVG/wr, DAVG/wr and array cache policy.",
    related: ["CMDS/s", "QUED", "DAVG/cmd"],
  },

  // ------------------------------------------------------------- Network
  "%DRPTX": {
    name: "Transmit packet drops",
    unit: "%",
    category: "network",
    what:
      "The percentage of outbound packets dropped on the virtual switch port or uplink.",
    read:
      "Drops cause retransmits and latency. A non-zero sustained value is a signal, even if throughput still looks acceptable.",
    check:
      "Check the uplink, physical switch, teaming policy, traffic shaping and the guest/virtual NIC. Compare with %DRPRX.",
    related: ["%DRPRX", "PKTTX/s", "MbTX/s"],
  },
  "%DRPRX": {
    name: "Receive packet drops",
    unit: "%",
    category: "network",
    what:
      "The percentage of inbound packets dropped on the virtual switch port or uplink.",
    read:
      "Receive drops are often outside the guest's control and point to the physical network or host path.",
    check:
      "Check the physical switch port, uplink errors, buffer/queue drops and the host's network stack.",
    related: ["%DRPTX", "PKTRX/s", "MbRX/s"],
  },
  "PKTTX/s": {
    name: "Packets transmitted",
    unit: "/s",
    category: "network",
    what:
      "Packets transmitted per second on the network port.",
    read:
      "Use with packet size and throughput to understand the traffic profile. Small packets at a high rate are expensive.",
    check:
      "Correlate with MbTX/s, PSZTX, drops and the guest workload.",
    related: ["MbTX/s", "%DRPTX"],
  },
  "PKTRX/s": {
    name: "Packets received",
    unit: "/s",
    category: "network",
    what:
      "Packets received per second on the network port.",
    read:
      "Use with packet size and throughput to understand the receive profile.",
    check:
      "Correlate with MbRX/s, PSZRX, drops and the physical uplink.",
    related: ["MbRX/s", "%DRPRX"],
  },
  "MbTX/s": {
    name: "Transmit throughput",
    unit: "Mbps",
    category: "network",
    what:
      "Megabits transmitted per second on the network port.",
    read:
      "Compare with link speed and the workload's expected throughput. A saturated link can raise latency even without drops.",
    check:
      "Check SPEED, uplink utilisation, teaming and traffic shaping.",
    related: ["SPEED", "PKTTX/s", "%DRPTX"],
  },
  "MbRX/s": {
    name: "Receive throughput",
    unit: "Mbps",
    category: "network",
    what:
      "Megabits received per second on the network port.",
    read:
      "Compare with link speed and the workload's expected receive rate.",
    check:
      "Check SPEED, uplink utilisation and receive drops.",
    related: ["SPEED", "PKTRX/s", "%DRPRX"],
  },
};

export const TECHNICAL_RELATIONSHIPS = {
  cpu: [
    {
      title: "%RDY is the scheduler-delay umbrella",
      detail:
        "%RDY tells you a vCPU wanted a physical CPU and did not get one. It can contain %MLMTD (a policy limit) and %CSTP (SMP co-scheduling). Split it before adding hardware.",
    },
    {
      title: "Used CPU is not waiting CPU",
      detail:
        "%USED measures consumption; %RDY measures delay. A VM can use little CPU and still wait a long time, especially when it has many vCPUs or is limited.",
    },
    {
      title: "%WAIT is not automatically CPU starvation",
      detail:
        "%WAIT includes idle and swap wait. Use %VMWAIT, %IDLE and %SWPWT to separate normal idle time from real blocking.",
    },
  ],
  memory: [
    {
      title: "Configured memory is not granted memory",
      detail:
        "MEMSZ is the configured size; GRANT is what is mapped. Compare with %ACTV before deciding that a VM needs more memory.",
    },
    {
      title: "Ballooning before swapping",
      detail:
        "MCTLSZ is ballooned memory; SWCUR is VMkernel-swapped memory. Ballooning is cheaper, but sustained ballooning is still a sign of host pressure or a memory limit.",
    },
    {
      title: "NUMA locality is a placement problem",
      detail:
        "N%L is the local share of VM memory; NRMEM and NLMEM show the split. A low N%L means the VM is spanning or placed across NUMA nodes, which raises memory latency.",
    },
  ],
  storage: [
    {
      title: "GAVG = DAVG + KAVG",
      detail:
        "GAVG is what the guest feels. DAVG is the device/array portion; KAVG is the VMkernel/vSCSI portion, including queue wait (QAVG). Split the symptom before changing the array or the host.",
    },
    {
      title: "Queue depth explains rising latency",
      detail:
        "QUED, ACTV, %USD and DQLEN/AQLEN describe queue pressure. High latency with a full queue points at saturation; high latency with an empty queue points at the path, array or VMkernel delay.",
    },
    {
      title: "Read and write paths differ",
      detail:
        "DAVG/rd, KAVG/rd and GAVG/rd are not interchangeable with the write variants. Array cache policy, media and guest I/O patterns can make one direction much slower.",
    },
  ],
  network: [
    {
      title: "Drops are a ratio, not a rate",
      detail:
        "%DRPTX and %DRPRX are percentages of packets dropped. Correlate them with packet rate, throughput, link speed and the physical switch.",
    },
    {
      title: "Throughput alone is not health",
      detail:
        "A link can carry high throughput with low latency, or low throughput with heavy drops. Use packet rate, packet size, drops and link speed together.",
    },
  ],
};

export function technicalFor(metric) {
  return TECHNICAL_REFERENCE[metric] || null;
}

export function technicalEntries(category = null) {
  return Object.entries(TECHNICAL_REFERENCE)
    .filter(([, entry]) => !category || entry.category === category)
    .map(([metric, entry]) => ({ metric, ...entry }));
}

export function relationshipsFor(category = null) {
  if (!category) {
    return Object.entries(TECHNICAL_RELATIONSHIPS).flatMap(([key, items]) =>
      items.map((item) => ({ ...item, category: key })),
    );
  }
  return (TECHNICAL_RELATIONSHIPS[category] || []).map((item) => ({ ...item, category }));
}

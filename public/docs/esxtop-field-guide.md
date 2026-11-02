# ESXtop field guide

This guide is the technical reference behind ESXtop Lens. It explains what the capture command does, how the PDH-CSV file is structured, what the important counters mean, and how to use them without jumping to the wrong conclusion.

> **Scope.** Broadcom and VMware documentation define counter semantics. Yellow Bricks is used for practical field thresholds. A threshold is a prompt to investigate, not a diagnosis, and not a substitute for application, guest, array or network evidence.

## 1. What esxtop is

`esxtop` is the ESXi Shell performance utility. It reads VMkernel counters and presents them as interactive screens. The same data can be written in **batch mode** as a PDH-CSV file that Windows Performance Monitor can read.

The scheduler view needs a small conceptual model:

- A **world** is a schedulable VMkernel entity, roughly analogous to a thread.
- A **group** contains one or more worlds. A VM is a group; its vCPUs, VMX helpers, MKS and device worlds are members.
- CPU statistics can be shown for the group (sum or aggregate) or for individual worlds after expansion. Group values can hide a single starved vCPU.
- Memory and disk counters are also attached to groups or worlds, depending on the panel.

`resxtop` is the remote equivalent available through the vSphere CLI/vMA. It talks to a host or vCenter and accepts similar batch options. The CSV structure is the same family of counters.

## 2. The capture command, token by token

```text
esxtop -b -a -d 2 -n 100 | gzip -9c > /vmfs/volumes/SAS.-LOCAL/perf.csv
```

| Token | Meaning | Operational consequence |
| --- | --- | --- |
| `esxtop` | Start the ESXi performance tool. | Requires a privileged ESXi Shell session. Interactive mode is the default; `-b` changes it. |
| `-b` | Batch mode. | No ncurses screen; CSV is written to stdout. The entity list is locked at the first snapshot, so a VM that is created or migrated onto the host after the capture starts may not appear. |
| `-a` | Collect all available fields. | Widest capture and largest file. Ignore the saved field selection. Excellent for a first look, expensive for long captures. |
| `-d 2` | Delay of 2 seconds between snapshots. | Fine-grained enough for CPU and latency work. Nominal duration is `n × d`, but the first sample is usually immediate and actual timestamps include tool overhead. The CSV timestamps are authoritative. |
| `-n 100` | About 100 iterations. | At `-d 2`, roughly 200 seconds of nominal coverage. Use `-n infinity` only when you have an external stop plan and sufficient space. |
| pipe operator | Pipe esxtop stdout into the next command. | The raw CSV is never written to the datastore; only the compressed output is. |
| `gzip -9c` | Compress stdin at maximum level, write to stdout. | Saves datastore space, costs host CPU and makes the file binary. It will not open as plain text until decompressed. |
| `> /vmfs/volumes/SAS.-LOCAL/perf.csv` | Shell redirect stdout into a datastore file. | Ensure free space and avoid writing to the datastore you are investigating. The name is misleading: the file is gzip, not CSV. |

### Better capture examples

Use a unique name that records the host and time:

```text
esxtop -b -a -d 2 -n 300 \
  | gzip -9c > /vmfs/volumes/SAS.-LOCAL/esxtop-$(hostname)-$(date +%FT%H%M).csv.gz
```

For a longer, lower-overhead baseline, 5-second sampling is often easier to read:

```text
esxtop -b -a -d 5 -n 720 \
  | gzip -9c > /vmfs/volumes/SAS.-LOCAL/esxtop-$(hostname)-$(date +%FT%H%M)-1h.csv.gz
```

For a focused capture, omit `-a`, configure only the fields you need with interactive `f` and save with `W`, then run batch mode with the configuration file. Batch field selection and configuration handling differ across releases, so verify the resulting header before relying on it. Another option is `-u`, which suppresses server-wide physical CPU statistics and reduces output when host CPU data is not needed.

If you need to limit the entities, use `-export-entity` / `-import-entity` during preparation or `-l` to lock the set. With `-b`, the entity set is effectively locked at the first sample regardless.

### Transfer and retention

The CSV can be tens or hundreds of megabytes, and the KB notes that some hosts have produced up to 120,000 columns. Observed all-metric captures can exceed that; one recent capture had 145,697 metric columns. Copy the file off the host, then remove it when the investigation is finished. Do not store the only copy on a datastore that may be failing.

The application defaults to 20,000,000 data cells, 200,000 metric columns and 50,000 samples. Those defaults admit the observed 145,697-column capture and allow 100 samples at the full 200,000-column width, or 137 samples of the observed capture. They are configurable with `ESXTOP_MAX_CELLS`, `ESXTOP_MAX_SERIES` and `ESXTOP_MAX_ROWS`.

Sample arrays are not sent to the browser with the first response. The parser stores them in a short-lived SQLite session; charts request only the series they display. This keeps the initial payload and browser memory small. Sessions expire after 30 minutes by default (`ESXTOP_SESSION_TTL_MINUTES`) and are deleted at shutdown.

### Focused capture with `-c`

The full command with `-a` is the broad first look. When you need a smaller, repeatable capture — for example disk adapter, disk device and VM disk latency — prepare a configuration file interactively.

1. Start `esxtop` on the ESXi host.
2. Switch to the panel: `c` CPU, `m` memory, `u` Disk Device, `d` Disk Adapter, `n` network, or `v` VM disk.
3. Press `f` to add/remove fields. Press `o` to change order if needed.
4. Repeat the field selection for every panel you want to include or exclude. The configuration file contains all panel layouts.
5. Press uppercase **`W`**. At the prompt, enter an **absolute datastore path**, for example `/vmfs/volumes/datastore1/esxtop-disk.rc`.
6. Verify the config with a two-sample batch run, then collect the real window.

```text
esxtop -b -c /vmfs/volumes/datastore1/esxtop-disk.rc -d 5 -n 60   > /vmfs/volumes/datastore1/esxtop_disk.csv
```

### Multiple storage panels in one rc file

An rc file is not one-panel-only. It stores the field layout for **every** panel, so you can configure Disk Adapter (`d`), Disk Device (`u`) and VM Disk (`v`) in the same interactive session and save all of them with a single `W`. Batch mode then collects the union of the selected fields.

| Key | Panel | What it shows |
|---|---|---|
| `d` | Disk Adapter | HBA/adapter latency, queue and throughput |
| `u` | Disk Device | Per-LUN/device latency, queue and throughput. Closest to a datastore's backing device |
| `v` | VM Disk | Per-VM virtual disk latency, IOPS and throughput |
| `x` | vSAN | vSAN-specific panel on releases that expose it; not a general Datastore panel |

**There is no separate Datastore panel in esxtop.** A datastore can span devices or extents, so there is no single Datastore latency row. Use `u` for the backing device and `v` for per-VM I/O, then map the datastore to its devices. The vSphere Datastore performance chart is a vCenter metric, not an esxtop panel.

To build a storage-only rc:

1. Run `esxtop`.
2. Press `d`, then `f`, and select adapter fields.
3. Press `u`, then `f`, and select device fields.
4. Press `v`, then `f`, and select VM-disk fields.
5. In the other panels (`c`, `m`, `n`, `i`, `p`), disable the fields you do not want. The rc stores all panel layouts, so leftovers still appear in the batch header.
6. Press uppercase `W` once and save to a durable path, for example `/vmfs/volumes/datastore1/esxtop-storage.rc`.
7. Validate with `-n 2` and inspect the header for adapter, device and VM-disk counters.

A real ESXi 6.0 `.esxtop60rc` looks like this:

| Line | Content | Meaning |
|---|---|---|
| 1 | `abcdefghij` | CPU |
| 2 | `abcdefghijklmnopq` | Memory |
| 3 | `ABCDEfGHIJkl` | Disk Adapter — fields A–E and G–J selected |
| 4 | `ABcdeFGhIJKLmnop` | Disk Device — fields A, B, F, G, I–L selected |
| 5 | `aBCDEfghIJKl` | VM Disk — fields B–E and I–K selected |
| 6 | `abcdefghijklmnopq` | Network — all hidden |
| 7 | `abcdef` | Interrupt — all hidden |
| 8 | `abcdef` | CPU Power — all hidden |
| 9–10 | `AbcDEFGHijKlmN` / `ABCdEf` | Additional release-specific panel layouts in this ESXi 6.0 file |
| 11 | `5p` | Options: 5-second delay and the starting panel (`p`, CPU Power on releases that expose it) |

The number of panel-layout lines is release-specific; the last line is the options line. Uppercase letters mark selected fields and lowercase letters mark hidden fields, but do not hand-edit the file. Always save it with `W`.

Important details:

- **Do not add `-a`** to the focused command. Broadcom documents that `-a` overrides configuration-file setup and shows all statistics.
- `-c` accepts an absolute path. A relative name such as `.esxtoprc` only works from the directory that contains that file.
- The exact default configuration filename depends on the ESXi release. Broadcom's current interactive documentation still refers to `~/.esxtop50rc`; older releases use other names. Do **not** assume `.esxtoprc`. Read the `W` prompt, or always supply your own path.
- `W` is uppercase and case-sensitive.
- Do not save the only copy under `/tmp`; on ESXi that is a ramdisk. Use a datastore path, preferably a different datastore from the one being investigated.
- The rc file stores selections, not a magic filter. If you leave default fields enabled in other panels, they may still appear. Inspect the first CSV line and remove fields you do not want.
- Some release-specific counters may be absent from batch output. Validate the header with `-n 2` before starting a long capture.

There is a step-by-step capture builder and command preview at **Capture** in the application, or use `#/capture`.

## 3. What the CSV actually contains

The first line begins with a PDH marker such as:

```text
"(PDH-CSV 4.0) (UTC)(0)","\\esxi01\Memory\Machine MBytes","\\esxi01\Physical Cpu(0)\% Processor Time"
```

Each following row is one snapshot:

```text
"11/02/2026 09:00:00","131072","41.2"
"11/02/2026 09:00:02","131072","43.7"
```

A counter path has this shape:

```text
\\host\Group(instance)\Counter
```

- `host` is the source host name. The leading double backslash is part of the PDH path syntax.
- `Group(instance)` identifies the entity. The instance may contain a VM name, world ID, device name or queue identifier.
- `Counter` is the field name. It can be an abbreviation such as `%RDY` or a human-readable label such as `% Ready`.

Important parsing details:

1. The first cell is the sample timestamp. It is usually `MM/DD/YYYY HH:MM:SS`, without a timezone in the row.
2. The header records the timezone in the PDH marker. The sample timestamp must be interpreted in that timezone; do not silently treat it as the browser timezone.
3. Fields are quoted because counter names contain commas, parentheses, spaces and backslashes.
4. Missing values can be blank, `N/A`, `-` or another release-specific placeholder.
5. A column can be categorical. Examples: `Uplink?` (`Y`/`N`), `Link Up?`, `Kernel State` and `VSAN Enabled?`. These series should not be charted as numbers.
6. A capture is **wide**, not long. Adding ten VMs adds many columns, not rows.
7. The same logical metric can appear at several layers: VM virtual disk, physical device, adapter, path and world. They measure different points in the stack.

The file suffix is not reliable. The example command names a gzip stream `perf.csv`; ESXtop Lens inspects the first bytes (gzip magic `1f 8b`) rather than trusting the extension.

## 4. Interactive mode survival sheet

These keys are useful when preparing a focused capture or replaying a support session:

| Key | Panel or action |
| --- | --- |
| `c` | CPU |
| `m` | Memory |
| `n` | Network |
| `d` | Disk adapter |
| `u` | Disk device/LUN |
| `v` | Disk VM |
| `i` | Interrupts |
| `p` | Power management |
| `x` | vSAN |
| `f` | Fields: add or remove counters |
| `o` | Order: move fields |
| `s` | Change refresh interval |
| `V` | Show only VM groups |
| `e` | Expand a group into worlds |
| `l` | Limit display to one group (GID) |
| `W` | Write the current configuration |
| `?` | Help |
| `q` | Quit |

Interactive thresholds and charts are useful for live work, but a batch capture is what makes an incident reviewable later. Capture *before* rebooting or changing resource settings if possible.

## 5. CPU counters

### The scheduling equation

A useful way to read a world is:

```text
100% = %RUN + %RDY + %CSTP + %WAIT
```

- **%RUN** is time scheduled on a physical CPU.
- **%RDY** is ready but not scheduled.
- **%CSTP** is ready but waiting for co-scheduling with sibling vCPUs.
- **%WAIT** is blocked or idle. It includes `%IDLE` and `%SWPWT`.

`%USED = %RUN + %SYS - %OVRLP`. It accounts for physical CPU cycles more accurately than `%RUN` on modern hosts.

### The counters that matter first

| Counter | Meaning | Typical interpretation |
| --- | --- | --- |
| `%USED` | CPU spent on behalf of the world, adjusted for core frequency. | Workload, not automatically a problem. A multi-vCPU group can exceed 100%. |
| `%RUN` | Scheduled time. | Useful context for `%USED`; on HT hosts it can be roughly double `%USED`. |
| `%SYS` | VMkernel work on behalf of the world: interrupts, I/O completion, system worlds. | High `%SYS` often correlates with I/O or network processing. |
| `%RDY` | Ready but waiting for a physical CPU. | Broadcom calls <5% normal. Yellow Bricks uses sustained 10% per world as a contention warning. Always read per vCPU. |
| `%MLMTD` | Ready but deliberately held back by a CPU limit. | Included in `%RDY`. Any sustained non-zero value means an administrative limit is throttling the VM. Adding host CPU will not fix it. |
| `%CSTP` | Co-stop. | SMP VM cannot make progress because sibling vCPUs are not co-schedulable. Sustained >3% is a warning. Too many vCPUs or an unbalanced guest are common causes. |
| `%SWPWT` | Waiting for VMkernel swap-in. | Memory pressure, not CPU pressure. Sustained >5% is a severe signal. |
| `%WAIT` | Blocked/busy wait. | Includes idle, so it can be high on a healthy but idle vCPU. |
| `%IDLE` | Guest idle loop. | Only meaningful for vCPU worlds. |
| `%OVRLP` | System work for another world while this world ran. | Context for `%USED`; it is charged again to the other world's `%SYS`. |
| `%LAT_C` / `%LAT_M` | CPU / memory resource contention latency. | Useful when a resource pool is bottlenecked. |
| `%DMD` | Active CPU demand over the previous minute. | Compare with entitlement to see whether the VM wants more CPU. |

### Host-level CPU

| Counter | Meaning | Guardrail in this app |
| --- | --- | --- |
| `% Processor Time` on `Physical Cpu(n)` | Physical CPU utilisation. | Warning at 80%, critical at 90% P95. |
| `Cpu Load (1/5/15 Minute Avg)` | Run-queue load average from 6-second samples. | Load near 1.0 means fully utilised; 2.0 is heavily overloaded per Broadcom. This app warns at 1.0 and marks 2.0 critical. |
| `% Util Time`, `% Core Util Time` | Alternative vSphere utilisation views. | Same guardrails; the app groups equivalent host CPU findings to avoid duplicate noise. |

A single high core is meaningful. A host can average 40% while one core is pinned at 100% and a latency-sensitive vCPU that lands on it starves. Use the per-core table and `%RDY`.

### CPU troubleshooting sequence

1. Is the VM actually slow, and is it CPU-bound? Check guest CPU, `%USED`, `%DMD` and application latency.
2. Is `%MLMTD` non-zero? If yes, fix the VM or resource-pool limit first.
3. Is `%RDY` sustained above 5–10% per vCPU? Check host load and per-core saturation.
4. Is `%CSTP` high? Review vCPU count and guest workload balance; fewer vCPUs can be faster.
5. Is `%SWPWT` or `%VMWAIT` high? Move to the memory and storage sections.
6. Is `%SYS` high? Look for heavy I/O or network processing before blaming guest CPU.
7. Is the host load high but ready time low? The workload may be satisfied; not every busy host is a problem.

## 6. Memory counters

### Host memory

| Counter | Meaning | How to use it |
| --- | --- | --- |
| `Memory Overcommit (1/5/15 Minute Avg)` | Requested memory divided by managed memory, minus 1. | A planning signal. 0.5 means the VMs request 50% more than the host manages. It is not proof of active reclaim. |
| `Machine MBytes` | Physical memory managed by the host. | Denominator for free-memory percentage. |
| `Free MBytes` | Free machine memory. | Low free memory is common and can be healthy if reclaim is absent. Correlate with balloon/swap. |
| `Kernel MBytes`, `NonKernel MBytes` | VMkernel and non-kernel memory. | Capacity context. |
| `Kernel MinFree MBytes` | Free-memory floor. | Reclaim becomes more active as free memory approaches it. |
| `Memctl Current/Target/Max MBytes` | Host-level ballooning. | Non-zero ballooning means the host is reclaiming guest memory. |
| `Swap Used/Target MBytes` | Host-level VMkernel swap. | Persistent swap is a serious memory-pressure signal. |
| `Swap MBytes Read/sec` / `Write/sec` | Host swap I/O. | Swap-in is synchronous and more urgent than swap-out. |
| `Total Compressed MBytes` | Compression cache. | Compression is cheaper than swapping but still indicates pressure. |

### Per-VM memory

| Counter | Meaning | How to use it |
| --- | --- | --- |
| `Memory Size MBytes` / `MEMSZ` | Configured guest memory. | Compare with grant and touched. |
| `Memory Granted Size MBytes` / `GRANT` | Guest memory mapped to machine memory. | Overhead excluded. |
| `Memory Consumed Size MBytes` / `CNSM` | Estimated consumed memory, net of sharing/compression. | Capacity view. |
| `Touched MBytes` / `TCHD` | Working-set estimate. | More useful than configured size for right-sizing. |
| `% Active` | Active guest memory estimate. | Helps size reservations. |
| `Memctl MBytes` / `MCTLSZ` | Ballooned memory. | Yellow Bricks flags above 1 MB. Correlate with host free memory and memory limit. |
| `Swapped MBytes` / `SWCUR` | Current VMkernel swap. | Persistent swap signals pressure or an incorrect limit. |
| `Swap Read MBytes/sec` / `SWR/s` | Swap-in rate. | Any sustained swap-in is high priority. |
| `Swap Written MBytes/sec` / `SWW/s` | Swap-out rate. | Active writing means pressure is ongoing. |
| `Compressed Memory MBytes` / `CACHEUSD` | Compression cache use. | Non-zero means pages are being compressed. |
| `Compression MBytes/sec` / `ZIP/s` | Compression rate. | Context for pressure. |
| `Decompression MBytes/sec` / `UNZIP/s` | Decompression rate. | Accessing compressed pages adds latency. |
| `Numa % Local` / `N%L` | Local NUMA memory. | Yellow Bricks flags <80%; below 50% is a strong concern. |

### Memory troubleshooting sequence

1. Is the host swapping in or out? `SWR/s`, `SWW/s`, `SWAP_READ`, `SWAP_WRITE`.
2. Is current swap present? `SWCUR`, `SWAP_USED_MB`.
3. Is ballooning active? `MCTLSZ`, `Memctl Current`.
4. Is the VM memory limit lower than its working set? Check the VM and resource-pool settings.
5. Is compression active? `CACHEUSD`, `ZIP/s`, `UNZIP/s`.
6. Is NUMA locality poor? `N%L`, `NRMEM`, `NLMEM`.
7. Is free memory low without any reclaim? It may be cache usage, not pressure. Do not resize based on a single free-memory number.
8. Is overcommit high? Treat it as a capacity observation until reclaim or guest symptoms appear.

## 7. Storage counters

### Three layers, one number

Storage latency is not one number. It is measured at several points:

```text
GAVG = DAVG + KAVG
```

- **DAVG** is the device-driver round trip: HBA, fabric, array, backend media.
- **KAVG** is time inside the ESXi VMkernel: queueing, vSCSI processing, path selection.
- **GAVG** is what the guest observes.
- **QAVG** is the queue portion and is part of KAVG.

Broadcom 344099 states that DAVG, KAVG and GAVG should not remain above 10 ms for sustained periods. Yellow Bricks uses 25 ms as a stronger warning. This application warns at 10 ms and marks 25 ms critical. All storage guidance is array-dependent; verify with the vendor.

### Queue and error counters

| Counter | Meaning | Interpretation |
| --- | --- | --- |
| `CMDS/s` | Commands per second, including metadata and other SCSI operations. | Usually near IOPS, but can be higher. |
| `ACTV` | Currently active commands. | Compare with queue depth. |
| `QUED` | Commands waiting for a queue slot. | Sustained >1 is a queue-pressure signal. |
| `%USD` | Queue depth used. | Near 100% means the queue is full; correlate with latency. |
| `LOAD` | Active plus queued commands divided by queue depth. | >1 means outstanding work exceeds the configured depth. |
| `AQLEN`, `DQLEN`, `LQLEN`, `WQLEN` | Adapter, device, LUN and world queue depths. | Context for QUED and %USD. Do not tune blindly. |
| `ABRTS/s` | Commands aborted per second. | Guests issue aborts after timeouts. Any sustained value is serious. |
| `RESETS/s` | Command resets per second. | Path, array or timeout trouble. |
| `CONS/s` | SCSI reservation conflicts. | Yellow Bricks flags >20/s; VMFS metadata locking may stall I/O. |
| `ATSF` | Failed Atomic Test and Set. | Any failure is a VAAI/VMFS health signal. |
| `DELETE_F` | Failed UNMAP. | Any failure warrants storage/VAAI review. |
| `FCMDS/s`, `FREAD/s`, `FWRITE/s` | Failed command counts. | Direct path/array health signals. |
| `SPLTCMD/s`, `SPLTCP/s` | Split commands/copies. | Large or misaligned I/O; can increase latency. |

### Read/write latency

Read and write latency can differ significantly because of cache behaviour, RAID, thin provisioning and queueing. Use `LAT/rd` and `LAT/wr`, or the read/write-specific DAVG/KAVG/GAVG counters, when the combined average hides a one-sided problem.

The storage panels are different views of the same stack:

- **Disk VM** (`v`): what the guest virtual disk sees.
- **Disk Device** (`u`): LUN/device-level queue and latency.
- **Disk Adapter** (`d`): HBA-level queue and latency.
- **Disk Path** can be expanded for path-level counters.

Do not add latencies across layers. Compare them.

### Storage troubleshooting sequence

1. Confirm the symptom: guest application latency, queue time or throughput.
2. Look at `GAVG`. If it is normal, storage may not be the bottleneck.
3. Split `DAVG` and `KAVG`.
4. High `DAVG`: investigate the array, backend media, SAN, path state and read/write cache.
5. High `KAVG`: investigate VMkernel queuing, queue depth, CPU saturation and vSCSI path.
6. Check `QUED`, `ACTV`, `%USD` and `LOAD` at device, adapter and VM layers.
7. Check `ABRTS/s`, `RESETS/s`, `ATSF` and `DELETE_F` for timeout or VAAI failures.
8. Check whether backup, cloning, anti-virus or a single VM is driving the IOPS.
9. Confirm with array-side metrics, vmkernel.log and the guest before changing queue depth.

## 8. Network counters

| Counter | Meaning | Interpretation |
| --- | --- | --- |
| `PKTTX/s` / `PKTRX/s` | Packets per second. | Workload. |
| `MbTX/s` / `MbRX/s` | Megabits per second. | Compare with link speed and uplink teaming. |
| `%DRPTX` / `%DRPRX` | Dropped packet percentage. | Yellow Bricks flags >1%. Sustained >5% is critical. |
| `PSZTX` / `PSZRX` | Average packet size. | Context for packet rate vs throughput. |
| `SPEED` | Negotiated physical link speed. | Physical NIC only. |
| `UP` / `FDUPLX` | Link state and duplex. | Categorical. A down or half-duplex link needs physical investigation. |
| `ACTN/s` | VMkernel actions. | Internal counter; limited diagnostic value. |

Network performance is often CPU performance. Packet processing consumes host CPU; a saturated host can drop packets even when the physical switch reports no errors. Rule out CPU contention first, then check the switchport, NIC errors, ring buffers, teaming and traffic shaping.

## 9. vSAN and power

- `SDLAT` (vSAN standard-deviation latency) measures latency variation. Yellow Bricks flags >5 ms. Use vSAN Observer or Skyline for disk-group, component, resync and network analysis.
- `Power Usage Now Watts` and `Power Usage Cap Watts` describe host power. Sustained operation at the cap can mean the host is power-limited; correlate with CPU frequency, BIOS power policy and host performance.

## 10. Practical threshold matrix

These are the guardrails used by the built-in rule engine. They are intentionally conservative and visible so they can be challenged.

| Area | Metric | Warning | Critical | Basis |
| --- | --- | --- | --- | --- |
| CPU | `%RDY` per vCPU | 5% | 10% | Broadcom normal <5%; Yellow Bricks 10% per world |
| CPU | `%MLMTD` | 0.1% | 5% | Any sustained non-zero means a limit is active |
| CPU | `%CSTP` | 3% | 5% | Yellow Bricks 3% |
| CPU | `%SWPWT` | 1% | 5% | Yellow Bricks 5%; any sustained wait is relevant |
| CPU | host core | 80% | 90% | Operational guardrail |
| CPU | load average 1 min | 1.0 | 2.0 | Broadcom VM performance article |
| Memory | `MCTLSZ` | 1 MB | 1 GB | Yellow Bricks 1 MB plus guardrail |
| Memory | `SWCUR` | 0.1 MB | 1 GB | Any current swap plus guardrail |
| Memory | swap I/O | 0.01 MB/s | 1 MB/s | Any sustained activity is a concern |
| Memory | `N%L` | <80% | <50% | Yellow Bricks 80% |
| Storage | `DAVG/cmd`, `GAVG/cmd` | 10 ms | 25 ms | Broadcom 10 ms; Yellow Bricks 25 ms |
| Storage | `KAVG/cmd` | 2 ms | 5 ms | Yellow Bricks 2 ms plus guardrail |
| Storage | `QUED` | 1 | 10 | Yellow Bricks 1 |
| Storage | `CONS/s` | 20/s | 50/s | Yellow Bricks 20/s plus guardrail |
| Storage | `ABRTS/s`, `RESETS/s` | any | 1/s | Any sustained abort/reset is abnormal |
| Storage | vSAN `SDLAT` | 5 ms | 10 ms | Yellow Bricks 5 ms plus guardrail |
| Network | `%DRPTX`, `%DRPRX` | 1% | 5% | Yellow Bricks 1% plus guardrail |

The engine uses P95 for sustained conditions and the maximum for hard error counters. It groups equivalent counters (for example `PCPU %`, `% Util Time` and `% Core Util Time`) into one host CPU finding so a single saturated core does not create three duplicate alerts.

## 11. Worked playbooks

### A VM is slow, host CPU looks busy

1. Identify the VM group and expand its vCPU worlds.
2. Read `%RDY` per vCPU, not just the group.
3. Check `%MLMTD`. If non-zero, the VM or pool limit is involved.
4. Check `%CSTP` for an SMP workload.
5. Check host per-core utilisation and load average.
6. Check `%SWPWT`, `%VMWAIT`, `%SYS` and storage/network latency.
7. Compare the timing of the guest symptom with the capture timeline. Correlation is not causation, but a mismatch is a clue.

### The host is out of memory

1. Start with host `FREE_MB`, `Memory Overcommit`, `MCTLSZ`, `SWAP_USED_MB`, `SWAP_READ`, `SWAP_WRITE`.
2. Find the VMs with `MCTLSZ`, `SWCUR`, `SWR/s`, `SWW/s` and `N%L`.
3. Check whether a VM or resource-pool memory limit is causing artificial reclaim.
4. Check whether the guest is actively using its configured memory (`TCHD`, `%ACTV`, `GRANT`).
5. Distinguish ballooning from host swapping. Ballooning is preferred, but persistent ballooning still means pressure.
6. Do not simply add RAM without checking limits, reservations and growth trends.

### Storage latency is high

1. Confirm that `GAVG` is high and sustained.
2. Split `DAVG` and `KAVG`.
3. Check `QUED`, `%USD`, `LOAD`, `ACTV` and queue depths at each layer.
4. Check aborts, resets and failed ATS/UNMAP.
5. Compare read and write latency.
6. Check whether one VM is generating the IOPS.
7. Escalate to the array with timestamps, LUNs, HBA paths and matching array metrics.

### Packet drops are reported

1. Check host CPU readiness and load.
2. Compare `MbTX/s` and `MbRX/s` with link speed.
3. Check the physical switchport for drops/errors and teaming state.
4. Check `%DRPTX` / `%DRPRX` at the port and per VM.
5. Validate with `pktcap-uw` if the source remains unclear.
6. Do not change offloads or ring buffers without a rollback plan.

## 12. Reading the analysis without over-trusting it

The application reports what the capture contains. If a field was not captured, the corresponding risk cannot be evaluated. A clean report means no curated guardrail was crossed; it does not prove that the host is healthy.

Specific limits:

- Guardrails are not universal. An array vendor may define a normal latency that is higher or lower than 10 ms.
- A P95 over a short capture is not a capacity forecast.
- The capture does not know guest application behaviour, business criticality, HA state, snapshots, backup windows or change history.
- The parser maps known counter names and instance formats. A vendor-specific or future esxtop release may use a new layout; inspect the raw metric if a field looks unmapped.
- Gzip input, CSV structure and timestamps are validated, but the application does not execute commands or contact the ESXi host.
- The parser still has configurable memory and time guardrails. A capture larger than the configured cell/column/row budget is rejected with an explicit `413` rather than risking an OOM kill. Raise the limits when the host has enough memory and temporary disk.

## 13. Primary references

- [Using the esxtop Utility — vSphere 8.0](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance/performance-monitoring-utilities-resxtop-and-esxtop/using-the-esxtop-utility.html)
- [Using Batch Mode — vSphere 8.0](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance/performance-monitoring-utilities-resxtop-and-esxtop/using-batch-mode.html)
- [Collecting esxtop batch data for ESXi performance troubleshooting — Broadcom 370279](https://knowledge.broadcom.com/external/article/370279/collecting-esxtop-batch-data-for-esxi-pe.html)
- [Exporting esxtop performance data as a CSV file — Broadcom 326309](https://knowledge.broadcom.com/external/article/326309/exporting-esxtop-performance-data-as-a-c.html)
- [Using ESXTop and Interpreting ESXTop Statistics — Broadcom 382249](https://knowledge.broadcom.com/external/article/382249/using-esxtop-and-interpreting-esxtop-sta.html)
- [Using esxtop to identify storage performance issues for ESXi — Broadcom 344099](https://knowledge.broadcom.com/external/article/344099)
- [Troubleshooting ESX/ESXi virtual machine performance issues — Broadcom 304594](https://knowledge.broadcom.com/external/article?legacyId=2001003)
- [Impact of virtual machine memory and CPU resource limits — Broadcom 326270](https://knowledge.broadcom.com/external/article/326270/impact-of-virtual-machine-memory-and-cpu.html)
- [vSphere Monitoring and Performance — vSphere 8.0](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance.html)
- [ESXTOP metric thresholds — Yellow Bricks](https://www.yellow-bricks.com/esxtop/)

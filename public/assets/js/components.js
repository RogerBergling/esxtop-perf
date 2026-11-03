/* Small dependency-free UI helpers. */

export const PALETTE = [
  '#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185',
  '#2dd4bf', '#f472b6', '#fb923c', '#93c5fd', '#c4b5fd',
];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESC[char]);

export const statusRank = (status) => ({
  critical: 4,
  warn: 3,
  info: 2,
  ok: 1,
  neutral: 0,
}[status] ?? 0);

export function worstStatus(statuses) {
  return statuses.reduce((worst, status) => (statusRank(status) > statusRank(worst) ? status : worst), 'neutral');
}

export function statusLabel(status) {
  return ({
    critical: 'Critical',
    warn: 'Warning',
    warning: 'Warning',
    info: 'Info',
    ok: 'Healthy',
    neutral: 'No rule',
  })[status] || 'No rule';
}

export function badge(status, text) {
  const tone = status === 'warning' ? 'warn' : status;
  return `<span class="badge ${esc(tone)}"><span class="badge-dot"></span>${esc(text || statusLabel(status))}</span>`;
}

export function pill(text, tone = '') {
  return `<span class="pill ${esc(tone)}">${esc(text)}</span>`;
}

export function categoryLabel(category) {
  return ({
    cpu: 'CPU',
    memory: 'Memory',
    storage: 'Storage',
    network: 'Network',
    power: 'Power',
    other: 'Other',
  })[category] || category;
}

export function categoryTone(category) {
  return ({
    cpu: 'accent',
    memory: 'violet',
    storage: 'warn',
    network: 'ok',
    power: 'orange',
  })[category] || '';
}

export function icon(name, size = 18) {
  const paths = {
    gauge: '<path d="M12 13l4-4"/><path d="M3.8 17a9 9 0 1 1 16.4 0"/><circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none"/>',
    memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4M10 10v4M14 10v4M17 10v4M6 20v-3M10 20v-3M14 20v-3M18 20v-3"/>',
    disk: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    network: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 12h3c3 0 3-6 7-6M7 12h3c3 0 3 6 7 6"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01M11 7h5M11 17h5"/>',
    insights: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 0 4 23V5.5Z"/><path d="M4 5.5V21"/>',
    alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    filter: '<path d="M3 5h18M7 12h10M10 19h4"/>',
    file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    play: '<path d="m8 5 11 7-11 7V5Z"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
}

export function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const number = Number(value);
  const abs = Math.abs(number);
  let maximumFractionDigits = digits;
  if (abs >= 1000) maximumFractionDigits = 0;
  else if (abs >= 100) maximumFractionDigits = 1;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits, minimumFractionDigits: 0 }).format(number);
}

export function formatMetric(value, unit = '', digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const number = Number(value);
  if (unit === '%') return `${formatNumber(number, 1)}%`;
  if (unit === 'MB' && Math.abs(number) >= 1024) return `${formatNumber(number / 1024, 2)} GB`;
  if (unit === 'MB/s') return `${formatNumber(number, 2)} MB/s`;
  if (unit === 'Mbps') return `${formatNumber(number, 1)} Mbps`;
  if (unit === 'ms') return `${formatNumber(number, 2)} ms`;
  if (unit === 'W') return `${formatNumber(number, 0)} W`;
  if (unit === '/s') return `${formatNumber(number, 1)}/s`;
  if (unit === 'bytes') return `${formatNumber(number, 0)} B`;
  if (unit === 'MHz') return `${formatNumber(number, 0)} MHz`;
  return `${formatNumber(number, digits)}${unit ? ` ${unit}` : ''}`;
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.max(0, Math.round(Number(seconds)));
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (rest) return `${minutes}m ${rest}s`;
  return `${minutes}m`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return '—';
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function seriesNumbers(series) {
  return (series?.values || []).filter((value) => typeof value === 'number' && Number.isFinite(value));
}

export function seriesByMetric(document, metricId) {
  return (document?.series || []).filter((series) => series.metric === metricId);
}

export function metricById(document, metricId) {
  return document?.metrics?.[metricId] || null;
}

export function referencesFor(document, metricId) {
  return metricById(document, metricId)?.references || [];
}

export function latestNumeric(series) {
  if (!series) return null;
  for (let index = series.values.length - 1; index >= 0; index -= 1) {
    if (typeof series.values[index] === 'number') return series.values[index];
  }
  return null;
}

export function statusFromSeries(series) {
  if (!series || !series.length) return 'neutral';
  return worstStatus(series.map((item) => item.status));
}

export function escapeAttr(value) {
  return esc(value).replaceAll('`', '&#96;');
}

export function chooseSeries(document, metricId, limit = 8, sortBy = 'p95') {
  const candidates = seriesByMetric(document, metricId)
    .filter((series) => series.kind === 'numeric' && series.stats?.count)
    .sort((left, right) => (Number(right.stats?.[sortBy]) || 0) - (Number(left.stats?.[sortBy]) || 0));
  return candidates.slice(0, limit);
}

export function categorySeries(document, category) {
  return (document?.series || []).filter((series) => series.category === category);
}

export function statusCounts(document) {
  const counts = { ok: 0, warn: 0, critical: 0, neutral: 0 };
  for (const series of document.series || []) counts[series.status || 'neutral'] += 1;
  return counts;
}

export function activeFindings(document, severity = null) {
  return (document?.findings || []).filter((finding) => !severity || finding.severity === severity);
}

export function vmSeries(document, vmName) {
  return (document?.series || []).filter((series) => series.vm === vmName || series.entity === vmName);
}

export function vmSummary(document, name) {
  const list = vmSeries(document, name);
  const numeric = list.filter((series) => series.kind === 'numeric');
  const pick = (metric, field = 'p95', mode = 'max') => {
    const candidates = numeric.filter((series) => series.metric === metric && series.stats?.count);
    if (!candidates.length) return null;
    return candidates.sort((left, right) => (
      mode === 'min'
        ? (Number(left.stats?.[field]) || Infinity) - (Number(right.stats?.[field]) || Infinity)
        : (Number(right.stats?.[field]) || -Infinity) - (Number(left.stats?.[field]) || -Infinity)
    ))[0];
  };
  const groupCpu = pick('%USED');
  const vcpuUsed = pick('%USED', 'p95', 'max');
  const ready = pick('%RDY');
  const mlmtd = pick('%MLMTD');
  const cstop = pick('%CSTP');
  const cpuSys = pick('%SYS');
  const cpuWait = pick('%WAIT');
  const swapWait = pick('%SWPWT');
  const balloon = pick('MCTLSZ');
  const swap = pick('SWCUR');
  const swapIn = pick('SWR/s');
  const swapOut = pick('SWW/s');
  const numa = pick('N%L', 'p05', 'min');
  const active = pick('%ACTV');
  const disk = pick('GAVG/cmd');
  const davg = pick('DAVG/cmd');
  const kavg = pick('KAVG/cmd');
  const qavg = pick('QAVG/cmd');
  const qued = pick('QUED');
  const activeCommands = pick('ACTV');
  const iops = pick('CMDS/s');
  const reads = pick('READS/s');
  const writes = pick('WRITES/s');
  const mbRead = pick('MBREAD/s');
  const mbWrite = pick('MBWRTN/s');
  const readLatency = pick('LAT/rd');
  const writeLatency = pick('LAT/wr');
  const aborts = pick('ABRTS/s');
  const resets = pick('RESETS/s');
  const drop = pick('%DRPTX', 'p95', 'max') || pick('%DRPRX');
  const txDrop = pick('%DRPTX');
  const rxDrop = pick('%DRPRX');
  const mbTx = pick('MbTX/s');
  const mbRx = pick('MbRX/s');
  const configured = pick('MEMSZ', 'last');
  const granted = pick('GRANT', 'last');
  const consumed = pick('CNSM', 'last');
  const members = pick('Members', 'last');
  const vcpuSeries = list.filter((series) => series.group?.toLowerCase().startsWith('vcpu') && series.metric === '%USED');
  const worlds = new Set(vcpuSeries.map((series) => series.world || series.instance));
  const diskSeries = list.filter((series) => series.group?.toLowerCase().startsWith('virtual disk'));
  const vdisks = new Set(diskSeries.map((series) => series.instance || series.entity)).size;
  const status = worstStatus(list.map((series) => series.status));
  const findings = (document.findings || []).filter((finding) => finding.entity === name);
  return {
    name, list, numeric, status, findings,
    cpuUsed: groupCpu || vcpuUsed,
    ready, mlmtd, cstop, cpuSys, cpuWait, swapWait,
    balloon, swap, swapIn, swapOut, numa, active,
    disk, davg, kavg, qavg, qued, activeCommands, iops, reads, writes, mbRead, mbWrite,
    readLatency, writeLatency, aborts, resets, drop, txDrop, rxDrop, mbTx, mbRx,
    configuredMemory: configured?.stats?.last ?? null,
    grantedMemory: granted?.stats?.last ?? null,
    consumedMemory: consumed?.stats?.last ?? null,
    vcpus: worlds.size || (members?.stats?.last ?? null),
    vdisks,
    seriesCount: list.length,
  };
}

export function vmFindings(document, vmName) {
  return (document?.findings || []).filter((finding) => finding.entity === vmName);
}

export function worstSeriesForMetric(seriesList) {
  return seriesList
    .filter((series) => series.kind === 'numeric' && series.stats?.count)
    .sort((left, right) => (Number(right.stats?.p95) || -Infinity) - (Number(left.stats?.p95) || -Infinity))[0] || null;
}

export function safeJsonDownload(document) {
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `esxtop-analysis-${document?.meta?.host || 'capture'}.json`.replace(/[^\w.-]+/g, '-');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvDownload(filename, rows) {
  const content = rows.map((row) => row.map((cell) => {
    const value = String(cell ?? '');
    return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timeLabel(document, index) {
  return document?.time?.labels?.[index] || `#${index + 1}`;
}

export function metricRoute(metricId) {
  return `#/metric/${encodeURIComponent(metricId)}`;
}

export function seriesRoute(seriesId) {
  return `#/series/${encodeURIComponent(seriesId)}`;
}

export function vmRoute(vmName) {
  return `#/vm/${encodeURIComponent(vmName)}`;
}

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

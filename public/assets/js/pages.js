/* Page renderers for ESXtop Lens. Each page returns { html, mount }. */

import {
  badge,
  categoryLabel,
  csvDownload,
  escapeAttr,
  formatDuration,
  formatMetric,
  formatNumber,
  icon,
  metricById,
  metricRoute,
  pill,
  safeJsonDownload,
  seriesByMetric,
  seriesRoute,
  statusRank,
  vmRoute,
  vmSeries,
  vmSummary,
  worstStatus,
  esc,
} from './components.js';
import { lineChart, sparklineSvg } from './charts.js';
import { render as renderMarkdown } from './markdown.js';
import {
  downloadReportHTML,
  openReportPrintWindow,
  reportBody,
  reportHostNames,
  reportStyles,
  reportVmNames,
} from './report.js';
import {
  relationshipsFor,
  technicalEntries,
  technicalFor,
} from './technical.js';

const CATEGORY_META = {
  cpu: {
    title: 'CPU',
    eyebrow: 'Scheduler and CPU',
    description: 'Host utilisation, vCPU ready time, co-stop and administrative limits. Ready time is read per vCPU; group totals can hide a starved vCPU.',
    icon: 'gauge',
  },
  memory: {
    title: 'Memory',
    eyebrow: 'Pressure and reclaim',
    description: 'Free memory, overcommit, ballooning, VMkernel swap, compression and NUMA locality. Swap-in is synchronous and deserves priority attention.',
    icon: 'memory',
  },
  storage: {
    title: 'Storage',
    eyebrow: 'Latency and queues',
    description: 'Separate guest, VMkernel and device latency. High GAVG is a symptom; DAVG and KAVG locate the layer, while QUED and LOAD describe queue pressure.',
    icon: 'disk',
  },
  network: {
    title: 'Network',
    eyebrow: 'Drops and throughput',
    description: 'Packet drops, throughput and port behaviour. Rule out host CPU contention before attributing a network symptom to the physical switch.',
    icon: 'network',
  },
  power: {
    title: 'Power',
    eyebrow: 'Consumption and caps',
    description: 'Observed power usage and configured power caps. A host pinned at its cap for sustained periods may be power-limited.',
    icon: 'server',
  },
  other: {
    title: 'Other signals',
    eyebrow: 'Unclassified counters',
    description: 'Counters that could not be mapped to a resource family. They remain searchable and chartable.',
    icon: 'grid',
  },
};

const STATUS_COLORS = {
  critical: '#f87171',
  warn: '#fbbf24',
  ok: '#34d399',
  neutral: '#93a3bb',
  info: '#38bdf8',
};

const STATUS_RING = {
  critical: '#f87171',
  warn: '#fbbf24',
  ok: '#34d399',
  neutral: '#6b7c96',
  info: '#38bdf8',
};

const COMMAND = [
  ['esxtop', 'The ESXi performance tool. It reads live VMkernel counters and normally runs with root privileges from the ESXi Shell.'],
  ['-b', 'Batch mode. Suppresses the interactive screen and writes PDH-CSV to stdout. The entity list is locked at the first snapshot, so newly created worlds do not appear.'],
  ['-a', 'Collect all available fields regardless of the saved esxtop configuration. This is the widest and largest capture.'],
  ['-d 2', 'Delay of 2 seconds between samples. Fine-grained enough for most latency investigations; 5 seconds is easier for long captures.'],
  ['-n 100', 'Approximately 100 iterations. Nominal wall time is n × delay; the first sample is usually immediate, so inspect the actual CSV timestamps.'],
  ['| gzip -9c', 'Compress stdout at maximum gzip level and write it to stdout. This saves datastore space but costs host CPU; the result is not a plain-text CSV.'],
  ['> /vmfs/volumes/...', 'Shell redirect to a datastore path. Ensure the datastore has free space and is not the datastore you are investigating.'],
];

function hostCpu(doc) {
  return seriesByMetric(doc, 'PCPU %').filter((series) => series.scope === 'host');
}

function worstBy(doc, metricIds, filter = () => true, field = 'p95') {
  const ids = Array.isArray(metricIds) ? metricIds : [metricIds];
  return (doc.series || [])
    .filter((series) => ids.includes(series.metric) && filter(series) && series.kind === 'numeric' && series.stats?.count)
    .sort((left, right) => (Number(right.stats?.[field]) || -Infinity) - (Number(left.stats?.[field]) || -Infinity))[0] || null;
}

function bestBy(doc, metricIds, filter = () => true, field = 'p05') {
  const ids = Array.isArray(metricIds) ? metricIds : [metricIds];
  return (doc.series || [])
    .filter((series) => ids.includes(series.metric) && filter(series) && series.kind === 'numeric' && series.stats?.count)
    .sort((left, right) => (Number(left.stats?.[field]) || Infinity) - (Number(right.stats?.[field]) || Infinity))[0] || null;
}

function seriesValue(series, field = 'p95') {
  return series?.stats?.[field] ?? null;
}

function statusTone(status) {
  if (status === 'warning') return 'warn';
  if (status === 'warn') return 'warn';
  return status || 'neutral';
}

function statusBadge(status) {
  return badge(statusTone(status));
}

function seriesShortLabel(series) {
  const group = String(series?.group || '').toLowerCase();
  if (series?.scope === 'vm' && series.vm) {
    if (group.startsWith('vcpu')) {
      const world = String(series.world || '').replace(/^vmx-/, '');
      return `${series.vm}${world ? ` · ${world}` : ''}`;
    }
    if (group.startsWith('virtual disk')) {
      const match = String(series.instance || '').match(/(:scsi\d+:\d+)$/);
      return `${series.vm}${match?.[1] || ''}`;
    }
    return series.vm;
  }
  if (group.startsWith('physical cpu')) return `CPU ${series.instance || ''}`.trim();
  if (group.startsWith('physical cpu load')) return 'Host load';
  return series.instance || series.entity || series.group || series.metric;
}

function metricName(doc, series) {
  return doc.metrics?.[series.metric]?.name || series.metricName || series.metric;
}

function chartSeries(doc, list, options = {}) {
  return list.map((series, index) => ({
    id: series.id,
    label: options.label ? options.label(series, index) : seriesShortLabel(series),
    values: series.values,
    unit: series.unit,
    color: STATUS_COLORS[series.status] && options.colorByStatus ? STATUS_COLORS[series.status] : undefined,
    area: options.area && list.length === 1,
  }));
}

function thresholdsFor(seriesList) {
  const thresholds = [];
  const seen = new Set();
  for (const series of seriesList) {
    const warn = series?.warnThreshold;
    const critical = series?.criticalThreshold;
    if (Number.isFinite(Number(warn))) {
      const key = `warn-${warn}`;
      if (!seen.has(key)) {
        seen.add(key);
        thresholds.push({ value: warn, label: `Warn ${formatMetric(warn, series.unit)}`, tone: 'warn' });
      }
    }
    if (Number.isFinite(Number(critical))) {
      const key = `critical-${critical}`;
      if (!seen.has(key)) {
        seen.add(key);
        thresholds.push({ value: critical, label: `Critical ${formatMetric(critical, series.unit)}`, tone: 'critical' });
      }
    }
  }
  return thresholds;
}

function chartSpec(id, title, description, list, doc, options = {}) {
  return { id, title, description, list, doc, options };
}

function chartCardsHtml(specs) {
  return `<div class="chart-grid">${specs.map((spec) => `
    <section class="chart-card">
      <div class="chart-card-head">
        <div>
          <h3>${esc(spec.title)}</h3>
          ${spec.description ? `<p>${esc(spec.description)}</p>` : ''}
        </div>
        ${spec.options.link ? `<a class="btn btn-sm btn-ghost" href="${escapeAttr(spec.options.link)}">${esc(spec.options.linkText || 'Inspect')} ${icon('arrow', 13)}</a>` : ''}
      </div>
      <div id="${escapeAttr(spec.id)}" class="chart-host"></div>
      ${spec.options.note ? `<p class="chart-note">${esc(spec.options.note)}</p>` : ''}
    </section>
  `).join('')}</div>`;
}

function specSeriesIds(specs) {
  return specs.flatMap((spec) => (spec.list || []).map((series) => series.id)).filter(Boolean);
}

async function loadSeriesForPage(ctx, specs, extraIds = []) {
  if (!ctx.ensureSeries) return;
  const ids = [...specSeriesIds(specs), ...extraIds.filter(Boolean)];
  if (ids.length) await ctx.ensureSeries(ids);
}

function mountCharts(root, specs) {
  for (const spec of specs) {
    const element = root.querySelector(`#${CSS.escape(spec.id)}`);
    if (!element) continue;
    lineChart(element, {
      series: chartSeries(spec.doc, spec.list, {
        colorByStatus: spec.options.colorByStatus,
        area: spec.options.area,
        label: spec.options.label,
      }),
      time: spec.doc.time,
      yUnit: spec.options.yUnit || spec.list[0]?.unit || '',
      thresholds: spec.options.thresholds ?? thresholdsFor(spec.list),
      height: spec.options.height || 300,
      includeZero: spec.options.includeZero !== false,
      ariaLabel: `${spec.title} chart`,
      emptyText: spec.options.emptyText || 'No numeric samples for this signal.',
    });
  }
}

function kpiCard({ label, value, sub, series, status = 'neutral', href, iconName = 'gauge', sparkId }) {
  const tone = statusTone(status);
  const linkOpen = href ? `<a class="kpi kpi-${escapeAttr(tone)}" href="${escapeAttr(href)}">` : `<div class="kpi kpi-${escapeAttr(tone)}">`;
  const linkClose = href ? '</a>' : '</div>';
  const spark = series ? sparklineSvg(series, { id: sparkId || series.id, color: STATUS_COLORS[tone] || STATUS_COLORS.neutral }) : '';
  return `${linkOpen}
    <div class="kpi-label">${icon(iconName, 14)} ${esc(label)}</div>
    <span class="kpi-status">${badge(statusTone(status))}</span>
    <div class="kpi-value">${value}${sub ? ` <small>${esc(sub)}</small>` : ''}</div>
    ${spark ? `<div class="kpi-spark">${spark}</div>` : ''}
  ${linkClose}`;
}

function summaryHero(doc) {
  const summary = doc.summary || {};
  const status = summary.status || 'neutral';
  const score = summary.score;
  const ring = STATUS_RING[status] || STATUS_RING.neutral;
  return `
    <section class="summary-hero">
      <div>
        <div class="summary-status-row">
          ${statusBadge(status)}
          ${pill(`${doc.meta.sampleCount} samples`, 'accent')}
          ${pill(`${doc.meta.columns.toLocaleString()} signals`)}
          ${doc.meta.compressed ? pill('gzip input', 'violet') : ''}
        </div>
        <h1>${esc(doc.meta.host || 'ESXi host')} <span class="dim">· capture review</span></h1>
        <p class="lede">${esc(summary.headline || 'Capture loaded.')} ${summary.warning ? `Use the ${esc(summary.warning)} warning${summary.warning === 1 ? '' : 's'} as a triage queue, not as an automatic root cause.` : 'Start with the criticals, then confirm each signal against the raw counter and the Broadcom guidance.'}</p>
        <div class="summary-counts">
          <span class="summary-count"><strong>${summary.critical || 0}</strong> critical</span>
          <span class="summary-count"><strong>${summary.warning || 0}</strong> warning</span>
          <span class="summary-count"><strong>${summary.info || 0}</strong> info</span>
          <span class="summary-count"><strong>${summary.counts?.ok || 0}</strong> within guardrail</span>
          <span class="summary-count"><strong>${summary.counts?.neutral || 0}</strong> unruled</span>
        </div>
        <div class="status-key" aria-label="Colour legend">
          <span><i class="dot ok"></i> green: inside guardrail</span>
          <span><i class="dot warn"></i> yellow: review</span>
          <span><i class="dot critical"></i> red: act</span>
        </div>
        <div class="summary-actions">
          <a class="btn btn-primary" href="#/insights">${icon('insights', 15)} Review findings</a>
          <a class="btn" href="#/metrics">${icon('table', 15)} Browse all metrics</a>
          <button class="btn btn-ghost" type="button" data-download-json>${icon('download', 15)} Export JSON</button>
          <a class="btn btn-ghost" href="#/report">${icon('file', 15)} Report</a>
        </div>
      </div>
      <div class="score-wrap">
        <div class="score-ring" style="--score:${Number(score) || 0};--ring:${ring}"><strong>${score === null || score === undefined ? '—' : `${score}%`}</strong></div>
        <div>
          <div class="score-label">Signal score</div>
          <p class="score-caption">${esc(summary.scoreBasis || 'Share of rule-evaluated signals currently inside their guardrail.')}</p>
        </div>
      </div>
    </section>`;
}

function captureTabs(doc, active = 'overview') {
  const counts = doc.summary?.categories || {};
  const tabs = [
    ['overview', 'Overview', 'grid'],
    ['cpu', 'CPU', 'gauge'],
    ['memory', 'Memory', 'memory'],
    ['storage', 'Storage', 'disk'],
    ['network', 'Network', 'network'],
    ['vms', 'Virtual machines', 'server'],
    ['insights', 'Insights', 'insights'],
    ['report', 'Report', 'file'],
    ['metrics', 'All metrics', 'table'],
  ];
  return `<div class="category-tabs">
    ${tabs.map(([route, label, iconName]) => {
      const count = counts[route]?.series;
      const activeClass = route === active ? ' active' : '';
      return `<a class="category-tab${activeClass}" href="#/${route}">${icon(iconName, 14)} ${esc(label)}${count ? `<span class="tab-count">${count}</span>` : ''}</a>`;
    }).join('')}
  </div>`;
}

export function captureLine(doc) {
  return `<div class="capture-inner">
    <div class="capture-host">
      ${badge(doc.summary?.status || 'neutral')}
      <strong>${esc(doc.meta.host || 'ESXi host')}</strong>
      <span class="capture-file" title="${escapeAttr(doc.meta.filename)}">${esc(doc.meta.filename)}</span>
    </div>
    <div class="capture-facts">
      <span class="capture-fact"><strong>${doc.meta.sampleCount}</strong> samples</span>
      <span class="capture-fact"><strong>${doc.meta.intervalSeconds ? `${formatNumber(doc.meta.intervalSeconds, 1)}s` : '—'}</strong> interval</span>
      <span class="capture-fact"><strong>${formatDuration(doc.meta.durationSeconds)}</strong> window</span>
      <span class="capture-fact"><strong>${doc.meta.columns.toLocaleString()}</strong> signals</span>
      ${doc.meta.vmCount ? `<span class="capture-fact"><strong>${doc.meta.vmCount}</strong> VMs</span>` : ''}
    </div>
    <div class="capture-actions">
      <span class="capture-note">${esc(doc.meta.captureStart || '')} → ${esc(doc.meta.captureEnd || '')}</span>
    </div>
  </div>`;
}

function findingEvidence(finding) {
  const observed = formatMetric(finding.observed, finding.unit);
  const threshold = formatMetric(finding.threshold, finding.unit);
  const stat = String(finding.statistic || 'p95').toUpperCase();
  return `${stat} <b>${esc(observed)}</b> vs guardrail ${esc(threshold)}`;
}

function findingCard(finding, options = {}) {
  const tone = finding.severity === 'warning' ? 'warn' : finding.severity;
  const references = options.compact ? [] : (finding.references || []);
  const seriesHref = finding.worstSeries ? seriesRoute(finding.worstSeries) : '#/insights';
  const tech = technicalFor(finding.metric);
  return `<article class="finding ${escapeAttr(tone)}" data-severity="${escapeAttr(finding.severity)}" data-category="${escapeAttr(finding.category)}">
    <div class="finding-head">
      <div>
        <div class="finding-title">
          ${badge(finding.severity === 'warning' ? 'warn' : finding.severity)}
          <h3>${esc(finding.title)}</h3>
        </div>
        <div class="finding-meta">
          <span class="entity">${esc(finding.entity || finding.scope || 'Host')}</span>
          <span class="meta-sep">/</span>
          ${pill(categoryLabel(finding.category), categoryToneClass(finding.category))}
          <span class="capture-fact mono">${esc(finding.metric)}</span>
          ${finding.affectedSeries > 1 ? `<span class="dim">${finding.affectedSeries} signals</span>` : ''}
        </div>
      </div>
      <span class="evidence">${findingEvidence(finding)}</span>
    </div>
    <p>${esc(finding.summary || '')}</p>
    ${tech ? `<p class="finding-technical"><strong>${esc(finding.metric)} — ${esc(tech.name)}:</strong> ${tech.what}</p>` : ''}
    ${options.compact ? '' : `<div class="recommendation"><strong>What to check:</strong> ${esc(finding.recommendation || '')}</div>`}
    <div class="finding-actions">
      <a class="btn btn-sm" href="${escapeAttr(seriesHref)}">${icon('arrow', 13)} Inspect signal</a>
      <a class="btn btn-sm btn-ghost" href="#/${escapeAttr(finding.category)}">Open ${esc(categoryLabel(finding.category))}</a>
      ${options.compact ? '' : `<span class="dim" style="font-size:.68rem">${escapeHtmlSafe(finding.instances?.slice(0, 3).join(' · ') || '')}</span>`}
    </div>
    ${references.length && !options.compact ? `<div class="refs">${references.map((reference) => `<a href="${escapeAttr(reference.url)}" target="_blank" rel="noreferrer">${icon('external', 12)} ${esc(reference.title)}</a>`).join('')}</div>` : ''}
  </article>`;
}

function categoryToneClass(category) {
  return ({ cpu: 'accent', memory: 'violet', storage: 'warn', network: 'ok', power: 'orange' })[category] || '';
}

function escapeHtmlSafe(value) {
  return esc(value);
}

function emptyState(title, detail) {
  return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(detail || '')}</div>`;
}

function vmTable(doc, limit = 200) {
  const summaries = (doc.vms || []).map((name) => vmSummary(doc, name))
    .sort((left, right) => statusRank(right.status) - statusRank(left.status) || (Number(right.ready?.stats?.p95) || 0) - (Number(left.ready?.stats?.p95) || 0));
  if (!summaries.length) return emptyState('No VM groups found', 'Capture with the CPU, memory and disk panels enabled, or use -a.');
  const rows = summaries.slice(0, limit).map((vm) => `
    <tr>
      <td class="name"><a href="${escapeAttr(vmRoute(vm.name))}">${esc(vm.name)}</a><span class="sub">${vm.findings.length ? `${vm.findings.length} finding${vm.findings.length === 1 ? '' : 's'}` : 'no findings'}</span></td>
      <td class="num">${vm.vcpus ?? '—'}</td>
      <td class="num">${vm.configuredMemory !== null ? formatMetric(vm.configuredMemory, 'MB') : '—'}</td>
      <td class="num">${formatMetric(vm.cpuUsed?.stats?.p95, '%')}</td>
      <td class="num ${vm.ready?.status === 'critical' ? 'status-text-critical' : vm.ready?.status === 'warn' ? 'status-text-warn' : ''}">${formatMetric(vm.ready?.stats?.p95, '%')}</td>
      <td class="num">${formatMetric(vm.mlmtd?.stats?.p95, '%')}</td>
      <td class="num">${formatMetric(vm.cstop?.stats?.p95, '%')}</td>
      <td class="num">${formatMetric(vm.balloon?.stats?.p95, 'MB')}</td>
      <td class="num">${formatMetric(vm.swap?.stats?.p95, 'MB')}</td>
      <td class="num">${formatMetric(vm.disk?.stats?.p95, 'ms')}</td>
      <td>${statusBadge(vm.status)}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Virtual machine</th><th class="num">vCPU</th><th class="num">Memory</th><th class="num">CPU used</th><th class="num">%RDY</th><th class="num">%MLMTD</th><th class="num">%CSTP</th><th class="num">Balloon</th><th class="num">Swap</th><th class="num">GAVG</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${summaries.length > limit ? `<p class="chart-note">Showing ${limit} of ${summaries.length} VMs. Use All metrics or filter by VM to narrow the view.</p>` : ''}`;
}

function hostCpuRows(doc) {
  const candidates = ['PCPU %', 'PCPU_UTIL', 'CORE_UTIL']
    .map((metric) => ({ metric, series: seriesByMetric(doc, metric).filter((series) => series.scope === 'host') }))
    .find((item) => item.series.length);
  if (!candidates) return [];
  const groups = new Map();
  for (const series of candidates.series) {
    const key = series.instance || series.entity;
    const current = groups.get(key);
    if (!current || statusRank(series.status) > statusRank(current.status)) groups.set(key, series);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.instance === '_Total') return -1;
    if (right.instance === '_Total') return 1;
    return String(left.instance).localeCompare(String(right.instance), undefined, { numeric: true });
  });
}

function hostCpuTable(doc) {
  const rows = hostCpuRows(doc);
  if (!rows.length) return emptyState('No host CPU counters found', 'The capture does not contain Physical Cpu counters.');
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Physical CPU</th><th class="num">Avg</th><th class="num">P95</th><th class="num">Peak</th><th class="num">Samples</th><th>Status</th></tr></thead>
    <tbody>${rows.map((series) => `<tr>
      <td class="name"><a href="${escapeAttr(seriesRoute(series.id))}">${esc(series.instance || series.entity)}</a><span class="sub">${esc(series.counter)}</span></td>
      <td class="num">${formatMetric(series.stats?.avg, series.unit)}</td>
      <td class="num">${formatMetric(series.stats?.p95, series.unit)}</td>
      <td class="num">${formatMetric(series.stats?.max, series.unit)}</td>
      <td class="num">${series.stats?.count ?? 0}</td>
      <td>${statusBadge(series.status)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function vmVcpuTable(doc, vmName) {
  const list = vmSeries(doc, vmName).filter((series) => series.group?.toLowerCase().startsWith('vcpu'));
  if (!list.length) return emptyState('No per-vCPU counters found', 'Group-level CPU counters can hide one starved vCPU. Capture Vcpu metrics for per-world detail.');
  const worlds = new Map();
  for (const series of list) {
    const key = series.world || series.instance;
    let row = worlds.get(key);
    if (!row) {
      row = { key, series: {} };
      worlds.set(key, row);
    }
    row.series[series.metric] = series;
  }
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>vCPU world</th><th class="num">%USED</th><th class="num">%RDY</th><th class="num">%MLMTD</th><th class="num">%CSTP</th><th class="num">%SWPWT</th><th>Status</th></tr></thead>
    <tbody>${[...worlds.values()].map((row) => {
      const used = row.series['%USED'];
      const ready = row.series['%RDY'];
      const mlmtd = row.series['%MLMTD'];
      const cstop = row.series['%CSTP'];
      const swapwait = row.series['%SWPWT'];
      const status = worstStatus(Object.values(row.series).map((series) => series.status));
      return `<tr>
        <td class="name">${esc(row.key || 'vCPU')}</td>
        <td class="num">${formatMetric(used?.stats?.p95, '%')}</td>
        <td class="num">${formatMetric(ready?.stats?.p95, '%')}</td>
        <td class="num">${formatMetric(mlmtd?.stats?.p95, '%')}</td>
        <td class="num">${formatMetric(cstop?.stats?.p95, '%')}</td>
        <td class="num">${formatMetric(swapwait?.stats?.p95, '%')}</td>
        <td>${statusBadge(status)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function hostMemoryTable(doc) {
  const wanted = ['MACHINE_MB', 'FREE_MB', 'OVERCOMMIT1', 'SWAP_USED_MB', 'SWAP_READ', 'SWAP_WRITE', 'MEMCTL_CURRENT_MB', 'COMPRESSED_MB'];
  const rows = wanted.map((metric) => worstBy(doc, metric, (series) => series.scope === 'host')).filter(Boolean);
  if (!rows.length) return emptyState('No host memory counters found', 'The capture does not contain the host Memory panel.');
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Host signal</th><th class="num">Last</th><th class="num">P95</th><th class="num">Status</th></tr></thead>
    <tbody>${rows.map((series) => `<tr>
      <td class="name"><a href="${escapeAttr(seriesRoute(series.id))}">${esc(metricName(doc, series))}</a><span class="sub">${esc(series.counter)}</span></td>
      <td class="num">${formatMetric(series.stats?.last, series.unit)}</td>
      <td class="num">${formatMetric(series.stats?.p95, series.unit)}</td>
      <td>${statusBadge(series.status)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function storageRows(doc) {
  const map = new Map();
  for (const series of doc.series.filter((item) => item.category === 'storage' && item.kind === 'numeric')) {
    const key = `${series.scope}|${series.group}|${series.entity}|${series.instance}`;
    let row = map.get(key);
    if (!row) {
      row = { key, series: {}, group: series.group, entity: series.entity, instance: series.instance, scope: series.scope };
      map.set(key, row);
    }
    if (!row.series[series.metric] || (Number(series.stats?.p95) || 0) > (Number(row.series[series.metric]?.stats?.p95) || 0)) {
      row.series[series.metric] = series;
    }
  }
  return [...map.values()].sort((left, right) => (
    (Number(right.series['GAVG/cmd']?.stats?.p95) || 0) - (Number(left.series['GAVG/cmd']?.stats?.p95) || 0)
  )).slice(0, 120);
}

function storageTable(doc) {
  const rows = storageRows(doc);
  if (!rows.length) return emptyState('No storage counters found', 'The capture does not contain disk adapter, device or virtual disk metrics.');
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Entity</th><th class="num">GAVG</th><th class="num">DAVG</th><th class="num">KAVG</th><th class="num">QUED</th><th class="num">CMDS/s</th><th>Status</th></tr></thead>
    <tbody>${rows.map((row) => {
      const gavg = row.series['GAVG/cmd'] || row.series['LAT/rd'];
      const davg = row.series['DAVG/cmd'];
      const kavg = row.series['KAVG/cmd'];
      const qued = row.series['QUED'];
      const commands = row.series['CMDS/s'];
      const status = worstStatus(Object.values(row.series).map((series) => series.status));
      const name = row.scope === 'vm' ? `${row.entity}${row.instance?.match(/(:scsi\d+:\d+)$/)?.[1] || ''}` : (row.instance || row.entity);
      return `<tr>
        <td class="name"><a href="${escapeAttr(seriesRoute(gavg?.id || commands?.id || Object.values(row.series)[0]?.id || ''))}">${esc(name)}</a><span class="sub">${esc(row.group)}</span></td>
        <td class="num">${formatMetric(gavg?.stats?.p95, gavg?.unit || 'ms')}</td>
        <td class="num">${formatMetric(davg?.stats?.p95, 'ms')}</td>
        <td class="num">${formatMetric(kavg?.stats?.p95, 'ms')}</td>
        <td class="num">${formatMetric(qued?.stats?.p95, '')}</td>
        <td class="num">${formatMetric(commands?.stats?.p95, '/s')}</td>
        <td>${statusBadge(status)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function networkRows(doc) {
  const map = new Map();
  for (const series of doc.series.filter((item) => item.category === 'network' && item.kind === 'numeric')) {
    const key = `${series.group}|${series.entity}|${series.instance}`;
    let row = map.get(key);
    if (!row) {
      row = { key, series: {}, group: series.group, entity: series.entity, instance: series.instance, scope: series.scope };
      map.set(key, row);
    }
    row.series[series.metric] = series;
  }
  return [...map.values()].sort((left, right) => (
    Math.max(Number(right.series['%DRPTX']?.stats?.p95) || 0, Number(right.series['%DRPRX']?.stats?.p95) || 0) -
    Math.max(Number(left.series['%DRPTX']?.stats?.p95) || 0, Number(left.series['%DRPRX']?.stats?.p95) || 0)
  )).slice(0, 120);
}

function networkTable(doc) {
  const rows = networkRows(doc);
  if (!rows.length) return emptyState('No network counters found', 'The capture does not contain Network Port metrics, or the port naming uses an unsupported format.');
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Port / VM</th><th class="num">TX drops</th><th class="num">RX drops</th><th class="num">TX</th><th class="num">RX</th><th>Status</th></tr></thead>
    <tbody>${rows.map((row) => {
      const tx = row.series['%DRPTX'];
      const rx = row.series['%DRPRX'];
      const mbTx = row.series['MbTX/s'];
      const mbRx = row.series['MbRX/s'];
      const status = worstStatus(Object.values(row.series).map((series) => series.status));
      const label = row.scope === 'vm' ? row.entity : (row.instance || row.entity);
      return `<tr>
        <td class="name"><a href="${escapeAttr(seriesRoute(tx?.id || rx?.id || mbTx?.id || Object.values(row.series)[0]?.id || ''))}">${esc(label)}</a><span class="sub">${esc(row.group)}${row.instance && row.scope === 'vm' ? ` · ${esc(row.instance)}` : ''}</span></td>
        <td class="num">${formatMetric(tx?.stats?.p95, '%')}</td>
        <td class="num">${formatMetric(rx?.stats?.p95, '%')}</td>
        <td class="num">${formatMetric(mbTx?.stats?.p95, 'Mbps')}</td>
        <td class="num">${formatMetric(mbRx?.stats?.p95, 'Mbps')}</td>
        <td>${statusBadge(status)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function topCpuSeries(doc, limit = 5) {
  let all = hostCpu(doc);
  if (!all.length) all = seriesByMetric(doc, 'PCPU_UTIL').filter((series) => series.scope === 'host');
  if (!all.length) all = seriesByMetric(doc, 'CORE_UTIL').filter((series) => series.scope === 'host');
  const total = all.find((series) => series.instance === '_Total');
  const rest = all.filter((series) => series !== total)
    .sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0));
  return [total, ...rest].filter(Boolean).slice(0, limit);
}

function perVmTopSeries(doc, metric, limit = 5) {
  const map = new Map();
  for (const series of seriesByMetric(doc, metric)) {
    if (!series.vm) continue;
    const current = map.get(series.vm);
    if (!current || (Number(series.stats?.p95) || 0) > (Number(current.stats?.p95) || 0)) map.set(series.vm, series);
  }
  return [...map.values()]
    .sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0))
    .slice(0, limit);
}

function reclaimSeries(doc, limit = 6) {
  const balloon = perVmTopSeries(doc, 'MCTLSZ', limit);
  const swap = perVmTopSeries(doc, 'SWCUR', limit);
  return [...balloon, ...swap]
    .filter((series) => (Number(series.stats?.p95) || 0) > 0)
    .sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0))
    .slice(0, limit);
}

function storageLatencySeries(doc, limit = 5) {
  return seriesByMetric(doc, 'GAVG/cmd')
    .filter((series) => series.kind === 'numeric' && series.stats?.count)
    .sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0))
    .slice(0, limit);
}

function networkDropSeries(doc, limit = 5) {
  return [...seriesByMetric(doc, '%DRPTX'), ...seriesByMetric(doc, '%DRPRX')]
    .filter((series) => series.kind === 'numeric' && (Number(series.stats?.p95) || 0) > 0)
    .sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0))
    .slice(0, limit);
}

function overviewKpiSeries(doc) {
  const cpu = topCpuSeries(doc, 1)[0] || null;
  const cpuPeak = worstBy(doc, ['PCPU %', 'PCPU_UTIL', 'CORE_UTIL'], (series) => series.scope === 'host');
  const free = worstBy(doc, 'FREE_MB', (series) => series.scope === 'host');
  const reclaim = worstBy(doc, ['MCTLSZ', 'SWCUR', 'SWAP_USED_MB', 'MEMCTL_CURRENT_MB'], (series) => (Number(series.stats?.p95) || 0) > 0);
  const ready = perVmTopSeries(doc, '%RDY', 1)[0] || null;
  const gavg = storageLatencySeries(doc, 1)[0] || null;
  const drops = networkDropSeries(doc, 1)[0] || null;
  return [cpuPeak || cpu, reclaim || free, ready, gavg, drops].filter(Boolean);
}

function overviewKpiCards(doc) {
  const cpu = topCpuSeries(doc, 1)[0] || null;
  const cpuPeak = worstBy(doc, ['PCPU %', 'PCPU_UTIL', 'CORE_UTIL'], (series) => series.scope === 'host');
  const free = worstBy(doc, 'FREE_MB', (series) => series.scope === 'host');
  const machine = worstBy(doc, 'MACHINE_MB', (series) => series.scope === 'host');
  const reclaim = worstBy(doc, ['MCTLSZ', 'SWCUR', 'SWAP_USED_MB', 'MEMCTL_CURRENT_MB'], (series) => (Number(series.stats?.p95) || 0) > 0);
  const ready = perVmTopSeries(doc, '%RDY', 1)[0] || null;
  const readyCount = new Set((doc.findings || []).filter((finding) => finding.ruleId === 'cpu.ready').map((finding) => finding.entity)).size;
  const gavg = storageLatencySeries(doc, 1)[0] || null;
  const qued = worstBy(doc, 'QUED');
  const drops = networkDropSeries(doc, 1)[0] || null;
  const freePct = free?.stats?.last && machine?.stats?.last ? (free.stats.last / machine.stats.last) * 100 : null;
  return [
    kpiCard({
      label: 'Host CPU', value: formatMetric(cpu?.stats?.p95, '%'), sub: cpuPeak && cpuPeak !== cpu ? `peak core ${formatMetric(cpuPeak.stats?.p95, '%')}` : 'P95 host signal',
      series: cpuPeak || cpu, status: doc.summary.categories?.cpu?.status || 'neutral', href: cpu ? seriesRoute(cpu.id) : '#/cpu', iconName: 'gauge', sparkId: 'kpi-cpu',
    }),
    kpiCard({
      label: reclaim ? 'Memory' : 'Free memory',
      value: formatMetric(reclaim?.stats?.p95, 'MB'),
      sub: reclaim ? `free ${formatMetric(free?.stats?.last, 'MB')}` : (freePct !== null ? `${formatNumber(freePct, 1)}% of machine` : 'host free memory'),
      series: reclaim || free, status: reclaim?.status || 'neutral',
      href: reclaim ? seriesRoute(reclaim.id) : (free ? seriesRoute(free.id) : '#/memory'),
      iconName: 'memory', sparkId: 'kpi-free',
    }),
    kpiCard({
      label: 'vCPU ready', value: formatMetric(ready?.stats?.p95, '%'), sub: `${readyCount} VM${readyCount === 1 ? '' : 's'} above guardrail`,
      series: ready, status: ready?.status || 'neutral', href: ready ? seriesRoute(ready.id) : '#/cpu', iconName: 'gauge', sparkId: 'kpi-ready',
    }),
    kpiCard({
      label: 'Storage', value: formatMetric(gavg?.stats?.p95, 'ms'), sub: qued ? `QUED ${formatMetric(qued.stats?.p95, '')}` : 'worst virtual disk/LUN',
      series: gavg, status: gavg?.status || doc.summary.categories?.storage?.status || 'neutral', href: gavg ? seriesRoute(gavg.id) : '#/storage', iconName: 'disk', sparkId: 'kpi-gavg',
    }),
    kpiCard({
      label: 'Network', value: formatMetric(drops?.stats?.p95, '%'), sub: drops ? seriesShortLabel(drops) : 'no drop signal',
      series: drops, status: drops?.status || doc.summary.categories?.network?.status || 'neutral', href: drops ? seriesRoute(drops.id) : '#/network', iconName: 'network', sparkId: 'kpi-drop',
    }),
    kpiCard({
      label: 'VMs', value: String(doc.meta.vmCount || 0), sub: `${doc.summary.critical || 0} critical findings`,
      series: null, status: doc.summary.status || 'neutral', href: '#/vms', iconName: 'server', sparkId: 'kpi-vms',
    }),
  ];
}

function overviewCharts(doc) {
  const specs = [];
  const cpuList = topCpuSeries(doc, 5);
  if (cpuList.length) {
    specs.push(chartSpec('chart-overview-cpu', 'Host CPU utilisation', 'Total and busiest physical cores. Averages hide single-core saturation.', cpuList, doc, {
      link: '#/cpu', linkText: 'CPU drilldown', yUnit: '%',
    }));
  }
  const ready = perVmTopSeries(doc, '%RDY', 5);
  if (ready.length) {
    specs.push(chartSpec('chart-overview-ready', 'VM CPU ready', 'One worst vCPU per VM. Read this per vCPU, not only at VM group level.', ready, doc, {
      link: '#/cpu', linkText: 'Ready time', yUnit: '%', label: (series) => series.vm,
    }));
  }
  const reclaim = reclaimSeries(doc, 5);
  if (reclaim.length) {
    specs.push(chartSpec('chart-overview-reclaim', 'Memory reclaim', 'Ballooned memory and current VMkernel swap. Either value should not persist without a memory-pressure review.', reclaim, doc, {
      link: '#/memory', linkText: 'Memory drilldown', yUnit: 'MB',
      label: (series) => `${series.vm} · ${series.metric === 'MCTLSZ' ? 'balloon' : 'swap'}`,
    }));
  } else {
    const free = worstBy(doc, 'FREE_MB', (series) => series.scope === 'host');
    if (free) specs.push(chartSpec('chart-overview-free', 'Host free memory', 'No ballooning or swap was detected in this capture. Free memory alone is not a pressure metric.', [free], doc, {
      link: '#/memory', linkText: 'Memory drilldown', yUnit: 'MB',
    }));
  }
  const latency = storageLatencySeries(doc, 5);
  if (latency.length) {
    specs.push(chartSpec('chart-overview-storage', 'Guest storage latency', 'GAVG by virtual disk, device and adapter. Use the storage page to split DAVG and KAVG.', latency, doc, {
      link: '#/storage', linkText: 'Storage drilldown', yUnit: 'ms',
    }));
  }
  const drops = networkDropSeries(doc, 5);
  if (drops.length) {
    specs.push(chartSpec('chart-overview-network', 'Packet drops', 'Transmit and receive drop percentages across the busiest ports.', drops, doc, {
      link: '#/network', linkText: 'Network drilldown', yUnit: '%',
      label: (series) => `${series.entity || series.instance} · ${series.metric === '%DRPTX' ? 'TX' : 'RX'}`,
    }));
  }
  return specs;
}

export function renderImport(ctx) {
  const state = ctx.state;
  const doc = state.doc;
  const commandRows = COMMAND.map(([key, description]) => `<div class="cmd-line"><span class="cmd-key">${esc(key)}</span><span class="cmd-desc">${esc(description)}</span></div>`).join('');
  const monitorSeries = [19, 23, 18, 31, 28, 42, 36, 47, 38, 52, 44, 61, 49, 55, 46, 42, 58, 64, 57, 69, 63, 60, 71, 66, 74, 68, 72, 76, 70, 78];
  const chartPoints = monitorSeries.map((value, index) => `${(index * 340) / (monitorSeries.length - 1)},${110 - (value - 15) * 1.3}`).join(' L');
  const error = state.error ? `<div class="error-banner">${icon('alert', 16)}<div><strong>Capture not loaded.</strong><br>${esc(state.error)}</div></div>` : '';
  return {
    html: `
      <section class="hero">
        <div>
          <div class="eyebrow">Local esxtop analysis · no upload</div>
          <h1>Turn a raw esxtop dump into a <em>diagnosis.</em></h1>
          <p class="hero-lede">Import the gzip or CSV produced by <code>esxtop -b -a</code>, then drill through CPU, memory, storage, network and VM worlds with threshold findings, evidence and Broadcom references.</p>
          <div class="hero-actions">
            <button class="btn btn-primary" type="button" data-open-upload>${icon('upload', 16)} Open a capture</button>
            <button class="btn" type="button" data-load-demo>${icon('play', 15)} Load demo capture</button>
            <a class="btn btn-ghost" href="#/capture">${icon('play', 15)} Capture with -c</a>
            <a class="btn btn-ghost" href="#/guide">${icon('book', 15)} Read the field guide</a>
          </div>
          <div class="hero-trust">
            <span>${icon('shield', 14)} parsed on this server</span>
            <span>${icon('check', 14)} gzip detected by magic bytes</span>
            <span>${icon('check', 14)} CSV + .csv.gz + .gz</span>
          </div>
        </div>
        <div class="monitor-art" aria-hidden="true">
          <div class="monitor-head"><span>LIVE / esxi01</span><span class="dim">CPU · MEM · IO</span></div>
          <div class="monitor-body">
            <div class="monitor-kpis">
              <div class="monitor-kpi"><span>CPU</span><strong>64%</strong></div>
              <div class="monitor-kpi"><span>Ready</span><strong class="status-text-warn">7.4%</strong></div>
              <div class="monitor-kpi"><span>GAVG</span><strong class="status-text-critical">28ms</strong></div>
            </div>
            <div class="monitor-chart">
              <svg viewBox="0 0 340 120" role="presentation">
                <defs><linearGradient id="demoArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#38bdf8" stop-opacity=".28"/><stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/></linearGradient></defs>
                <path d="M0 110H340M0 78H340M0 46H340M0 14H340" stroke="rgba(148,163,184,.13)" stroke-width="1"/>
                <path d="M0 110 L${chartPoints} L340 110 Z" fill="url(#demoArea)"/>
                <path d="M${chartPoints}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M0 88C40 87 56 85 72 84S118 87 136 82 180 77 196 80 238 76 252 74 292 72 340 70" fill="none" stroke="#a78bfa" stroke-width="1.4" stroke-dasharray="4 4" opacity=".8"/>
              </svg>
            </div>
            <div class="monitor-foot"><span class="status-line"><i class="dot warn"></i> 3 signals to review</span><span>60 samples · 2s</span></div>
          </div>
        </div>
      </section>

      <section class="upload-grid" id="import">
        <div class="card">
          <div class="card-header"><div><div class="card-kicker">Step 1 / import</div><h2>Drop an esxtop capture</h2></div>${doc ? pill('Replace current capture', 'accent') : pill('local only', 'ok')}</div>
          <div class="dropzone" id="landing-dropzone" role="button" tabindex="0" aria-label="Choose an esxtop CSV or gzip capture">
            <div class="dz-icon">${icon('upload', 23)}</div>
            <strong>Drop the file here, or click to choose</strong>
            <p>Raw PDH-CSV or gzip-compressed capture. The extension does not matter; the content is sniffed.</p>
            <div class="file-types"><span>.csv</span><span>.csv.gz</span><span>.gz</span><span>PDH-CSV 4.0</span></div>
          </div>
          <input type="file" id="landing-file" hidden accept=".csv,.csv.gz,.gz,.txt,text/csv,application/gzip">
          <div class="upload-actions">
            <button class="btn btn-primary" type="button" data-open-upload>${icon('upload', 15)} Choose file</button>
            <button class="btn" type="button" data-load-demo>${icon('play', 14)} Use demo</button>
            ${doc ? '<a class="btn btn-ghost" href="#/">Back to current capture</a>' : ''}
          </div>
          ${error}
          <div class="upload-note">${icon('shield', 15)}<span>Your file is processed by the local Python server. Metadata is shown immediately; sample arrays are kept in a temporary local session for chart drilldown and removed after the session TTL or on restart. Nothing is sent to a third party.</span></div>
        </div>

        <div class="card command-card">
          <div class="card-header"><div><div class="card-kicker">Step 0 / capture</div><h2>The exact command</h2></div>${pill('ESXi Shell', 'violet')}</div>
          <pre aria-label="Example esxtop command"><code>esxtop -b -a -d 2 -n 100 \
  | gzip -9c > /vmfs/volumes/SAS.-LOCAL/perf.csv</code></pre>
          <div class="mt-1">${commandRows}</div>
          <p class="hint">The file is gzip data even though it is named <code>.csv</code>. ESXtop Lens detects the gzip magic bytes. For real captures use a unique filename such as <code>esxtop-$(hostname)-$(date +%FT%H%M).csv.gz</code>.</p>
        </div>
      </section>

      <div class="section-head"><div><div class="eyebrow">What you get</div><h2>Built for the second and third look</h2></div><p>Fast triage, then every counter remains reachable. No metric is hidden behind a “summary” that cannot be inspected.</p></div>
      <div class="feature-grid">
        <div class="feature"><div class="feature-icon">${icon('gauge', 17)}</div><h3>CPU and vCPU drilldown</h3><p>Host cores, VM groups and individual vCPU worlds: %RDY, %MLMTD, %CSTP, %SWPWT and the full CPU field set.</p></div>
        <div class="feature"><div class="feature-icon">${icon('memory', 17)}</div><h3>Memory pressure with context</h3><p>Overcommit alone is not a finding. Ballooning, VMkernel swap, swap I/O, compression and NUMA locality are correlated.</p></div>
        <div class="feature"><div class="feature-icon">${icon('disk', 17)}</div><h3>Layered storage latency</h3><p>GAVG = DAVG + KAVG. Inspect VM virtual disks, devices, adapters, queues and abort/reset counters separately.</p></div>
        <div class="feature"><div class="feature-icon">${icon('network', 17)}</div><h3>Drops and throughput</h3><p>TX/RX drop percentages, packet and bit rates, link state and per-port or per-VM network signals.</p></div>
        <div class="feature"><div class="feature-icon">${icon('insights', 17)}</div><h3>Explainable findings</h3><p>Every finding states the observed percentile, the guardrail and why it matters, then links to Broadcom and Yellow Bricks.</p></div>
        <div class="feature"><div class="feature-icon">${icon('table', 17)}</div><h3>Every metric remains visible</h3><p>Search all counters, chart any signal, read every sample or export the analysis and raw series to CSV.</p></div>
        <div class="feature"><div class="feature-icon">${icon('file', 17)}</div><h3>HTML and PDF reports</h3><p>Export a standalone HTML report or print to PDF with the executive summary, a prioritized action plan, findings and a technical reference.</p></div>
      </div>

      <div class="section-head"><div><div class="eyebrow">Source material</div><h2>Ground truth</h2></div><p>The analysis follows the official esxtop counter semantics, with field thresholds labelled as operational guidance.</p></div>
      <div class="grid-2">
        <div class="card flat">
          <h3>Broadcom / VMware</h3>
          <ul class="source-list">
            <li><span class="src-num">01</span><a href="https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance/performance-monitoring-utilities-resxtop-and-esxtop/using-the-esxtop-utility.html" target="_blank" rel="noreferrer">Using the esxtop Utility ${icon('external', 12)}</a></li>
            <li><span class="src-num">02</span><a href="https://knowledge.broadcom.com/external/article/370279/collecting-esxtop-batch-data-for-esxi-pe.html" target="_blank" rel="noreferrer">Collecting esxtop batch data ${icon('external', 12)}</a></li>
            <li><span class="src-num">03</span><a href="https://knowledge.broadcom.com/external/article/382249/using-esxtop-and-interpreting-esxtop-sta.html" target="_blank" rel="noreferrer">Using ESXTop and interpreting statistics ${icon('external', 12)}</a></li>
            <li><span class="src-num">04</span><a href="https://knowledge.broadcom.com/external/article/344099" target="_blank" rel="noreferrer">Using esxtop to identify storage performance issues ${icon('external', 12)}</a></li>
          </ul>
        </div>
        <div class="card flat">
          <h3>Practical thresholds</h3>
          <ul class="source-list">
            <li><span class="src-num">05</span><a href="https://www.yellow-bricks.com/esxtop/" target="_blank" rel="noreferrer">Yellow Bricks — ESXTOP metric thresholds ${icon('external', 12)}</a></li>
            <li><span class="src-num">06</span><a href="https://knowledge.broadcom.com/external/article?legacyId=2001003" target="_blank" rel="noreferrer">Troubleshooting ESXi VM performance issues ${icon('external', 12)}</a></li>
            <li><span class="src-num">07</span><a href="https://knowledge.broadcom.com/external/article/326270/impact-of-virtual-machine-memory-and-cpu.html" target="_blank" rel="noreferrer">Impact of CPU and memory limits ${icon('external', 12)}</a></li>
            <li><span class="src-num">08</span><a href="https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance.html" target="_blank" rel="noreferrer">vSphere Monitoring and Performance ${icon('external', 12)}</a></li>
          </ul>
        </div>
      </div>
      <div class="callout accent mt-1"><strong>Read this first:</strong> performance is contextual. A single spike is not a bottleneck, and a red signal is not automatically the root cause. Use the evidence and the guide, then confirm in the guest, the array and the network.</div>
    `,
    mount(root) {
      const input = root.querySelector('#landing-file');
      const dropzone = root.querySelector('#landing-dropzone');
      const open = () => input?.click();
      const send = (file) => {
        if (file) ctx.uploadFile(file);
      };
      root.querySelectorAll('[data-open-upload]').forEach((button) => button.addEventListener('click', open));
      root.querySelectorAll('[data-load-demo]').forEach((button) => button.addEventListener('click', () => ctx.loadDemo()));
      dropzone?.addEventListener('click', open);
      dropzone?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      input?.addEventListener('change', () => send(input.files?.[0]));
      for (const eventName of ['dragenter', 'dragover']) {
        dropzone?.addEventListener(eventName, (event) => {
          event.preventDefault();
          dropzone.classList.add('drag');
        });
      }
      for (const eventName of ['dragleave', 'drop']) {
        dropzone?.addEventListener(eventName, (event) => {
          event.preventDefault();
          dropzone.classList.remove('drag');
        });
      }
      dropzone?.addEventListener('drop', (event) => {
        send(event.dataTransfer?.files?.[0]);
      });
      root.querySelector('[data-download-json]')?.addEventListener('click', () => safeJsonDownload(doc));
    },
  };
}

export async function renderOverview(ctx) {
  const doc = ctx.doc;
  const findings = doc.findings || [];
  const chartSpecs = overviewCharts(doc);
  const kpiSeries = overviewKpiSeries(doc);
  await loadSeriesForPage(ctx, chartSpecs, kpiSeries.map((series) => series.id));
  const kpiCards = overviewKpiCards(doc).join('');
  const topFindings = findings.slice(0, 4);
  return {
    html: `
      ${summaryHero(doc)}
      ${captureTabs(doc, 'overview')}
      <section class="kpi-grid mt-1">${kpiCards}</section>
      <div class="section-head">
        <div><div class="eyebrow">Triage queue</div><h2>Signals that need a second look</h2></div>
        <div class="section-actions"><a class="btn" href="#/insights">${icon('insights', 15)} All ${findings.length} findings</a></div>
      </div>
      ${topFindings.length ? `<div class="findings">${topFindings.map((finding) => findingCard(finding, { compact: true })).join('')}</div>` : emptyState('No threshold breaches', 'The curated rules did not find a signal outside its guardrail. Inspect the raw metrics before concluding that the host is healthy.')}
      <div class="section-head"><div><div class="eyebrow">Visual drilldown</div><h2>What changed during the capture</h2></div><p>Charts are tolerant of missing samples and preserve the original time labels. Hover for exact values.</p></div>
      ${chartSpecs.length ? chartCardsHtml(chartSpecs) : emptyState('No chartable signals', 'The capture has no numeric series in the selected categories.')}
      <div class="section-head"><div><div class="eyebrow">Virtual machines</div><h2>Who is carrying the pressure</h2></div><div class="section-actions"><a class="btn" href="#/vms">${icon('server', 15)} All VMs</a></div></div>
      ${vmTable(doc, 30)}
      <div class="section-head"><div><div class="eyebrow">Method</div><h2>How to read this page</h2></div></div>
      <div class="observations">${(doc.observations || []).map((observation) => `<article class="observation"><h3>${esc(observation.title)}</h3><p>${esc(observation.text)}</p></article>`).join('')}</div>
    `,
    mount(root) {
      mountCharts(root, chartSpecs);
      root.querySelector('[data-download-json]')?.addEventListener('click', () => safeJsonDownload(doc));
      root.querySelectorAll('[data-print]').forEach((button) => button.addEventListener('click', () => window.print()));
    },
  };
}

export function renderReport(ctx) {
  const doc = ctx.doc;
  const hosts = reportHostNames(doc);
  const initialHost = doc.meta.host || hosts[0] || '';
  const initialVms = reportVmNames(doc, initialHost);
  const scopeOptions = (selected = '') => hosts.map((host) => `<option value="${escapeAttr(host)}"${host === selected ? ' selected' : ''}>${esc(host)}</option>`).join('');
  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">Export · capture report</div>
        <h1>Capture report</h1>
        <p class="page-lede">A standalone report with the executive summary, a prioritized “What to do next” action plan, every finding, host and disk detail, VM detail, a technical reference and a complete appendix of every captured metric. Choose the report scope, generate it, then export HTML or PDF.</p>
        <div class="summary-actions report-toolbar">
          <button class="btn btn-primary" type="button" id="report-html" disabled>${icon('download', 15)} Export HTML</button>
          <button class="btn" type="button" id="report-pdf" disabled>${icon('file', 15)} Export PDF</button>
          <button class="btn" type="button" id="report-metrics-csv">${icon('table', 15)} Export all metrics CSV</button>
          <a class="btn btn-ghost" href="#/">${icon('back', 14)} Back to overview</a>
        </div>
        <div class="callout mt-1"><strong>PDF export:</strong> generate the report first, then the browser print dialog opens. Choose <b>Save as PDF</b> (or “Print to PDF”) and keep the default A4 page size.</div>
      </div>
      ${captureTabs(doc, 'report')}
      <section class="card report-scope-card">
        <div class="card-header"><div><div class="card-kicker">Report scope</div><h2>Choose what the detailed section should cover</h2></div>${pill('Choose before generating', 'accent')}</div>
        <div class="seg report-scope-modes" role="group" aria-label="Report scope">
          <button class="active" type="button" data-report-mode="all">All capture</button>
          <button type="button" data-report-mode="host">One host</button>
          <button type="button" data-report-mode="vm">Selected VMs</button>
        </div>
        <div class="form-grid">
          <label class="field" id="report-host-field" hidden><span>ESXi host</span><select class="select" id="report-host">${scopeOptions(initialHost)}</select></label>
          <label class="field field-wide" id="report-vm-field" hidden><span>VMs in detailed sections</span><select class="select" id="report-vms" multiple size="6">${initialVms.map((name) => `<option value="${escapeAttr(name)}">${esc(name)}</option>`).join('')}</select></label>
        </div>
        <p class="report-note" id="report-scope-help"><b>All capture:</b> detailed host and VM sections include every host and every VM. Global summary, findings and appendix remain capture-wide.</p>
        <div class="summary-actions">
          <button class="btn btn-primary" type="button" id="report-generate">${icon('play', 14)} Generate report</button>
          <button class="btn btn-sm" type="button" id="report-clear-vms" hidden>All VMs on host</button>
          <span class="dim" id="report-scope-summary">Choose a scope, then generate the report.</span>
        </div>
      </section>
      <style>${reportStyles()}</style>
      <div id="report-content">
        <div class="card flat report-placeholder"><div class="card-kicker">No report generated yet</div><h2>Choose a scope above</h2><p class="muted">Select <b>All capture</b>, one host, or one or more VMs. Then press <b>Generate report</b>. The export buttons are enabled after generation so the HTML/PDF always matches the visible report.</p></div>
      </div>
    `,
    mount(root) {
      const hostField = root.querySelector('#report-host-field');
      const vmField = root.querySelector('#report-vm-field');
      const hostSelect = root.querySelector('#report-host');
      const vmSelect = root.querySelector('#report-vms');
      const content = root.querySelector('#report-content');
      const summary = root.querySelector('#report-scope-summary');
      const help = root.querySelector('#report-scope-help');
      const clearVms = root.querySelector('#report-clear-vms');
      const htmlButton = root.querySelector('#report-html');
      const pdfButton = root.querySelector('#report-pdf');
      const modeButtons = [...root.querySelectorAll('[data-report-mode]')];
      let mode = 'all';
      let generatedScope = null;

      const selectedScope = () => ({
        mode,
        host: hostSelect?.value || initialHost,
        vms: mode === 'vm' && vmSelect ? [...vmSelect.selectedOptions].map((option) => option.value) : [],
      });
      const showPlaceholder = (message = 'Choose a scope above, then press Generate report.') => {
        generatedScope = null;
        content.innerHTML = `<div class="card flat report-placeholder"><div class="card-kicker">Report not generated</div><h2>${esc(message)}</h2><p class="muted">Export buttons are disabled until a report is generated.</p></div>`;
        if (htmlButton) htmlButton.disabled = true;
        if (pdfButton) pdfButton.disabled = true;
      };
      const updateVisibility = () => {
        const hostMode = mode !== 'all';
        const vmMode = mode === 'vm';
        if (hostField) hostField.hidden = !hostMode;
        if (vmField) vmField.hidden = !vmMode;
        if (clearVms) clearVms.hidden = !vmMode;
        modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.reportMode === mode));
        if (help) {
          help.innerHTML = mode === 'all'
            ? '<b>All capture:</b> detailed host and VM sections include every host and every VM. Global summary, findings and appendix remain capture-wide.'
            : mode === 'host'
              ? `<b>One host:</b> include every VM on <code>${esc(hostSelect?.value || initialHost)}</code>. Global summary, findings and appendix remain capture-wide.`
              : '<b>Selected VMs:</b> include only the chosen VMs on the chosen host. Leave the list empty for all VMs on that host. Global summary, findings and appendix remain capture-wide.';
        }
        if (summary) summary.textContent = mode === 'all'
          ? 'All hosts and VMs'
          : mode === 'host'
            ? `All VMs on ${hostSelect?.value || initialHost}`
            : `${vmSelect ? [...vmSelect.selectedOptions].length : 0} selected VM(s) on ${hostSelect?.value || initialHost}`;
      };
      const populateVms = () => {
        const host = hostSelect?.value || initialHost;
        const names = reportVmNames(doc, host);
        if (vmSelect) {
          vmSelect.innerHTML = names.map((name) => `<option value="${escapeAttr(name)}">${esc(name)}</option>`).join('');
          vmSelect.size = Math.max(4, Math.min(8, names.length || 4));
        }
        updateVisibility();
        showPlaceholder();
      };
      modeButtons.forEach((button) => button.addEventListener('click', () => {
        mode = button.dataset.reportMode || 'all';
        if (mode === 'all') {
          updateVisibility();
          showPlaceholder();
        } else {
          populateVms();
        }
      }));
      hostSelect?.addEventListener('change', populateVms);
      vmSelect?.addEventListener('change', () => {
        updateVisibility();
        showPlaceholder('Scope changed');
      });
      clearVms?.addEventListener('click', () => {
        if (!vmSelect) return;
        [...vmSelect.options].forEach((option) => { option.selected = false; });
        updateVisibility();
        showPlaceholder('Scope changed');
      });
      root.querySelector('#report-generate')?.addEventListener('click', () => {
        generatedScope = selectedScope();
        content.innerHTML = reportBody(doc, generatedScope);
        if (htmlButton) htmlButton.disabled = false;
        if (pdfButton) pdfButton.disabled = false;
        updateVisibility();
        if (summary) {
          summary.textContent = generatedScope.mode === 'all'
            ? 'Report generated: all hosts and VMs'
            : generatedScope.mode === 'host'
              ? `Report generated: all VMs on ${generatedScope.host}`
              : `Report generated: ${generatedScope.vms.length || 'all'} VM(s) on ${generatedScope.host}`;
        }
      });
      htmlButton?.addEventListener('click', () => {
        if (!generatedScope) return;
        downloadReportHTML(doc, ctx.toast, generatedScope);
      });
      pdfButton?.addEventListener('click', () => {
        if (!generatedScope) return;
        openReportPrintWindow(doc, ctx.toast, generatedScope);
      });
      root.querySelector('#report-metrics-csv')?.addEventListener('click', () => {
        const rows = [['category', 'metric', 'metric_name', 'group', 'instance', 'entity', 'scope', 'unit', 'min', 'avg', 'p95', 'max', 'last', 'status', 'raw_header']];
        for (const series of doc.series || []) {
          rows.push([
            series.category, series.metric, doc.metrics?.[series.metric]?.name || series.metricName || series.metric,
            series.group, series.instance, series.entity, series.scope, series.unit,
            series.stats?.min, series.stats?.avg, series.stats?.p95, series.stats?.max, series.stats?.last,
            series.status, series.rawHeader,
          ]);
        }
        csvDownload(`esxtop-all-metrics-${doc.meta.host || 'capture'}.csv`, rows);
      });
      updateVisibility();
      showPlaceholder();
    },
  };
}

export async function renderCategory(ctx, category) {
  const doc = ctx.doc;
  const meta = CATEGORY_META[category] || CATEGORY_META.other;
  const categorySummary = doc.summary?.categories?.[category] || {};
  const specs = [];
  let primaryTable = '';
  let secondary = '';

  if (category === 'cpu') {
    const cpuList = topCpuSeries(doc, 6);
    if (cpuList.length) specs.push(chartSpec('chart-cpu-host', 'Host physical CPU', 'Total and busiest cores. Use P95 rather than a single peak when judging saturation.', cpuList, doc, { linkText: 'All metrics', link: '#/metrics?category=cpu', yUnit: '%' }));
    const ready = perVmTopSeries(doc, '%RDY', 6);
    if (ready.length) specs.push(chartSpec('chart-cpu-ready', 'VM CPU ready', 'Worst vCPU per VM. A VM group total spreads ready time across worlds and can understate a starved vCPU.', ready, doc, { yUnit: '%', label: (series) => series.vm }));
    const cstop = perVmTopSeries(doc, '%CSTP', 5);
    if (cstop.length) specs.push(chartSpec('chart-cpu-cstop', 'Co-stop', 'SMP co-scheduling pressure. Compare with vCPU count and guest workload balance.', cstop, doc, { yUnit: '%', label: (series) => series.vm }));
    const load = seriesByMetric(doc, 'LOAD1').filter((series) => series.scope === 'host');
    if (load.length) specs.push(chartSpec('chart-cpu-load', 'Host load average', 'Broadcom describes 1.0 as fully utilised and 2.0 as overloaded. The capture window matters.', load, doc, { yUnit: '', linkText: 'All metrics', link: '#/metrics?category=cpu' }));
    primaryTable = `<div class="section-head"><div><div class="eyebrow">VM pressure</div><h2>Virtual machine CPU</h2></div><div class="section-actions"><a class="btn" href="#/metrics?category=cpu">${icon('table', 14)} All CPU signals</a></div></div>${vmTable(doc, 100)}`;
    secondary = `<div class="section-head"><div><div class="eyebrow">Host view</div><h2>Physical CPU cores</h2></div><p>Each row is a physical CPU counter. Expand a core to inspect the raw series and all samples.</p></div>${hostCpuTable(doc)}`;
  } else if (category === 'memory') {
    const free = worstBy(doc, 'FREE_MB', (series) => series.scope === 'host');
    if (free) specs.push(chartSpec('chart-mem-free', 'Host free memory', 'Free memory alone is not a pressure diagnosis. Correlate with ballooning, swap and overcommit.', [free], doc, { yUnit: 'MB' }));
    const reclaim = reclaimSeries(doc, 7);
    if (reclaim.length) specs.push(chartSpec('chart-mem-reclaim', 'VM memory reclaim', 'Ballooning and VMkernel swap by VM. Persistent swap-in is synchronous and can look like an application stall.', reclaim, doc, { yUnit: 'MB', label: (series) => `${series.vm} · ${series.metric === 'MCTLSZ' ? 'balloon' : 'swap'}` }));
    const swap = [...seriesByMetric(doc, 'SWAP_READ'), ...seriesByMetric(doc, 'SWAP_WRITE'), ...seriesByMetric(doc, 'SWR/s'), ...seriesByMetric(doc, 'SWW/s')]
      .filter((series) => (Number(series.stats?.p95) || 0) > 0)
      .sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0)).slice(0, 6);
    if (swap.length) specs.push(chartSpec('chart-mem-swap-io', 'Swap I/O rate', 'Host and VM swap rates. Any sustained swap-in deserves priority attention.', swap, doc, { yUnit: 'MB/s', label: (series) => `${series.entity || series.vm || 'host'} · ${series.metric}` }));
    const overcommit = seriesByMetric(doc, 'OVERCOMMIT1').filter((series) => series.scope === 'host');
    if (overcommit.length) specs.push(chartSpec('chart-mem-overcommit', 'Memory overcommit', 'Requested memory versus managed memory, minus one. Overcommit is a planning signal, not proof of reclaim.', overcommit, doc, { yUnit: '', linkText: 'All metrics', link: '#/metrics?category=memory' }));
    primaryTable = `<div class="section-head"><div><div class="eyebrow">VM pressure</div><h2>Virtual machine memory</h2></div><div class="section-actions"><a class="btn" href="#/metrics?category=memory">${icon('table', 14)} All memory signals</a></div></div>${vmTable(doc, 100)}`;
    secondary = `<div class="section-head"><div><div class="eyebrow">Host view</div><h2>Host memory signals</h2></div><p>Overcommit, balloon target, swap and compression are related but not interchangeable.</p></div>${hostMemoryTable(doc)}`;
  } else if (category === 'storage') {
    const latency = storageLatencySeries(doc, 7);
    if (latency.length) specs.push(chartSpec('chart-storage-gavg', 'Guest storage latency', 'GAVG = DAVG + KAVG. Split the layers on the storage table before blaming the array.', latency, doc, { yUnit: 'ms', label: (series) => `${series.scope === 'vm' ? series.entity : series.instance || series.entity}` }));
    const kavg = seriesByMetric(doc, 'KAVG/cmd').sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0)).slice(0, 6);
    if (kavg.length) specs.push(chartSpec('chart-storage-kavg', 'VMkernel latency', 'KAVG is the ESXi storage stack. Sustained elevation commonly means queuing or a queue-depth mismatch.', kavg, doc, { yUnit: 'ms', label: (series) => series.scope === 'vm' ? series.entity : series.instance || series.entity }));
    const qued = seriesByMetric(doc, 'QUED').sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0)).slice(0, 6);
    if (qued.length) specs.push(chartSpec('chart-storage-queued', 'Queued commands', 'A sustained QUED above 1 means commands are waiting for a queue slot. Check queue depth and array health.', qued, doc, { yUnit: '', label: (series) => series.scope === 'vm' ? series.entity : series.instance || series.entity }));
    const iops = seriesByMetric(doc, 'CMDS/s').sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0)).slice(0, 6);
    if (iops.length) specs.push(chartSpec('chart-storage-iops', 'Commands per second', 'IOPS is workload, not health. Pair it with latency and queue depth to judge saturation.', iops, doc, { yUnit: '/s', linkText: 'All metrics', link: '#/metrics?category=storage', label: (series) => series.scope === 'vm' ? series.entity : series.instance || series.entity }));
    primaryTable = `<div class="section-head"><div><div class="eyebrow">Layered view</div><h2>Storage entities</h2></div><div class="section-actions"><a class="btn" href="#/metrics?category=storage">${icon('table', 14)} All storage signals</a></div></div><p class="muted">Rows can represent a VM virtual disk, a device or an adapter. That is intentional: compare layers rather than assuming one number is the whole path.</p>${storageTable(doc)}`;
    secondary = '';
  } else if (category === 'network') {
    const drops = networkDropSeries(doc, 7);
    if (drops.length) specs.push(chartSpec('chart-network-drops', 'Packet drops', 'Anything above 1% sustained is worth investigating. Rule out CPU contention before blaming the physical network.', drops, doc, { yUnit: '%', label: (series) => `${series.entity || series.instance} · ${series.metric === '%DRPTX' ? 'TX' : 'RX'}` }));
    const tx = seriesByMetric(doc, 'MbTX/s').sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0)).slice(0, 6);
    if (tx.length) specs.push(chartSpec('chart-network-tx', 'Transmit throughput', 'Busiest ports by P95. Throughput without drops or latency is not automatically a problem.', tx, doc, { yUnit: 'Mbps', label: (series) => series.entity || series.instance }));
    const rx = seriesByMetric(doc, 'MbRX/s').sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0)).slice(0, 6);
    if (rx.length) specs.push(chartSpec('chart-network-rx', 'Receive throughput', 'Pair receive throughput with drops and host CPU readiness; packet processing can be CPU-bound.', rx, doc, { yUnit: 'Mbps', label: (series) => series.entity || series.instance }));
    primaryTable = `<div class="section-head"><div><div class="eyebrow">Ports and VMs</div><h2>Network signals</h2></div><div class="section-actions"><a class="btn" href="#/metrics?category=network">${icon('table', 14)} All network signals</a></div></div>${networkTable(doc)}`;
    secondary = '';
  } else {
    primaryTable = `<div class="section-head"><div><div class="eyebrow">Unclassified</div><h2>Other signals</h2></div><div class="section-actions"><a class="btn" href="#/metrics?category=other">${icon('table', 14)} All metrics</a></div></div>${emptyState('No curated page for this category', 'Use All metrics to inspect these counters. The raw series and stats remain available.')}`;
  }

  await loadSeriesForPage(ctx, specs);
  const relations = relationshipsFor(category);

  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">${esc(meta.eyebrow)}</div>
        <h1>${esc(meta.title)}</h1>
        <p class="page-lede">${esc(meta.description)}</p>
        <div class="summary-status-row">${statusBadge(categorySummary.status || 'neutral')} <span class="dim">${categorySummary.critical || 0} critical · ${categorySummary.warning || 0} warning · ${categorySummary.series || 0} signals</span></div>
      </div>
      ${captureTabs(doc, category)}
      ${specs.length ? chartCardsHtml(specs) : ''}
      ${primaryTable}
      ${secondary}
      ${relations.length ? `<div class="section-head"><div><div class="eyebrow">Technical context</div><h2>How these counters fit together</h2></div><p>Use these relationships before treating a single counter as the root cause.</p></div><div class="grid-2">${relations.map((item) => `<div class="card flat"><h3>${esc(item.title)}</h3><p class="muted">${esc(item.detail)}</p></div>`).join('')}</div>` : ''}
      <div class="callout mt-2"><strong>Threshold caveat:</strong> ${esc(meta.description)} The values in this view are percentiles computed over the whole capture. Use the time-series hover and the raw series page to judge whether a spike is sustained.</div>
    `,
    mount(root) {
      mountCharts(root, specs);
    },
  };
}

export function renderVms(ctx) {
  const doc = ctx.doc;
  const summaries = (doc.vms || []).map((name) => vmSummary(doc, name));
  const critical = summaries.filter((vm) => vm.status === 'critical').length;
  const warning = summaries.filter((vm) => vm.status === 'warn').length;
  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">Virtual machines</div>
        <h1>Worlds and pressure</h1>
        <p class="page-lede">A VM is a group of worlds. The group view is useful for totals, but CPU ready and swap wait must be read per vCPU when a VM is reported slow. Internal ESXi system worlds such as <code>system1</code> and <code>hostd.20994601</code> are excluded from this table and from VM-scoped findings; their raw series remain searchable.</p>
        <div class="summary-status-row">${statusBadge(critical ? 'critical' : warning ? 'warn' : 'ok')} <span class="dim">${summaries.length} VMs · ${critical} critical · ${warning} warning</span></div>
      </div>
      ${captureTabs(doc, 'vms')}
      <div class="table-toolbar">
        <div class="input-icon">${icon('search', 15)}<input class="input" id="vm-search" type="search" placeholder="Search VMs…" aria-label="Search virtual machines"></div>
        <span class="spacer"></span>
        <span class="dim" id="vm-count">${summaries.length} VMs</span>
      </div>
      <div id="vm-table-wrap">${vmTable(doc, 500)}</div>
      <div class="section-head"><div><div class="eyebrow">How to use this page</div><h2>Group vs vCPU</h2></div></div>
      <div class="observations">
        <article class="observation"><h3>Read ready time per vCPU</h3><p>Broadcom describes normal ready time below 5%; Yellow Bricks uses sustained 10% per world as a contention warning. A group aggregate can look acceptable while one world is starved.</p></article>
        <article class="observation"><h3>Separate a limit from capacity</h3><p>%MLMTD is included in %RDY. If MLMTD is non-zero, a configured CPU limit is throttling the VM, and adding host capacity will not remove it.</p></article>
        <article class="observation"><h3>Memory reclaim is a sequence</h3><p>Ballooning is cheaper than swapping. Swap-in is synchronous and can produce intermittent guest stalls. Check MCTLSZ, SWCUR, SWR/s and SWW/s together.</p></article>
      </div>
    `,
    mount(root) {
      const input = root.querySelector('#vm-search');
      const wrap = root.querySelector('#vm-table-wrap');
      const count = root.querySelector('#vm-count');
      const original = wrap.innerHTML;
      input?.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        const source = summaries.map((vm) => ({ vm, html: vmRowHtml(doc, vm) }));
        const matches = source.filter(({ vm }) => !query || vm.name.toLowerCase().includes(query));
        count.textContent = `${matches.length} VM${matches.length === 1 ? '' : 's'}`;
        if (!matches.length) {
          wrap.innerHTML = emptyState('No matching VM', 'Search checks the VM display name from the capture.');
        } else {
          wrap.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Virtual machine</th><th class="num">vCPU</th><th class="num">Memory</th><th class="num">CPU used</th><th class="num">%RDY</th><th class="num">%MLMTD</th><th class="num">%CSTP</th><th class="num">Balloon</th><th class="num">Swap</th><th class="num">GAVG</th><th>Status</th></tr></thead><tbody>${matches.map(({ html }) => html).join('')}</tbody></table></div>`;
        }
      });
      if (!original) wrap.innerHTML = original;
    },
  };
}

function vmRowHtml(doc, vm) {
  return `<tr>
    <td class="name"><a href="${escapeAttr(vmRoute(vm.name))}">${esc(vm.name)}</a><span class="sub">${vm.findings.length ? `${vm.findings.length} finding${vm.findings.length === 1 ? '' : 's'}` : 'no findings'}</span></td>
    <td class="num">${vm.vcpus ?? '—'}</td>
    <td class="num">${vm.configuredMemory !== null ? formatMetric(vm.configuredMemory, 'MB') : '—'}</td>
    <td class="num">${formatMetric(vm.cpuUsed?.stats?.p95, '%')}</td>
    <td class="num">${formatMetric(vm.ready?.stats?.p95, '%')}</td>
    <td class="num">${formatMetric(vm.mlmtd?.stats?.p95, '%')}</td>
    <td class="num">${formatMetric(vm.cstop?.stats?.p95, '%')}</td>
    <td class="num">${formatMetric(vm.balloon?.stats?.p95, 'MB')}</td>
    <td class="num">${formatMetric(vm.swap?.stats?.p95, 'MB')}</td>
    <td class="num">${formatMetric(vm.disk?.stats?.p95, 'ms')}</td>
    <td>${statusBadge(vm.status)}</td>
  </tr>`;
}

export async function renderVm(ctx, vmName) {
  const doc = ctx.doc;
  const vm = vmSummary(doc, vmName);
  if (!vm.list.length) {
    return {
      html: `<div class="page-head"><div class="eyebrow">Virtual machine</div><h1>${esc(vmName)}</h1><p class="page-lede">This VM was not found in the capture. VM names come from the esxtop instance strings and can differ from the vCenter display name if the capture was taken while the VM was renamed.</p></div><a class="btn" href="#/vms">${icon('back', 14)} All VMs</a>`,
      mount() {},
    };
  }
  const specs = [];
  const ready = vm.list.filter((series) => series.group?.toLowerCase().startsWith('vcpu') && series.metric === '%RDY');
  if (ready.length) specs.push(chartSpec('chart-vm-ready', 'vCPU ready time', 'The percentage of time each vCPU was ready but waiting for a physical CPU. Compare with %MLMTD.', ready, doc, { yUnit: '%', label: (series) => series.world || series.instance, area: ready.length === 1 }));
  const usedGroup = vm.list.filter((series) => series.group?.toLowerCase().startsWith('group cpu') && series.metric === '%USED');
  const usedVcpu = vm.list.filter((series) => series.group?.toLowerCase().startsWith('vcpu') && series.metric === '%USED');
  const used = usedGroup.length ? usedGroup : usedVcpu;
  if (used.length) specs.push(chartSpec('chart-vm-used', 'CPU used', usedGroup.length ? 'Group-level CPU utilisation across all worlds.' : 'Per-vCPU utilisation because the capture has no Group Cpu counter.', used, doc, { yUnit: '%', label: (series) => series.world || series.vm }));
  const memory = vm.list.filter((series) => ['MCTLSZ', 'SWCUR'].includes(series.metric));
  if (memory.length) specs.push(chartSpec('chart-vm-memory', 'Memory reclaim', 'Ballooned memory and current swap for this VM. A current swap value can persist after the pressure has passed; watch swap rates too.', memory, doc, { yUnit: 'MB', label: (series) => series.metric === 'MCTLSZ' ? 'Balloon' : 'VMkernel swap' }));
  const disk = vm.list.filter((series) => series.metric === 'GAVG/cmd');
  if (disk.length) specs.push(chartSpec('chart-vm-disk', 'Virtual disk latency', 'Guest-observed latency. Use the storage page to split DAVG, KAVG and queueing.', disk, doc, { yUnit: 'ms', label: (series) => series.instance || 'virtual disk' }));
  const drops = vm.list.filter((series) => ['%DRPTX', '%DRPRX'].includes(series.metric));
  if (drops.length) specs.push(chartSpec('chart-vm-network', 'Network drops', 'Transmit and receive drop percentages on the VM network port.', drops, doc, { yUnit: '%', label: (series) => series.metric === '%DRPTX' ? 'TX drops' : 'RX drops' }));
  const findings = (doc.findings || []).filter((finding) => finding.entity === vm.name);
  const vmTechnical = ['%RDY', '%MLMTD', '%CSTP', 'MCTLSZ', 'SWCUR', 'GAVG/cmd']
    .map((metric) => ({ metric, ...technicalFor(metric) }))
    .filter((item) => item.name);
  const tableRows = vm.list.slice(0, 200);
  await loadSeriesForPage(ctx, specs, [vm.ready, vm.mlmtd, vm.balloon, vm.swap, vm.disk].map((series) => series?.id));
  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">Virtual machine drilldown · ${esc(vm.name)}</div>
        <h1>${esc(vm.name)}</h1>
        <p class="page-lede">Group-level totals, per-vCPU worlds, memory reclaim, virtual disk latency and network signals from this capture. Every counter remains available in the table below.</p>
        <div class="summary-status-row">${statusBadge(vm.status)} ${vm.findings.length ? pill(`${vm.findings.length} findings`, vm.status === 'critical' ? 'danger' : 'warn') : pill('no findings', 'ok')} ${pill(`${vm.seriesCount} signals`)}</div>
      </div>
      ${captureTabs(doc, 'vms')}
      <div class="summary-actions"><a class="btn btn-ghost btn-sm" href="#/vms">${icon('back', 13)} All VMs</a><a class="btn btn-ghost btn-sm" href="#/metrics?q=${encodeURIComponent(vm.name)}">${icon('table', 13)} All metrics for this VM</a></div>
      <section class="kpi-grid mt-1">
        ${kpiCard({ label: 'vCPUs', value: vm.vcpus ?? '—', sub: 'worlds detected', status: 'neutral', href: '#/vms', iconName: 'server', sparkId: 'vm-vcpus' })}
        ${kpiCard({ label: 'CPU ready', value: formatMetric(vm.ready?.stats?.p95, '%'), sub: 'worst vCPU P95', series: vm.ready, status: vm.ready?.status || 'neutral', href: vm.ready ? seriesRoute(vm.ready.id) : '#/cpu', iconName: 'gauge', sparkId: 'vm-ready' })}
        ${kpiCard({ label: 'CPU limit', value: formatMetric(vm.mlmtd?.stats?.p95, '%'), sub: 'MLMTD P95', series: vm.mlmtd, status: vm.mlmtd?.status || 'neutral', href: vm.mlmtd ? seriesRoute(vm.mlmtd.id) : '#/cpu', iconName: 'gauge', sparkId: 'vm-mlmtd' })}
        ${kpiCard({ label: 'Ballooned', value: formatMetric(vm.balloon?.stats?.p95, 'MB'), sub: 'P95', series: vm.balloon, status: vm.balloon?.status || 'neutral', href: vm.balloon ? seriesRoute(vm.balloon.id) : '#/memory', iconName: 'memory', sparkId: 'vm-balloon' })}
        ${kpiCard({ label: 'Swapped', value: formatMetric(vm.swap?.stats?.p95, 'MB'), sub: 'current VMkernel swap', series: vm.swap, status: vm.swap?.status || 'neutral', href: vm.swap ? seriesRoute(vm.swap.id) : '#/memory', iconName: 'memory', sparkId: 'vm-swap' })}
        ${kpiCard({ label: 'Disk GAVG', value: formatMetric(vm.disk?.stats?.p95, 'ms'), sub: 'worst virtual disk', series: vm.disk, status: vm.disk?.status || 'neutral', href: vm.disk ? seriesRoute(vm.disk.id) : '#/storage', iconName: 'disk', sparkId: 'vm-disk' })}
      </section>
      ${specs.length ? chartCardsHtml(specs) : emptyState('No chartable VM signals', 'The capture contains this VM name but no numeric series for it.')}
      <div class="section-head"><div><div class="eyebrow">Findings</div><h2>What needs attention</h2></div><div class="section-actions"><a class="btn" href="#/insights">${icon('insights', 14)} Global insights</a></div></div>
      ${findings.length ? `<div class="findings">${findings.map((finding) => findingCard(finding)).join('')}</div>` : emptyState('No threshold findings for this VM', 'Inspect the raw counters below. A neutral metric can still be important if it is outside the rule set.')}
      <div class="section-head"><div><div class="eyebrow">Worlds</div><h2>Per-vCPU detail</h2></div></div>
      ${vmVcpuTable(doc, vm.name)}
      <div class="section-head"><div><div class="eyebrow">Technical vocabulary</div><h2>What these VM counters mean</h2></div></div>
      <div class="grid-2">${vmTechnical.map((item) => `<div class="card flat"><div class="card-kicker">${esc(item.metric)}</div><h3>${esc(item.name)}</h3><p class="muted">${item.what}</p><p class="muted">${item.read}</p></div>`).join('')}</div>
      <div class="section-head"><div><div class="eyebrow">Raw signals</div><h2>All metrics for ${esc(vm.name)}</h2></div><div class="section-actions"><a class="btn" href="#/metrics?q=${encodeURIComponent(vm.name)}">${icon('search', 14)} Search this VM</a></div></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Signal</th><th>Group / instance</th><th class="num">Avg</th><th class="num">P95</th><th class="num">Peak</th><th>Status</th></tr></thead><tbody>
        ${tableRows.map((series) => `<tr><td class="name"><a href="${escapeAttr(seriesRoute(series.id))}">${esc(metricName(doc, series))}</a><span class="sub">${esc(series.metric)}</span></td><td>${esc(series.group)}${series.instance ? `<span class="sub">${esc(series.instance)}</span>` : ''}</td><td class="num">${formatMetric(series.stats?.avg, series.unit)}</td><td class="num">${formatMetric(series.stats?.p95, series.unit)}</td><td class="num">${formatMetric(series.stats?.max, series.unit)}</td><td>${statusBadge(series.status)}</td></tr>`).join('')}
      </tbody></table></div>
      ${vm.list.length > 200 ? `<p class="chart-note">Showing the first 200 of ${vm.list.length} signals. Use All metrics to narrow the view.</p>` : ''}
    `,
    mount(root) {
      mountCharts(root, specs);
    },
  };
}

export function renderInsights(ctx) {
  const doc = ctx.doc;
  const findings = doc.findings || [];
  const critical = findings.filter((finding) => finding.severity === 'critical');
  const warning = findings.filter((finding) => finding.severity === 'warning');
  const info = findings.filter((finding) => finding.severity === 'info');
  const group = (items, label, tone) => items.length ? `<div class="finding-group-title"><span>${esc(label)}</span><span class="line"></span><span>${items.length}</span></div><div class="findings">${items.map((finding) => findingCard(finding)).join('')}</div>` : '';
  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">Evidence-backed triage</div>
        <h1>Findings</h1>
        <p class="page-lede">Each finding names the counter, the observed percentile, the guardrail and the next check. Critical does not mean root cause; it means the signal is outside the curated guardrail and should be explained.</p>
        <div class="summary-status-row">${statusBadge(doc.summary.status)} <span class="dim">${critical.length} critical · ${warning.length} warning · ${info.length} informational</span></div>
      </div>
      ${captureTabs(doc, 'insights')}
      <div class="callout accent"><strong>Support workflow:</strong> work critical findings first, confirm each one against the raw series, identify the layer (CPU, memory, storage or network), then change one thing and re-capture. The <a href="#/report">report</a> includes a prioritized “What to do next” plan and the technical reference for every counter behind the findings.</div>
      <div class="table-toolbar">
        <div class="filters" id="finding-filters">
          <button class="filter-btn active" type="button" data-severity-filter="all">All <span class="dim">${findings.length}</span></button>
          <button class="filter-btn" type="button" data-severity-filter="critical">Critical <span class="dim">${critical.length}</span></button>
          <button class="filter-btn" type="button" data-severity-filter="warning">Warning <span class="dim">${warning.length}</span></button>
          <button class="filter-btn" type="button" data-severity-filter="info">Info <span class="dim">${info.length}</span></button>
        </div>
        <span class="spacer"></span>
        <span class="dim" id="finding-count">${findings.length} findings</span>
      </div>
      <div id="finding-list">
        ${group(critical, 'Critical', 'critical')}
        ${group(warning, 'Warning', 'warn')}
        ${group(info, 'Information', 'info')}
      </div>
      ${!findings.length ? emptyState('No findings in the curated rules', 'Check the observations below, then inspect the raw metrics. The absence of a finding is not a guarantee of health.') : ''}
      <div class="section-head"><div><div class="eyebrow">Method notes</div><h2>What the engine does and does not know</h2></div></div>
      <div class="observations">${(doc.observations || []).map((observation) => `<article class="observation"><h3>${esc(observation.title)}</h3><p>${esc(observation.text)}</p></article>`).join('')}</div>
      <div class="callout mt-2"><strong>Source hierarchy:</strong> Broadcom/VMware documentation defines counter semantics. Yellow Bricks supplies practical field thresholds. The rule engine uses sustained percentiles (usually P95) to reduce single-spike noise, except for hard error counters such as ABRTS/s, ATSF and DELETE_F. Confirm storage queue and latency guidance with the array vendor.</div>
    `,
    mount(root) {
      const buttons = [...root.querySelectorAll('[data-severity-filter]')];
      const cards = [...root.querySelectorAll('.finding')];
      const groups = [...root.querySelectorAll('.finding-group-title')];
      const count = root.querySelector('#finding-count');
      let active = 'all';
      const apply = () => {
        let visible = 0;
        cards.forEach((card) => {
          const show = active === 'all' || card.dataset.severity === active;
          card.classList.toggle('hide', !show);
          if (show) visible += 1;
        });
        groups.forEach((heading) => {
          const next = heading.nextElementSibling;
          const hasVisible = next?.querySelector?.('.finding:not(.hide)');
          heading.classList.toggle('hide', !hasVisible);
        });
        count.textContent = `${visible} finding${visible === 1 ? '' : 's'}`;
        buttons.forEach((button) => button.classList.toggle('active', button.dataset.severityFilter === active));
      };
      buttons.forEach((button) => button.addEventListener('click', () => {
        active = button.dataset.severityFilter;
        apply();
      }));
      apply();
    },
  };
}

export function renderMetrics(ctx, query = {}) {
  const doc = ctx.doc;
  const categories = ['all', 'cpu', 'memory', 'storage', 'network', 'power', 'other'];
  const initialCategory = categories.includes(query.category) ? query.category : 'all';
  const initialSearch = query.q || '';
  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">Every captured signal</div>
        <h1>Metric explorer</h1>
        <p class="page-lede">All ${doc.series.length.toLocaleString()} counters from this capture. Search raw headers, group names, VMs and metric labels; click a row to open its full time-series and every sample.</p>
      </div>
      ${captureTabs(doc, 'metrics')}
      <div class="table-toolbar">
        <div class="input-icon">${icon('search', 15)}<input class="input" id="metric-search" type="search" value="${escapeAttr(initialSearch)}" placeholder="Search %RDY, GAVG, VM name, group…" aria-label="Search metrics"></div>
        <select class="select" id="metric-category" aria-label="Filter category">
          ${categories.map((category) => `<option value="${category}"${category === initialCategory ? ' selected' : ''}>${category === 'all' ? 'All categories' : categoryLabel(category)}</option>`).join('')}
        </select>
        <select class="select" id="metric-status" aria-label="Filter status">
          <option value="all">All statuses</option>
          <option value="critical">Critical</option>
          <option value="warn">Warning</option>
          <option value="ok">Within guardrail</option>
          <option value="neutral">No rule</option>
        </select>
        <span class="spacer"></span>
        <span class="dim" id="metric-count">${doc.series.length} signals</span>
        <button class="btn btn-sm" type="button" id="metric-export">${icon('download', 13)} Export filtered</button>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Signal</th><th>Entity</th><th>Category</th><th class="num">Avg</th><th class="num">P95</th><th class="num">Peak</th><th>Status</th></tr></thead>
          <tbody id="metric-rows"></tbody>
        </table>
      </div>
      <div class="inline-actions mt-1"><button class="btn" type="button" id="metric-more">Show more</button><span class="dim" id="metric-page-note"></span></div>
    `,
    mount(root) {
      const search = root.querySelector('#metric-search');
      const category = root.querySelector('#metric-category');
      const status = root.querySelector('#metric-status');
      const rows = root.querySelector('#metric-rows');
      const count = root.querySelector('#metric-count');
      const more = root.querySelector('#metric-more');
      const note = root.querySelector('#metric-page-note');
      let limit = 250;
      let filteredCache = [];
      const filter = () => {
        const query = search.value.trim().toLowerCase();
        const categoryValue = category.value;
        const statusValue = status.value;
        filteredCache = doc.series
          .filter((series) => categoryValue === 'all' || series.category === categoryValue)
          .filter((series) => statusValue === 'all' || series.status === statusValue)
          .filter((series) => {
            if (!query) return true;
            return [series.label, series.rawHeader, series.group, series.counter, series.entity, series.instance, series.vm, series.metric, metricName(doc, series)]
              .some((value) => String(value || '').toLowerCase().includes(query));
          })
          .sort((left, right) => statusRank(right.status) - statusRank(left.status) || (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0));
        limit = 250;
        renderRows();
      };
      const renderRows = () => {
        const slice = filteredCache.slice(0, limit);
        rows.innerHTML = slice.length ? slice.map((series) => `<tr class="clickable" data-href="${escapeAttr(seriesRoute(series.id))}">
          <td class="name"><a href="${escapeAttr(seriesRoute(series.id))}">${esc(metricName(doc, series))}</a><span class="sub">${esc(series.metric)} · ${esc(series.group)}${series.counter ? ` · ${esc(series.counter)}` : ''}</span></td>
          <td>${esc(series.entity || series.vm || '—')}<span class="sub">${esc(series.instance || series.entityKind || '')}</span></td>
          <td>${pill(categoryLabel(series.category), categoryToneClass(series.category))}</td>
          <td class="num">${formatMetric(series.stats?.avg, series.unit)}</td>
          <td class="num">${formatMetric(series.stats?.p95, series.unit)}</td>
          <td class="num">${formatMetric(series.stats?.max, series.unit)}</td>
          <td>${statusBadge(series.status)}</td>
        </tr>`).join('') : `<tr><td colspan="7"><div class="table-empty">No metrics match these filters.</div></td></tr>`;
        count.textContent = `${filteredCache.length.toLocaleString()} signal${filteredCache.length === 1 ? '' : 's'}`;
        more.hidden = filteredCache.length <= limit;
        note.textContent = filteredCache.length ? `Showing ${Math.min(limit, filteredCache.length)} of ${filteredCache.length}` : '';
      };
      search.addEventListener('input', filter);
      category.addEventListener('change', filter);
      status.addEventListener('change', filter);
      more.addEventListener('click', () => {
        limit += 250;
        renderRows();
      });
      rows.addEventListener('click', (event) => {
        const row = event.target.closest('tr[data-href]');
        if (row && !event.target.closest('a')) window.location.hash = row.dataset.href;
      });
      root.querySelector('#metric-export').addEventListener('click', () => {
        const header = ['metric', 'metric_name', 'group', 'instance', 'entity', 'unit', 'avg', 'p95', 'max', 'status', 'raw_header'];
        const data = [header, ...filteredCache.map((series) => [series.metric, metricName(doc, series), series.group, series.instance, series.entity, series.unit, series.stats?.avg, series.stats?.p95, series.stats?.max, series.status, series.rawHeader])];
        csvDownload(`esxtop-metrics-${doc.meta.host || 'capture'}.csv`, data);
      });
      filter();
    },
  };
}

export async function renderMetric(ctx, metricId) {
  const doc = ctx.doc;
  const definition = metricById(doc, metricId);
  const list = seriesByMetric(doc, metricId)
    .sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0));
  if (!definition && !list.length) {
    return {
      html: `<div class="page-head"><div class="eyebrow">Metric</div><h1>${esc(metricId)}</h1><p class="page-lede">This metric is not present in the current capture.</p></div><a class="btn" href="#/metrics">${icon('back', 14)} All metrics</a>`,
      mount() {},
    };
  }
  const chartList = list.filter((series) => series.kind === 'numeric').slice(0, 12);
  const specs = chartList.length ? [chartSpec('chart-metric', definition?.name || metricId, 'Top entities by P95. Toggle series in the legend; hover for exact values.', chartList, doc, {
    yUnit: chartList[0]?.unit || '',
    label: (series) => seriesShortLabel(series),
    area: chartList.length === 1,
  })] : [];
  const references = definition?.references || [];
  const tech = technicalFor(metricId);
  const relations = relationshipsFor(tech?.category || definition?.category || '');
  await loadSeriesForPage(ctx, specs);
  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">Metric · ${esc(metricId)}</div>
        <h1>${esc(definition?.name || metricId)}</h1>
        <p class="page-lede">${esc(definition?.description || 'Raw esxtop counter.')}</p>
        <div class="summary-status-row">${definition?.known ? pill('curated metric', 'accent') : pill('raw metric')} ${definition?.unit ? pill(definition.unit) : ''} <span class="dim">${list.length} series in this capture</span></div>
      </div>
      ${captureTabs(doc, 'metrics')}
      ${specs.length ? chartCardsHtml(specs) : emptyState('No numeric series', 'This counter is present but does not contain numeric samples.')}
      <div class="metric-intro mt-1">
        <div>
          <div class="section-head" style="margin-top:.4rem"><div><h2>All entities</h2><p>Sorted by P95. Click a row to inspect the raw series.</p></div></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Entity</th><th>Group</th><th class="num">Avg</th><th class="num">P95</th><th class="num">Peak</th><th class="num">Samples</th><th>Status</th></tr></thead><tbody>
            ${list.map((series) => `<tr class="clickable" data-href="${escapeAttr(seriesRoute(series.id))}"><td class="name"><a href="${escapeAttr(seriesRoute(series.id))}">${esc(seriesShortLabel(series))}</a><span class="sub">${esc(series.instance || series.entityKind)}</span></td><td>${esc(series.group)}</td><td class="num">${formatMetric(series.stats?.avg, series.unit)}</td><td class="num">${formatMetric(series.stats?.p95, series.unit)}</td><td class="num">${formatMetric(series.stats?.max, series.unit)}</td><td class="num">${series.stats?.count ?? 0}</td><td>${statusBadge(series.status)}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <aside class="metric-side">
          <div class="card-kicker">Interpretation</div>
          <p class="muted">${esc(definition?.thresholdNote || 'No curated threshold is attached to this metric. Use it as context with the surrounding counters.')}</p>
          ${!tech && definition?.description ? `<p class="muted">${esc(definition.description)}</p>` : ''}
          ${tech ? `<div class="metric-technical">
            <div class="card-kicker">Technical detail</div>
            <p>${tech.what}</p>
            <p>${tech.read}</p>
            ${tech.formula ? `<p class="mono">${esc(tech.formula)}</p>` : ''}
            <p><strong>What to check:</strong> ${tech.check}</p>
            ${relations.length ? `<ul class="tech-list">${relations.map((item) => `<li><strong>${esc(item.title)}:</strong> ${esc(item.detail)}</li>`).join('')}</ul>` : ''}
          </div>` : ''}
          ${references.length ? `<div class="refs">${references.map((reference) => `<a href="${escapeAttr(reference.url)}" target="_blank" rel="noreferrer">${icon('external', 12)} ${esc(reference.title)}</a>`).join('')}</div>` : ''}
          <div class="mt-1"><a class="btn btn-sm" href="#/metrics">${icon('back', 13)} All metrics</a></div>
        </aside>
      </div>
    `,
    mount(root) {
      mountCharts(root, specs);
      root.addEventListener('click', (event) => {
        const row = event.target.closest('tr[data-href]');
        if (row && !event.target.closest('a')) window.location.hash = row.dataset.href;
      });
    },
  };
}

export async function renderSeries(ctx, seriesId) {
  const doc = ctx.doc;
  const series = (doc.series || []).find((item) => item.id === seriesId);
  if (!series) {
    return {
      html: `<div class="page-head"><div class="eyebrow">Signal</div><h1>Series not found</h1><p class="page-lede">The series ID is not present in the current capture.</p></div><a class="btn" href="#/metrics">${icon('back', 14)} All metrics</a>`,
      mount() {},
    };
  }
  await ctx.ensureSeries([series.id]);
  const definition = metricById(doc, series.metric);
  const specs = series.kind === 'numeric' ? [chartSpec('chart-series', metricName(doc, series), `${seriesShortLabel(series)} · full capture`, [series], doc, {
    yUnit: series.unit,
    area: true,
    thresholds: thresholdsFor([series]),
    note: series.statusText !== 'No automatic threshold' ? `${series.statusText}. ${series.statusSummary || ''}` : '',
  })] : [];
  const sampleCount = series.values.length;
  const preview = series.values.slice(0, 400);
  const valueRows = preview.map((value, index) => `<tr><td class="num">${esc(doc.time.labels?.[index] || `#${index + 1}`)}</td><td class="num">${esc(series.kind === 'numeric' ? formatMetric(value, series.unit) : (value ?? '—'))}</td></tr>`).join('');
  const references = definition?.references || [];
  const tech = technicalFor(series.metric);
  const relations = relationshipsFor(tech?.category || definition?.category || '');
  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">Raw signal · ${esc(series.metric)}</div>
        <h1>${esc(metricName(doc, series))}</h1>
        <p class="page-lede">${esc(seriesShortLabel(series))} · ${esc(series.group)}${series.instance ? `(${esc(series.instance)})` : ''} · ${esc(series.counter)}</p>
        <div class="summary-status-row">${statusBadge(series.status)} ${pill(series.unit || 'unitless')} ${series.kind === 'text' ? pill('text series', 'violet') : ''}</div>
      </div>
      ${captureTabs(doc, 'metrics')}
      <div class="stat-strip">
        <div class="stat-box"><span>Average</span><strong>${formatMetric(series.stats?.avg, series.unit)}</strong></div>
        <div class="stat-box"><span>P95</span><strong>${formatMetric(series.stats?.p95, series.unit)}</strong></div>
        <div class="stat-box"><span>Peak</span><strong>${formatMetric(series.stats?.max, series.unit)}</strong></div>
        <div class="stat-box"><span>Last</span><strong>${formatMetric(series.stats?.last, series.unit)}</strong></div>
        <div class="stat-box"><span>Samples</span><strong>${sampleCount}</strong></div>
      </div>
      ${specs.length ? chartCardsHtml(specs) : emptyState('No numeric chart', 'This series is categorical or contains no numeric samples. The values are still listed below.')}
      <div class="metric-intro mt-1">
        <div>
          <div class="section-head"><div><h2>Samples</h2><p>${sampleCount > preview.length ? `Showing the first ${preview.length} samples. Download the series for the full capture.` : 'Every sample in the capture.'}</p></div><div class="section-actions"><button class="btn btn-sm" type="button" id="download-series">${icon('download', 13)} Download series CSV</button></div></div>
          <div class="table-wrap" style="max-height:520px"><table class="data"><thead><tr><th class="num">Time</th><th class="num">Value</th></tr></thead><tbody>${valueRows}</tbody></table></div>
        </div>
        <aside class="metric-side">
          <div class="card-kicker">Status</div>
          <p class="muted">${esc(series.statusSummary || 'No curated rule was applied.')}</p>
          ${series.observed !== null && series.observed !== undefined ? `<div class="callout accent"><strong>${esc(String(series.statistic || 'p95').toUpperCase())} ${esc(formatMetric(series.observed, series.unit))}</strong><br>${series.threshold !== null && series.threshold !== undefined ? `Guardrail: ${esc(formatMetric(series.threshold, series.unit))}` : 'No threshold crossed.'}</div>` : ''}
          <div class="card-kicker">Definition</div>
          <p class="muted">${esc(definition?.description || 'Raw esxtop counter. No curated description is available yet.')}</p>
          ${definition?.thresholdNote ? `<p class="muted">${esc(definition.thresholdNote)}</p>` : ''}
          ${tech ? `<div class="metric-technical">
            <div class="card-kicker">Technical detail</div>
            <p>${tech.what}</p>
            <p>${tech.read}</p>
            ${tech.formula ? `<p class="mono">${esc(tech.formula)}</p>` : ''}
            <p><strong>What to check:</strong> ${tech.check}</p>
            ${relations.length ? `<ul class="tech-list">${relations.map((item) => `<li><strong>${esc(item.title)}:</strong> ${esc(item.detail)}</li>`).join('')}</ul>` : ''}
          </div>` : ''}
          <div class="copy-raw">${esc(series.rawHeader)}</div>
          <div class="mt-1"><a class="btn btn-sm" href="${escapeAttr(metricRoute(series.metric))}">${icon('table', 13)} Same metric across entities</a></div>
          <div class="mt-1"><a class="btn btn-sm btn-ghost" href="#/metrics">${icon('back', 13)} All metrics</a></div>
          ${references.length ? `<div class="refs">${references.map((reference) => `<a href="${escapeAttr(reference.url)}" target="_blank" rel="noreferrer">${icon('external', 12)} ${esc(reference.title)}</a>`).join('')}</div>` : ''}
        </aside>
      </div>
    `,
    mount(root) {
      mountCharts(root, specs);
      root.querySelector('#download-series')?.addEventListener('click', () => {
        const rows = [['time', 'value', series.metric, series.group, series.instance]];
        series.values.forEach((value, index) => rows.push([doc.time.rawLabels?.[index] || doc.time.labels?.[index] || index, value, series.metric, series.group, series.instance]));
        csvDownload(`esxtop-${series.metric.replace(/[^\w-]+/g, '_')}-${series.id}.csv`, rows);
      });
    },
  };
}

export function renderCapture(ctx) {
  const panelKeys = {
    'disk-both': ['u', 'd'],
    'disk-device': ['u'],
    'disk-adapter': ['d'],
    cpu: ['c'],
    memory: ['m'],
    network: ['n'],
  };
  const steps = [
    ['Start esxtop interactively', 'Open an SSH session to the ESXi host as root and run <code>esxtop</code>. Do not add <code>-a</code> here; you are preparing a focused field layout.'],
    ['Open the panel you need', 'Use <b>d</b> for Disk Adapter, <b>u</b> for Disk Device, <b>v</b> for VM Disk, <b>c</b> for CPU, <b>m</b> for memory, or <b>n</b> for network. For a complete storage view, configure <b>d</b>, <b>u</b> and <b>v</b> in the same session.'],
    ['Select fields with f', 'Press <b>f</b> to open the field-selection panel. Enable only the counters you need. Press <b>o</b> if you also want to reorder them. Repeat this in every panel you want to exclude or include; the rc file stores all panel selections. To collect only storage, clear the fields you do not want in <b>c</b>, <b>m</b>, <b>n</b>, <b>i</b> and <b>p</b> as well — see “What c, m, n, i and p contain” below.'],
    ['Write the config with W', 'Press <b>W</b> — uppercase, case-sensitive. At the prompt, enter an <b>absolute datastore path</b> such as /vmfs/volumes/datastore1/esxtop-disk.rc. Do not accept a default path under /tmp or the ESXi ramdisk if the file must survive a reboot.'],
    ['Verify the file and header', 'Run a tiny batch test with <code>-n 2</code>, then inspect the CSV header. This proves the config is readable and that the expected counters are present before a long capture.'],
    ['Run the focused capture', 'Use <code>esxtop -b -c &lt;absolute-rc-path&gt; -d &lt;interval&gt; -n &lt;samples&gt;</code>. Do not add <code>-a</code>: it overrides the configuration and collects all statistics.'],
  ];

  const stepHtml = steps.map(([title, detail], index) => `
    <article class="step-card">
      <span class="step-num">${String(index + 1).padStart(2, '0')}</span>
      <div><h3>${title}</h3><p>${detail}</p></div>
    </article>`).join('');

  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">Capture manual · focused fields</div>
        <h1>Make a config file with <span class="mono">-c</span></h1>
        <p class="page-lede">Interactive esxtop can write a reusable configuration file. Use it when you need a repeatable, smaller capture — for example disk device and disk adapter latency fields — instead of collecting every counter on a busy host.</p>
        <div class="summary-status-row">${pill('Broadcom documented', 'accent')} ${pill('W is uppercase', 'warn')} ${pill('omit -a', 'danger')}</div>
      </div>

      <div class="capture-manual-layout">
        <section class="card">
          <div class="card-header"><div><div class="card-kicker">Command builder</div><h2>Build the batch command</h2></div>${icon('play', 20)}</div>
          <p class="muted">The config file must already exist. Build the command here, run it on the ESXi host, then import the resulting CSV or gzip file into ESXtop Lens.</p>
          <div class="form-grid">
            <label class="field"><span>Config file path</span><input class="input" id="capture-config" value="/vmfs/volumes/datastore1/esxtop-disk.rc" spellcheck="false"></label>
            <label class="field"><span>Panel to configure</span><select class="select" id="capture-panel">
              <option value="storage-all">Storage bundle: Adapter + Device + VM Disk</option>
              <option value="disk-both">Disk Device + Disk Adapter</option>
              <option value="disk-device">Disk Device only</option>
              <option value="disk-adapter">Disk Adapter only</option>
              <option value="vm-disk">VM Disk only</option>
              <option value="cpu">CPU</option>
              <option value="memory">Memory</option>
              <option value="network">Network</option>
            </select></label>
            <label class="field"><span>Interval (seconds)</span><input class="input" id="capture-interval" type="number" value="5" min="2" step="1"></label>
            <label class="field"><span>Samples (-n)</span><input class="input" id="capture-samples" type="number" value="60" min="1" step="1"></label>
            <label class="field field-wide"><span>Output file</span><input class="input" id="capture-output" value="/vmfs/volumes/datastore1/esxtop-disk.csv" spellcheck="false"></label>
            <label class="check-field field-wide"><input id="capture-gzip" type="checkbox"> <span>Compress the output with <code>gzip -9c</code> (recommended for long captures)</span></label>
          </div>
          <div class="capture-hint" id="capture-panel-hint">Configure both <b>u</b> (Disk Device) and <b>d</b> (Disk Adapter) before pressing <b>W</b>.</div>
          <div class="command-preview">
            <div class="command-toolbar"><span>Batch command</span><button class="btn btn-sm btn-ghost" type="button" id="capture-copy">${icon('download', 13)} Copy</button></div>
            <pre><code id="capture-command"></code></pre>
          </div>
          <div class="capture-warning" id="capture-warning" hidden>${icon('alert', 14)} Prefer an absolute path under <code>/vmfs/volumes/</code>; the ESXi ramdisk and <code>/tmp</code> are not durable storage.</div>
          <div class="callout danger mt-1"><strong>Do not add <code>-a</code> to this command.</strong> Broadcom documents that <code>-a</code> overrides configuration-file setup and shows all statistics. That defeats the focused capture.</div>
        </section>

        <aside class="card flat">
          <div class="card-kicker">Verification recipe</div>
          <h3>Test before the long run</h3>
          <p>Use a short two-sample capture and inspect the header before collecting for 5 or 10 minutes:</p>
          <pre class="mini-code"><code>esxtop -b -c /vmfs/volumes/datastore1/esxtop-disk.rc \
  -d 2 -n 2 > /vmfs/volumes/datastore1/esxtop-test.csv
head -1 /vmfs/volumes/datastore1/esxtop-test.csv \
  | tr ',' '\n' | grep -E 'DAVG|KAVG|GAVG|CMDS|QUED' | head</code></pre>
          <p class="dim">If expected counters are missing, the rc file is not selecting the panel fields you think it is. Re-check <code>f</code> and press <code>W</code> again.</p>
          <div class="capture-hint">The exact default configuration filename varies by ESXi release. Do not rely on <code>.esxtoprc</code>; use the <b>W</b> prompt and an explicit absolute path.</div>
        </aside>
      </div>

      <div class="section-head"><div><div class="eyebrow">Multiple panels</div><h2>One rc file can hold the whole storage path</h2></div><p>The rc file stores every panel's field layout, not just the panel you are viewing. You can configure <code>d</code>, <code>u</code> and <code>v</code> in one session and save them together with a single <code>W</code>.</p></div>

      <div class="grid-2">
        <div class="card flat">
          <h3>Storage panels that can coexist</h3>
          <table class="data compact-table"><tbody>
            <tr><td class="mono">d</td><td><b>Disk Adapter</b> — HBA/adapter latency, queue and throughput.</td></tr>
            <tr><td class="mono">u</td><td><b>Disk Device</b> — per-LUN/device latency, queue and throughput. This is the closest view to a datastore's backing device.</td></tr>
            <tr><td class="mono">v</td><td><b>VM Disk</b> — per-VM virtual disk latency, IOPS and throughput.</td></tr>
            <tr><td class="mono">x</td><td><b>vSAN</b> — only on releases that expose it; not a general Datastore panel.</td></tr>
          </tbody></table>
          <div class="callout warning mt-1"><strong>There is no separate Datastore panel in esxtop.</strong> A datastore can span devices or extents, so there is no single Datastore latency row. Use <b>u</b> for the backing device and <b>v</b> for per-VM I/O, then map the datastore to its devices. The vSphere Datastore performance chart is a vCenter metric, not an esxtop panel.</div>
        </div>
        <div class="card flat">
          <h3>Build a storage-only rc</h3>
          <ol class="mistake-list">
            <li>Run <code>esxtop</code>.</li>
            <li>Press <b>d</b>, then <b>f</b>, and select adapter fields.</li>
            <li>Press <b>u</b>, then <b>f</b>, and select device fields.</li>
            <li>Press <b>v</b>, then <b>f</b>, and select VM disk fields.</li>
            <li>In <b>c</b>, <b>m</b>, <b>n</b>, <b>i</b> and <b>p</b>, disable the fields you do not want. The rc stores every panel layout, so leftover fields still appear in batch output.</li>
            <li>Press uppercase <b>W</b> once and save to a durable path, for example <code>/vmfs/volumes/datastore1/esxtop-storage.rc</code>.</li>
            <li>Validate with <code>-n 2</code>, then inspect the CSV header for adapter, device and VM-disk counters.</li>
          </ol>
          <p class="dim">The “Panel to configure” dropdown above is only a hint. The rc file path you pass to <code>-c</code> is what determines the collected fields.</p>
        </div>
      </div>

      <div class="section-head" id="other-panels"><div><div class="eyebrow">Other panels</div><h2>What <code>c</code>, <code>m</code>, <code>n</code>, <code>i</code> and <code>p</code> contain</h2></div><p>The rc file stores every panel layout, not just the panel currently on screen. If you want storage-only data, clear these before <b>W</b>; otherwise leftover fields appear in the batch header.</p></div>

      <div class="panel-reference-grid">
        <article class="panel-ref">
          <div class="panel-ref-head"><span class="panel-key">c</span><h3>CPU</h3></div>
          <p>Host physical CPU and world/group scheduling data: <code>%USED</code>, <code>%RUN</code>, <code>%SYS</code>, <code>%WAIT</code>, <code>%RDY</code>, <code>%MLMTD</code>, <code>%CSTP</code> and <code>%SWPWT</code>.</p>
          <p class="panel-keep"><b>Storage-only:</b> press <b>c</b>, then <b>f</b>, and deselect all fields. Keep CPU fields only if you also need contention or limit evidence.</p>
        </article>
        <article class="panel-ref">
          <div class="panel-ref-head"><span class="panel-key">m</span><h3>Memory</h3></div>
          <p>Host free/overcommit memory and per-VM grant, ballooning, VMkernel swap, compression and NUMA locality. Useful for memory-pressure correlation.</p>
          <p class="panel-keep"><b>Storage-only:</b> clear all fields. For NFS/iSCSI storage, you may instead keep swap-I/O and network-path signals if memory pressure is part of the incident.</p>
        </article>
        <article class="panel-ref">
          <div class="panel-ref-head"><span class="panel-key">n</span><h3>Network</h3></div>
          <p>Virtual switch ports, uplinks, packet and bit rates, average packet size, link state and transmit/receive drop percentages.</p>
          <p class="panel-keep"><b>Storage-only:</b> clear all fields. Keep drops and throughput when the datastore path is iSCSI or NFS.</p>
        </article>
        <article class="panel-ref">
          <div class="panel-ref-head"><span class="panel-key">i</span><h3>Interrupts</h3></div>
          <p>Per-CPU interrupt activity and vector data. It is mainly useful when you suspect a driver, NIC or storage-controller interrupt storm.</p>
          <p class="panel-keep"><b>Storage-only:</b> clear all fields unless interrupt behaviour is part of the storage investigation.</p>
        </article>
        <article class="panel-ref">
          <div class="panel-ref-head"><span class="panel-key">p</span><h3>CPU Power</h3></div>
          <p>CPU power-management state, frequency, <code>%A/MPERF</code> and power data. Use it for power, turbo or frequency-scaling questions, not routine storage capture.</p>
          <p class="panel-keep"><b>Storage-only:</b> clear all fields. Panel availability and field letters vary by ESXi release.</p>
        </article>
      </div>

      <div class="callout accent"><strong>Storage-only sequence:</strong> configure <b>d</b>, <b>u</b> and <b>v</b> as needed; then visit <b>c</b>, <b>m</b>, <b>n</b>, <b>i</b> and <b>p</b>, press <b>f</b> in each panel, deselect the fields you do not want, and press <b>W</b> once. An all-lowercase panel line means every field in that panel is hidden. This is the step that keeps leftover counters out of the batch header.</div>

      <div class="card flat mt-1">
        <div class="card-kicker">Real file · ESXi 8.0 U3</div>
        <h3>Anatomy of a real <code>.esxtop60rc</code></h3>
        <p>Here is a real ESXi 8.0 U3 file. The <code>.esxtop60rc</code> name is historical and is still the default filename on newer releases. The number of panel-layout lines changes between ESXi releases; the last line is the options line. Uppercase letters mark selected fields and lowercase letters mark hidden fields, but do not hand-edit this file — always save it with <code>W</code>.</p>
        <table class="data compact-table"><tbody>
          <tr><td class="mono">1</td><td class="mono">abcdefghij</td><td>CPU</td></tr>
          <tr><td class="mono">2</td><td class="mono">abcdefghijklmnopq</td><td>Memory</td></tr>
          <tr><td class="mono">3</td><td class="mono">ABCDEfGHIJkl</td><td>Disk Adapter — fields A–E and G–J selected</td></tr>
          <tr><td class="mono">4</td><td class="mono">ABcdeFGhIJKLmnop</td><td>Disk Device — fields A, B, F, G, I–L selected</td></tr>
          <tr><td class="mono">5</td><td class="mono">aBCDEfghIJKl</td><td>VM Disk — fields B–E and I–K selected</td></tr>
          <tr><td class="mono">6</td><td class="mono">abcdefghijklmnopq</td><td>Network — all hidden</td></tr>
          <tr><td class="mono">7</td><td class="mono">abcdef</td><td>Interrupt — all hidden</td></tr>
          <tr><td class="mono">8</td><td class="mono">abcdef</td><td>CPU Power — all hidden</td></tr>
          <tr><td class="mono">9–10</td><td class="mono">AbcDEFGHijKlmN<br>ABCdEf</td><td>Additional release-specific panel layouts in this ESXi 8.0 U3 file</td></tr>
          <tr><td class="mono">11</td><td class="mono">5p</td><td>Options: 5-second delay and the starting panel (<code>p</code>, CPU Power on releases that expose it)</td></tr>
        </tbody></table>
        <p class="dim">This example already has the storage panels partly enabled. If you want only storage, clear the fields in the other panels before pressing <code>W</code>. The exact field letters and line count are release-specific; use the interactive <code>f</code> panel as the source of truth.</p>
      </div>

      <div class="callout accent mt-1"><strong>Large sample count?</strong> At 146,274 columns the default 20,000,000-cell guardrail allows 136 samples. Giving the container more RAM does not raise the cell limit. Open the <a href="#/guide">field guide</a> and choose <b>Sizing large captures</b> for the memory formula, sample-count table, recommended <code>ESXTOP_MAX_*</code> values and a 10 GB Compose example.</div>

      <div class="section-head"><div><div class="eyebrow">Step by step</div><h2>The exact workflow</h2></div><p>The sequence matters: configure interactively, save with <code>W</code>, then reference that file with <code>-c</code> in batch mode.</p></div>
      <div class="steps-grid">${stepHtml}</div>

      <div class="section-head"><div><div class="eyebrow">Reference</div><h2>Options and traps</h2></div></div>
      <div class="grid-2">
        <div class="card flat">
          <h3>What each option means</h3>
          <table class="data compact-table"><tbody>
            <tr><td class="mono">esxtop</td><td>starts the ESXi performance utility</td></tr>
            <tr><td class="mono">-b</td><td>batch mode: CSV to stdout, entity list locked at first sample</td></tr>
            <tr><td class="mono">-c file</td><td>load a user-defined config; without it, the release default is used</td></tr>
            <tr><td class="mono">-d 5</td><td>5 seconds between snapshots; minimum is 2 seconds</td></tr>
            <tr><td class="mono">-n 60</td><td>about 60 samples; nominal coverage is n × delay</td></tr>
            <tr><td class="mono">W</td><td>write the current interactive setup, including field selections</td></tr>
            <tr><td class="mono">-a</td><td>all statistics; overrides the config file — omit it for focused capture</td></tr>
          </tbody></table>
        </div>
        <div class="card flat">
          <h3>Common mistakes</h3>
          <ul class="mistake-list">
            <li><b>Using lowercase <code>w</code>:</b> the config write command is uppercase <code>W</code>.</li>
            <li><b>Keeping <code>-a</code>:</b> the config file is ignored. Remove it.</li>
            <li><b>Saving under <code>/tmp</code>:</b> ESXi's ramdisk is not durable. Use a datastore path.</li>
            <li><b>Assuming <code>.esxtoprc</code>:</b> the default name is release-dependent; press <code>W</code> and read the prompt, or provide an absolute path.</li>
            <li><b>Using a relative <code>-c</code> path:</b> <code>.esxtoprc</code> only works from the directory that contains it. Prefer an absolute datastore path.</li>
            <li><b>Configuring only one panel:</b> the rc file stores all panel layouts. Clear fields in panels you do not want, then recheck the output header.</li>
            <li><b>Looking for a Datastore panel:</b> esxtop has no separate Datastore panel. Use <code>u</code> for the backing device and <code>v</code> for per-VM I/O, or use the vSphere Datastore chart.</li>
            <li><b>Writing to the datastore under investigation:</b> choose another datastore if possible.</li>
          </ul>
        </div>
      </div>

      <div class="callout accent"><strong>Import it:</strong> the resulting file can be plain CSV or gzip. ESXtop Lens detects gzip from its magic bytes, not the filename. Open <a href="#/import">Import</a> and drop the file in. If the capture is intended for disk troubleshooting, this focused profile can be much smaller and easier to review than an <code>-a</code> capture.</div>

      <div class="section-head"><div><div class="eyebrow">Primary sources</div><h2>Verify against the vendor</h2></div></div>
      <div class="card flat">
        <ul class="source-list">
          <li><span class="src-num">01</span><a href="https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance/performance-monitoring-utilities-resxtop-and-esxtop/using-esxtop-or-resxtop-in-interactive-mode/interactive-mode-command-line-options.html" target="_blank" rel="noreferrer">Broadcom — interactive options, W and -c ${icon('external', 12)}</a></li>
          <li><span class="src-num">02</span><a href="https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-monitoring-and-performance/performance-monitoring-utilities-resxtop-and-esxtop/using-batch-mode/prepare-for-batch-mode.html" target="_blank" rel="noreferrer">Broadcom — prepare for batch mode ${icon('external', 12)}</a></li>
          <li><span class="src-num">03</span><a href="https://knowledge.broadcom.com/external/article/370279/collecting-esxtop-batch-data-for-esxi-pe.html" target="_blank" rel="noreferrer">Broadcom 370279 — collecting esxtop batch data ${icon('external', 12)}</a></li>
          <li><span class="src-num">04</span><a href="https://www.virten.net/vmware/esxtop/" target="_blank" rel="noreferrer">virten.net — ESXTOP guide ${icon('external', 12)}</a></li>
          <li><span class="src-num">05</span><a href="https://www.yellow-bricks.com/esxtop/" target="_blank" rel="noreferrer">Yellow Bricks — save a focused configuration with W ${icon('external', 12)}</a></li>
        </ul>
      </div>
    `,
    mount(root) {
      const config = root.querySelector('#capture-config');
      const panel = root.querySelector('#capture-panel');
      const interval = root.querySelector('#capture-interval');
      const samples = root.querySelector('#capture-samples');
      const output = root.querySelector('#capture-output');
      const gzip = root.querySelector('#capture-gzip');
      const command = root.querySelector('#capture-command');
      const hint = root.querySelector('#capture-panel-hint');
      const warning = root.querySelector('#capture-warning');
      const shellQuote = (value) => /^[\w./:@%+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
      const panelLabels = {
        'storage-all': 'Configure <b>d</b> (Disk Adapter), <b>u</b> (Disk Device) and <b>v</b> (VM Disk) in the same interactive session, then press <b>W</b> once. There is no separate Datastore panel; <b>u</b> and <b>v</b> are the datastore-facing views. Clear the other panels if you want a storage-only capture.',
        'disk-both': 'Configure both <b>u</b> (Disk Device) and <b>d</b> (Disk Adapter) before pressing <b>W</b>.',
        'disk-device': 'Press <b>u</b> (Disk Device), then configure its fields with <b>f</b>.',
        'disk-adapter': 'Press <b>d</b> (Disk Adapter), then configure its fields with <b>f</b>.',
        'vm-disk': 'Press <b>v</b> (VM Disk), then configure its fields with <b>f</b>.',
        cpu: 'Press <b>c</b> (CPU), then configure its fields with <b>f</b>.',
        memory: 'Press <b>m</b> (Memory), then configure its fields with <b>f</b>.',
        network: 'Press <b>n</b> (Network), then configure its fields with <b>f</b>.',
      };
      const update = () => {
        const configPath = config.value.trim() || '/vmfs/volumes/datastore1/esxtop-disk.rc';
        const outputPath = output.value.trim() || '/vmfs/volumes/datastore1/esxtop-disk.csv';
        const intervalValue = Math.max(2, Number(interval.value) || 5);
        const samplesValue = Math.max(1, Number(samples.value) || 60);
        const finalOutput = gzip.checked && !outputPath.endsWith('.gz') ? `${outputPath}.gz` : outputPath;
        command.textContent = `esxtop -b -c ${shellQuote(configPath)} -d ${intervalValue} -n ${samplesValue}${gzip.checked ? ' | gzip -9c' : ''} > ${shellQuote(finalOutput)}`;
        hint.innerHTML = panelLabels[panel.value] || panelLabels['disk-both'];
        warning.hidden = outputPath.startsWith('/vmfs/volumes/');
      };
      [config, panel, interval, samples, output, gzip].forEach((element) => {
        element.addEventListener('input', update);
        element.addEventListener('change', update);
      });
      root.querySelector('#capture-copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(command.textContent);
          ctx.toast('Batch command copied.');
        } catch {
          ctx.toast('Copy failed; select the command manually.');
        }
      });
      update();
    },
  };
}

export function renderGuide() {
  return {
    html: `
      <div class="page-head">
        <div class="eyebrow">Field guide · esxtop batch mode</div>
        <h1>Read the capture like a technician</h1>
        <p class="page-lede">The CSV format, every option in the capture command, the meaning of the CPU / memory / storage / network counters, the traps in batch mode and the reasoning behind the guardrails.</p>
      </div>
      <div class="doc-layout">
        <article class="prose" id="guide-body"><div class="loading"><span class="spinner"></span> Loading the field guide…</div></article>
        <aside class="doc-toc" id="guide-toc"><h3>On this page</h3><p class="dim">Loading…</p></aside>
      </div>
    `,
    async mount(root) {
      try {
        const response = await fetch('/docs/esxtop-field-guide.md', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (!root.isConnected) return;
        const { html, toc } = renderMarkdown(text);
        if (!root.isConnected) return;
        root.querySelector('#guide-body').innerHTML = html;
        const tocElement = root.querySelector('#guide-toc');
        tocElement.innerHTML = `<h3>On this page</h3>${toc.map((item) => `<a class="${item.level === 3 ? 'lvl3' : ''}" href="#${escapeAttr(item.id)}">${esc(item.text)}</a>`).join('')}`;
        tocElement.addEventListener('click', (event) => {
          const link = event.target.closest('a[href^="#"]');
          if (!link) return;
          event.preventDefault();
          root.querySelector(`#${CSS.escape(link.getAttribute('href').slice(1))}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } catch (error) {
        root.querySelector('#guide-body').innerHTML = `<div class="callout danger"><strong>The field guide could not be loaded.</strong><br>${esc(error.message)}. The Markdown file is served from <code>/docs/esxtop-field-guide.md</code>.</div>`;
      }
    },
  };
}

export function renderNotFound() {
  return {
    html: `<div class="page-head"><div class="eyebrow">404</div><h1>Page not found</h1><p class="page-lede">The route does not exist. Return to the current capture or open the field guide.</p></div><div class="summary-actions"><a class="btn btn-primary" href="#/">Overview</a><a class="btn" href="#/guide">Field guide</a></div>`,
    mount() {},
  };
}

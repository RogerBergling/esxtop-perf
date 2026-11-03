/* Standalone capture report: HTML download and print-to-PDF. */

import {
  categoryLabel,
  esc,
  formatDuration,
  formatMetric,
  formatNumber,
  statusLabel,
  vmSummary,
  worstStatus,
} from './components.js';
import {
  TECHNICAL_RELATIONSHIPS,
  technicalEntries,
  technicalFor,
} from './technical.js';

const REPORT_CSS = `
.capture-report {
  --rp-ink: #172033;
  --rp-muted: #5c6b82;
  --rp-line: #d8e0ec;
  --rp-panel: #f7f9fc;
  --rp-critical: #b42318;
  --rp-warn: #a15c00;
  --rp-info: #175cd3;
  --rp-ok: #067647;
  box-sizing: border-box;
  max-width: 1120px;
  margin: 1rem auto 2rem;
  padding: 2rem;
  border: 1px solid var(--rp-line);
  border-radius: 14px;
  background: #fff;
  color: var(--rp-ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 10pt;
  line-height: 1.5;
  color-scheme: light;
}
.capture-report *, .capture-report *::before, .capture-report *::after { box-sizing: border-box; }
.capture-report h1, .capture-report h2, .capture-report h3, .capture-report p { margin-top: 0; }
.capture-report h1 { font-size: 2rem; line-height: 1.15; margin-bottom: .35rem; letter-spacing: -.02em; }
.capture-report h2 { font-size: 1.15rem; margin: 2rem 0 .65rem; padding-bottom: .35rem; border-bottom: 2px solid var(--rp-line); }
.capture-report h3 { font-size: .95rem; margin: 1.2rem 0 .5rem; }
.capture-report code, .capture-report .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .86em; }
.capture-report .report-kicker { color: var(--rp-info); font-size: .68rem; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; margin-bottom: .45rem; }
.capture-report .report-subtitle { color: var(--rp-muted); margin-bottom: .9rem; }
.capture-report .report-status-row { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; margin: .85rem 0 1rem; }
.capture-report .report-badge { display: inline-flex; align-items: center; gap: .3rem; border: 1px solid currentColor; border-radius: 999px; padding: .16rem .55rem; font-size: .68rem; font-weight: 750; letter-spacing: .02em; text-transform: uppercase; white-space: nowrap; }
.capture-report .report-badge.critical { color: var(--rp-critical); background: #fef3f2; }
.capture-report .report-badge.warn, .capture-report .report-badge.warning { color: var(--rp-warn); background: #fffaeb; }
.capture-report .report-badge.info { color: var(--rp-info); background: #eff8ff; }
.capture-report .report-badge.ok { color: var(--rp-ok); background: #ecfdf3; }
.capture-report .report-badge.neutral { color: var(--rp-muted); background: var(--rp-panel); }
.capture-report .report-pill { border: 1px solid var(--rp-line); border-radius: 999px; background: var(--rp-panel); padding: .18rem .55rem; color: var(--rp-muted); font-size: .72rem; }
.capture-report .report-score { margin-left: auto; font-weight: 750; color: var(--rp-ink); }
.capture-report .report-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .55rem; margin: 1rem 0 1.4rem; }
.capture-report .report-stat { border: 1px solid var(--rp-line); border-radius: 10px; background: var(--rp-panel); padding: .65rem .7rem; }
.capture-report .report-stat strong { display: block; font-size: 1.35rem; line-height: 1.1; }
.capture-report .report-stat span { color: var(--rp-muted); font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; }
.capture-report .report-section { margin-top: 1.5rem; }
.capture-report .report-table { width: 100%; border-collapse: collapse; margin: .5rem 0 1rem; font-size: .78rem; }
.capture-report .report-table th, .capture-report .report-table td { border-bottom: 1px solid var(--rp-line); padding: .42rem .45rem; text-align: left; vertical-align: top; }
.capture-report .report-table th { color: var(--rp-muted); font-size: .66rem; letter-spacing: .06em; text-transform: uppercase; background: var(--rp-panel); }
.capture-report .report-table td.num, .capture-report .report-table th.num { text-align: right; white-space: nowrap; }
.capture-report .report-table tr:last-child td { border-bottom: 0; }
.capture-report h4 { font-size: .82rem; margin: 1rem 0 .35rem; }
.capture-report .report-table-wrap { width: 100%; max-width: 100%; overflow-x: auto; margin: .5rem 0 1rem; }
.capture-report .report-table-wrap .report-table { margin: 0; }
.capture-report .report-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem; margin: .5rem 0 1rem; }
.capture-report .report-entity-card { border: 1px solid var(--rp-line); border-radius: 9px; background: #fff; padding: .6rem .7rem; break-inside: avoid; min-width: 0; }
.capture-report .report-entity-head { display: flex; align-items: flex-start; justify-content: space-between; gap: .4rem; margin-bottom: .45rem; }
.capture-report .report-entity-head strong { display: block; font-size: .84rem; line-height: 1.25; overflow-wrap: anywhere; }
.capture-report .report-entity-meta { display: block; color: var(--rp-muted); font-size: .68rem; margin-top: .1rem; }
.capture-report .report-metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .28rem .45rem; }
.capture-report .report-metric { min-width: 0; }
.capture-report .report-metric span { display: block; color: var(--rp-muted); font-size: .57rem; letter-spacing: .04em; text-transform: uppercase; line-height: 1.2; }
.capture-report .report-metric strong { display: block; color: var(--rp-ink); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .7rem; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.capture-report .report-finding { border: 1px solid var(--rp-line); border-left: 4px solid var(--rp-muted); border-radius: 8px; background: #fff; padding: .7rem .8rem; margin: .55rem 0; break-inside: avoid; }
.capture-report .report-finding.critical { border-left-color: var(--rp-critical); }
.capture-report .report-finding.warning, .capture-report .report-finding.warn { border-left-color: var(--rp-warn); }
.capture-report .report-finding.info { border-left-color: var(--rp-info); }
.capture-report .report-finding-head { display: flex; flex-wrap: wrap; gap: .4rem .6rem; align-items: baseline; margin-bottom: .25rem; }
.capture-report .report-finding-head strong { font-size: .9rem; }
.capture-report .report-meta { color: var(--rp-muted); font-size: .74rem; }
.capture-report .report-evidence { margin-left: auto; color: var(--rp-ink); font-size: .74rem; font-weight: 650; }
.capture-report .report-finding p { margin: .25rem 0; color: #344054; font-size: .8rem; }
.capture-report .report-finding .report-rec { color: var(--rp-ink); }
.capture-report .report-refs { color: var(--rp-muted) !important; font-size: .72rem !important; }
.capture-report .report-refs a { color: var(--rp-info); text-decoration: none; }
.capture-report .report-empty { border: 1px dashed var(--rp-line); border-radius: 8px; padding: .8rem; color: var(--rp-muted); background: var(--rp-panel); }
.capture-report .report-note { color: var(--rp-muted); font-size: .78rem; }
.capture-report .report-action-intro { border: 1px solid var(--rp-line); border-radius: 8px; background: var(--rp-panel); padding: .7rem .8rem; margin: .5rem 0 1rem; }
.capture-report .report-action-intro h3 { margin-top: 0; }
.capture-report .report-action { border: 1px solid var(--rp-line); border-left: 4px solid var(--rp-muted); border-radius: 8px; background: #fff; padding: .65rem .8rem; margin: .5rem 0; break-inside: avoid; }
.capture-report .report-action.critical { border-left-color: var(--rp-critical); }
.capture-report .report-action.warning, .capture-report .report-action.warn { border-left-color: var(--rp-warn); }
.capture-report .report-action.info { border-left-color: var(--rp-info); }
.capture-report .report-action-head { display: flex; flex-wrap: wrap; gap: .4rem .6rem; align-items: baseline; }
.capture-report .report-action-head strong { font-size: .88rem; }
.capture-report .report-action p { margin: .3rem 0 0; color: #344054; font-size: .8rem; }
.capture-report .report-action .report-action-evidence { color: var(--rp-muted); font-size: .74rem; }
.capture-report .report-priority { display: inline-grid; place-items: center; min-width: 1.8rem; padding: .12rem .35rem; border-radius: 5px; background: var(--rp-ink); color: #fff; font-size: .64rem; font-weight: 800; letter-spacing: .04em; }
.capture-report .report-action.critical .report-priority { background: var(--rp-critical); }
.capture-report .report-action.warning .report-priority, .capture-report .report-action.warn .report-priority { background: var(--rp-warn); }
.capture-report .report-action.info .report-priority { background: var(--rp-info); }
.capture-report .report-tech-inline { border-left: 2px solid var(--rp-line); padding-left: .55rem; color: var(--rp-muted) !important; font-size: .76rem !important; }
.capture-report .report-relations { margin: .5rem 0 1rem; }
.capture-report .report-relations h3 { margin-top: .7rem; }
.capture-report .report-tech-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; margin: .5rem 0 1rem; }
.capture-report .report-tech { border: 1px solid var(--rp-line); border-radius: 9px; background: #fff; padding: .65rem .75rem; break-inside: avoid; }
.capture-report .report-tech.relevant { border-color: color-mix(in srgb, var(--rp-info) 45%, var(--rp-line)); background: #f8fbff; }
.capture-report .report-tech-head { display: flex; flex-wrap: wrap; gap: .35rem .5rem; align-items: baseline; margin-bottom: .25rem; }
.capture-report .report-tech-head strong { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .82rem; color: var(--rp-info); }
.capture-report .report-tech-head span { color: var(--rp-muted); font-size: .74rem; }
.capture-report .report-tech p { margin: .25rem 0; color: #344054; font-size: .76rem; }
.capture-report .report-tech .report-formula { color: var(--rp-muted); }
.capture-report .report-tech code { color: var(--rp-ink); }
.capture-report .report-decision td:first-child { font-weight: 650; white-space: nowrap; }
.capture-report .report-footer { margin-top: 2rem; padding-top: .75rem; border-top: 1px solid var(--rp-line); color: var(--rp-muted); font-size: .72rem; display: flex; justify-content: space-between; gap: 1rem; }
.capture-report .report-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.capture-report .report-list { margin: .35rem 0 0; padding-left: 1.1rem; color: #344054; font-size: .8rem; }
.capture-report .report-list li { margin: .3rem 0; }
.capture-report .report-print-bar { max-width: 1120px; margin: 1rem auto 0; display: flex; justify-content: flex-end; gap: .5rem; }
.capture-report .report-print-bar button { border: 1px solid #175cd3; border-radius: 8px; background: #175cd3; color: #fff; padding: .5rem .8rem; font: inherit; font-weight: 650; cursor: pointer; }
.report-standalone { margin: 0; background: #eef2f7; }
.report-standalone .capture-report { margin-top: 1rem; box-shadow: 0 14px 40px rgba(16, 24, 40, .12); }
@page { size: A4; margin: 12mm; }
@media print {
  .report-print-bar, .report-toolbar, .topbar, .capture-bar, .footer, .category-tabs { display: none !important; }
  .capture-report .report-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .capture-report .report-entity-card { break-inside: avoid; }
  .capture-report .report-table-wrap { overflow: visible; }
  .capture-report .report-table { font-size: 6.8pt; }
  .capture-report .report-table th, .capture-report .report-table td { padding: .25rem .25rem; }
  .capture-report .report-table th { white-space: normal; }
  .report-standalone { background: #fff; }
  .report-standalone .capture-report, .capture-report { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; }
  .capture-report h2 { break-after: avoid; }
  .capture-report .report-finding, .capture-report .report-stat, .capture-report .report-table tr { break-inside: avoid; }
  .capture-report .report-action, .capture-report .report-tech, .capture-report .report-relations { break-inside: avoid; }
}
@media (max-width: 760px) {
  .capture-report { padding: 1rem; }
  .capture-report .report-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .capture-report .report-grid-2 { grid-template-columns: 1fr; }
  .capture-report .report-evidence { margin-left: 0; }
  .capture-report .report-table { display: block; max-width: 100%; overflow-x: auto; }
  .capture-report .report-table th, .capture-report .report-table td { white-space: nowrap; }
  .capture-report .report-card-grid { grid-template-columns: 1fr; }
  .capture-report .report-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

function severityTone(severity) {
  if (severity === 'warning') return 'warning';
  return severity || 'neutral';
}

function statusTone(status) {
  if (status === 'warning') return 'warn';
  return status || 'neutral';
}

function badgeFor(status, text = null) {
  const tone = statusTone(status);
  return `<span class="report-badge ${esc(tone)}">${esc(text || statusLabel(status))}</span>`;
}

function findingEvidence(finding) {
  const stat = String(finding.statistic || 'p95').toUpperCase();
  return `${stat} ${formatMetric(finding.observed, finding.unit)} vs ${formatMetric(finding.threshold, finding.unit)}`;
}

function reportFinding(finding) {
  const tone = severityTone(finding.severity);
  const references = (finding.references || []).filter((reference) => reference?.url);
  const tech = technicalFor(finding.metric);
  return `<article class="report-finding ${esc(tone)}">
    <div class="report-finding-head">
      ${badgeFor(finding.severity)}
      <strong>${esc(finding.title)}</strong>
      <span class="report-meta">${esc(finding.entity || finding.scope || 'Host')} · ${esc(categoryLabel(finding.category))} · <span class="mono">${esc(finding.metric)}</span></span>
      <span class="report-evidence">${findingEvidence(finding)}</span>
    </div>
    <p>${esc(finding.summary || '')}</p>
    ${tech ? `<p class="report-tech-inline"><strong>${esc(finding.metric)} — ${esc(tech.name)}:</strong> ${tech.what}</p>` : ''}
    ${finding.recommendation ? `<p class="report-rec"><strong>What to check:</strong> ${esc(finding.recommendation)}</p>` : ''}
    ${references.length ? `<p class="report-refs"><strong>References:</strong> ${references.map((reference) => `<a href="${esc(reference.url)}">${esc(reference.title || reference.url)}</a>`).join(' · ')}</p>` : ''}
  </article>`;
}

function reportFindings(findings) {
  if (!findings.length) {
    return '<div class="report-empty">No curated threshold breaches were detected. Inspect the raw metrics before concluding that the host is healthy.</div>';
  }
  const groups = [
    ['critical', 'Critical'],
    ['warning', 'Warning'],
    ['info', 'Info'],
  ];
  return groups.map(([severity, label]) => {
    const items = findings.filter((finding) => finding.severity === severity);
    if (!items.length) return '';
    return `<h3>${label} · ${items.length}</h3>${items.map(reportFinding).join('')}`;
  }).join('');
}

function reportActions(findings) {
  const priority = { critical: 'P1', warning: 'P2', info: 'P3' };
  const groups = [
    ['critical', 'Critical actions'],
    ['warning', 'Warning actions'],
    ['info', 'Informational review'],
  ];
  const actions = groups.map(([severity, label]) => {
    const items = findings.filter((finding) => finding.severity === severity);
    if (!items.length) return '';
    return `<h3>${label} · ${items.length}</h3>${items.map((finding) => `
      <article class="report-action ${esc(severityTone(severity))}">
        <div class="report-action-head">
          <span class="report-priority">${priority[severity] || 'P3'}</span>
          <strong>${esc(finding.title)}</strong>
          <span class="report-meta">${esc(finding.entity || finding.scope || 'Host')} · ${esc(categoryLabel(finding.category))} · <span class="mono">${esc(finding.metric)}</span></span>
        </div>
        <p><strong>Do:</strong> ${esc(finding.recommendation || 'Review the raw counter and confirm the finding before changing anything.')}</p>
        <p class="report-action-evidence">${findingEvidence(finding)} · Re-capture after the change and confirm the metric returns inside its guardrail.</p>
      </article>`).join('')}`;
  }).join('');

  const decisionRows = [
    ['%RDY high, %MLMTD > 0', 'The VM or resource pool has a CPU limit. Remove or raise the limit before adding hardware.'],
    ['%RDY high, %MLMTD = 0', 'Host scheduling contention. Reduce vCPUs, move the VM, or add CPU capacity.'],
    ['%CSTP high', 'SMP co-scheduling pressure. Review vCPU count and guest workload balance.'],
    ['%SWPWT / SWCUR / MCTLSZ high', 'Memory pressure or a limit. Check host free memory, reservations and VM limits.'],
    ['N%L low', 'NUMA locality. Resize the VM to fit a node or let vSphere place it correctly.'],
    ['KAVG high', 'VMkernel/vSCSI delay. Check queue depth, paths, vSCSI and host CPU pressure.'],
    ['DAVG high', 'Device/array delay. Check the array, SAN fabric, HBA and path health.'],
    ['GAVG high', 'Split it: GAVG = DAVG + KAVG. Fix the layer that dominates.'],
    ['QUED / %USD high', 'Queue saturation. Check DQLEN/AQLEN and whether the backend can absorb more depth.'],
    ['ABRTS/s, RESETS/s or CONS/s', 'Hard storage-path errors or reservation conflicts. Treat as an incident before tuning.'],
    ['%DRPTX / %DRPRX', 'Network drops. Check the uplink, physical switch, teaming and traffic shaping.'],
  ];

  return `<div class="report-action-intro">
      <h3>Before you change anything</h3>
      <ol class="report-list">
        <li>Confirm the finding is sustained across the capture window, not just a single maximum. The report uses percentiles for this reason.</li>
        <li>Identify the layer first: CPU delay (%RDY/%MLMTD/%CSTP), memory reclaim (MCTLSZ/SWCUR), storage (GAVG = DAVG + KAVG), or network drops.</li>
        <li>Change one thing at a time, record it, and re-capture with the same interval and sample count.</li>
        <li>Compare the same percentile and the worst vCPU, device or VM — not only the host average.</li>
      </ol>
    </div>
    ${actions || '<div class="report-empty">No curated action items were produced. Review the raw metrics and the technical reference before making changes.</div>'}
    <h3>Decision guide</h3>
    <table class="report-table report-decision">
      <thead><tr><th>Signal</th><th>First action</th></tr></thead>
      <tbody>${decisionRows.map(([signal, action]) => `<tr><td class="mono">${esc(signal)}</td><td>${esc(action)}</td></tr>`).join('')}</tbody>
    </table>
    <h3>Change control</h3>
    <ul class="report-list">
      <li>Save the current capture and the configuration or policy you are about to change.</li>
      <li>Prefer the least invasive change: remove an artificial limit, right-size a VM, or correct placement before adding capacity.</li>
      <li>Re-capture after the change and compare P95, P05, peak and the worst affected series.</li>
      <li>Roll back if the signal worsens or a new critical finding appears.</li>
    </ul>`;
}

function reportTechnical(findings) {
  const relevant = new Set(findings.map((finding) => finding.metric));
  const categoryOrder = ['cpu', 'memory', 'storage', 'network'];
  const relationships = Object.entries(TECHNICAL_RELATIONSHIPS)
    .map(([category, items]) => `<h3>${esc(categoryLabel(category))}</h3><ul class="report-list">${items.map((item) => `<li><strong>${esc(item.title)}:</strong> ${esc(item.detail)}</li>`).join('')}</ul>`)
    .join('');
  const categories = categoryOrder.map((category) => {
    const entries = technicalEntries(category)
      .sort((left, right) => Number(relevant.has(right.metric)) - Number(relevant.has(left.metric)) || left.metric.localeCompare(right.metric));
    if (!entries.length) return '';
    return `<h3>${esc(categoryLabel(category))}</h3>
      <div class="report-tech-grid">
        ${entries.map((entry) => `<article class="report-tech ${relevant.has(entry.metric) ? 'relevant' : ''}">
          <div class="report-tech-head">
            <strong>${esc(entry.metric)}</strong>
            <span>${esc(entry.name)}</span>
            ${relevant.has(entry.metric) ? '<span class="report-pill">in this report</span>' : ''}
          </div>
          <p><strong>What it is:</strong> ${entry.what}</p>
          <p><strong>How to read it:</strong> ${entry.read}</p>
          ${entry.formula ? `<p class="report-formula"><strong>Relationship:</strong> <code>${esc(entry.formula)}</code></p>` : ''}
          <p><strong>What to check:</strong> ${entry.check}</p>
        </article>`).join('')}
      </div>`;
  }).join('');
  return `<p class="report-note">This reference covers the counters used by the rules; a capture may not contain every metric. Definitions follow the Broadcom/VMware counter semantics and the field guide's operational guidance.</p>
    <div class="report-relations"><h3>Key relationships</h3>${relationships}</div>
    ${categories}`;
}

function reportEntityCard({ title, subtitle, status, metrics }) {
  return `<article class="report-entity-card">
    <div class="report-entity-head">
      <div><strong>${esc(title)}</strong>${subtitle ? `<span class="report-entity-meta">${esc(subtitle)}</span>` : ''}</div>
      ${badgeFor(status || 'neutral')}
    </div>
    <div class="report-metric-grid">
      ${metrics.map(([label, value]) => `<div class="report-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}
    </div>
  </article>`;
}

function reportHostSeries(doc, metric, predicate = () => true) {
  return (doc.series || []).filter((series) => (
    series.metric === metric &&
    series.scope === 'host' &&
    series.kind === 'numeric' &&
    series.stats?.count &&
    predicate(series)
  ));
}

function reportHostPick(doc, metric, predicate = () => true, field = 'p95', mode = 'max') {
  const candidates = reportHostSeries(doc, metric, predicate);
  if (!candidates.length) return null;
  return candidates.sort((left, right) => (
    mode === 'min'
      ? (Number(left.stats?.[field]) || Infinity) - (Number(right.stats?.[field]) || Infinity)
      : (Number(right.stats?.[field]) || -Infinity) - (Number(left.stats?.[field]) || -Infinity)
  ))[0];
}

function reportHostStorageRows(doc) {
  const map = new Map();
  for (const series of doc.series || []) {
    if (series.scope !== 'host' || series.category !== 'storage' || series.kind !== 'numeric') continue;
    const key = `${series.group}|${series.instance || series.entity}`;
    let row = map.get(key);
    if (!row) {
      row = { key, group: series.group, instance: series.instance || series.entity, series: {} };
      map.set(key, row);
    }
    if (!row.series[series.metric] || (Number(series.stats?.p95) || 0) > (Number(row.series[series.metric]?.stats?.p95) || 0)) {
      row.series[series.metric] = series;
    }
  }
  const rows = [...map.values()].filter((row) => (
    ['GAVG/cmd', 'DAVG/cmd', 'KAVG/cmd', 'QAVG/cmd', 'CMDS/s'].some((metric) => row.series[metric])
  ));
  return rows.sort((left, right) => (
    (Number(right.series['GAVG/cmd']?.stats?.p95) || 0) - (Number(left.series['GAVG/cmd']?.stats?.p95) || 0) ||
    (Number(right.series['CMDS/s']?.stats?.p95) || 0) - (Number(left.series['CMDS/s']?.stats?.p95) || 0)
  ));
}

function hostStorageValue(row, metric, field = 'p95') {
  return row?.series?.[metric]?.stats?.[field] ?? null;
}

function reportHost(doc) {
  const cpuTotal = reportHostPick(doc, 'PCPU %', (series) => series.instance === '_Total')
    || reportHostPick(doc, 'PCPU_UTIL', (series) => series.instance === '_Total')
    || reportHostPick(doc, 'PCPU %')
    || reportHostPick(doc, 'PCPU_UTIL');
  const cpuCore = reportHostPick(doc, 'PCPU %', (series) => series.instance !== '_Total')
    || reportHostPick(doc, 'CORE_UTIL', (series) => series.instance !== '_Total');
  const load = reportHostPick(doc, 'LOAD1');
  const free = reportHostPick(doc, 'FREE_MB', () => true, 'last');
  const machine = reportHostPick(doc, 'MACHINE_MB', () => true, 'last');
  const overcommit = reportHostPick(doc, 'OVERCOMMIT1');
  const balloon = reportHostPick(doc, 'MEMCTL_CURRENT_MB');
  const swap = reportHostPick(doc, 'SWAP_USED_MB');
  const swapIn = reportHostPick(doc, 'SWAP_READ');
  const swapOut = reportHostPick(doc, 'SWAP_WRITE');
  const gavg = reportHostPick(doc, 'GAVG/cmd');
  const qued = reportHostPick(doc, 'QUED');
  const drops = [
    reportHostPick(doc, '%DRPTX'),
    reportHostPick(doc, '%DRPRX'),
  ].filter(Boolean).sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0))[0] || null;
  const freePct = free?.stats?.last && machine?.stats?.last ? (free.stats.last / machine.stats.last) * 100 : null;
  const rows = [
    ['Physical CPU total P95', cpuTotal ? formatMetric(cpuTotal.stats?.p95, '%') : '—', cpuTotal?.status || 'neutral'],
    ['Busiest physical core P95', cpuCore ? formatMetric(cpuCore.stats?.p95, '%') : '—', cpuCore?.status || 'neutral'],
    ['CPU load 1m P95', formatMetric(load?.stats?.p95, ''), load?.status || 'neutral'],
    ['Free memory last', free ? `${formatMetric(free.stats?.last, 'MB')}${freePct !== null ? ` (${formatNumber(freePct, 1)}% of machine)` : ''}` : '—', free?.status || 'neutral'],
    ['Memory overcommit P95', formatMetric(overcommit?.stats?.p95, ''), overcommit?.status || 'neutral'],
    ['Host balloon P95', formatMetric(balloon?.stats?.p95, 'MB'), balloon?.status || 'neutral'],
    ['Host swap used P95', formatMetric(swap?.stats?.p95, 'MB'), swap?.status || 'neutral'],
    ['Host swap I/O P95', `${formatMetric(swapIn?.stats?.p95, 'MB/s')} read / ${formatMetric(swapOut?.stats?.p95, 'MB/s')} write`, worstStatus([swapIn?.status, swapOut?.status].filter(Boolean))],
    ['Host storage GAVG P95', formatMetric(gavg?.stats?.p95, 'ms'), gavg?.status || 'neutral'],
    ['Host storage QUED P95', formatMetric(qued?.stats?.p95, ''), qued?.status || 'neutral'],
    ['Host network drops P95', drops ? formatMetric(drops.stats?.p95, '%') : '—', drops?.status || 'neutral'],
  ];
  const storageRows = reportHostStorageRows(doc);
  const hostTable = `<table class="report-table report-host-table">
    <thead><tr><th>Host signal</th><th class="num">Value</th><th>Status</th></tr></thead>
    <tbody>${rows.map(([label, value, status]) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td><td>${badgeFor(status)}</td></tr>`).join('')}</tbody>
  </table>`;
  const storageCards = storageRows.length ? `<h3>Host disk adapters and devices</h3>
    <p class="report-note">All host-scope storage entities in the capture, sorted by GAVG P95. Latency and queue values are P95; abort/reset values are capture maxima. <code>—</code> means the counter was not captured.</p>
    <div class="report-card-grid">
      ${storageRows.map((row) => reportEntityCard({
        title: row.instance || row.group,
        subtitle: row.group,
        status: worstStatus(Object.values(row.series).map((series) => series.status)),
        metrics: [
          ['IOPS', formatMetric(hostStorageValue(row, 'CMDS/s'), '/s')],
          ['MB Read/s', formatMetric(hostStorageValue(row, 'MBREAD/s'), 'MB/s')],
          ['MB Write/s', formatMetric(hostStorageValue(row, 'MBWRTN/s'), 'MB/s')],
          ['GAVG', formatMetric(hostStorageValue(row, 'GAVG/cmd'), 'ms')],
          ['DAVG', formatMetric(hostStorageValue(row, 'DAVG/cmd'), 'ms')],
          ['KAVG', formatMetric(hostStorageValue(row, 'KAVG/cmd'), 'ms')],
          ['QAVG', formatMetric(hostStorageValue(row, 'QAVG/cmd'), 'ms')],
          ['Read lat', formatMetric(hostStorageValue(row, 'LAT/rd'), 'ms')],
          ['Write lat', formatMetric(hostStorageValue(row, 'LAT/wr'), 'ms')],
          ['QUED', formatMetric(hostStorageValue(row, 'QUED'), '')],
          ['ACTV', formatMetric(hostStorageValue(row, 'ACTV'), '')],
          ['Aborts max', formatMetric(hostStorageValue(row, 'ABRTS/s', 'max'), '/s')],
          ['Resets max', formatMetric(hostStorageValue(row, 'RESETS/s', 'max'), '/s')],
        ],
      })).join('')}
    </div>` : '';
  return `<p class="report-note">Host counters are P95 over the capture window unless marked “last”. Latency is split into GAVG, DAVG and KAVG; the host storage cards below include every host-scope adapter/device captured.</p>
    ${hostTable}
    ${storageCards}`;
}

function reportVms(doc) {
  const names = doc.vms || [];
  if (!names.length) {
    return '<div class="report-empty">No VM groups were detected. ESXi system worlds are excluded from this table.</div>';
  }
  const rows = names.map((name) => {
    const vm = vmSummary(doc, name);
    const status = worstStatus([vm.status, ...vm.findings.map((finding) => finding.severity)]);
    return `<tr>
      <td><strong>${esc(vm.name)}</strong></td>
      <td class="num">${vm.vcpus ?? '—'}</td>
      <td class="num">${vm.configuredMemory !== null ? formatMetric(vm.configuredMemory, 'MB') : '—'}</td>
      <td class="num">${formatMetric(vm.cpuUsed?.stats?.p95, '%')}</td>
      <td class="num">${formatMetric(vm.ready?.stats?.p95, '%')}</td>
      <td class="num">${formatMetric(vm.mlmtd?.stats?.p95, '%')}</td>
      <td class="num">${formatMetric(vm.cstop?.stats?.p95, '%')}</td>
      <td class="num">${formatMetric(vm.balloon?.stats?.p95, 'MB')}</td>
      <td class="num">${formatMetric(vm.swap?.stats?.p95, 'MB')}</td>
      <td class="num">${formatMetric(vm.disk?.stats?.p95, 'ms')}</td>
      <td>${badgeFor(status)}</td>
    </tr>`;
  }).join('');
  return `<p class="report-note">Only VM groups are listed. ESXi system worlds such as <code>system1</code>, <code>hostd.20994601</code> and <code>python.20979311</code> are excluded from this table and from VM-scoped findings.</p>
    <div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>Virtual machine</th><th class="num">vCPU</th><th class="num">Memory</th><th class="num">CPU P95</th><th class="num">%RDY P95</th><th class="num">%MLMTD P95</th><th class="num">%CSTP P95</th><th class="num">Balloon P95</th><th class="num">Swap P95</th><th class="num">GAVG P95</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function diskRowsForVm(vm) {
  const groups = new Map();
  for (const series of vm.list) {
    if (!series.group?.toLowerCase().startsWith('virtual disk')) continue;
    const key = series.instance || series.entity || 'virtual disk';
    let row = groups.get(key);
    if (!row) {
      row = { key, series: {} };
      groups.set(key, row);
    }
    if (!row.series[series.metric] || (Number(series.stats?.p95) || 0) > (Number(row.series[series.metric]?.stats?.p95) || 0)) {
      row.series[series.metric] = series;
    }
  }
  const rows = [...groups.values()];
  const childDisks = rows.filter((row) => /:scsi\d+:\d+$/.test(row.key));
  return childDisks.length ? childDisks : rows;
}

function diskValue(row, metric, field = 'p95') {
  return row?.series?.[metric]?.stats?.[field] ?? null;
}

function diskLabel(instance) {
  const value = String(instance || 'virtual disk');
  const match = value.match(/(:scsi\d+:\d+)$/);
  if (match) return match[1].slice(1);
  const withoutUuid = value.replace(/^.*?\)/, '').replace(/^:/, '').trim();
  return withoutUuid || 'virtual disk total';
}

function diskStatus(row) {
  return worstStatus(Object.values(row.series).map((series) => series.status));
}

function reportVmStorage(doc) {
  const names = doc.vms || [];
  const summaryRows = [];
  const diskCards = [];
  for (const name of names) {
    const vm = vmSummary(doc, name);
    const rows = diskRowsForVm(vm);
    if (!rows.length) continue;
    const worst = [...rows].sort((left, right) => (
      (Number(diskValue(right, 'GAVG/cmd')) || 0) - (Number(diskValue(left, 'GAVG/cmd')) || 0) ||
      (Number(diskValue(right, 'CMDS/s')) || 0) - (Number(diskValue(left, 'CMDS/s')) || 0)
    ))[0];
    summaryRows.push(`<tr>
      <td><strong>${esc(name)}</strong></td>
      <td class="num">${rows.length}</td>
      <td class="num">${formatMetric(diskValue(worst, 'CMDS/s'), '/s')}</td>
      <td class="num">${formatMetric(diskValue(worst, 'MBREAD/s'), 'MB/s')}</td>
      <td class="num">${formatMetric(diskValue(worst, 'MBWRTN/s'), 'MB/s')}</td>
      <td class="num">${formatMetric(diskValue(worst, 'GAVG/cmd'), 'ms')}</td>
      <td class="num">${formatMetric(diskValue(worst, 'DAVG/cmd'), 'ms')}</td>
      <td class="num">${formatMetric(diskValue(worst, 'KAVG/cmd'), 'ms')}</td>
      <td>${badgeFor(diskStatus(worst))}</td>
    </tr>`);
    for (const row of rows) {
      diskCards.push(reportEntityCard({
        title: `${name} · ${diskLabel(row.key)}`,
        subtitle: 'Virtual disk',
        status: diskStatus(row),
        metrics: [
          ['IOPS', formatMetric(diskValue(row, 'CMDS/s'), '/s')],
          ['Read/s', formatMetric(diskValue(row, 'READS/s'), '/s')],
          ['Write/s', formatMetric(diskValue(row, 'WRITES/s'), '/s')],
          ['MB Read/s', formatMetric(diskValue(row, 'MBREAD/s'), 'MB/s')],
          ['MB Write/s', formatMetric(diskValue(row, 'MBWRTN/s'), 'MB/s')],
          ['GAVG', formatMetric(diskValue(row, 'GAVG/cmd'), 'ms')],
          ['DAVG', formatMetric(diskValue(row, 'DAVG/cmd'), 'ms')],
          ['KAVG', formatMetric(diskValue(row, 'KAVG/cmd'), 'ms')],
          ['QAVG', formatMetric(diskValue(row, 'QAVG/cmd'), 'ms')],
          ['Read lat', formatMetric(diskValue(row, 'LAT/rd'), 'ms')],
          ['Write lat', formatMetric(diskValue(row, 'LAT/wr'), 'ms')],
          ['QUED', formatMetric(diskValue(row, 'QUED'), '')],
          ['ACTV', formatMetric(diskValue(row, 'ACTV'), '')],
          ['Aborts max', formatMetric(diskValue(row, 'ABRTS/s', 'max'), '/s')],
          ['Resets max', formatMetric(diskValue(row, 'RESETS/s', 'max'), '/s')],
        ],
      }));
    }
  }
  if (!summaryRows.length) {
    return '<div class="report-empty">No Virtual Disk counters were captured for the detected VMs.</div>';
  }
  return `<h3>VM storage detail</h3>
    <p class="report-note">P95 over the capture window. The quick-scan table selects the virtual disk with the highest GAVG (then highest IOPS) per VM. The cards below show every captured virtual disk and all storage latency, queue, throughput and error values. <code>—</code> means the counter was not captured.</p>
    <h4>Quick scan: worst virtual disk per VM</h4>
    <div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>Virtual machine</th><th class="num">vDisks</th><th class="num">IOPS</th><th class="num">MB Read/s</th><th class="num">MB Write/s</th><th class="num">GAVG</th><th class="num">DAVG</th><th class="num">KAVG</th><th>Status</th></tr></thead>
      <tbody>${summaryRows.join('')}</tbody>
    </table></div>
    <h4>Per-virtual-disk latency and I/O</h4>
    <div class="report-card-grid">${diskCards.join('')}</div>`;
}

function reportVmMemoryNetwork(doc) {
  const names = doc.vms || [];
  if (!names.length) return '<div class="report-empty">No VM groups were detected.</div>';
  const cards = names.map((name) => {
    const vm = vmSummary(doc, name);
    return reportEntityCard({
      title: name,
      subtitle: `${vm.vcpus ?? '—'} vCPU · ${formatMetric(vm.configuredMemory, 'MB')} configured`,
      status: vm.status,
      metrics: [
        ['Memory size', formatMetric(vm.configuredMemory, 'MB')],
        ['Granted', formatMetric(vm.grantedMemory, 'MB')],
        ['Balloon', formatMetric(vm.balloon?.stats?.p95, 'MB')],
        ['Swap', formatMetric(vm.swap?.stats?.p95, 'MB')],
        ['Swap in', formatMetric(vm.swapIn?.stats?.p95, 'MB/s')],
        ['Swap out', formatMetric(vm.swapOut?.stats?.p95, 'MB/s')],
        ['Swap wait', formatMetric(vm.swapWait?.stats?.p95, '%')],
        ['N%L P05', formatMetric(vm.numa?.stats?.p05, '%')],
        ['TX drop', formatMetric(vm.txDrop?.stats?.p95, '%')],
        ['RX drop', formatMetric(vm.rxDrop?.stats?.p95, '%')],
        ['TX Mbps', formatMetric(vm.mbTx?.stats?.p95, 'Mbps')],
        ['RX Mbps', formatMetric(vm.mbRx?.stats?.p95, 'Mbps')],
      ],
    });
  }).join('');
  return `<h3>VM memory and network detail</h3>
    <p class="report-note">P95 for reclaim and network values; <code>N%L</code> shows P05 because lower locality is worse. <code>Swap wait</code> is the vCPU swap-wait percentage. <code>—</code> means the counter was not captured.</p>
    <div class="report-card-grid">${cards}</div>`;
}

function reportCategories(doc) {
  const categories = doc.summary?.categories || {};
  const order = ['cpu', 'memory', 'storage', 'network', 'power', 'other'];
  const rows = order
    .filter((key) => categories[key])
    .map((key) => {
      const item = categories[key];
      return `<tr>
        <td>${esc(categoryLabel(key))}</td>
        <td class="num">${formatNumber(item.series || 0, 0)}</td>
        <td class="num">${formatNumber(item.critical || 0, 0)}</td>
        <td class="num">${formatNumber(item.warning || 0, 0)}</td>
        <td>${badgeFor(item.status || 'neutral')}</td>
      </tr>`;
    }).join('');
  return `<table class="report-table">
    <thead><tr><th>Category</th><th class="num">Signals</th><th class="num">Critical</th><th class="num">Warning</th><th>Status</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No category summaries available.</td></tr>'}</tbody>
  </table>`;
}

function reportDetails(doc) {
  const meta = doc.meta || {};
  const rows = [
    ['Host', meta.host || '—'],
    ['Capture file', meta.filename || '—'],
    ['Capture start', meta.captureStart || '—'],
    ['Capture end', meta.captureEnd || '—'],
    ['Window', formatDuration(meta.durationSeconds)],
    ['Interval', meta.intervalSeconds ? `${formatNumber(meta.intervalSeconds, 1)} s` : '—'],
    ['Samples', formatNumber(meta.sampleCount, 0)],
    ['Metric columns', formatNumber(meta.columns, 0)],
    ['Groups', formatNumber(meta.groupCount ?? (doc.groups || []).length, 0)],
    ['VMs', formatNumber(meta.vmCount ?? (doc.vms || []).length, 0)],
    ['Findings', formatNumber((doc.findings || []).length, 0)],
    ['Parser version', meta.parserVersion || '—'],
    ['Application version', doc.appVersion || '—'],
  ];
  return `<table class="report-table">
    <tbody>${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody>
  </table>`;
}

function reportMethod(doc) {
  const observations = doc.observations || [];
  return `<div class="report-grid-2">
    <div>
      <h3>How to read this report</h3>
      <ul class="report-list">
        <li>Every finding is a guardrail breach, not proof of root cause. Confirm it against the raw counter and the workload.</li>
        <li>Percentiles describe the whole capture window. A single spike and a sustained plateau are different problems.</li>
        <li>VM-scoped CPU and memory findings use only VM groups. Internal ESXi system worlds are excluded.</li>
        <li>The signal score is the share of rule-evaluated signals inside their guardrail; it is not a capacity-planning score or a vSphere alarm.</li>
        <li>References point to Broadcom/VMware and Yellow Bricks guidance. Verify thresholds against the current vendor documentation.</li>
      </ul>
    </div>
    <div>
      <h3>Capture notes</h3>
      <ul class="report-list">
        ${observations.slice(0, 5).map((item) => `<li><strong>${esc(item.title)}:</strong> ${esc(item.text)}</li>`).join('') || '<li>No additional capture notes.</li>'}
      </ul>
    </div>
  </div>`;
}

export function reportBody(doc) {
  const summary = doc.summary || {};
  const findings = doc.findings || [];
  const meta = doc.meta || {};
  const status = summary.status || 'neutral';
  const score = summary.score;
  const critical = summary.critical || 0;
  const warning = summary.warning || 0;
  const info = summary.info || 0;
  const vms = (doc.vms || []).length;
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return `<section class="capture-report">
    <div class="report-kicker">ESXtop Lens · capture report</div>
    <h1>${esc(meta.host || 'ESXi host')}</h1>
    <p class="report-subtitle">${esc(meta.filename || 'capture')} · ${esc(meta.captureStart || '')} → ${esc(meta.captureEnd || '')}</p>
    <div class="report-status-row">
      ${badgeFor(status)}
      <span class="report-pill">${formatNumber(meta.sampleCount, 0)} samples</span>
      <span class="report-pill">${formatNumber(meta.columns, 0)} signals</span>
      <span class="report-pill">${formatNumber(vms, 0)} VMs</span>
      <span class="report-score">Signal score: ${score === null || score === undefined ? '—' : `${score}%`}</span>
    </div>
    <div class="report-summary">
      <div class="report-stat"><strong>${critical}</strong><span>Critical</span></div>
      <div class="report-stat"><strong>${warning}</strong><span>Warnings</span></div>
      <div class="report-stat"><strong>${info}</strong><span>Info</span></div>
      <div class="report-stat"><strong>${formatNumber(summary.counts?.ok || 0, 0)}</strong><span>Within guardrail</span></div>
      <div class="report-stat"><strong>${formatNumber(summary.counts?.neutral || 0, 0)}</strong><span>Unruled</span></div>
    </div>
    <section class="report-section">
      <h2>Summary</h2>
      <p>${esc(summary.headline || 'Capture loaded.')}</p>
      ${summary.scoreBasis ? `<p class="report-note">${esc(summary.scoreBasis)}</p>` : ''}
    </section>
    <section class="report-section">
      <h2>Host snapshot</h2>
      ${reportHost(doc)}
    </section>
    <section class="report-section">
      <h2>What to do next</h2>
      ${reportActions(findings)}
    </section>
    <section class="report-section">
      <h2>Findings</h2>
      ${reportFindings(findings)}
    </section>
    <section class="report-section">
      <h2>Technical reference</h2>
      ${reportTechnical(findings)}
    </section>
    <section class="report-section">
      <h2>Virtual machines</h2>
      ${reportVms(doc)}
      ${reportVmStorage(doc)}
      ${reportVmMemoryNetwork(doc)}
    </section>
    <section class="report-section">
      <h2>Categories</h2>
      ${reportCategories(doc)}
    </section>
    <section class="report-section">
      <h2>Capture details</h2>
      ${reportDetails(doc)}
    </section>
    <section class="report-section">
      <h2>Method and caveats</h2>
      ${reportMethod(doc)}
    </section>
    <footer class="report-footer">
      <span>Generated by ESXtop Lens ${esc(doc.appVersion || '')} on ${esc(generated)}</span>
      <span>Unofficial triage aid. Confirm every finding against the source data and vendor guidance.</span>
    </footer>
  </section>`;
}

export function reportStyles() {
  return REPORT_CSS;
}

function reportFilename(doc) {
  const host = String(doc?.meta?.host || 'capture').replace(/[^\w.-]+/g, '-');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `esxtop-report-${host}-${stamp}.html`;
}

export function reportDocument(doc, { autoPrint = false, toolbar = true } = {}) {
  const title = `ESXtop Lens report · ${doc?.meta?.host || 'capture'}`;
  const printBar = toolbar ? '<div class="report-print-bar"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>' : '';
  const auto = autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),500));</script>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body class="report-standalone">
${printBar}
${reportBody(doc)}
${auto}
</body>
</html>`;
}

export function downloadReportHTML(doc, toast = null) {
  const blob = new Blob([reportDocument(doc)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = reportFilename(doc);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (toast) toast('HTML report downloaded.');
}

export function openReportPrintWindow(doc, toast = null) {
  const win = window.open('', '_blank');
  if (!win) {
    if (toast) toast('Pop-up blocked. Allow pop-ups to export the PDF report.');
    return;
  }
  win.document.open();
  win.document.write(reportDocument(doc, { autoPrint: true, toolbar: true }));
  win.document.close();
  win.focus();
  if (toast) toast('Report opened. Choose “Save as PDF” in the print dialog.');
}

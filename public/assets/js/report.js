/* Standalone capture report: HTML download and print-to-PDF. */

import {
  categoryLabel,
  esc,
  formatDuration,
  formatMetric,
  formatNumber,
  hasAllMetric,
  hasAnyMetric,
  hasMetric,
  hasVcpuSeries,
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
.capture-report .report-metric-id { display: block; color: var(--rp-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .64rem; margin-top: .1rem; overflow-wrap: anywhere; }
.capture-report .report-appendix-entity { margin-top: 1.1rem; break-inside: avoid; }
.capture-report .report-appendix-entity h3 { display: flex; flex-wrap: wrap; gap: .35rem .6rem; align-items: baseline; }
.capture-report .report-appendix-entity h3 .report-note { margin: 0; font-weight: 400; }
.capture-report .report-appendix-table { font-size: .68rem; }
.capture-report .report-appendix-table th, .capture-report .report-appendix-table td { padding: .34rem .35rem; }
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

function reportActions(findings, categories = new Set(REPORT_CATEGORIES), doc = null) {
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
    ['%RDY high, %MLMTD > 0', 'The VM or resource pool has a CPU limit. Remove or raise the limit before adding hardware.', 'cpu', ['%RDY', '%MLMTD'], true],
    ['%RDY high, %MLMTD = 0', 'Host scheduling contention. Reduce vCPUs, move the VM, or add CPU capacity.', 'cpu', ['%RDY']],
    ['%CSTP high', 'SMP co-scheduling pressure. Review vCPU count and guest workload balance.', 'cpu', ['%CSTP']],
    ['%SWPWT / SWCUR / MCTLSZ high', 'Memory pressure or a limit. Check host free memory, reservations and VM limits.', 'memory', ['%SWPWT', 'SWCUR', 'MCTLSZ']],
    ['N%L low', 'NUMA locality. Resize the VM to fit a node or let vSphere place it correctly.', 'memory', ['N%L']],
    ['KAVG high', 'VMkernel/vSCSI delay. Check queue depth, paths, vSCSI and host CPU pressure.', 'storage', ['KAVG/cmd', 'KAVG/rd', 'KAVG/wr']],
    ['DAVG high', 'Device/array delay. Check the array, SAN fabric, HBA and path health.', 'storage', ['DAVG/cmd', 'DAVG/rd', 'DAVG/wr']],
    ['GAVG high', 'Split it: GAVG = DAVG + KAVG. Fix the layer that dominates.', 'storage', ['GAVG/cmd', 'GAVG/rd', 'GAVG/wr']],
    ['QUED / %USD high', 'Queue saturation. Check DQLEN/AQLEN and whether the backend can absorb more depth.', 'storage', ['QUED', '%USD']],
    ['ABRTS/s, RESETS/s or CONS/s', 'Hard storage-path errors or reservation conflicts. Treat as an incident before tuning.', 'storage', ['ABRTS/s', 'RESETS/s', 'CONS/s']],
    ['%DRPTX / %DRPRX', 'Network drops. Check the uplink, physical switch, teaming and traffic shaping.', 'network', ['%DRPTX', '%DRPRX']],
  ].filter((row) => categories.has(row[2]) && (!doc || (row[4] ? hasAllMetric(doc, row[3]) : hasAnyMetric(doc, row[3]))));

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
    ${decisionRows.length ? `<h3>Decision guide</h3>
    <table class="report-table report-decision">
      <thead><tr><th>Signal</th><th>First action</th></tr></thead>
      <tbody>${decisionRows.map(([signal, action]) => `<tr><td class="mono">${esc(signal)}</td><td>${esc(action)}</td></tr>`).join('')}</tbody>
    </table>` : ''}
    <h3>Change control</h3>
    <ul class="report-list">
      <li>Save the current capture and the configuration or policy you are about to change.</li>
      <li>Prefer the least invasive change: remove an artificial limit, right-size a VM, or correct placement before adding capacity.</li>
      <li>Re-capture after the change and compare P95, P05, peak and the worst affected series.</li>
      <li>Roll back if the signal worsens or a new critical finding appears.</li>
    </ul>`;
}

function reportTechnical(findings, categories = new Set(REPORT_CATEGORIES), doc = null) {
  const relevant = new Set(findings.map((finding) => finding.metric));
  const categoryOrder = ['cpu', 'memory', 'storage', 'network'].filter((category) => categories.has(category));
  const relationships = Object.entries(TECHNICAL_RELATIONSHIPS)
    .filter(([category]) => categories.has(category))
    .map(([category, items]) => `<h3>${esc(categoryLabel(category))}</h3><ul class="report-list">${items.map((item) => `<li><strong>${esc(item.title)}:</strong> ${esc(item.detail)}</li>`).join('')}</ul>`)
    .join('');
  const categorySections = categoryOrder.map((category) => {
    const entries = technicalEntries(category)
      .filter((entry) => !doc || hasMetric(doc, entry.metric))
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
  if (!relationships && !categorySections) return '';
  return `<p class="report-note">This reference covers the counters used by the rules that are present in this capture. Definitions follow the Broadcom/VMware counter semantics and the field guide's operational guidance.</p>
    ${relationships ? `<div class="report-relations"><h3>Key relationships</h3>${relationships}</div>` : ''}
    ${categorySections}`;
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

function reportHostSeries(doc, host, metric, predicate = () => true) {
  return (doc.series || []).filter((series) => (
    series.metric === metric &&
    series.scope === 'host' &&
    (!host || series.host === host) &&
    series.kind === 'numeric' &&
    series.stats?.count &&
    predicate(series)
  ));
}

function reportHostPick(doc, host, metric, predicate = () => true, field = 'p95', mode = 'max') {
  const candidates = reportHostSeries(doc, host, metric, predicate);
  if (!candidates.length) return null;
  return candidates.sort((left, right) => (
    mode === 'min'
      ? (Number(left.stats?.[field]) || Infinity) - (Number(right.stats?.[field]) || Infinity)
      : (Number(right.stats?.[field]) || -Infinity) - (Number(left.stats?.[field]) || -Infinity)
  ))[0];
}

function reportHostStorageRows(doc, host) {
  const map = new Map();
  for (const series of doc.series || []) {
    if (series.scope !== 'host' || series.category !== 'storage' || series.kind !== 'numeric' || (host && series.host !== host)) continue;
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
  const rows = [...map.values()].filter((row) => Object.keys(row.series).length);
  return rows.sort((left, right) => {
    const leftLatency = ['GAVG/cmd', 'DAVG/cmd', 'KAVG/cmd', 'QAVG/cmd', 'LAT/rd', 'LAT/wr', 'VSCSI_LATENCY'].map((metric) => Number(left.series[metric]?.stats?.p95) || 0).find((value) => value) || 0;
    const rightLatency = ['GAVG/cmd', 'DAVG/cmd', 'KAVG/cmd', 'QAVG/cmd', 'LAT/rd', 'LAT/wr', 'VSCSI_LATENCY'].map((metric) => Number(right.series[metric]?.stats?.p95) || 0).find((value) => value) || 0;
    return (rightLatency - leftLatency) ||
      ((Number(right.series['CMDS/s']?.stats?.p95) || 0) - (Number(left.series['CMDS/s']?.stats?.p95) || 0));
  });
}

function hostStorageValue(row, metric, field = 'p95') {
  return row?.series?.[metric]?.stats?.[field] ?? null;
}

function reportMetricTitle(doc, series) {
  return doc.metrics?.[series.metric]?.name || series.metricName || series.metric;
}

function reportHost(doc, host, categories) {
  const cpuTotal = reportHostPick(doc, host, 'PCPU %', (series) => series.instance === '_Total')
    || reportHostPick(doc, host, 'PCPU_UTIL', (series) => series.instance === '_Total')
    || reportHostPick(doc, host, 'PCPU %')
    || reportHostPick(doc, host, 'PCPU_UTIL');
  const cpuCore = reportHostPick(doc, host, 'PCPU %', (series) => series.instance !== '_Total')
    || reportHostPick(doc, host, 'CORE_UTIL', (series) => series.instance !== '_Total');
  const load = reportHostPick(doc, host, 'LOAD1');
  const free = reportHostPick(doc, host, 'FREE_MB', () => true, 'last');
  const machine = reportHostPick(doc, host, 'MACHINE_MB', () => true, 'last');
  const overcommit = reportHostPick(doc, host, 'OVERCOMMIT1');
  const balloon = reportHostPick(doc, host, 'MEMCTL_CURRENT_MB');
  const swap = reportHostPick(doc, host, 'SWAP_USED_MB');
  const swapIn = reportHostPick(doc, host, 'SWAP_READ');
  const swapOut = reportHostPick(doc, host, 'SWAP_WRITE');
  const gavg = reportHostPick(doc, host, 'GAVG/cmd');
  const qued = reportHostPick(doc, host, 'QUED');
  const drops = [
    reportHostPick(doc, host, '%DRPTX'),
    reportHostPick(doc, host, '%DRPRX'),
  ].filter(Boolean).sort((left, right) => (Number(right.stats?.p95) || 0) - (Number(left.stats?.p95) || 0))[0] || null;
  const powerNow = reportHostPick(doc, host, 'POWER_NOW');
  const powerCap = reportHostPick(doc, host, 'POWER_CAP');
  const freePct = free?.stats?.last !== null && free?.stats?.last !== undefined && machine?.stats?.last
    ? (free.stats.last / machine.stats.last) * 100
    : null;
  const rows = [];
  if (cpuTotal) rows.push(['Physical CPU total P95', formatMetric(cpuTotal.stats?.p95, '%'), cpuTotal.status, 'cpu']);
  if (cpuCore) rows.push(['Busiest physical core P95', formatMetric(cpuCore.stats?.p95, '%'), cpuCore.status, 'cpu']);
  if (load) rows.push(['CPU load 1m P95', formatMetric(load.stats?.p95, ''), load.status, 'cpu']);
  if (free) rows.push(['Free memory last', `${formatMetric(free.stats?.last, 'MB')}${freePct !== null ? ` (${formatNumber(freePct, 1)}% of machine)` : ''}`, free.status, 'memory']);
  if (overcommit) rows.push(['Memory overcommit P95', formatMetric(overcommit.stats?.p95, ''), overcommit.status, 'memory']);
  if (balloon) rows.push(['Host balloon P95', formatMetric(balloon.stats?.p95, 'MB'), balloon.status, 'memory']);
  if (swap) rows.push(['Host swap used P95', formatMetric(swap.stats?.p95, 'MB'), swap.status, 'memory']);
  if (swapIn || swapOut) rows.push(['Host swap I/O P95', `${formatMetric(swapIn?.stats?.p95, 'MB/s')} read / ${formatMetric(swapOut?.stats?.p95, 'MB/s')} write`, worstStatus([swapIn?.status, swapOut?.status].filter(Boolean)), 'memory']);
  if (gavg) rows.push(['Host storage GAVG P95', formatMetric(gavg.stats?.p95, 'ms'), gavg.status, 'storage']);
  if (qued) rows.push(['Host storage QUED P95', formatMetric(qued.stats?.p95, ''), qued.status, 'storage']);
  if (drops) rows.push(['Host network drops P95', formatMetric(drops.stats?.p95, '%'), drops.status, 'network']);
  if (powerNow) rows.push(['Host power usage P95', formatMetric(powerNow.stats?.p95, 'W'), powerNow.status, 'power']);
  if (powerCap) rows.push(['Host power cap', formatMetric(powerCap.stats?.last, 'W'), powerCap.status, 'power']);
  const visibleRows = rows.filter((row) => categories.has(row[3]));
  const storageRows = categories.has('storage') ? reportHostStorageRows(doc, host) : [];
  const hostTable = `<table class="report-table report-host-table">
    <thead><tr><th>Host signal</th><th class="num">Value</th><th>Status</th></tr></thead>
    <tbody>${visibleRows.map(([label, value, status]) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td><td>${badgeFor(status)}</td></tr>`).join('') || '<tr><td colspan="3">No host signals in the selected categories.</td></tr>'}</tbody>
  </table>`;
  const maxMetrics = new Set(['ABRTS/s', 'RESETS/s', 'CONS/s', 'ATSF', 'DELETE_F', 'ATS', 'ATS_FAIL_MS', 'CLONE_F', 'LCLONE_F', 'EXTSTATS_F', 'RESSPACE_F', 'ZERO_F']);
  const storageCards = storageRows.length ? `<h3>Host storage entities</h3>
    <p class="report-note">Every host-scope storage entity in the capture, sorted by the highest available latency. The card lists every metric captured for that entity; counters absent from the capture are omitted. Latency and queue values are P95; hard error counters use the capture maximum.</p>
    <div class="report-card-grid">
      ${storageRows.map((row) => {
        const metrics = Object.keys(row.series)
          .sort((left, right) => {
            const leftName = reportMetricTitle(doc, row.series[left]);
            const rightName = reportMetricTitle(doc, row.series[right]);
            return leftName.localeCompare(rightName) || left.localeCompare(right);
          })
          .map((metric) => {
            const series = row.series[metric];
            const field = maxMetrics.has(metric) ? 'max' : 'p95';
            return [reportMetricTitle(doc, series), formatMetric(hostStorageValue(row, metric, field), series.unit)];
          });
        return reportEntityCard({
          title: row.instance || row.group,
          subtitle: row.group,
          status: worstStatus(Object.values(row.series).map((series) => series.status)),
          metrics,
        });
      }).join('')}
    </div>` : '';
  const storageNote = categories.has('storage')
    ? ' Host storage cards list only the counters that were present in this capture.'
    : '';
  return `<p class="report-note">Scope: <strong>${esc(host || 'capture host')}</strong>. Host counters are P95 over the capture window unless marked “last”.${storageNote}</p>
    ${hostTable}
    ${storageCards}`;
}

export const REPORT_CATEGORIES = ['cpu', 'memory', 'storage', 'network', 'power', 'interrupt', 'other'];

export function reportCategorySet(scope = {}) {
  const selected = Array.isArray(scope.categories) && scope.categories.length
    ? scope.categories.filter((category) => REPORT_CATEGORIES.includes(category))
    : [...REPORT_CATEGORIES];
  return new Set(selected.length ? selected : REPORT_CATEGORIES);
}

function filteredReportSummary(doc, categories) {
  const selectedSeries = (doc.series || []).filter((series) => categories.has(series.category));
  const selectedFindings = (doc.findings || []).filter((finding) => categories.has(finding.category));
  const counts = { ok: 0, warn: 0, critical: 0, neutral: 0, info: 0 };
  for (const series of selectedSeries) counts[series.status || 'neutral'] += 1;
  const evaluated = counts.ok + counts.warn + counts.critical;
  const critical = selectedFindings.filter((finding) => finding.severity === 'critical').length;
  const warning = selectedFindings.filter((finding) => finding.severity === 'warning').length;
  const info = selectedFindings.filter((finding) => finding.severity === 'info').length;
  const status = critical ? 'critical' : warning ? 'warn' : evaluated ? 'ok' : 'neutral';
  const score = evaluated ? Math.round((counts.ok / evaluated) * 100) : null;
  const headline = critical
    ? `${critical} critical finding${critical === 1 ? '' : 's'} in the selected categories`
    : warning
      ? `${warning} warning${warning === 1 ? '' : 's'} in the selected categories`
      : evaluated
        ? 'No threshold breaches in the selected categories'
        : 'No rule-evaluated series in the selected categories';
  return { counts, evaluated, critical, warning, info, status, score, headline, selectedFindings };
}

export function reportHostNames(doc) {
  const fromMeta = Array.isArray(doc?.meta?.hosts) ? doc.meta.hosts.filter(Boolean) : [];
  if (fromMeta.length) return fromMeta;
  return [...new Set((doc?.series || []).map((series) => series.host).filter(Boolean))].sort();
}

export function reportVmNames(doc, host = null) {
  return [...new Set((doc?.series || [])
    .filter((series) => series.scope === 'vm' && series.vm && (!host || series.host === host))
    .map((series) => series.vm))]
    .sort((left, right) => String(left).localeCompare(String(right)));
}

function reportScopedVmNames(doc, host, selectedVms = []) {
  const names = reportVmNames(doc, host);
  if (!Array.isArray(selectedVms) || !selectedVms.length) return names;
  const selected = new Set(selectedVms);
  return names.filter((name) => selected.has(name));
}

function reportVms(doc, host = null, selectedVms = [], categories = new Set(REPORT_CATEGORIES)) {
  const names = reportScopedVmNames(doc, host, selectedVms);
  if (!names.length) {
    return '<div class="report-empty">No VM groups were detected for the selected host and scope. ESXi system worlds are excluded from this table.</div>';
  }
  const hasVcpuGroup = hasVcpuSeries(doc);
  const columns = [{ header: 'Virtual machine', cell: (vm) => `<td><strong>${esc(vm.name)}</strong></td>` }];
  if (categories.has('cpu') && hasVcpuGroup) columns.push({ header: 'vCPU', cell: (vm) => `<td class="num">${vm.vcpus ?? '—'}</td>` });
  if (categories.has('cpu') && hasMetric(doc, '%USED')) columns.push({ header: 'CPU P95', cell: (vm) => `<td class="num">${formatMetric(vm.cpuUsed?.stats?.p95, '%')}</td>` });
  if (categories.has('cpu') && hasMetric(doc, '%RDY')) columns.push({ header: '%RDY P95', cell: (vm) => `<td class="num">${formatMetric(vm.ready?.stats?.p95, '%')}</td>` });
  if (categories.has('cpu') && hasMetric(doc, '%MLMTD')) columns.push({ header: '%MLMTD P95', cell: (vm) => `<td class="num">${formatMetric(vm.mlmtd?.stats?.p95, '%')}</td>` });
  if (categories.has('cpu') && hasMetric(doc, '%CSTP')) columns.push({ header: '%CSTP P95', cell: (vm) => `<td class="num">${formatMetric(vm.cstop?.stats?.p95, '%')}</td>` });
  if (categories.has('memory') && hasMetric(doc, 'MEMSZ')) columns.push({ header: 'Memory', cell: (vm) => `<td class="num">${vm.configuredMemory !== null ? formatMetric(vm.configuredMemory, 'MB') : '—'}</td>` });
  if (categories.has('memory') && hasMetric(doc, 'MCTLSZ')) columns.push({ header: 'Balloon P95', cell: (vm) => `<td class="num">${formatMetric(vm.balloon?.stats?.p95, 'MB')}</td>` });
  if (categories.has('memory') && hasMetric(doc, 'SWCUR')) columns.push({ header: 'Swap P95', cell: (vm) => `<td class="num">${formatMetric(vm.swap?.stats?.p95, 'MB')}</td>` });
  if (categories.has('storage') && ['GAVG/cmd', 'LAT/rd', 'LAT/wr', 'VSCSI_LATENCY'].some((metric) => hasMetric(doc, metric))) columns.push({ header: 'Storage latency P95', cell: (vm) => `<td class="num">${formatMetric(vm.disk?.stats?.p95, vm.disk?.unit || 'ms')}</td>` });
  columns.push({ header: 'Status', cell: (vm) => `<td>${badgeFor(worstStatus([vm.status, ...vm.findings.map((finding) => finding.severity)]))}</td>` });
  const rows = names.map((name) => {
    const vm = vmSummary(doc, name, host, categories);
    return `<tr>${columns.map((column) => column.cell(vm)).join('')}</tr>`;
  }).join('');
  return `<p class="report-note">One row per VM. Columns are shown only when the metric and category exist in this capture. ESXi system worlds such as <code>system1</code>, <code>hostd.20994601</code> and <code>python.20979311</code> are excluded from this table and from VM-scoped findings.</p>
    <div class="report-table-wrap"><table class="report-table">
      <thead><tr>${columns.map((column) => `<th${['Virtual machine', 'Status'].includes(column.header) ? '' : ' class="num"'}>${esc(column.header)}</th>`).join('')}</tr></thead>
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

function reportVmStorage(doc, host = null, selectedVms = [], categories = new Set(REPORT_CATEGORIES)) {
  if (!categories.has('storage')) return '';
  const names = reportScopedVmNames(doc, host, selectedVms);
  const summaryRows = [];
  const diskCards = [];
  const vmDiskMetrics = new Set((doc.series || [])
    .filter((series) => series.scope === 'vm' && String(series.group || '').toLowerCase().startsWith('virtual disk'))
    .map((series) => series.metric));
  const summaryColumns = [
    ['CMDS/s', 'IOPS'],
    ['MBREAD/s', 'MB Read/s'],
    ['MBWRTN/s', 'MB Write/s'],
    ['GAVG/cmd', 'GAVG'],
    ['DAVG/cmd', 'DAVG'],
    ['KAVG/cmd', 'KAVG'],
    ['QAVG/cmd', 'QAVG'],
    ['LAT/rd', 'Read latency'],
    ['LAT/wr', 'Write latency'],
    ['VSCSI_LATENCY', 'Virtual disk latency'],
    ['QUED', 'QUED'],
    ['ACTV', 'ACTV'],
  ].filter(([metric]) => vmDiskMetrics.has(metric));
  const maxMetrics = new Set(['ABRTS/s', 'RESETS/s', 'CONS/s', 'ATSF', 'DELETE_F', 'ATS', 'CLONE_F', 'LCLONE_F', 'EXTSTATS_F', 'RESSPACE_F', 'ZERO_F']);
  for (const name of names) {
    const vm = vmSummary(doc, name, host, categories);
    const rows = diskRowsForVm(vm);
    if (!rows.length) continue;
    const worst = [...rows].sort((left, right) => {
      const leftLatency = ['GAVG/cmd', 'DAVG/cmd', 'KAVG/cmd', 'QAVG/cmd', 'LAT/rd', 'LAT/wr', 'VSCSI_LATENCY'].map((metric) => Number(diskValue(left, metric)) || 0).find((value) => value) || 0;
      const rightLatency = ['GAVG/cmd', 'DAVG/cmd', 'KAVG/cmd', 'QAVG/cmd', 'LAT/rd', 'LAT/wr', 'VSCSI_LATENCY'].map((metric) => Number(diskValue(right, metric)) || 0).find((value) => value) || 0;
      return (rightLatency - leftLatency) || ((Number(diskValue(right, 'CMDS/s')) || 0) - (Number(diskValue(left, 'CMDS/s')) || 0));
    })[0];
    summaryRows.push(`<tr>
      <td><strong>${esc(name)}</strong></td>
      <td class="num">${rows.length}</td>
      ${summaryColumns.map(([metric]) => {
        const series = worst.series[metric];
        return `<td class="num">${formatMetric(diskValue(worst, metric), series?.unit || '')}</td>`;
      }).join('')}
      <td>${badgeFor(diskStatus(worst))}</td>
    </tr>`);
    for (const row of rows) {
      const metrics = Object.keys(row.series)
        .sort((left, right) => reportMetricTitle(doc, row.series[left]).localeCompare(reportMetricTitle(doc, row.series[right])) || left.localeCompare(right))
        .map((metric) => {
          const series = row.series[metric];
          const field = maxMetrics.has(metric) ? 'max' : 'p95';
          return [reportMetricTitle(doc, series), formatMetric(diskValue(row, metric, field), series.unit)];
        });
      diskCards.push(reportEntityCard({
        title: `${name} · ${diskLabel(row.key)}`,
        subtitle: 'Virtual disk',
        status: diskStatus(row),
        metrics,
      }));
    }
  }
  if (!summaryRows.length) {
    return '<div class="report-empty">No Virtual Disk counters were captured for the detected VMs.</div>';
  }
  return `<h3>VM storage detail</h3>
    <p class="report-note">P95 over the capture window unless the counter is a hard error field, which uses the capture maximum. The quick-scan table has one row per VM; the cards below have one card per virtual disk. A VM with multiple disks appears once per disk — that is disk-level detail, not a duplicate VM record. Every captured metric is listed, and counters absent from the capture are omitted.</p>
    <h4>Quick scan: worst virtual disk per VM</h4>
    <div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>Virtual machine</th><th class="num">vDisks</th>${summaryColumns.map(([, label]) => `<th class="num">${esc(label)}</th>`).join('')}<th>Status</th></tr></thead>
      <tbody>${summaryRows.join('')}</tbody>
    </table></div>
    <h4>Per-virtual-disk latency and I/O</h4>
    <div class="report-card-grid">${diskCards.join('')}</div>`;
}

function reportVmMemoryNetwork(doc, host = null, selectedVms = [], categories = new Set(REPORT_CATEGORIES)) {
  const showMemory = categories.has('memory');
  const showNetwork = categories.has('network');
  if (!showMemory && !showNetwork) return '';
  const names = reportScopedVmNames(doc, host, selectedVms);
  if (!names.length) return '<div class="report-empty">No VM groups were detected for the selected host and scope.</div>';
  const memoryFields = [
    ['MEMSZ', 'Memory size', 'MB', 'configuredMemory'],
    ['GRANT', 'Granted', 'MB', 'grantedMemory'],
    ['MCTLSZ', 'Balloon', 'MB', 'balloon'],
    ['SWCUR', 'Swap', 'MB', 'swap'],
    ['SWR/s', 'Swap in', 'MB/s', 'swapIn'],
    ['SWW/s', 'Swap out', 'MB/s', 'swapOut'],
    ['%SWPWT', 'Swap wait', '%', 'swapWait'],
    ['N%L', 'N%L P05', '%', 'numa'],
  ].filter(([metric]) => hasMetric(doc, metric));
  const networkFields = [
    ['%DRPTX', 'TX drop', '%', 'txDrop'],
    ['%DRPRX', 'RX drop', '%', 'rxDrop'],
    ['MbTX/s', 'TX Mbps', 'Mbps', 'mbTx'],
    ['MbRX/s', 'RX Mbps', 'Mbps', 'mbRx'],
  ].filter(([metric]) => hasMetric(doc, metric));
  const cards = [];
  for (const name of names) {
    const vm = vmSummary(doc, name, host, categories);
    const metrics = [];
    if (showMemory) {
      for (const [metric, label, unit, field] of memoryFields) {
        const series = vm[field];
        let value = metric === 'N%L' ? series?.stats?.p05 : series?.stats?.p95;
        if (metric === 'MEMSZ') value = vm.configuredMemory;
        if (metric === 'GRANT') value = vm.grantedMemory;
        metrics.push([label, formatMetric(value, unit)]);
      }
    }
    if (showNetwork) {
      for (const [metric, label, unit, field] of networkFields) {
        metrics.push([label, formatMetric(vm[field]?.stats?.p95, unit)]);
      }
    }
    if (!metrics.length) continue;
    const subtitleParts = [];
    if (vm.vcpus !== null && vm.vcpus !== undefined) subtitleParts.push(`${vm.vcpus} vCPU`);
    if (vm.configuredMemory !== null && vm.configuredMemory !== undefined) subtitleParts.push(`${formatMetric(vm.configuredMemory, 'MB')} configured`);
    cards.push(reportEntityCard({
      title: name,
      subtitle: subtitleParts.join(' · '),
      status: vm.status,
      metrics,
    }));
  }
  if (!cards.length) return '<div class="report-empty">No VM memory or network counters were captured for the selected VMs.</div>';
  const title = showMemory && showNetwork ? 'VM memory and network detail' : showMemory ? 'VM memory detail' : 'VM network detail';
  const note = showMemory
    ? 'P95 for reclaim values; N%L shows P05 because lower locality is worse. Swap wait is the vCPU swap-wait percentage. Only counters present in the capture are shown.'
    : 'P95 for network values. Only counters present in the capture are shown.';
  return `<h3>${title}</h3><p class="report-note">${esc(note)}</p><div class="report-card-grid">${cards.join('')}</div>`;
}

function reportMetricAppendix(doc, selectedCategories = new Set(REPORT_CATEGORIES)) {
  const series = (doc.series || []).filter((item) => item.stats && selectedCategories.has(item.category));
  const groups = new Map();
  for (const item of series) {
    let key;
    let label;
    let meta;
    let order;
    if (item.scope === 'vm' && item.vm) {
      key = `vm|${item.host}|${item.vm}`;
      label = item.vm;
      meta = `VM · ${item.host}`;
      order = 0;
    } else if (item.category === 'storage' && item.instance) {
      key = `storage|${item.host}|${item.group}|${item.instance}`;
      label = item.instance;
      meta = `${item.group} · ${item.host}`;
      order = 2;
    } else if (item.scope === 'host') {
      key = `host|${item.host}`;
      label = item.host || 'ESXi host';
      meta = 'Host and system metrics';
      order = 1;
    } else {
      key = `other|${item.host}|${item.group}|${item.entity}`;
      label = item.entity || item.group || 'Other';
      meta = `${item.group} · ${item.host}`;
      order = 3;
    }
    let group = groups.get(key);
    if (!group) {
      group = { key, label, meta, order, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  const sorted = [...groups.values()].sort((left, right) => (
    left.order - right.order ||
    left.label.localeCompare(right.label) ||
    left.meta.localeCompare(right.meta)
  ));
  const sections = sorted.map((group) => {
    const items = group.items.sort((left, right) => (
      String(left.category).localeCompare(String(right.category)) ||
      String(left.metricName || left.metric).localeCompare(String(right.metricName || right.metric)) ||
      String(left.group).localeCompare(String(right.group)) ||
      String(left.instance || '').localeCompare(String(right.instance || ''))
    ));
    return `<section class="report-appendix-entity">
      <h3>${esc(group.label)} <span class="report-note">${esc(group.meta)} · ${items.length} metrics</span></h3>
      <div class="report-table-wrap"><table class="report-table report-appendix-table">
        <thead><tr><th>Category</th><th>Metric</th><th class="num">Min</th><th class="num">Avg</th><th class="num">P95</th><th class="num">Max</th><th class="num">Last</th><th>Status</th></tr></thead>
        <tbody>${items.map((item) => {
          const definition = doc.metrics?.[item.metric] || {};
          const name = definition.name || item.metricName || item.metric;
          return `<tr>
            <td>${esc(categoryLabel(item.category))}</td>
            <td><strong>${esc(name)}</strong><span class="report-metric-id">${esc(item.metric)} · ${esc(item.group)}${item.instance ? ` · ${esc(item.instance)}` : ''}${item.counter ? ` · ${esc(item.counter)}` : ''}</span></td>
            <td class="num">${formatMetric(item.stats?.min, item.unit)}</td>
            <td class="num">${formatMetric(item.stats?.avg, item.unit)}</td>
            <td class="num">${formatMetric(item.stats?.p95, item.unit)}</td>
            <td class="num">${formatMetric(item.stats?.max, item.unit)}</td>
            <td class="num">${formatMetric(item.stats?.last, item.unit)}</td>
            <td>${badgeFor(item.status || 'neutral')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>`;
  }).join('');
  return `<p class="report-note">Every captured series is included below. Each VM appears once as an entity heading with all its captured metrics underneath; host and disk entities are grouped the same way. Values are statistics over the capture window; raw sample arrays are not embedded in the report. Open the metric in ESXtop Lens for the complete time series or use <b>Export filtered metrics CSV</b>.</p>
    <p class="report-note"><strong>${formatNumber(series.length, 0)} series · ${sorted.length} entities.</strong> For very large captures this appendix can be very long.</p>
    ${sections || '<div class="report-empty">No metric series are available for the selected categories.</div>'}`;
}

function reportCategories(doc, selectedCategories = new Set(REPORT_CATEGORIES)) {
  const categories = doc.summary?.categories || {};
  const rows = REPORT_CATEGORIES
    .filter((key) => selectedCategories.has(key) && (categories[key]?.series || 0) > 0)
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
    ['Primary host', meta.host || '—'],
    ['Hosts in capture', (meta.hosts || reportHostNames(doc)).join(', ') || '—'],
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
        <li><strong>Healthy</strong> means a curated rule evaluated this series and it is inside its guardrail. <strong>Warning</strong> and <strong>Critical</strong> mean the rule threshold was crossed. <strong>Info</strong> is an informational rule. <strong>No rule</strong> means no curated threshold was applied, so no health verdict exists for that series. No rule does not mean healthy, zero, missing or hidden.</li>
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

export function reportBody(doc, scope = {}) {
  const meta = doc.meta || {};
  const categories = reportCategorySet(scope);
  const reportSummary = filteredReportSummary(doc, categories);
  const findings = reportSummary.selectedFindings;
  const status = reportSummary.status;
  const score = reportSummary.score;
  const critical = reportSummary.critical;
  const warning = reportSummary.warning;
  const info = reportSummary.info;
  const vms = (doc.vms || []).length;
  const hosts = reportHostNames(doc);
  const requestedMode = scope.mode || 'all';
  const mode = ['all', 'both', 'hosts', 'vms'].includes(requestedMode)
    ? requestedMode
    : requestedMode === 'host' ? 'both' : requestedMode === 'vm' ? 'vms' : 'all';
  const requestedHosts = (Array.isArray(scope.hosts) && scope.hosts.length
    ? scope.hosts
    : (scope.host ? [scope.host] : [])).filter(Boolean);
  const selectedHosts = (mode === 'all'
    ? hosts
    : requestedHosts.length ? requestedHosts : [meta.host || hosts[0] || '']).filter(Boolean);
  const pageVms = (scope.vms || []).map((item) => {
    if (typeof item === 'string') return { host: scope.host || meta.host || '', vm: item };
    if (Array.isArray(item)) return { host: item[0], vm: item[1] };
    return item;
  }).filter((item) => item && item.vm);
  const selectedPairsByHost = new Map();
  for (const pair of pageVms) {
    if (!selectedPairsByHost.has(pair.host)) selectedPairsByHost.set(pair.host, []);
    if (!selectedPairsByHost.get(pair.host).includes(pair.vm)) selectedPairsByHost.get(pair.host).push(pair.vm);
  }
  const detailHosts = mode === 'all' ? hosts : mode === 'both' || mode === 'hosts' ? selectedHosts : [];
  const vmHosts = mode === 'all' ? hosts : mode === 'both' ? selectedHosts : mode === 'vms' ? [...selectedPairsByHost.keys()] : [];
  const scopeLabel = mode === 'all'
    ? `all ${hosts.length} host${hosts.length === 1 ? '' : 's'} and all ${vms} VMs`
    : mode === 'hosts'
      ? `${selectedHosts.length} selected host${selectedHosts.length === 1 ? '' : 's'}; host detail only`
      : mode === 'both'
        ? `${selectedHosts.length} selected host${selectedHosts.length === 1 ? '' : 's'}; ${pageVms.length ? `${pageVms.length} selected VM${pageVms.length === 1 ? '' : 's'}` : 'all VMs on those hosts'}`
        : `${pageVms.length} selected VM${pageVms.length === 1 ? '' : 's'} across ${selectedPairsByHost.size} host${selectedPairsByHost.size === 1 ? '' : 's'}; VM detail only`;
  const title = mode === 'all' && hosts.length > 1
    ? 'All ESXi hosts · capture report'
    : mode === 'vms'
      ? 'Selected VMs · capture report'
      : selectedHosts.length > 1
        ? `${selectedHosts.length} selected hosts · capture report`
        : (selectedHosts[0] || meta.host || 'ESXi host');
  const generated = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const technical = reportTechnical(findings, categories, doc);
  const hostSections = detailHosts.map((host) => `<section class="report-section">
      <h2>Host snapshot${detailHosts.length > 1 ? ` · ${esc(host)}` : ''}</h2>
      ${reportHost(doc, host, categories)}
    </section>`).join('');
  const vmSections = vmHosts.map((host) => {
    const selectedNames = selectedPairsByHost.get(host) || [];
    const names = mode === 'vms'
      ? reportScopedVmNames(doc, host, selectedNames)
      : mode === 'both' && selectedNames.length
        ? reportScopedVmNames(doc, host, selectedNames)
        : reportVmNames(doc, host);
    if (!names.length) return '';
    return `<section class="report-section">
      ${vmHosts.length > 1 ? `<h3>Virtual machines · ${esc(host)}</h3>` : ''}
      ${reportVms(doc, host, names, categories)}
      ${reportVmStorage(doc, host, names, categories)}
      ${reportVmMemoryNetwork(doc, host, names, categories)}
    </section>`;
  }).join('');
  return `<section class="capture-report">
    <div class="report-kicker">ESXtop Lens · capture report</div>
    <h1>${esc(title)}</h1>
    <p class="report-subtitle">${esc(meta.filename || 'capture')} · ${esc(meta.captureStart || '')} → ${esc(meta.captureEnd || '')}</p>
    <div class="report-status-row">
      ${badgeFor(status)}
      <span class="report-pill">${formatNumber(meta.sampleCount, 0)} samples</span>
      <span class="report-pill">${formatNumber(meta.columns, 0)} signals</span>
      <span class="report-pill">${formatNumber(vms, 0)} VMs in capture</span>
      ${hosts.length > 1 ? `<span class="report-pill">${hosts.length} hosts</span>` : ''}
      <span class="report-score">Signal score: ${score === null || score === undefined ? '—' : `${score}%`}</span>
    </div>
    <p class="report-note">Detailed sections: <strong>${esc(scopeLabel)}</strong>. Metric categories: <strong>${esc([...categories].map(categoryLabel).join(', '))}</strong>. Executive summary, findings, categories and complete appendix are filtered by the selected categories; host/VM selection controls the detail sections.</p>
    <div class="report-summary">
      <div class="report-stat"><strong>${critical}</strong><span>Critical</span></div>
      <div class="report-stat"><strong>${warning}</strong><span>Warnings</span></div>
      <div class="report-stat"><strong>${info}</strong><span>Info</span></div>
      <div class="report-stat"><strong>${formatNumber(reportSummary.counts.ok, 0)}</strong><span>Within guardrail</span></div>
      <div class="report-stat"><strong>${formatNumber(reportSummary.counts.neutral, 0)}</strong><span>No rule</span></div>
    </div>
    <section class="report-section">
      <h2>Summary</h2>
      <p>${esc(reportSummary.headline)}</p>
      <p class="report-note">Signal score is the share of rule-evaluated series in the selected categories currently inside their guardrail.</p>
    </section>
    ${hostSections}
    <section class="report-section">
      <h2>What to do next</h2>
      ${reportActions(findings, categories, doc)}
    </section>
    <section class="report-section">
      <h2>Findings</h2>
      ${reportFindings(findings)}
    </section>
    ${technical ? `<section class="report-section">
      <h2>Technical reference</h2>
      ${technical}
    </section>` : ''}
    ${vmSections}
    <section class="report-section">
      <h2>Categories</h2>
      ${reportCategories(doc, categories)}
    </section>
    <section class="report-section">
      <h2>Capture details</h2>
      ${reportDetails(doc)}
    </section>
    <section class="report-section report-appendix">
      <h2>Complete metric appendix</h2>
      ${reportMetricAppendix(doc, categories)}
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

export function reportDocument(doc, { autoPrint = false, toolbar = true, scope = {} } = {}) {
  const title = `ESXtop Lens report · ${scope.host || doc?.meta?.host || 'capture'}`;
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
${reportBody(doc, scope)}
${auto}
</body>
</html>`;
}

export function downloadReportHTML(doc, toast = null, scope = {}) {
  const blob = new Blob([reportDocument(doc, { scope })], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = reportFilename(doc);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (toast) toast('HTML report downloaded.');
}

export function openReportPrintWindow(doc, toast = null, scope = {}) {
  const win = window.open('', '_blank');
  if (!win) {
    if (toast) toast('Pop-up blocked. Allow pop-ups to export the PDF report.');
    return;
  }
  win.document.open();
  win.document.write(reportDocument(doc, { autoPrint: true, toolbar: true, scope }));
  win.document.close();
  win.focus();
  if (toast) toast('Report opened. Choose “Save as PDF” in the print dialog.');
}

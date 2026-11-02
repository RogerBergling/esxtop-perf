/* Dependency-free responsive SVG line charts and sparklines. */

import { esc, formatMetric, formatNumber, PALETTE } from './components.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') element.textContent = value;
    else element.setAttribute(key, String(value));
  }
  return element;
}

function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const fraction = raw / (10 ** exponent);
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * (10 ** exponent);
}

function niceDomain(values, includeZero = true) {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (includeZero) {
    if (min > 0) min = 0;
    if (max < 0) max = 0;
  }
  if (min === max) {
    const pad = Math.abs(min || 1) * 0.1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step = niceStep(span / 4);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  if (min === max) max = min + step;
  return [min, max];
}

function axisLabel(value, unit) {
  if (unit === '%') return `${formatNumber(value, 0)}%`;
  if (unit === 'MB' && Math.abs(value) >= 1024) return `${formatNumber(value / 1024, 1)}G`;
  if (unit === '/s' && Math.abs(value) >= 1000) return `${formatNumber(value / 1000, 1)}k`;
  if (unit === 'Mbps' && Math.abs(value) >= 1000) return `${formatNumber(value / 1000, 1)}G`;
  if (unit === 'ms') return `${formatNumber(value, 1)}ms`;
  return formatNumber(value, 1);
}

function formatTooltip(value, unit) {
  return formatMetric(value, unit);
}

function pointFor(index, values, xOf, yOf) {
  const value = values[index];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return [xOf(index), yOf(value)];
}

function decimateIndices(series, count, maximum = 1600) {
  if (count <= maximum) return Array.from({ length: count }, (_, index) => index);
  const selected = new Set([0, count - 1]);
  const bucket = Math.ceil(count / maximum);
  for (let start = 0; start < count; start += bucket) {
    const end = Math.min(count, start + bucket);
    let minIndex = -1;
    let maxIndex = -1;
    let minValue = Infinity;
    let maxValue = -Infinity;
    for (let index = start; index < end; index += 1) {
      for (const item of series) {
        const value = item.values[index];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        if (value < minValue) { minValue = value; minIndex = index; }
        if (value > maxValue) { maxValue = value; maxIndex = index; }
      }
    }
    if (minIndex >= 0) selected.add(minIndex);
    if (maxIndex >= 0) selected.add(maxIndex);
    selected.add(start);
    selected.add(end - 1);
  }
  return [...selected].filter((index) => index >= 0 && index < count).sort((a, b) => a - b);
}

export function lineChart(container, options) {
  if (!container) return () => {};
  const {
    series = [],
    time = {},
    yUnit = '',
    height = 320,
    thresholds = [],
    includeZero = true,
    emptyText = 'No numeric samples in this signal.',
  } = options;

  const visibleSeries = series
    .filter((item) => item && Array.isArray(item.values))
    .map((item, index) => ({ ...item, color: item.color || PALETTE[index % PALETTE.length] }));
  const count = Math.max(time.labels?.length || 0, ...visibleSeries.map((item) => item.values.length), 0);

  const wrapper = document.createElement('div');
  wrapper.className = 'chart-shell';
  const svg = svgEl('svg', {
    viewBox: `0 0 1000 ${height}`,
    class: 'chart-svg',
    role: 'img',
    'aria-label': options.ariaLabel || 'Performance time-series chart',
  });
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;
  wrapper.append(svg, tooltip);
  container.replaceChildren(wrapper);

  if (!count || !visibleSeries.length) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = emptyText;
    wrapper.append(empty);
    return () => {};
  }

  const numericValues = [];
  for (const item of visibleSeries) {
    for (const value of item.values) {
      if (typeof value === 'number' && Number.isFinite(value)) numericValues.push(value);
    }
  }
  for (const threshold of thresholds) {
    if (Number.isFinite(Number(threshold.value))) numericValues.push(Number(threshold.value));
  }
  if (!numericValues.length) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = emptyText;
    wrapper.append(empty);
    return () => {};
  }

  const [domainMin, domainMax] = niceDomain(numericValues, includeZero);
  const margin = { top: 18, right: 22, bottom: 34, left: 62 };
  const plotWidth = 1000 - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xValues = time.elapsed?.length === count
    ? time.elapsed
    : Array.from({ length: count }, (_, index) => index);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const spanX = xMax - xMin || 1;
  const xOf = (index) => margin.left + ((xValues[index] - xMin) / spanX) * plotWidth;
  const yOf = (value) => margin.top + plotHeight - ((value - domainMin) / (domainMax - domainMin || 1)) * plotHeight;

  const defs = svgEl('defs');
  const gradient = svgEl('linearGradient', { id: 'chartArea', x1: '0', x2: '0', y1: '0', y2: '1' });
  gradient.append(
    svgEl('stop', { offset: '0%', 'stop-color': visibleSeries[0].color, 'stop-opacity': '0.25' }),
    svgEl('stop', { offset: '100%', 'stop-color': visibleSeries[0].color, 'stop-opacity': '0.01' }),
  );
  defs.append(gradient);
  svg.append(defs);

  const gridGroup = svgEl('g', { class: 'chart-grid' });
  const yTicks = 4;
  for (let index = 0; index <= yTicks; index += 1) {
    const value = domainMin + ((domainMax - domainMin) * index) / yTicks;
    const y = yOf(value);
    gridGroup.append(
      svgEl('line', { x1: margin.left, x2: 1000 - margin.right, y1: y, y2: y }),
      svgEl('text', { x: margin.left - 10, y: y + 4, 'text-anchor': 'end', text: axisLabel(value, yUnit) }),
    );
  }
  const xTickCount = Math.min(6, Math.max(2, Math.round(plotWidth / 145)));
  for (let index = 0; index <= xTickCount; index += 1) {
    const sampleIndex = Math.round(((count - 1) * index) / xTickCount);
    const x = xOf(sampleIndex);
    gridGroup.append(
      svgEl('line', { x1: x, x2: x, y1: margin.top, y2: margin.top + plotHeight, class: 'grid-v' }),
      svgEl('text', {
        x,
        y: height - 10,
        'text-anchor': index === 0 ? 'start' : index === xTickCount ? 'end' : 'middle',
        text: time.labels?.[sampleIndex] || `#${sampleIndex + 1}`,
      }),
    );
  }
  svg.append(gridGroup);

  const thresholdGroup = svgEl('g', { class: 'chart-thresholds' });
  for (const threshold of thresholds) {
    const value = Number(threshold.value);
    if (!Number.isFinite(value)) continue;
    const tone = threshold.tone === 'critical' ? 'critical' : threshold.tone === 'warn' || threshold.tone === 'warning' ? 'warn' : 'neutral';
    const y = yOf(value);
    thresholdGroup.append(svgEl('line', {
      x1: margin.left,
      x2: 1000 - margin.right,
      y1: y,
      y2: y,
      class: `threshold ${tone}`,
    }));
    thresholdGroup.append(svgEl('text', {
      x: 1000 - margin.right,
      y: y - 5,
      'text-anchor': 'end',
      class: `threshold-label ${tone}`,
      text: threshold.label || `Threshold ${formatNumber(value, 1)}`,
    }));
  }
  svg.append(thresholdGroup);

  const indices = decimateIndices(visibleSeries, count);
  const linesGroup = svgEl('g', { class: 'chart-lines' });
  const pathRefs = new Map();
  visibleSeries.forEach((item) => {
    let path = '';
    let drawing = false;
    for (const index of indices) {
      const point = pointFor(index, item.values, xOf, yOf);
      if (!point) {
        drawing = false;
        continue;
      }
      path += `${drawing ? 'L' : 'M'}${point[0].toFixed(2)},${point[1].toFixed(2)} `;
      drawing = true;
    }
    const pathElement = svgEl('path', {
      d: path.trim(),
      class: 'chart-line',
      stroke: item.color,
      fill: 'none',
      'vector-effect': 'non-scaling-stroke',
    });
    pathRefs.set(item.id || item.label, pathElement);
    linesGroup.append(pathElement);
    if (item.area && visibleSeries.length === 1 && path) {
      const areaPath = `${path} L${xOf(count - 1).toFixed(2)},${(margin.top + plotHeight).toFixed(2)} L${xOf(0).toFixed(2)},${(margin.top + plotHeight).toFixed(2)} Z`;
      linesGroup.prepend(svgEl('path', { d: areaPath, class: 'chart-area', fill: 'url(#chartArea)' }));
    }
  });

  const legacy = svgEl('g', { class: 'chart-last-points' });
  for (const item of visibleSeries) {
    for (let index = count - 1; index >= 0; index -= 1) {
      const value = item.values[index];
      if (typeof value === 'number' && Number.isFinite(value)) {
        legacy.append(svgEl('circle', {
          cx: xOf(index),
          cy: yOf(value),
          r: 2.6,
          fill: item.color,
          class: 'last-dot',
        }));
        break;
      }
    }
  }
  svg.append(linesGroup, legacy);

  const hover = svgEl('g', { class: 'chart-hover', visibility: 'hidden' });
  const hoverLine = svgEl('line', { y1: margin.top, y2: margin.top + plotHeight, class: 'hover-line' });
  hover.append(hoverLine);
  const hoverDots = svgEl('g');
  hover.append(hoverDots);
  svg.append(hover);

  const hit = svgEl('rect', {
    x: margin.left,
    y: margin.top,
    width: plotWidth,
    height: plotHeight,
    class: 'chart-hit',
  });
  svg.append(hit);

  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  const hidden = new Set();
  visibleSeries.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'legend-item';
    button.innerHTML = `<i style="background:${esc(item.color)}"></i><span>${esc(item.label)}</span>`;
    button.title = `Toggle ${item.label}`;
    button.addEventListener('click', () => {
      const key = item.id || item.label;
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      button.classList.toggle('off', hidden.has(key));
      const path = pathRefs.get(key);
      if (path) path.style.display = hidden.has(key) ? 'none' : '';
    });
    legend.append(button);
  });
  wrapper.append(legend);

  const showHover = (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const relativeX = ((event.clientX - rect.left) / rect.width) * 1000;
    if (relativeX < margin.left - 10 || relativeX > 1000 - margin.right + 10) {
      hideHover();
      return;
    }
    let nearest = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < count; index += 1) {
      const distance = Math.abs(xOf(index) - relativeX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    }
    const x = xOf(nearest);
    hoverLine.setAttribute('x1', x);
    hoverLine.setAttribute('x2', x);
    hoverDots.replaceChildren();
    const rows = [];
    for (const item of visibleSeries) {
      const key = item.id || item.label;
      if (hidden.has(key)) continue;
      const value = item.values[nearest];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      hoverDots.append(svgEl('circle', { cx: x, cy: yOf(value), r: 3.6, fill: item.color, class: 'hover-dot' }));
      rows.push(`<div class="ct-row"><i style="background:${esc(item.color)}"></i><span>${esc(item.label)}</span><strong>${esc(formatTooltip(value, item.unit || yUnit))}</strong></div>`);
    }
    if (!rows.length) {
      hideHover();
      return;
    }
    hover.setAttribute('visibility', 'visible');
    tooltip.hidden = false;
    tooltip.innerHTML = `<div class="ct-time">${esc(time.labels?.[nearest] || `Sample ${nearest + 1}`)}</div>${rows.join('')}`;
    const wrapperRect = wrapper.getBoundingClientRect();
    const tooltipX = ((x / 1000) * rect.width) + (rect.left - wrapperRect.left);
    const desired = Math.min(Math.max(8, tooltipX + 12), wrapperRect.width - 250);
    tooltip.style.left = `${desired}px`;
    tooltip.style.top = '8px';
  };

  const hideHover = () => {
    hover.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };

  svg.addEventListener('pointermove', showHover);
  svg.addEventListener('pointerleave', hideHover);

  return () => {
    svg.removeEventListener('pointermove', showHover);
    svg.removeEventListener('pointerleave', hideHover);
  };
}

export function sparklineSvg(series, options = {}) {
  const width = options.width || 150;
  const height = options.height || 40;
  const values = (series?.values || []).filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (values.length < 2) {
    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="M0 ${height - 2}H${width}" class="spark-base"/></svg>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - 4 - ((value - min) / span) * (height - 8)).toFixed(1)}`);
  const color = options.color || '#38bdf8';
  const path = `M${points.join(' L')}`;
  const area = `${path} L${width},${height} L0,${height} Z`;
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="spark-${esc(options.id || 'x')}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".28"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#spark-${esc(options.id || 'x')})"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

export function barMeter(value, maximum = 100, tone = 'accent') {
  const percent = Math.max(0, Math.min(100, (Number(value) / maximum) * 100));
  return `<span class="bar-meter"><span class="bar-fill ${esc(tone)}" style="width:${percent.toFixed(1)}%"></span></span>`;
}

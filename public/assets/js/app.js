/* ESXtop Lens application shell, hash router and upload lifecycle. */

import {
  renderCapture,
  renderCategory,
  renderGuide,
  renderImport,
  renderInsights,
  renderMetric,
  renderMetrics,
  renderNotFound,
  renderOverview,
  renderReport,
  renderSeries,
  renderVm,
  renderVms,
  captureLine,
} from './pages.js';
import { applyBuildInfo, loadBuildInfo } from './version.js';

const THEME_KEY = 'esxtop-lens-theme';
const UPLOAD_PASSWORD_KEY = 'esxtop-lens-upload-password';
const state = {
  doc: null,
  error: null,
  health: null,
  seriesById: new Map(),
  seriesCache: new Map(),
};

const view = document.querySelector('#view');
const captureBar = document.querySelector('#capture-bar');
const nav = document.querySelector('#main-nav');
const loading = document.querySelector('#loading-overlay');
const loadingTitle = document.querySelector('#loading-title');
const loadingDetail = document.querySelector('#loading-detail');
const loadingProgress = document.querySelector('#loading-progress');
const loadingMeta = document.querySelector('#loading-meta');
const toastElement = document.querySelector('#toast');
const newCapture = document.querySelector('#new-capture');
const globalFileInput = document.querySelector('#global-file-input');

let renderSequence = 0;
let toastTimer = null;
let parseTimer = null;

const NAV_ITEMS = [
  ['overview', 'Overview', '#/'],
  ['capture', 'Capture', '#/capture'],
  ['cpu', 'CPU', '#/cpu'],
  ['memory', 'Memory', '#/memory'],
  ['storage', 'Storage', '#/storage'],
  ['network', 'Network', '#/network'],
  ['power', 'Power', '#/power'],
  ['interrupt', 'Interrupts', '#/interrupt'],
  ['vms', 'VMs', '#/vms'],
  ['insights', 'Insights', '#/insights'],
  ['report', 'Report', '#/report'],
  ['metrics', 'Metrics', '#/metrics'],
  ['guide', 'Guide', '#/guide'],
];

function initialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

function toast(message) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add('show');
  toastTimer = setTimeout(() => toastElement.classList.remove('show'), 3200);
}

function escapeRoute(value) {
  return encodeURIComponent(value);
}

function uploadPassword() {
  try {
    return window.sessionStorage.getItem(UPLOAD_PASSWORD_KEY) || '';
  } catch {
    return '';
  }
}

function setUploadPassword(value) {
  try {
    if (value) window.sessionStorage.setItem(UPLOAD_PASSWORD_KEY, value);
    else window.sessionStorage.removeItem(UPLOAD_PASSWORD_KEY);
  } catch {
    // Storage can be disabled by browser privacy settings; the field still works for this upload.
  }
}

function parseHash() {
  const raw = (window.location.hash || '#/').replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart || '/';
  const segments = path.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { path, segments, query };
}

function activeNav(route) {
  const first = route.segments[0] || 'overview';
  if (first === 'vm') return 'vms';
  if (first === 'metric' || first === 'series') return 'metrics';
  return first;
}

function updateChrome(route) {
  if (!nav) return;
  if (state.doc) {
    const categoryCounts = state.doc.summary?.categories || {};
    const visibleItems = NAV_ITEMS.filter(([key]) => {
      if (key === 'vms') return true;
      if (!['cpu', 'memory', 'storage', 'network', 'power', 'interrupt'].includes(key)) return true;
      return (categoryCounts[key]?.series || 0) > 0;
    });
    nav.innerHTML = visibleItems.map(([key, label, href]) => `<a href="${href}" data-nav="${key}">${label}</a>`).join('');
  } else {
    nav.innerHTML = `<a href="#/import" data-nav="import">Import</a><a href="#/capture" data-nav="capture">Capture manual</a><a href="#/guide" data-nav="guide">Field guide</a>`;
  }
  const active = activeNav(route);
  nav.querySelectorAll('a').forEach((link) => {
    const key = link.dataset.nav;
    const isActive = key === active || (key === 'vms' && active === 'vms') || (key === 'overview' && active === 'overview');
    link.classList.toggle('active', isActive);
  });
  const showBar = Boolean(state.doc) && !['import', 'guide', 'capture'].includes(route.segments[0] || '');
  captureBar.hidden = !showBar;
  if (showBar) captureBar.innerHTML = captureLine(state.doc);
  newCapture.hidden = !state.doc;
  if (state.doc) {
    const title = {
      overview: 'Overview', cpu: 'CPU', memory: 'Memory', storage: 'Storage', network: 'Network',
      power: 'Power', interrupt: 'Interrupts', other: 'Other signals',
      vms: 'Virtual machines', insights: 'Findings', metrics: 'Metric explorer', vm: 'VM detail', capture: 'Capture manual',
      metric: 'Metric detail', series: 'Signal detail',
    }[active] || 'Capture';
    document.title = `${title} · ${state.doc.meta.host || 'ESXi'} · ESXtop Lens`;
  } else {
    document.title = route.segments[0] === 'guide'
      ? 'Field guide · ESXtop Lens'
      : 'ESXtop Lens — turn an esxtop capture into a diagnosis';
  }
}

function showLoading(title, detail, progress = 5, meta = '') {
  loading.hidden = false;
  document.body.setAttribute('aria-busy', 'true');
  loadingTitle.textContent = title;
  loadingDetail.textContent = detail;
  loadingProgress.style.width = `${Math.max(2, Math.min(100, progress))}%`;
  loadingMeta.textContent = meta;
}

function setLoading(title, detail, progress, meta) {
  if (title) loadingTitle.textContent = title;
  if (detail) loadingDetail.textContent = detail;
  if (Number.isFinite(progress)) loadingProgress.style.width = `${Math.max(2, Math.min(100, progress))}%`;
  if (meta !== undefined) loadingMeta.textContent = meta;
}

function hideLoading() {
  loading.hidden = true;
  document.body.removeAttribute('aria-busy');
  clearInterval(parseTimer);
  parseTimer = null;
}

function parseProgress() {
  clearInterval(parseTimer);
  let progress = 48;
  parseTimer = setInterval(() => {
    progress = Math.min(92, progress + (progress < 70 ? 3 : 1));
    loadingProgress.style.width = `${progress}%`;
  }, 380);
}

function installDocument(document) {
  state.doc = document;
  state.error = null;
  state.seriesById = new Map((document.series || []).map((series) => [series.id, series]));
  state.seriesCache = new Map();
}

async function ensureSeries(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const missing = unique.filter((id) => !state.seriesCache.has(id));
  if (!missing.length) return;
  if (!state.doc) throw new Error('No capture is loaded.');
  const session = state.doc.meta?.sessionId;
  if (!session) {
    throw new Error('This capture has no analysis session. Re-import the capture.');
  }
  const response = await fetch('/api/series', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session, ids: missing }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Series request failed with HTTP ${response.status}.`);
  }
  for (const [id, values] of Object.entries(payload.series || {})) {
    state.seriesCache.set(id, values);
    const series = state.seriesById.get(id);
    if (series) series.values = values;
  }
  for (const id of missing) {
    if (!state.seriesCache.has(id)) state.seriesCache.set(id, []);
  }
}

async function checkUploadPassword(password) {
  const response = await fetch('/api/upload-auth', {
    cache: 'no-store',
    headers: { 'X-ESXTOP-Upload-Password': password },
  });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return true;
}

async function uploadFile(file) {
  if (!file) return;
  const password = uploadPassword();
  if (state.health?.uploadAuthRequired && !password) {
    state.error = 'The server requires an upload password. Enter it on the import page before choosing a capture.';
    window.location.hash = '#/import';
    render();
    return;
  }
  const maxUploadBytes = Number(state.health?.limits?.uploadBytes || state.health?.maxUploadBytes || 0);
  if (maxUploadBytes && file.size > maxUploadBytes) {
    state.error = `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB, larger than the server limit of ${(maxUploadBytes / 1024 / 1024).toFixed(0)} MB.`;
    window.location.hash = '#/import';
    render();
    return;
  }
  if (state.health?.uploadAuthRequired && password) {
    showLoading('Checking upload password…', 'Verifying the password before sending the capture.', 2, 'Local analysis server');
    try {
      const accepted = await checkUploadPassword(password);
      if (!accepted) {
        hideLoading();
        state.error = 'The upload password was rejected. Check the value in ESXTOP_UPLOAD_PASSWORD and the password entered on the import page.';
        window.location.hash = '#/import';
        render();
        return;
      }
    } catch (error) {
      hideLoading();
      state.error = `Could not reach the analysis server to verify the upload password (${error.message}). Check that the container or start.py is running, the URL/port is reachable, and any reverse proxy forwards the X-ESXTOP-Upload-Password header.`;
      window.location.hash = '#/import';
      render();
      return;
    }
  }
  showLoading('Reading capture…', 'Uploading the file to the local parser.', 2, `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/analyze?name=${escapeRoute(file.name)}`);
  xhr.responseType = 'json';
  xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
  if (password) xhr.setRequestHeader('X-ESXTOP-Upload-Password', password);
  xhr.upload.addEventListener('loadstart', () => {
    setLoading('Uploading capture…', 'Sending the capture to the local parser.', 3, `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`);
  });
  xhr.upload.addEventListener('progress', (event) => {
    if (!event.lengthComputable) return;
    const percent = 5 + Math.round((event.loaded / event.total) * 38);
    loadingProgress.style.width = `${percent}%`;
    loadingMeta.textContent = `Upload ${Math.round((event.loaded / event.total) * 100)}% · ${file.name}`;
  });
  xhr.upload.addEventListener('load', () => {
    setLoading('Parsing and scoring…', 'Reading PDH-CSV columns, computing statistics and applying guardrails.', 50, `${file.name} · local processing`);
    parseProgress();
  });
  xhr.addEventListener('load', () => {
    hideLoading();
    const document = xhr.response;
    if (xhr.status >= 200 && xhr.status < 300 && document?.ok) {
      installDocument(document);
      if (!window.location.hash || ['#/', '#/import', '#/guide'].includes(window.location.hash)) {
        window.location.hash = '#/';
      }
      toast(`${document.meta.host || 'Capture'} loaded · ${document.meta.sampleCount} samples · ${document.meta.columns.toLocaleString()} signals`);
      render();
      return;
    }
    if (xhr.status === 401) {
      state.health = { ...(state.health || {}), uploadAuthRequired: true };
    }
    const message = document?.error || `The server returned HTTP ${xhr.status}.`;
    state.error = message;
    window.location.hash = '#/import';
    render();
    toast('Capture could not be loaded.');
  });
  xhr.addEventListener('error', () => {
    hideLoading();
    state.error = 'Could not reach the analysis server during upload. Check that the container or start.py is still running, the URL/port is reachable, and any reverse proxy allows the upload body size and timeout.';
    window.location.hash = '#/import';
    render();
  });
  xhr.addEventListener('abort', () => {
    hideLoading();
    toast('Upload cancelled.');
  });
  xhr.send(file);
}

async function loadDemo() {
  showLoading('Loading demo capture…', 'Fetching the bundled synthetic esxtop capture and running analysis.', 18, 'esxi01 · 60 samples · 936 signals');
  parseProgress();
  try {
    const response = await fetch('/api/demo', { cache: 'no-store' });
    const document = await response.json().catch(() => null);
    hideLoading();
    if (!response.ok || !document?.ok) throw new Error(document?.error || `HTTP ${response.status}`);
    installDocument(document);
    window.location.hash = '#/';
    toast('Demo capture loaded. Every finding is synthetic.');
    render();
  } catch (error) {
    hideLoading();
    state.error = `Could not load the demo: ${error.message}`;
    window.location.hash = '#/import';
    render();
  }
}

function pageFor(route) {
  if (route.segments[0] === 'guide') return renderGuide;
  if (route.segments[0] === 'capture') return renderCapture;
  if (!state.doc) return renderImport;
  const first = route.segments[0] || 'overview';
  if (first === 'overview' || route.segments.length === 0) return renderOverview;
  if (first === 'import') return renderImport;
  if (['cpu', 'memory', 'storage', 'network', 'power', 'interrupt', 'other'].includes(first)) {
    return (context) => renderCategory(context, first);
  }
  if (first === 'vms') return renderVms;
  if (first === 'vm') return (context) => renderVm(context, route.segments.slice(1).join('/'));
  if (first === 'insights') return renderInsights;
  if (first === 'report') return renderReport;
  if (first === 'metrics') return (context) => renderMetrics(context, route.query);
  if (first === 'metric') return (context) => renderMetric(context, route.segments.slice(1).join('/'));
  if (first === 'series') return (context) => renderSeries(context, route.segments.slice(1).join('/'));
  return renderNotFound;
}

async function render() {
  const sequence = ++renderSequence;
  const route = parseHash();
  updateChrome(route);
  const page = state.doc
    ? pageFor(route)
    : (route.segments[0] === 'guide' ? renderGuide : route.segments[0] === 'capture' ? renderCapture : renderImport);
  const context = {
    state,
    doc: state.doc,
    route,
    query: route.query,
    uploadFile,
    loadDemo,
    ensureSeries,
    toast,
    navigate: (hash) => { window.location.hash = hash; },
    uploadPassword,
    setUploadPassword,
    render,
  };
  try {
    const result = await page(context);
    if (sequence !== renderSequence) return;
    view.innerHTML = result.html;
    view.dataset.route = route.path;
    await result.mount?.(view, context);
    if (sequence !== renderSequence) return;
    window.scrollTo({ top: 0, behavior: 'auto' });
  } catch (error) {
    console.error(error);
    if (sequence !== renderSequence) return;
    view.innerHTML = `<div class="page-head"><div class="eyebrow">Application error</div><h1>Something went wrong</h1><p class="page-lede">${escapeHtml(error.message || String(error))}</p></div><div class="summary-actions"><a class="btn btn-primary" href="#/import">Back to import</a><button class="btn" type="button" id="reload-app">Reload</button></div>`;
    view.querySelector('#reload-app')?.addEventListener('click', () => window.location.reload());
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function loadMetadata() {
  const info = await loadBuildInfo();
  applyBuildInfo(document, info);
  try {
    const health = await fetch('/api/health', { cache: 'no-store' }).then((response) => response.json());
    state.health = health;
  } catch {
    // The app remains usable without the health endpoint.
  }
}

async function init() {
  applyTheme(initialTheme());
  document.querySelector('#theme-toggle')?.addEventListener('click', toggleTheme);
  newCapture?.addEventListener('click', () => globalFileInput?.click());
  globalFileInput?.addEventListener('change', () => {
    const file = globalFileInput.files?.[0];
    if (file) uploadFile(file);
    globalFileInput.value = '';
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('keydown', (event) => {
    if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
      const search = document.querySelector('#metric-search, #vm-search');
      if (search) {
        event.preventDefault();
        search.focus();
      }
    }
  });
  await loadMetadata();
  render();
}

init();

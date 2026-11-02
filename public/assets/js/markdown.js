/* Minimal, dependency-free Markdown renderer.
   Supports: headings, paragraphs, ordered/unordered lists, fenced code,
   tables, blockquotes, horizontal rules, bold/italic/inline-code/links.
   Everything is HTML-escaped first, so untrusted content cannot inject markup.

   Adapted from the author's MIT-licensed Learning Lab renderer. */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const slug = (s) =>
  s.toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'section';

/** Allow only links that cannot execute script. The text is escaped first, so
 *  escaping quotes/attribute characters is already handled by esc(). */
function safeUrl(url) {
  const target = String(url ?? '').trim();
  if (!target) return '#';
  if (/^(?:https?:|mailto:)/i.test(target)) return target;
  if (/^(?:#|\/(?!\/)|\.{1,2}\/|\?)/.test(target)) return target;
  return '#';
}

function inline(text) {
  let t = esc(text);
  // inline code first so its content is not processed further
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => `<img alt="${alt}" src="${safeUrl(url)}">`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => `<a href="${safeUrl(url)}">${label}</a>`);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return t;
}

const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function buildList(items, idx, indent) {
  const ordered = items[idx].ordered;
  let html = ordered ? '<ol>' : '<ul>';
  while (idx < items.length && items[idx].indent >= indent) {
    if (items[idx].indent > indent) break;
    const it = items[idx++];
    let child = '';
    while (idx < items.length && items[idx].indent > indent) {
      const [sub, next] = buildList(items, idx, items[idx].indent);
      child += sub;
      idx = next;
    }
    html += `<li>${inline(it.text)}${child}</li>`;
  }
  html += ordered ? '</ol>' : '</ul>';
  return [html, idx];
}

export function md(src) {
  const { html } = render(src);
  return html;
}

export function render(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const toc = [];
  let i = 0;
  let uid = 0;
  const usedIds = new Set();

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    out.push(`<p>${inline(buf.join(' '))}</p>`);
    buf.length = 0;
  };
  const para = [];

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      flushParagraph(para);
      const lang = fence[1] || '';
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre data-lang="${esc(lang)}"><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    // blank line
    if (!line.trim()) {
      flushParagraph(para);
      i++;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(para);
      const level = h[1].length;
      const text = h[2].trim();
      let id = slug(text);
      if (usedIds.has(id)) id = `${id}-${++uid}`;
      usedIds.add(id);
      if (level === 2 || level === 3) toc.push({ level, text: text.replace(/[*`]/g, ''), id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph(para);
      out.push('<hr>');
      i++;
      continue;
    }

    // blockquote (may span lines)
    if (/^\s*>\s?/.test(line)) {
      flushParagraph(para);
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${md(body.join('\n'))}</blockquote>`);
      continue;
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushParagraph(para);
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table>'
      );
      continue;
    }

    // lists
    const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const ol = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length) {
        const mu = lines[i].match(/^(\s*)[-*+]\s+(.*)$/);
        const mo = lines[i].match(/^(\s*)\d+[.)]\s+(.*)$/);
        if (mu || mo) {
          const m = mu || mo;
          items.push({ indent: m[1].length, text: m[2], ordered: Boolean(mo) });
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length && !/^\s*(```|\||>)/.test(lines[i])) {
          items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        } else break;
      }
      out.push(buildList(items, 0, items[0].indent)[0]);
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushParagraph(para);
  return { html: out.join('\n'), toc };
}

/** Build a table of contents from a markdown string. */
export function tocOf(src) {
  return render(src).toc;
}

/** Render inline Markdown (bold, code, links) with no paragraph wrapper. */
export const inlineMd = (src) => inline(src);

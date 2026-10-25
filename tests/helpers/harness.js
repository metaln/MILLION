'use strict';
// 単一 HTML のテスト共通部品。<script> の取り出し・簡易DOMの組み立て・patch 適用。
// 読み込み時に HTML ファイルを読まない（各ローダーが自分の HTML を渡す）。

function extractScript(html) {
  const blocks = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  if (blocks.length !== 1) throw new Error(`<script> ブロックが ${blocks.length} 個（1個を想定）`);
  return blocks[0].slice('<script>'.length, -'</script>'.length);
}

function parseAttrs(s) {
  const attrs = {};
  for (const m of s.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

function makeElement(tag, attrs = {}) {
  const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
  const el = {
    tagName: tag,
    id: attrs.id || '',
    value: attrs.value ?? '',
    textContent: '',
    className: attrs.class || '',
    style: { display: /display:\s*none/.test(attrs.style || '') ? 'none' : '' },
    attrs: { ...attrs },
    children: [],
    listeners: {},
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    classList: {
      toggle: c => (classes.has(c) ? classes.delete(c) : classes.add(c)),
      contains: c => classes.has(c),
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    appendChild(c) { this.children.push(c); return c; },
  };
  return el;
}

// 開始タグ直後から対応する終了タグまでの中身（同名タグの入れ子を数える）。void 要素は空
function innerOf(body, from, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = from;
  let depth = 1;
  for (let m; (m = re.exec(body));) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return body.slice(from, m.index);
  }
  return '';
}

function buildDocument(html) {
  const body = html.slice(0, html.indexOf('<script>'));
  const byId = {};
  for (const m of body.matchAll(/<(\w+)(\s[^>]*)>/g)) {
    const attrs = parseAttrs(m[2]);
    if (!attrs.id) continue;
    const el = makeElement(m[1], attrs);
    if (m[1] !== 'input') {
      el.innerHTML = innerOf(body, m.index + m[0].length, m[1]).trim();
      el.textContent = el.innerHTML.replace(/<[^>]+>/g, '');
    }
    byId[attrs.id] = el;
  }
  return {
    byId,
    getElementById: id => byId[id] || null,
    createElement: tag => makeElement(tag),
  };
}

// patches: [{ from, to }] 各 from は code 内でちょうど1回出現すること（別関数への誤爆防止）
function applyPatches(code, patches) {
  for (const { from, to } of patches) {
    const n = code.split(from).length - 1;
    if (n !== 1) throw new Error(`patch 対象の出現回数が ${n}: ${from}`);
    code = code.replace(from, to);
  }
  return code;
}

module.exports = { extractScript, parseAttrs, makeElement, innerOf, buildDocument, applyPatches };

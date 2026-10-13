'use strict';
// pst-point-tool.html の <script> をそのまま同一 realm で評価し、内部関数と簡易DOMを返す。
// ブラウザ自動化が無い環境で回帰テストを回すためのハーネス。
// DOM要素は HTML 本文（<script> より前）の id 付きタグから生成し、初期値（value / style / aria-*）も HTML から読む。

const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '..', '..', 'pst-point-tool.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

const EXPORTS = [
  'SONGS', 'BY_ID', 'FILL_ORDER', 'DISPLAY_ORDER', 'EL', 'PROGRESS_CAP', 'STEP', 'MAX_DIFF',
  'PROGRESS_SONGS', 'FLAT_SONGS', 'esc', 'buildSequence', 'appState', 'calcAlgo', 'sumState',
  'doCalc', 'buildViewModel', 'renderAll', 'scheduleRender',
  '_renderRows', '_renderSummary', '_renderOrder', '_syncInputsFromState', 'adj',
];

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

// patches: [{ from, to }] 各 from はスクリプト内でちょうど1回出現すること（別関数への誤爆防止）
function loadPst({ patches = [] } = {}) {
  let code = extractScript(HTML);
  for (const { from, to } of patches) {
    const n = code.split(from).length - 1;
    if (n !== 1) throw new Error(`patch 対象の出現回数が ${n}: ${from}`);
    code = code.replace(from, to);
  }
  const document = buildDocument(HTML);
  const window = {};
  const rafQueue = [];
  const raf = { requested: 0 };
  const requestAnimationFrame = cb => { raf.requested++; rafQueue.push(cb); return rafQueue.length; };
  const flushRaf = () => { while (rafQueue.length) rafQueue.shift()(); };

  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'document', 'window', 'requestAnimationFrame',
    `${code}\n;module.exports = { ${EXPORTS.join(', ')} };`)(mod, document, window, requestAnimationFrame);

  const el = id => {
    const e = document.getElementById(id);
    if (!e) throw new Error(`要素 #${id} が HTML に無い`);
    return e;
  };
  const fire = (id, ev = {}) => el(id).listeners.click.forEach(fn => fn(ev));
  const calc = (target, current, progress) => {
    el('inp-target').value = String(target);
    el('inp-current').value = String(current);
    el('inp-progress').value = String(progress);
    fire('btn-calc');
  };
  // result-rows のイベント委譲へ渡すクリック。btn=null は .cbtn 以外のクリック
  const clickCounter = (id, d) => fire('result-rows', {
    target: { closest: () => (id == null ? null : { dataset: { id, d: String(d) } }) },
  });

  return { ...mod.exports, window, document, el, raf, flushRaf, calc, clickCounter, fire };
}

// _renderRows の出力を行単位に分解
function parseRows(html) {
  return html.split('<div class="result-row"').slice(1).map(chunk => ({
    id: chunk.match(/id="row-([^"]+)"/)[1],
    name: chunk.match(/<span class="row-name">([^<]*)<\/span>/)[1],
    stage: (chunk.match(/<span class="stage-badge">([^<]*)<\/span>/) || [null, null])[1],
    count: Number(chunk.match(/class="cval"[^>]*>(\d+)</)[1]),
    decDisabled: / data-d="-1" disabled>/.test(chunk),
    incDisabled: / data-d="1" disabled>/.test(chunk),
  }));
}

// _renderOrder の出力を <li> 単位に分解（タグを除いた本文と class）
function parseOrder(html) {
  return [...html.matchAll(/<li(?: class="([^"]*)")?>([\s\S]*?)<\/li>/g)]
    .map(m => ({ cls: m[1] || '', text: m[2].replace(/<[^>]+>/g, '') }));
}

module.exports = { loadPst, parseRows, parseOrder, HTML, HTML_PATH };

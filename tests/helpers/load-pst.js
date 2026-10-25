'use strict';
// pst-point-tool.html の <script> をそのまま同一 realm で評価し、内部関数と簡易DOMを返す。
// ブラウザ自動化が無い環境で回帰テストを回すためのハーネス。
// DOM要素は HTML 本文（<script> より前）の id 付きタグから生成し、初期値（value / style / aria-*）も HTML から読む。

const fs = require('node:fs');
const path = require('node:path');
const { applyPatches, extractScript, buildDocument } = require('./harness');

const HTML_PATH = path.join(__dirname, '..', '..', 'pst-point-tool.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

const EXPORTS = [
  'SONGS', 'BY_ID', 'FILL_ORDER', 'DISPLAY_ORDER', 'EL', 'PROGRESS_CAP', 'STEP', 'MAX_DIFF',
  'PROGRESS_SONGS', 'FLAT_SONGS', 'esc', 'buildSequence', 'appState', 'calcAlgo', 'sumState',
  'doCalc', 'buildViewModel', 'renderAll', 'scheduleRender',
  '_renderRows', '_renderSummary', '_renderOrder', '_syncInputsFromState', 'adj',
];

// patches: [{ from, to }] 各 from はスクリプト内でちょうど1回出現すること（別関数への誤爆防止）
function loadPst({ patches = [] } = {}) {
  const code = applyPatches(extractScript(HTML), patches);
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

'use strict';
// move-estimate-tool.html の <script> を同一 realm で評価し、内部関数と簡易DOMを返す。
// 簡易DOMの組み立ては harness.js と共通（HTML 本文の id 付きタグから生成し、初期値も HTML から読む）。

const fs = require('node:fs');
const path = require('node:path');
const { extractScript, buildDocument, applyPatches } = require('./harness');

const HTML_PATH = path.join(__dirname, '..', '..', 'move-estimate-tool.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

const EXPORTS = [
  'CHARGE', 'RELEASE', 'BONUS', 'TRIGGER_MIN', 'TRIGGER_MAX', 'LIKELY_BONUS', 'RARE_BONUS', 'MAX_PT',
  'LIKELY_LABEL', 'RARE_LABEL', 'SPEC_ITEMS', 'bonusLabel', 'esc', 'solve', 'byTrigger', 'appState',
  'buildViewModel', '_groupHtml', '_resultHtml', '_renderFieldError', 'renderAll', 'doCalc',
  'BATCH_MAX', 'CSV_HINT', 'parseCsv', 'buildBatchViewModel', 'doBatch',
  'UNLIKELY_RELEASE', 'UNLIKELY_TRIGGER', 'BONUS_ORDER', 'BONUS_VIEWS', 'isLikely', 'shownBonus',
];

// patches: [{ from, to }] 各 from はスクリプト内でちょうど1回出現すること（別関数への誤爆防止）
function loadMove({ patches = [] } = {}) {
  const code = applyPatches(extractScript(HTML), patches);
  const document = buildDocument(HTML);

  // requestAnimationFrame: キューに積み、flushRaf で実行する。raf.requested は要求の累計回数
  const rafQueue = [];
  const raf = { requested: 0 };
  const requestAnimationFrame = cb => { raf.requested++; rafQueue.push(cb); return rafQueue.length; };
  const flushRaf = () => { while (rafQueue.length) rafQueue.shift()(); };

  // #result の querySelector: `[属性="値"]` の連なりだけを受け付け、innerHTML 中の <button> 開始タグのうち
  // 全属性が一致する最初の1件を返す。focus() を呼ぶと focused に一致した属性の object を1件足す
  const focused = [];
  document.getElementById('result').querySelector = sel => {
    if (!/^(\[[\w-]+="[^"]*"\])+$/.test(sel)) throw new Error(`未対応のセレクタ: ${sel}`);
    const want = [...sel.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map(m => [m[1], m[2]]);
    for (const tag of document.getElementById('result').innerHTML.matchAll(/<button\s([^>]*)>/g)) {
      const attrs = {};
      for (const m of tag[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
      if (want.every(([k, v]) => attrs[k] === v)) {
        return { focus: () => focused.push(Object.fromEntries(want)) };
      }
    }
    return null;
  };

  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'document', 'requestAnimationFrame',
    `${code}\n;module.exports = { ${EXPORTS.join(', ')} };`)(mod, document, requestAnimationFrame);

  const el = id => {
    const e = document.getElementById(id);
    if (!e) throw new Error(`要素 #${id} が HTML に無い`);
    return e;
  };
  const fire = (id, type, ev = {}) => (el(id).listeners[type] || []).forEach(fn => fn(ev));
  // 「計算する」ボタン・入力欄の Enter はどちらもフォームの submit になる（ブラウザの標準動作）。
  // 戻り値は既定動作（送信）を止めたかどうか
  const calc = v => {
    el('inp-pt').value = String(v);
    let prevented = false;
    fire('calc-form', 'submit', { preventDefault: () => { prevented = true; } });
    return prevented;
  };
  // CSV一括のフォームの submit。戻り値は既定動作（送信）を止めたかどうか
  const batch = text => {
    el('inp-csv').value = text;
    let prevented = false;
    fire('batch-form', 'submit', { preventDefault: () => { prevented = true; } });
    return prevented;
  };
  // #result のイベント委譲へ渡すクリック。action=null は data-action の無い箇所のクリック。
  // index は CSV一括の人ごとのボタン（data-index）。ブラウザと同じく文字列で渡す
  const clickResult = (action, index) => fire('result', 'click', {
    target: { closest: () => (action == null ? null : { dataset: index == null ? { action } : { action, index: String(index) } }) },
  });

  // 表示するボーナス回数の切り替えボタン（data-view）。view=undefined は data-view の無いボタン
  const clickView = view => fire('result', 'click', {
    target: { closest: () => ({ dataset: view === undefined ? { action: 'bonus-view' } : { action: 'bonus-view', view } }) },
  });

  return { ...mod.exports, document, el, fire, calc, batch, clickResult, clickView, raf, flushRaf, focused };
}

// 結果欄の切り替えボタンの [data-view, aria-pressed] の並び
const viewButtons = html => [...html.matchAll(/data-action="bonus-view" data-view="([^"]*)" aria-pressed="(true|false)">([^<]*)<\/button>/g)]
  .map(m => [m[1], m[2], m[3]]);

// サマリ欄の [ラベル, 値] の並び（1人用・CSV一括で共通）
const parseSummary = html => [...html.matchAll(/<div class="srow"><span>([^<]*)<\/span><span class="sval">([^<]*)<\/span><\/div>/g)]
  .map(m => [m[1], m[2]]);

// _resultHtml の出力を、サマリ・グループ・別枠の切り替えボタンに分解
function parseResult(html) {
  const summary = parseSummary(html);
  const groups = html.split('<section class="group">').slice(1).map(chunk => {
    const head = chunk.match(/<h2 class="group-title">([^<]*)<span class="group-count">(\d+)件<\/span><\/h2>/);
    const rows = [...chunk.matchAll(/<div class="result-row">([\s\S]*?)<\/div>/g)]
      .map(m => [...m[1].matchAll(/<span class="num">([^<]*)<\/span>/g)].map(n => n[1]));
    return {
      title: head[1], total: Number(head[2]), rows,
      empty: chunk.includes('<div class="group-empty">該当なし</div>'),
    };
  });
  // 開閉ボタンの先頭の ◇ は読み上げから外す（aria-hidden の span）。label はその後の文言
  const toggle = html.match(/data-action="rare" aria-expanded="(true|false)"><span aria-hidden="true">◇<\/span> ([^<]*)<\/button>/);
  return { summary, groups, toggle: toggle ? { expanded: toggle[1], label: toggle[2] } : null };
}

module.exports = { loadMove, parseResult, parseSummary, viewButtons, HTML, HTML_PATH };

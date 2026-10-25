'use strict';
// move-estimate-tool.html の <script> を同一 realm で評価し、内部関数と簡易DOMを返す。
// 簡易DOMの組み立ては load-pst.js と共通（HTML 本文の id 付きタグから生成し、初期値も HTML から読む）。

const fs = require('node:fs');
const path = require('node:path');
const { extractScript, buildDocument } = require('./load-pst');

const HTML_PATH = path.join(__dirname, '..', '..', 'move-estimate-tool.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

const EXPORTS = [
  'CHARGE', 'RELEASE', 'BONUS', 'TRIGGER_MIN', 'TRIGGER_MAX', 'LIKELY_BONUS', 'RARE_BONUS', 'MAX_PT',
  'LIKELY_LABEL', 'RARE_LABEL', 'SPEC_ITEMS', 'bonusLabel', 'esc', 'solve', 'byTrigger', 'appState',
  'buildViewModel', '_groupHtml', '_resultHtml', '_renderFieldError', 'renderAll', 'doCalc',
];

// patches: [{ from, to }] 各 from はスクリプト内でちょうど1回出現すること（別関数への誤爆防止）
function loadMove({ patches = [] } = {}) {
  let code = extractScript(HTML);
  for (const { from, to } of patches) {
    const n = code.split(from).length - 1;
    if (n !== 1) throw new Error(`patch 対象の出現回数が ${n}: ${from}`);
    code = code.replace(from, to);
  }
  const document = buildDocument(HTML);
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'document', `${code}\n;module.exports = { ${EXPORTS.join(', ')} };`)(mod, document);

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
  // #result のイベント委譲へ渡すクリック。action=null は data-action の無い箇所のクリック
  const clickResult = action => fire('result', 'click', {
    target: { closest: () => (action == null ? null : { dataset: { action } }) },
  });

  return { ...mod.exports, document, el, fire, calc, clickResult };
}

// _resultHtml の出力を、サマリ・グループ・別枠の切り替えボタンに分解
function parseResult(html) {
  const summary = [...html.matchAll(/<div class="srow"><span>([^<]*)<\/span><span class="sval">([^<]*)<\/span><\/div>/g)]
    .map(m => [m[1], m[2]]);
  const groups = html.split('<section class="group">').slice(1).map(chunk => {
    const head = chunk.match(/<h2 class="group-title">([^<]*)<span class="group-count">(\d+)件<\/span><\/h2>/);
    const rows = [...chunk.matchAll(/<div class="result-row">([\s\S]*?)<\/div>/g)]
      .map(m => [...m[1].matchAll(/<span class="num">([^<]*)<\/span>/g)].map(n => n[1]));
    return {
      title: head[1], total: Number(head[2]), rows,
      empty: chunk.includes('<div class="group-empty">該当なし</div>'),
    };
  });
  const toggle = html.match(/data-action="rare" aria-expanded="(true|false)">([^<]*)<\/button>/);
  return { summary, groups, toggle: toggle ? { expanded: toggle[1], label: toggle[2] } : null };
}

module.exports = { loadMove, parseResult, HTML, HTML_PATH };

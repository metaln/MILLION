'use strict';
// 対象: move-estimate-tool.html（solve / buildViewModel / 描画 / doCalc / イベント委譲 / HTML の静的な取り決め）
//
// 観点表で外したもの（理由）:
// - 入力欄の空白・全角数字: <input type=number> がブラウザ側で受け付けない
// - トリガー数 −10,001・999,999: 595×貯め − 180×吐き は常に5の倍数で、これらの値は作れない。
//   範囲の外側は −10,005 と 1,000,000、内側は −10,000 と 999,995 で確かめる（0〜100,000 の全候補で5の倍数を実測。2026-10-25）
// - 同じボーナス回数でトリガー数の絶対値が等しい2件（並び順の同点）: 負の側が −242,165 以下になり下限で除外される
// - esc の特殊文字: 描画に通す文字列は定数の名前だけ。実装は pst-point-tool.html と同一
// - buildViewModel の idle（未計算）: doCalc は必ず list か error を設定するため操作経路では起きない。
//   静的HTMLの初期表示と一致することだけ見る
// - サマリの上端固定の実際の見え方・フォーカス位置・色: 目視確認の範囲（CSS の宣言の有無だけ見る）
// - 入力欄での Enter による送信: ブラウザの標準動作（暗黙の submit）。form の中に入力欄と submit ボタンがある構造だけ見る

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMove, parseResult, HTML } = require('./helpers/load-move');

const mv = loadMove();
const { solve } = mv;
const key = x => `${x.charge},${x.release},${x.bonus},${x.trigger}`;
const result = p => parseResult(p.el('result').innerHTML);
const outline = p => result(p).groups.map(g => [g.title, g.total, g.rows.length]);

const MSG_IDLE = '<div class="placeholder">「計算する」を押すと結果が表示されます</div>';
const MSG_NONE = '<div class="placeholder warn">指定のポイントに合う組み合わせがありません。入力したポイントを確かめてください</div>';
const MSG_OVER = `ポイントは${(99999999).toLocaleString()}以下にしてください`;
const fieldError = p => [p.el('inp-pt-error').textContent, p.el('inp-pt').getAttribute('aria-invalid')];
const SUMMARY = (pt, likely, rare) => [
  ['指定のポイント', pt.toLocaleString()], ['ボーナス0回・5回の候補', `${likely}件`], ['ボーナス1〜4回の候補', `${rare}件`],
];
const EMPTY = c => ({ title: `ボーナス ${c}回`, total: 0, rows: [], empty: true });
const TOGGLE_CLOSED = { expanded: 'false', label: '◇ ボーナス1〜4回の候補を表示' };
const TOGGLE_OPEN = { expanded: 'true', label: '◇ ボーナス1〜4回の候補を隠す' };

// 検算用: solve とは別の手順（回数の組を先にすべて作り、合計ポイントで引く）で、pt が [lo, hi] の候補を数え直す
function forward(lo, hi) {
  const byPt = new Map();
  let low = 0, high = 0;
  for (let c = 0; c <= 5; c++)
    for (let b = 0; 634 * b + 3000 * c <= hi; b++) {
      const base = 634 * b + 3000 * c;
      for (let a = Math.max(0, Math.ceil((lo - base) / 595)); 595 * a + base <= hi; a++) {
        const trigger = 595 * a - 180 * b;
        if (trigger < -10000) { low++; continue; }
        if (trigger > 999999) { high++; continue; }
        const pt = 595 * a + base;
        if (!byPt.has(pt)) byPt.set(pt, []);
        byPt.get(pt).push(`${a},${b},${c},${trigger}`);
      }
    }
  return { byPt, low, high };
}

function compareRange(lo, hi) {
  const { byPt, low, high } = forward(lo, hi);
  let compared = 0;
  const mismatch = [];
  for (let pt = lo; pt <= hi; pt++) {
    const want = (byPt.get(pt) || []).sort();
    compared += want.length;
    if (solve(pt).map(key).sort().join('|') !== want.join('|')) mismatch.push(pt);
  }
  // 不一致が数万件あると deepEqual の差分生成でメモリが尽きるため、件数で比べて先頭だけを表示する
  assert.equal(mismatch.length, 0, `不一致の pt（先頭5件）: ${mismatch.slice(0, 5).join(', ')}`);
  return { compared, low, high };
}

test('定数: 動きのポイント・トリガー数の範囲・入力上限は依頼仕様の値', () => {
  assert.deepEqual(mv.CHARGE, { name: '貯め', point: 595, trigger: 595 });
  assert.deepEqual(mv.RELEASE, { name: '吐き', point: 634, trigger: -180 });
  assert.deepEqual(mv.BONUS, { name: 'ボーナス', point: 3000, max: 5 });
  assert.deepEqual([mv.TRIGGER_MIN, mv.TRIGGER_MAX], [-10000, 999999]);
  assert.deepEqual([mv.LIKELY_BONUS, mv.RARE_BONUS], [[0, 5], [1, 2, 3, 4]]);
  assert.equal(mv.MAX_PT, 99999999);
});

test('solve: 0〜100,000 の全ポイントで前向き列挙と一致する（トリガー下限で外れる組を含む範囲）', () => {
  // 前提: 範囲内に下限で除外される組がある（無ければ下限判定を検算できない）。上限に届く組はまだ無い
  assert.deepEqual(compareRange(0, 100000), { compared: 63072, low: 6086, high: 0 });
});

test('solve: 1,000,000〜1,010,000 の全ポイントで前向き列挙と一致する（トリガー上限で外れる組を含む範囲）', () => {
  assert.deepEqual(compareRange(1000000, 1010000), { compared: 124680, low: 33895, high: 196 });
});

test('solve: 最小の動きの前後（負・0・1・594・595・596・633・634）', () => {
  const cases = [
    [-1, []],
    [0, [{ charge: 0, release: 0, bonus: 0, trigger: 0 }]],
    [1, []], [594, []],
    [595, [{ charge: 1, release: 0, bonus: 0, trigger: 595 }]],
    [596, []], [633, []],
    [634, [{ charge: 0, release: 1, bonus: 0, trigger: -180 }]],
  ];
  for (const [pt, want] of cases) assert.deepEqual(solve(pt), want, `pt=${pt}`);
});

test('solve: トリガー数の下限（−10,000 は候補に入り、−10,005 は外す）', () => {
  assert.deepEqual(solve(56748), [{ charge: 8, release: 82, bonus: 0, trigger: -10000 }]);
  // 前提: 91,745 = 595×21 + 634×125 で、この組のトリガー数は −10,005
  assert.deepEqual([595 * 21 + 634 * 125, 595 * 21 - 180 * 125], [91745, -10005]);
  assert.deepEqual(solve(91745), [{ charge: 113, release: 15, bonus: 5, trigger: 64535 }]);
});

test('solve: トリガー数の上限（999,995 は候補に入り、7桁の 1,000,000 は外す）', () => {
  const bonus0 = pt => solve(pt).filter(x => x.bonus === 0);
  assert.deepEqual(bonus0(1043951), [
    { charge: 1697, release: 54, bonus: 0, trigger: 999995 },
    { charge: 1063, release: 649, bonus: 0, trigger: 515665 },
    { charge: 429, release: 1244, bonus: 0, trigger: 31335 },
  ]);
  // 前提: 1,008,954 = 595×1,684 + 634×11 で、この組のトリガー数は 1,000,000
  assert.deepEqual([595 * 1684 + 634 * 11, 595 * 1684 - 180 * 11], [1008954, 1000000]);
  assert.deepEqual(bonus0(1008954), [
    { charge: 1050, release: 606, bonus: 0, trigger: 515670 },
    { charge: 416, release: 1201, bonus: 0, trigger: 31340 },
  ]);
});

test('solve: ボーナスは最大5回（15,000 は5回で作れ、18,000 は6回が要るため候補なし）', () => {
  assert.deepEqual(solve(15000), [{ charge: 0, release: 0, bonus: 5, trigger: 0 }]);
  assert.deepEqual(solve(18000), []);
});

test('solve: 入力上限 99,999,999 でも全候補が式・トリガー数の範囲・回数の範囲を満たす', () => {
  const pt = 99999999;
  const list = solve(pt);
  assert.equal(list.length, 12);
  const bad = list.filter(x => 595 * x.charge + 634 * x.release + 3000 * x.bonus !== pt
    || 595 * x.charge - 180 * x.release !== x.trigger || x.trigger < -10000 || x.trigger > 999999 || x.bonus > 5
    || ![x.charge, x.release, x.bonus].every(n => Number.isInteger(n) && n >= 0));
  assert.equal(bad.length, 0, `条件を満たさない候補（先頭3件）: ${JSON.stringify(bad.slice(0, 3))}`);
  assert.equal(new Set(list.map(key)).size, list.length, '重複なし');
});

test('bonusLabel: 連続する回数は「〜」、飛びがある・1件以下は「・」で並べる', () => {
  assert.deepEqual([[0, 5], [1, 2, 3, 4], [2, 3], [1, 2, 4], [3], []].map(mv.bonusLabel),
    ['0回・5回', '1〜4回', '2〜3回', '1回・2回・4回', '3回', '']);
  assert.deepEqual([mv.LIKELY_LABEL, mv.RARE_LABEL], ['0回・5回', '1〜4回']);
});

test('表示: サマリと行の書式（0は符号なし・正は+・3桁区切り）、0件のグループは「該当なし」', () => {
  const p = loadMove();
  p.calc(0);
  assert.deepEqual(result(p), {
    summary: SUMMARY(0, 1, 0),
    groups: [{ title: 'ボーナス 0回', total: 1, rows: [['0', '0', '0']], empty: false }, EMPTY(5)],
    toggle: null,
  });
  p.calc(634);
  assert.deepEqual(result(p).groups[0].rows, [['0', '1', '-180']]);
  p.calc(57120);
  assert.deepEqual(result(p).groups[0].rows, [['96', '0', '+57,120']]);
});

test('表示: グループ内の候補を全件、トリガー数が0に近い順に並べる（959,140 のボーナス0回は3件）', () => {
  const p = loadMove();
  p.calc(959140);
  // solve は吐き回数の昇順（トリガー数の降順）に返すため、並べ替えないと逆順になる
  assert.deepEqual(solve(959140).filter(x => x.bonus === 0).map(x => x.trigger), [959140, 474810, -9520]);
  assert.deepEqual(result(p).groups[0].rows, [['344', '1,190', '-9,520'], ['978', '595', '+474,810'], ['1,612', '0', '+959,140']]);
  assert.deepEqual(result(p).groups[1].rows, [['436', '1,080', '+65,020'], ['1,070', '485', '+549,350']]);
  assert.deepEqual(result(p).summary, SUMMARY(959140, 5, 8));
  p.clickResult('rare');
  assert.deepEqual(outline(p), [
    ['ボーナス 0回', 3, 3], ['ボーナス 5回', 2, 2], ['ボーナス 1回', 2, 2],
    ['ボーナス 2回', 2, 2], ['ボーナス 3回', 2, 2], ['ボーナス 4回', 2, 2],
  ]);
});

test('別枠: 主な候補が無いときだけ最初から開く（3,000 は開く・57,120 は閉じる）', () => {
  const p = loadMove();
  p.calc(3000);
  assert.deepEqual(result(p), {
    summary: SUMMARY(3000, 0, 1),
    groups: [EMPTY(0), EMPTY(5),
      { title: 'ボーナス 1回', total: 1, rows: [['0', '0', '0']], empty: false }, EMPTY(2), EMPTY(3), EMPTY(4)],
    toggle: TOGGLE_OPEN,
  });
  p.calc(57120);
  assert.deepEqual(result(p), {
    summary: SUMMARY(57120, 1, 1),
    groups: [{ title: 'ボーナス 0回', total: 1, rows: [['96', '0', '+57,120']], empty: false }, EMPTY(5)],
    toggle: TOGGLE_CLOSED,
  });
});

test('別枠: ボタンで開閉し、再計算で初期状態へ戻る', () => {
  const p = loadMove();
  p.calc(57120);
  p.clickResult('rare');
  const opened = result(p);
  assert.deepEqual(opened.toggle, TOGGLE_OPEN);
  assert.deepEqual(opened.groups.slice(2), [EMPTY(1),
    { title: 'ボーナス 2回', total: 1, rows: [['6', '75', '-9,930']], empty: false }, EMPTY(3), EMPTY(4)]);
  p.clickResult('rare');
  assert.deepEqual([result(p).toggle, result(p).groups.length], [TOGGLE_CLOSED, 2]);
  p.clickResult('rare');
  p.calc(57120);
  assert.deepEqual([result(p).toggle, result(p).groups.length], [TOGGLE_CLOSED, 2]);
  // 最初から開いている場合も閉じられる
  p.calc(3000);
  p.clickResult('rare');
  assert.deepEqual([result(p).toggle, result(p).groups.length], [TOGGLE_CLOSED, 2]);
});

test('別枠: 候補が0件ならボタンを出さない（595）', () => {
  const p = loadMove();
  p.calc(595);
  assert.deepEqual(result(p), {
    summary: SUMMARY(595, 1, 0),
    groups: [{ title: 'ボーナス 0回', total: 1, rows: [['1', '0', '+595']], empty: false }, EMPTY(5)],
    toggle: null,
  });
});

test('表示: 組み合わせが無いポイントは警告だけを出す（前の結果は残さない）', () => {
  const p = loadMove();
  for (const pt of [1, 594, 18000]) {
    p.calc(595);
    p.calc(pt);
    assert.equal(p.el('result').innerHTML, MSG_NONE, `pt=${pt}`);
  }
});

test('doCalc: 上限 99,999,999（8桁）ちょうどは計算し、+1 は入力欄の直下に警告。続けて正常値を入れると戻る', () => {
  const p = loadMove();
  // 初期状態: エラー表示は空で、aria-invalid は未設定
  assert.deepEqual(fieldError(p), ['', null]);
  p.calc(99999999);
  assert.deepEqual([fieldError(p), result(p).summary], [['', 'false'], SUMMARY(99999999, 4, 8)]);
  p.calc(100000000);
  // 警告は入力欄の直下だけに出し、結果欄は前の結果を残さず空にする
  assert.deepEqual([fieldError(p), p.el('result').innerHTML, p.appState.list], [[MSG_OVER, 'true'], '', null]);
  p.calc(595);
  assert.deepEqual([fieldError(p), result(p).summary], [['', 'false'], SUMMARY(595, 1, 0)]);
});

test('doCalc: 入力の正規化（空・非数・負・小数・指数表記・非有限）', () => {
  const cases = [['', 0], ['abc', 0], ['-5', 0], ['595.9', 595], ['1e3', 1000], ['-1e3', 0], ['1e400', 0], ['Infinity', 0]];
  for (const [v, want] of cases) {
    const p = loadMove();
    p.calc(v);
    assert.equal(p.appState.pt, want, `入力 ${JSON.stringify(v)}`);
  }
});

test('初期表示: HTML の案内文と idle の描画が一致する', () => {
  const p = loadMove();
  assert.equal(p.el('result').innerHTML, MSG_IDLE);
  assert.equal(p._resultHtml({ kind: 'idle' }), MSG_IDLE);
  assert.equal(p.buildViewModel({ list: null, error: '' }).kind, 'idle');
});

test('フォーム: 入力欄と submit ボタンを form に入れ、submit で計算して既定動作（送信）を止める', () => {
  const p = loadMove();
  const inner = p.el('calc-form').innerHTML;
  assert.equal(inner.includes('<input type="number" id="inp-pt"'), true);
  assert.equal(inner.includes('<button type="submit" class="btn-calc" id="btn-calc">計算する</button>'), true);
  // キーボード操作を手作りしない: 入力欄・ボタンに直接のリスナーは置かない
  assert.deepEqual([p.el('inp-pt').listeners, p.el('btn-calc').listeners], [{}, {}]);
  assert.equal(p.calc(595), true);
  assert.deepEqual(result(p).summary, SUMMARY(595, 1, 0));
});

test('結果欄: data-action の無い箇所のクリックは描画し直さない', () => {
  const p = loadMove();
  p.calc(57120);
  p.el('result').innerHTML = 'sentinel';
  p.clickResult(null);
  assert.equal(p.el('result').innerHTML, 'sentinel');
  // 対照: ボタンのクリックなら描画し直す
  p.clickResult('rare');
  assert.deepEqual(result(p).toggle, TOGGLE_OPEN);
});

test('仕様: 定数から組んだ6項目を表示し、トグルで開閉する', () => {
  const p = loadMove();
  const { CHARGE: C, RELEASE: R, BONUS: B } = p;
  const n = v => v.toLocaleString();
  const want = [
    `${C.name}: ${n(C.point)}ptとトリガー${n(C.trigger)}個を得ます。`,
    `${R.name}: トリガー${n(-R.trigger)}個を使い、${n(R.point)}ptを得ます。`,
    `${B.name}: ${n(B.point)}ptを得ます。使えるのは最大${B.max}回です。`,
    `トリガー数は0個から数えます。最後のトリガー数が${n(p.TRIGGER_MIN)}〜${n(p.TRIGGER_MAX)}個に収まらない組み合わせは候補に含めません。`,
    `${B.name}は${p.LIKELY_LABEL}のことがほとんどのため、${p.RARE_LABEL}の候補は別枠に分けます。`,
    `同じ${B.name}回数の候補は、最後のトリガー数が0に近い順に並べます。`,
  ];
  assert.equal(p.el('spec-body').innerHTML, want.map(s => `<li>${s}</li>`).join(''));

  const state = () => [p.el('spec-body').classList.contains('open'), p.el('spec-toggle').getAttribute('aria-expanded')];
  assert.deepEqual(state(), [false, 'false']);
  p.fire('spec-toggle', 'click');
  assert.deepEqual(state(), [true, 'true']);
  p.fire('spec-toggle', 'click');
  assert.deepEqual(state(), [false, 'false']);
});

test('HTML: 指定のポイントを含むサマリはスクロールしても画面上端に残る（sticky 指定）', () => {
  const rule = sel => (HTML.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`)) || [])[1];
  // 上端の位置はノッチ等の安全領域を避ける（viewport-fit=cover でなければ 0 と同じ）
  const sticky = body => /\bposition: sticky;/.test(body) && /\btop: env\(safe-area-inset-top, 0px\);/.test(body);
  assert.equal(sticky(rule('.summary')), true);
  // 対照: 同じ判定は、抽出できた sticky でない規則を拾わない
  assert.equal(typeof rule('.srow'), 'string');
  assert.equal(sticky(rule('.srow')), false);
  // サマリは結果欄の先頭に置く（後ろに置くと上端へ届くまで見えない）。別枠の有無で組み立てが分かれるため両方見る
  const p = loadMove();
  for (const pt of [595, 57120]) {
    p.calc(pt);
    assert.equal(p.el('result').innerHTML.startsWith('<div class="summary">'), true, `pt=${pt}`);
  }
});

test('HTML: baseline-ui の禁止事項（100vh・letter-spacing・transition/animation・z-index）を CSS に含まない', () => {
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  // 前提: <style> を切り出せている（indexOf が -1 だと範囲がずれて全文や空文字になる）
  assert.equal(css.startsWith('<style>') && css.includes('.summary {'), true);
  const banned = /\b100vh\b|letter-spacing:|transition:|animation:|z-index:/g;
  assert.deepEqual(css.match(banned), null);
  // 対照: 同じ検出式は各禁止事項を拾う
  assert.deepEqual('a{min-height:100vh;letter-spacing:1px;transition:x;animation:y;z-index:1}'.match(banned),
    ['100vh', 'letter-spacing:', 'transition:', 'animation:', 'z-index:']);
  assert.deepEqual('a{min-height:100dvh}'.match(banned), null);
});

test('HTML: baseline-ui の書式（見出しは balance・本文は pretty・数値は tabular-nums）', () => {
  assert.equal(HTML.includes('h1, .group-title { text-wrap: balance; }'), true);
  assert.equal(HTML.includes('.spec-body li, .placeholder, .field-error { text-wrap: pretty; }'), true);
  const rule = sel => (HTML.match(new RegExp(`\\n${sel.replace(/[.[\]=]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';
  for (const sel of ['.field input[type=number]', '.sval', '.num'])
    assert.equal(rule(sel).includes('font-variant-numeric: tabular-nums;'), true, sel);
  assert.equal(HTML.includes('.group-count { font-size: 12px; font-weight: 400; color: #767676; font-variant-numeric: tabular-nums; }'), true);
});

test('HTML: CSP meta・インラインイベントハンドラ無し・入力欄の label[for]', () => {
  const m = HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(m, 'CSP meta が無い');
  assert.equal(m[1], "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  assert.deepEqual(HTML.match(/<[^>]*\son[a-z]+\s*=/gi), null);
  const inputIds = [...HTML.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(inputIds, ['inp-pt']);
  assert.deepEqual([...HTML.matchAll(/<label for="([^"]+)"/g)].map(x => x[1]), inputIds);
});

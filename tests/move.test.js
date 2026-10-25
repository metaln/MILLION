'use strict';
// 対象: move-estimate-tool.html（solve / buildViewModel / 描画 / doCalc / イベント委譲 / HTML の静的な取り決め）
//
// 観点表で外したもの（理由）:
// - 入力欄の空白・全角数字: <input type=number> がブラウザ側で受け付けない
// - トリガー数 −10,001: 595×貯め − 180×吐き は常に5の倍数で、この値は作れない。下限の外側は −10,005 で確かめる
//   （0〜100,000 の全候補で5の倍数を実測。2026-10-25）
// - 同じボーナス回数でトリガー数の絶対値が等しい2件（並び順の同点）: 負の側が −242,165 以下になり下限で除外される
// - esc の特殊文字: 描画に通す文字列は定数の名前だけ。実装は pst-point-tool.html と同一
// - buildViewModel の idle（未計算）: doCalc は必ず list か error を設定するため操作経路では起きない。
//   静的HTMLの初期表示と一致することだけ見る
// - 描画後のフォーカス位置・CSS・レイアウト: 目視確認の範囲

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMove, parseResult, HTML } = require('./helpers/load-move');

const mv = loadMove();
const { solve } = mv;
const key = x => `${x.charge},${x.release},${x.bonus},${x.trigger}`;
const result = p => parseResult(p.el('result').innerHTML);
const outline = p => result(p).groups.map(g => [g.title, g.total, g.rows.length, g.more]);
const fmtRow = ([a, b, t]) => [a.toLocaleString(), b.toLocaleString(), (t > 0 ? '+' : '') + t.toLocaleString()];

const MSG_IDLE = '<div class="placeholder">「計算する」を押すと結果が表示されます</div>';
const MSG_NONE = '<div class="placeholder warn">指定のポイントに合う組み合わせがありません</div>';
const MSG_OVER = `<div class="placeholder warn">ポイントは${(999999999).toLocaleString()}以下にしてください</div>`;
const SUMMARY = (pt, likely, rare) => [
  ['指定のポイント', pt.toLocaleString()], ['ボーナス0回・5回の候補', `${likely}件`], ['ボーナス1〜4回の候補', `${rare}件`],
];
const EMPTY = c => ({ title: `ボーナス ${c}回`, total: 0, rows: [], empty: true, more: null });
const TOGGLE_CLOSED = { expanded: 'false', label: '◇ ボーナス1〜4回の候補を表示' };
const TOGGLE_OPEN = { expanded: 'true', label: '◇ ボーナス1〜4回の候補を隠す' };

// 4,833,780pt のボーナス0回の全候補（[貯め, 吐き, トリガー数]、トリガー数が0に近い順）
const G0_4833780 = [
  [1784, 5950, -9520], [2418, 5355, 474810], [3052, 4760, 959140], [3686, 4165, 1443470],
  [4320, 3570, 1927800], [4954, 2975, 2412130], [5588, 2380, 2896460], [6222, 1785, 3380790],
  [6856, 1190, 3865120], [7490, 595, 4349450], [8124, 0, 4833780],
];

// 検算用: solve とは別の手順（回数の組を先にすべて作り、合計ポイントで引く）で数え直す
function forward(limit) {
  const byPt = new Map();
  let excluded = 0;
  for (let c = 0; c <= 5; c++)
    for (let b = 0; 634 * b + 3000 * c <= limit; b++)
      for (let a = 0; 595 * a + 634 * b + 3000 * c <= limit; a++) {
        const trigger = 595 * a - 180 * b;
        if (trigger < -10000) { excluded++; continue; }
        const pt = 595 * a + 634 * b + 3000 * c;
        if (!byPt.has(pt)) byPt.set(pt, []);
        byPt.get(pt).push(`${a},${b},${c},${trigger}`);
      }
  return { byPt, excluded };
}

test('定数: 動きのポイント・トリガー数・回数の上限は依頼仕様の値', () => {
  assert.deepEqual(mv.CHARGE, { name: '貯め', point: 595, trigger: 595 });
  assert.deepEqual(mv.RELEASE, { name: '吐き', point: 634, trigger: -180 });
  assert.deepEqual(mv.BONUS, { name: 'ボーナス', point: 3000, max: 5 });
  assert.equal(mv.TRIGGER_MIN, -10000);
  assert.deepEqual([mv.LIKELY_BONUS, mv.RARE_BONUS], [[0, 5], [1, 2, 3, 4]]);
  assert.deepEqual([mv.MAX_PT, mv.SHOW_LIMIT], [999999999, 10]);
});

test('solve: 0〜100,000 の全ポイントで前向き列挙と一致する', () => {
  const LIMIT = 100000;
  const { byPt, excluded } = forward(LIMIT);
  // 前提: 範囲内にトリガー下限で除外される組がある（無ければ下限判定を検算できない）
  assert.equal(excluded, 6086);
  let compared = 0;
  const mismatch = [];
  for (let pt = 0; pt <= LIMIT; pt++) {
    const want = (byPt.get(pt) || []).sort();
    compared += want.length;
    if (solve(pt).map(key).sort().join('|') !== want.join('|')) mismatch.push(pt);
  }
  // 不一致が数万件あると deepEqual の差分生成でメモリが尽きるため、件数で比べて先頭だけを表示する
  assert.equal(mismatch.length, 0, `不一致の pt（先頭5件）: ${mismatch.slice(0, 5).join(', ')}`);
  assert.equal(compared, 63072);
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

test('solve: ボーナスは最大5回（15,000 は5回で作れ、18,000 は6回が要るため候補なし）', () => {
  assert.deepEqual(solve(15000), [{ charge: 0, release: 0, bonus: 5, trigger: 0 }]);
  assert.deepEqual(solve(18000), []);
});

test('solve: 上限 999,999,999 でも全候補が式・トリガー下限・回数の範囲を満たす', () => {
  const pt = 999999999;
  const list = solve(pt);
  assert.equal(list.length, 12388);
  const bad = list.filter(x => 595 * x.charge + 634 * x.release + 3000 * x.bonus !== pt
    || 595 * x.charge - 180 * x.release !== x.trigger || x.trigger < -10000 || x.bonus > 5
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
    groups: [{ title: 'ボーナス 0回', total: 1, rows: [['0', '0', '0']], empty: false, more: null }, EMPTY(5)],
    toggle: null,
  });
  p.calc(634);
  assert.deepEqual(result(p).groups[0].rows, [['0', '1', '-180']]);
  p.calc(57120);
  assert.deepEqual(result(p).groups[0].rows, [['96', '0', '+57,120']]);
});

test('表示: 1グループ10件ちょうどは全件表示、11件は10件と「残り1件」（トリガー数が0に近い順）', () => {
  const p = loadMove();
  p.calc(4349450);
  assert.deepEqual(outline(p), [['ボーナス 0回', 10, 10, null], ['ボーナス 5回', 9, 9, null]]);
  p.calc(4833780);
  assert.deepEqual(outline(p), [['ボーナス 0回', 11, 10, { bonus: 0, rest: 1 }], ['ボーナス 5回', 10, 10, null]]);
  assert.deepEqual(result(p).groups[0].rows, G0_4833780.slice(0, 10).map(fmtRow));
});

test('表示: 「残りを表示」は押したグループだけ全件にし、再計算で10件へ戻る', () => {
  const p = loadMove();
  p.calc(4833780);
  p.clickResult('more', 0);
  assert.deepEqual(result(p).groups[0].rows, G0_4833780.map(fmtRow));
  assert.deepEqual(outline(p), [['ボーナス 0回', 11, 11, null], ['ボーナス 5回', 10, 10, null]]);
  p.calc(4833780);
  assert.deepEqual(outline(p), [['ボーナス 0回', 11, 10, { bonus: 0, rest: 1 }], ['ボーナス 5回', 10, 10, null]]);

  // 複数グループが10件を超えるとき、別枠のグループも番号で個別に開く
  p.calc(6000000);
  p.clickResult('rare');
  p.clickResult('more', 2);
  assert.deepEqual(outline(p), [
    ['ボーナス 0回', 12, 10, { bonus: 0, rest: 2 }], ['ボーナス 5回', 12, 10, { bonus: 5, rest: 2 }],
    ['ボーナス 1回', 12, 10, { bonus: 1, rest: 2 }], ['ボーナス 2回', 13, 13, null],
    ['ボーナス 3回', 12, 10, { bonus: 3, rest: 2 }], ['ボーナス 4回', 13, 10, { bonus: 4, rest: 3 }],
  ]);
});

test('別枠: 主な候補が無いときだけ最初から開く（3,000 は開く・57,120 は閉じる）', () => {
  const p = loadMove();
  p.calc(3000);
  assert.deepEqual(result(p), {
    summary: SUMMARY(3000, 0, 1),
    groups: [EMPTY(0), EMPTY(5),
      { title: 'ボーナス 1回', total: 1, rows: [['0', '0', '0']], empty: false, more: null }, EMPTY(2), EMPTY(3), EMPTY(4)],
    toggle: TOGGLE_OPEN,
  });
  p.calc(57120);
  assert.deepEqual(result(p), {
    summary: SUMMARY(57120, 1, 1),
    groups: [{ title: 'ボーナス 0回', total: 1, rows: [['96', '0', '+57,120']], empty: false, more: null }, EMPTY(5)],
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
    { title: 'ボーナス 2回', total: 1, rows: [['6', '75', '-9,930']], empty: false, more: null }, EMPTY(3), EMPTY(4)]);
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
    groups: [{ title: 'ボーナス 0回', total: 1, rows: [['1', '0', '+595']], empty: false, more: null }, EMPTY(5)],
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

test('doCalc: 上限 999,999,999 ちょうどは計算し、+1 で警告。続けて正常値を入れると戻る', () => {
  const p = loadMove();
  p.calc(999999999);
  assert.deepEqual([p.appState.error, result(p).summary[0]], ['', ['指定のポイント', '999,999,999']]);
  p.calc(1000000000);
  assert.equal(p.el('result').innerHTML, MSG_OVER);
  assert.equal(p.appState.list, null);
  p.calc(595);
  assert.deepEqual(result(p).summary, SUMMARY(595, 1, 0));
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

test('入力欄: Enter で計算し、ほかのキーでは計算しない', () => {
  const p = loadMove();
  p.el('inp-pt').value = '595';
  p.fire('inp-pt', 'keydown', { key: 'a' });
  assert.equal(p.el('result').innerHTML, MSG_IDLE);
  p.fire('inp-pt', 'keydown', { key: 'Enter' });
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
    `トリガー数は0個から数え、最後のトリガー数が${n(p.TRIGGER_MIN)}個を下回る組み合わせは候補から外します。`,
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

test('HTML: CSP meta・インラインイベントハンドラ無し・入力欄の label[for]', () => {
  const m = HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(m, 'CSP meta が無い');
  assert.equal(m[1], "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  assert.deepEqual(HTML.match(/<[^>]*\son[a-z]+\s*=/gi), null);
  const inputIds = [...HTML.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(inputIds, ['inp-pt']);
  assert.deepEqual([...HTML.matchAll(/<label for="([^"]+)"/g)].map(x => x[1]), inputIds);
});

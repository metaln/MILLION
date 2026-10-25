'use strict';
// 対象: move-estimate-tool.html（solve / buildViewModel / 描画 / doCalc / イベント委譲 / HTML の静的な取り決め）
//
// 観点表で外したもの（理由）:
// - トリガー数 −10,001・999,999: 595×貯め − 180×吐き は常に5の倍数で、これらの値は作れない。
//   範囲の外側は −10,005 と 1,000,000、内側は −10,000 と 999,995 で確かめる（0〜100,000 の全候補で5の倍数を実測。2026-10-25）
// - 同じボーナス回数でトリガー数の絶対値が等しい2件（並び順の同点）: 負の側が −242,165 以下になり下限で除外される
// - esc の特殊文字: 描画に通す文字列は定数の名前だけ。実装は pst-point-tool.html と同一
// - buildViewModel の idle（未計算）: doCalc は必ず list か error を設定するため操作経路では起きない。
//   静的HTMLの初期表示と一致することだけ見る
// - サマリの上端固定の実際の見え方・フォーカス位置・色: 目視確認の範囲（CSS の宣言の有無だけ見る）
// - 入力欄での Enter による送信: ブラウザの標準動作（暗黙の submit）。form の中に入力欄と submit ボタンがある構造だけ見る
// - 0回・5回の候補が「吐き4桁かつトリガー数50万以上」の組だけになる pt: 起きない。トリガー数 t（50万〜999,995）の組から
//   貯め−634・吐き+595 とした組はトリガー数 t−484,330（15,670〜515,665）。50万以上ならもう1回引くと 31,335 以上になる。
//   どちらも貯めが足りる（595×633 < 500,000 のため t の組は貯め634回以上、t ≥ 984,330 なら1,654回以上）。
//   よって同じ回数に主な候補が必ず残り、主な候補の有無で決める別枠の初期開閉は外す前と変わらない

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMove, parseResult, viewButtons, HTML } = require('./helpers/load-move');

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
  ['指定のポイント', pt.toLocaleString()], ['主な候補', `${likely}件`], ['その他の候補', `${rare}件`],
];
const EMPTY = c => ({ title: `ボーナス ${c}回`, total: 0, rows: [], empty: true });
const TOGGLE_CLOSED = { expanded: 'false', label: '◇ その他の候補を表示' };
const TOGGLE_OPEN = { expanded: 'true', label: '◇ その他の候補を隠す' };
const VIEWS = pressed => ['all', '0', '5'].map(v => [v, String(v === pressed), v === 'all' ? '両方' : `${v}回`]);

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
  assert.deepEqual([mv.UNLIKELY_RELEASE, mv.UNLIKELY_TRIGGER], [1000, 500000]);
  assert.deepEqual([mv.BONUS_ORDER, mv.BONUS_VIEWS], [[0, 5, 1, 2, 3, 4], ['all', '0', '5']]);
  assert.equal(mv.MAX_PT, 99999999);
});

test('isLikely: ボーナス0回・5回のうち、吐き1,000回以上かつトリガー数500,000以上の組だけを外す（境界の前後）', () => {
  const x = (bonus, release, trigger) => mv.isLikely({ charge: 0, release, bonus, trigger });
  const cases = [
    [0, 1000, 500000, false], [5, 1000, 500000, false], [0, 5662, 965165, false],
    // 片方だけ満たす組は主な候補に残す
    [0, 999, 500000, true], [0, 1000, 499995, true], [0, 999, 999995, true], [0, 9999, 499995, true],
    // 吐き5桁も「4桁以上」として外す
    [0, 10000, 500000, false],
    [0, 0, 0, true], [5, 0, -10000, true], [0, 1000, -10000, true],
    // 1〜4回は吐き・トリガー数によらずその他
    [1, 0, 0, false], [4, 999, 0, false], [2, 1000, 500000, false],
  ];
  assert.deepEqual(cases.map(([b, r, t]) => x(b, r, t)), cases.map(c => c[3]));
});

test('shownBonus: 切り替えで0回・5回の片方を外し、1〜4回は常に残す。並びは BONUS_ORDER', () => {
  assert.deepEqual(['all', '0', '5'].map(mv.shownBonus), [[0, 5, 1, 2, 3, 4], [0, 1, 2, 3, 4], [5, 1, 2, 3, 4]]);
  // 数値の 0・5 は文字列の data-view と一致しない（クリック経路は常に文字列）。'all' 以外の未知の値は1〜4回だけ
  assert.deepEqual([0, 5, '1', 'All', ''].map(mv.shownBonus), Array(5).fill([1, 2, 3, 4]));
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

test('その他: 吐き4桁かつトリガー数50万以上の0回・5回の組は、その他の候補の同じ回数のグループへ移す（4,605,373）', () => {
  const p = loadMove();
  p.calc(4605373);
  const r = result(p);
  assert.deepEqual([r.summary, r.toggle], [SUMMARY(4605373, 3, 10), TOGGLE_CLOSED]);
  assert.deepEqual(r.groups, [
    { title: 'ボーナス 0回', total: 2, rows: [['1,707', '5,662', '-3,495'], ['2,341', '5,067', '+480,835']], empty: false },
    { title: 'ボーナス 5回', total: 1, rows: [['1,799', '5,552', '+71,045']], empty: false },
  ]);
  p.clickResult('rare');
  // その他の候補は 0回→5回→1〜4回 の順。0回・5回のグループは候補があるときだけ出る
  assert.deepEqual(result(p).groups.slice(2, 4), [
    { title: 'ボーナス 0回', total: 1, rows: [['2,975', '4,472', '+965,165']], empty: false },
    { title: 'ボーナス 5回', total: 1, rows: [['2,433', '4,957', '+555,375']], empty: false },
  ]);
  assert.deepEqual(outline(p).slice(4).map(g => g[0]), ['ボーナス 1回', 'ボーナス 2回', 'ボーナス 3回', 'ボーナス 4回']);
});

test('切り替え: 0回・5回の片方だけを表示し、サマリの件数・その他の候補もそれに合わせる', () => {
  const p = loadMove();
  p.calc(4605373);
  assert.deepEqual(viewButtons(p.el('result').innerHTML), VIEWS('all'));
  p.clickView('5');
  p.clickResult('rare');
  const r = result(p);
  assert.deepEqual([viewButtons(p.el('result').innerHTML), r.summary], [VIEWS('5'), SUMMARY(4605373, 1, 9)]);
  assert.deepEqual(outline(p), [
    ['ボーナス 5回', 1, 1], ['ボーナス 5回', 1, 1],
    ['ボーナス 1回', 2, 2], ['ボーナス 2回', 2, 2], ['ボーナス 3回', 2, 2], ['ボーナス 4回', 2, 2],
  ]);
  p.clickView('0');
  assert.deepEqual([viewButtons(p.el('result').innerHTML), result(p).summary], [VIEWS('0'), SUMMARY(4605373, 2, 9)]);
  assert.deepEqual(outline(p).slice(0, 2), [['ボーナス 0回', 2, 2], ['ボーナス 0回', 1, 1]]);
  p.clickView('all');
  assert.deepEqual(result(p).summary, SUMMARY(4605373, 3, 10));
});

test('切り替え: 再計算しても保ち、選んだ回数の候補が無ければそのグループを「該当なし」にする', () => {
  const p = loadMove();
  p.calc(57120);
  p.clickView('5');
  p.calc(57120);
  const r = result(p);
  // 57,120 はボーナス0回の候補だけ。5回だけを表示すると主な候補は0件だが、組み合わせはあるので警告にしない
  assert.deepEqual([viewButtons(p.el('result').innerHTML), r.summary, r.groups, r.toggle],
    [VIEWS('5'), SUMMARY(57120, 0, 1), [EMPTY(5)], TOGGLE_CLOSED]);
  // 対照: 組み合わせが無い pt は切り替えによらず警告
  p.calc(1);
  assert.equal(p.el('result').innerHTML, MSG_NONE);
});

test('切り替え: 決まった値以外（1〜4回・数値でない・空・data-view なし）は無視する', () => {
  const p = loadMove();
  p.calc(4605373);
  p.clickView('5');
  for (const v of ['1', '4', 'All', '', ' 5', '05', undefined]) {
    p.clickView(v);
    assert.deepEqual([p.appState.bonusView, viewButtons(p.el('result').innerHTML)], ['5', VIEWS('5')], `view=${JSON.stringify(v)}`);
  }
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
  // 0回・5回の各2件のうち、吐き4桁かつトリガー数50万以上の +585,365・+659,905 はその他の候補へ移る
  assert.deepEqual([fieldError(p), result(p).summary], [['', 'false'], SUMMARY(99999999, 2, 10)]);
  p.calc(100000000);
  // 警告は入力欄の直下だけに出し、結果欄は前の結果を残さず空にする
  assert.deepEqual([fieldError(p), p.el('result').innerHTML, p.appState.list], [[MSG_OVER, 'true'], '', null]);
  p.calc(595);
  assert.deepEqual([fieldError(p), result(p).summary], [['', 'false'], SUMMARY(595, 1, 0)]);
});

test('doCalc: 指定のポイントは CSV と同じ書式で読む（桁区切り・末尾 pt・全角・前後の空白）', () => {
  const cases = [['4,560,338pt', 4560338], ['４６０５３７３', 4605373], ['３，９００，２０５ｐｔ', 3900205], ['595 pt', 595],
    [' 1 190 ', 1190], ['0', 0], ['99,999,999', 99999999]];
  for (const [v, want] of cases) {
    const p = loadMove();
    p.calc(v);
    assert.deepEqual([p.appState.pt, fieldError(p), result(p).summary[0]], [want, ['', 'false'], ['指定のポイント', want.toLocaleString()]],
      `入力 ${JSON.stringify(v)}`);
  }
});

test('doCalc: 空・整数でない・桁区切りの崩れは入力欄の直下にエラーを出し、計算しない（前の結果を残さない）', () => {
  const NOT_INT = 'ポイントが0以上の整数ではありません';
  const cases = [['', 'ポイントを入力してください'], [' \t ', 'ポイントを入力してください'], ['abc', NOT_INT], ['-5', NOT_INT],
    ['595.9', NOT_INT], ['1e3', NOT_INT], ['Infinity', NOT_INT], ['595pts', NOT_INT], ['1,0000', '桁区切りは3桁ごとにしてください'],
    ['100,000,000', MSG_OVER]];
  for (const [v, msg] of cases) {
    const p = loadMove();
    p.calc(595);
    p.calc(v);
    assert.deepEqual([fieldError(p), p.el('result').innerHTML, p.appState.list], [[msg, 'true'], '', null], `入力 ${JSON.stringify(v)}`);
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
  // 桁区切り・末尾 pt・全角を受け付けるため type=number にしない（数字キーボードは inputmode で出す）
  assert.equal(inner.includes('<input type="text" id="inp-pt" value="0" inputmode="numeric" autocomplete="off"'), true);
  assert.equal(inner.includes('<button type="submit" class="btn-calc" id="btn-calc">計算する</button>'), true);
  // キーボード操作を手作りしない: 入力欄・ボタンに直接のリスナーは置かない
  assert.deepEqual([p.el('inp-pt').listeners, p.el('btn-calc').listeners], [{}, {}]);
  assert.equal(p.calc(595), true);
  assert.deepEqual(result(p).summary, SUMMARY(595, 1, 0));
});

test('読み上げ: 結果欄全体は aria-live にせず、計算したときだけ短い要約を role=status の要素へ書く', () => {
  assert.equal(HTML.includes('<div id="result">'), true);
  assert.equal(HTML.includes('<p id="result-status" class="visually-hidden" role="status"></p>'), true);
  assert.equal(/\n\.visually-hidden \{[^}]*clip-path: inset\(50%\);[^}]*\}/.test(HTML), true);
  const p = loadMove();
  const status = () => p.el('result-status').textContent;
  assert.equal(status(), '');
  p.calc(57120);
  assert.equal(status(), '主な候補1件、その他の候補1件を計算しました');
  // 開閉・表示の切り替えでは書き換えない（対照: 計算し直せば書き換える）
  p.el('result-status').textContent = 'sentinel';
  p.clickResult('rare');
  p.clickView('0');
  assert.equal(status(), 'sentinel');
  // 件数は表示中のボーナス回数で数えるため、両方の表示へ戻してから計算する
  p.clickView('all');
  p.calc(4605373);
  assert.equal(status(), '主な候補3件、その他の候補10件を計算しました');
  p.calc(1);
  assert.equal(status(), '指定のポイントに合う組み合わせがありません');
  // 入力のエラーは入力欄のエラー欄が知らせるため、要約は空にする
  p.calc('abc');
  assert.equal(status(), '');
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

test('フォーカス: 別枠・表示切り替えのボタンを押したら、描画し直した後に同じボタンへフォーカスを戻す', () => {
  const p = loadMove();
  p.calc(57120);
  assert.deepEqual(p.focused, []);
  p.clickResult('rare');
  assert.deepEqual(p.focused, [{ 'data-action': 'rare' }]);
  p.clickView('5');
  p.clickView('all');
  p.clickView('0');
  assert.deepEqual(p.focused.slice(1), [
    { 'data-action': 'bonus-view', 'data-view': '5' },
    { 'data-action': 'bonus-view', 'data-view': 'all' },
    { 'data-action': 'bonus-view', 'data-view': '0' },
  ]);
  assert.equal(p.focused.length, 4);
  // 負例: data-action の無い箇所・決まった値以外の view・data-view の無いボタン・一括用 action は動かさない
  const before = p.focused.length;
  p.clickResult(null);
  for (const v of ['1', '4', 'All', '', ' 5', '05', undefined]) p.clickView(v);
  p.clickResult('rare-person', 0);
  p.clickResult('unknown');
  assert.equal(p.focused.length, before);
  // 対照: 候補が0件でボタンが無い結果では、有効な action でもフォーカスは記録されない（見つからない）
  p.calc(595);
  p.clickResult('rare');
  assert.equal(p.focused.length, before);
});

// エラー欄の再通知の検査用。submit は入力を送り、err は [エラー欄の文言, aria-invalid] を返す
const ERROR_FIELDS = [
  {
    name: '1人用', id: 'inp-pt', bad: 'abc', badMsg: 'ポイントが0以上の整数ではありません',
    bad2: '', bad2Msg: 'ポイントを入力してください', good: 595, submit: (p, v) => p.calc(v),
  },
  {
    name: 'CSV', id: 'inp-csv', bad: 'b,595\na,abc', badMsg: '2行目「a,abc」: ポイントが0以上の整数ではありません',
    bad2: '', bad2Msg: '名前と現在ptを1行以上入力してください', good: 'b,595', submit: (p, v) => p.batch(v),
  },
];
const errOf = (p, id) => [p.el(`${id}-error`).textContent, p.el(id).getAttribute('aria-invalid')];

test('エラー欄: 同じエラーの再送信は、いったん空にして次のフレームで文言を入れ直す（1人用・CSV）', () => {
  for (const f of ERROR_FIELDS) {
    const p = loadMove();
    f.submit(p, f.bad);
    assert.deepEqual([errOf(p, f.id), p.raf.requested], [[f.badMsg, 'true'], 0], `${f.name} 初回は即時`);
    f.submit(p, f.bad);
    // 文言が変わらないと読み上げられないため、空にしてから次のフレームで入れる。aria-invalid は即時
    assert.deepEqual([errOf(p, f.id), p.raf.requested], [['', 'true'], 1], `${f.name} 再送信の直後`);
    p.flushRaf();
    assert.deepEqual(errOf(p, f.id), [f.badMsg, 'true'], `${f.name} flush 後`);
    // 3回目も同じ
    f.submit(p, f.bad);
    assert.deepEqual([errOf(p, f.id), p.raf.requested], [['', 'true'], 2], `${f.name} 3回目の直後`);
    p.flushRaf();
    assert.deepEqual(errOf(p, f.id), [f.badMsg, 'true'], `${f.name} 3回目 flush 後`);
  }
});

test('エラー欄: 別の文言・空文字は即時に書き、フレームを要求しない', () => {
  for (const f of ERROR_FIELDS) {
    const p = loadMove();
    f.submit(p, f.bad);
    f.submit(p, f.bad2);
    assert.deepEqual([errOf(p, f.id), p.raf.requested], [[f.bad2Msg, 'true'], 0], `${f.name} 別の文言`);
    f.submit(p, f.good);
    assert.deepEqual([errOf(p, f.id), p.raf.requested], [['', 'false'], 0], `${f.name} 正常値で空`);
    // 対照: 同じ文言の再送信ならフレームを要求する
    f.submit(p, f.bad);
    f.submit(p, f.bad);
    assert.equal(p.raf.requested, 1, `${f.name} 対照`);
  }
});

test('エラー欄: 入れ直しを待つ間に別の送信が来たら、古い入れ直しは何も書かない', () => {
  for (const f of ERROR_FIELDS) {
    // 正常値で送信 → 空のまま
    let p = loadMove();
    f.submit(p, f.bad);
    f.submit(p, f.bad);
    f.submit(p, f.good);
    p.flushRaf();
    assert.deepEqual(errOf(p, f.id), ['', 'false'], `${f.name} 正常値`);
    // 別のエラー → 別のエラー文言が残る
    p = loadMove();
    f.submit(p, f.bad);
    f.submit(p, f.bad);
    f.submit(p, f.bad2);
    p.flushRaf();
    assert.deepEqual(errOf(p, f.id), [f.bad2Msg, 'true'], `${f.name} 別のエラー`);
    // 対照: 待つ間に何も来なければ古い文言が入る
    p = loadMove();
    f.submit(p, f.bad);
    f.submit(p, f.bad);
    p.flushRaf();
    assert.deepEqual(errOf(p, f.id), [f.badMsg, 'true'], `${f.name} 対照`);
  }
});

test('HTML: エラー欄は空のとき display:none にせず、余白は文言があるときだけ付ける', () => {
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  assert.equal(css.startsWith('<style>') && css.includes('.field-error {'), true);
  const hidden = /\.field-error:empty\s*\{[^}]*display:\s*none/;
  assert.equal(hidden.test(css), false);
  // 対照: 同じ検出式は変更前の規則を拾う
  assert.equal(hidden.test('\n.field-error:empty { display: none; }\n'), true);
  const rule = sel => (css.match(new RegExp(`\\n${sel.replace(/[.():]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1];
  assert.equal(typeof rule('.field-error:not(:empty)'), 'string');
  assert.equal(/\bmargin-top: 5px;/.test(rule('.field-error:not(:empty)')), true);
  assert.equal(typeof rule('.field-error'), 'string');
  assert.equal(/margin-top/.test(rule('.field-error')), false);
});

test('仕様: 定数から組んだ7項目を表示し、トグルで開閉する', () => {
  const p = loadMove();
  const { CHARGE: C, RELEASE: R, BONUS: B } = p;
  const n = v => v.toLocaleString();
  const want = [
    `${C.name}: ${n(C.point)}ptとトリガー${n(C.trigger)}個を得ます。`,
    `${R.name}: トリガー${n(-R.trigger)}個を使い、${n(R.point)}ptを得ます。`,
    `${B.name}: ${n(B.point)}ptを得ます。使えるのは最大${B.max}回です。`,
    `トリガー数は0個から数えます。最後のトリガー数が${n(p.TRIGGER_MIN)}〜${n(p.TRIGGER_MAX)}個に収まらない組み合わせは候補に含めません。`,
    `${B.name}は${p.LIKELY_LABEL}のことがほとんどのため、${p.RARE_LABEL}の候補は「その他の候補」に分けます。`,
    `${R.name}が${n(p.UNLIKELY_RELEASE)}回以上で、最後のトリガー数が${n(p.UNLIKELY_TRIGGER)}個以上の組み合わせも、ほとんど起きないため「その他の候補」に分けます。`,
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
  assert.equal(HTML.includes('.spec-body li, .placeholder, .field-error, .field-hint { text-wrap: pretty; }'), true);
  const rule = sel => (HTML.match(new RegExp(`\\n${sel.replace(/[.[\]=]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';
  for (const sel of ['.field input', '.field textarea', '.sval', '.num'])
    assert.equal(rule(sel).includes('font-variant-numeric: tabular-nums;'), true, sel);
  assert.equal(HTML.includes('.group-count { font-size: 12px; font-weight: 400; color: #6b6b6b; font-variant-numeric: tabular-nums; }'), true);
});

// WCAG 2.x の相対輝度とコントラスト比（#rrggbb）
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// CSS の1規則（行頭のセレクタ〜}）から指定プロパティの #rrggbb を取る。規則が無ければ null
const cssColor = (sel, prop) => {
  const body = (HTML.match(new RegExp(`\\n${sel.replace(/[.[\]=]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1];
  const m = body && body.match(new RegExp(`(?:^|[;\\s])${prop}: (?:1px solid )?(#[0-9a-fA-F]{6});`));
  return m ? m[1] : null;
};

test('HTML: 補助テキスト（初期案内・件数・該当なし）の文字色は body 背景に対し 4.5:1 以上', () => {
  assert.equal(cssColor('body', 'background'), '#f7f7f7');
  for (const sel of ['.placeholder', '.group-count', '.group-empty']) {
    const c = cssColor(sel, 'color');
    assert.equal(typeof c, 'string', sel);
    assert.equal(contrast(c, '#f7f7f7') >= 4.5, true, `${sel} ${c} ${contrast(c, '#f7f7f7').toFixed(2)}`);
  }
  // 対照: 変更前の #767676 は届かない（約 4.24:1）。計算式は白黒で 21:1
  assert.equal(contrast('#767676', '#f7f7f7') < 4.5, true);
  assert.equal(contrast('#000000', '#ffffff'), 21);
});

test('HTML: 入力欄の枠線は白背景に対し 3:1 以上（入力範囲を示すのは枠線だけ）', () => {
  for (const sel of ['.field input', '.field textarea']) {
    const c = cssColor(sel, 'border');
    assert.equal(typeof c, 'string', sel);
    assert.equal(contrast(c, '#ffffff') >= 3, true, `${sel} ${c} ${contrast(c, '#ffffff').toFixed(2)}`);
  }
  // 対照: 変更前の #ccc は届かない（約 1.61:1）
  assert.equal(contrast('#cccccc', '#ffffff') < 3, true);
});

test('HTML: 入力欄のフォーカスは枠線の色でなくアウトラインで示す（エラーの赤枠中も見える）', () => {
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  assert.equal(css.startsWith('<style>') && css.includes('.field textarea {'), true);
  const noOutline = /outline:\s*none/g;
  assert.deepEqual(css.match(noOutline), null);
  // 対照: 同じ検出式は outline: none を拾う
  assert.deepEqual('a{outline: none}b{outline:none}'.match(noOutline), ['outline: none', 'outline:none']);
  assert.equal(css.includes('\n.field input:focus-visible, .field textarea:focus-visible { outline: 2px solid #3460FB; outline-offset: 1px; }'), true);
});

test('HTML: CSP meta・インラインイベントハンドラ無し・入力欄の label[for]', () => {
  const m = HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(m, 'CSP meta が無い');
  assert.equal(m[1], "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  assert.deepEqual(HTML.match(/<[^>]*\son[a-z]+\s*=/gi), null);
  const inputIds = [...HTML.matchAll(/<(?:input|textarea)[^>]*\sid="([^"]+)"/g)].map(x => x[1]);
  assert.deepEqual(inputIds, ['inp-pt', 'inp-csv']);
  assert.deepEqual([...HTML.matchAll(/<label for="([^"]+)"/g)].map(x => x[1]), inputIds);
});

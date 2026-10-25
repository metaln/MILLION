'use strict';
// 対象: move-estimate-tool.html のチューン形式（solve・候補の分け方・仕様の文言・表示）と、形式の切り替え（setFormat・切り替えボタン）
// シアター形式の計算・表示は tests/move.test.js、CSV一括の読み方は tests/move-batch.test.js
//
// 観点表で外したもの（理由）:
// - トリガー数 −10,000〜−9,976・999,986〜999,999: 595×貯め − 140×吐き は常に35の倍数で、これらの値は作れない。
//   範囲の外側は −10,010 と 1,000,020、内側は −9,975 と 999,985 で確かめる（貯め・吐き0〜299回の全組で35の倍数を実測。2026-10-25）
// - 同じボーナス回数でトリガー数の絶対値が等しい2件（並び順の同点）: 候補どうしの差 64,645 が奇数のため、
//   負の側が −64,645 以下になり下限で除外される
// - 入力上限 99,999,999 ちょうど: 7で割って1余り、チューンでは候補が無い。上限の近くは前向き列挙の範囲で確かめる
// - 形式の選択の保存（開き直したときの復元）: 作っていない。開くたびにシアターから始まる
// - 切り替えボタンの見た目・押しやすさ: 目視確認の範囲（CSS の宣言の有無だけ見る）

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMove, parseResult, parseSummary, viewButtons, formatButtons, HTML } = require('./helpers/load-move');
const { compareRange } = require('./helpers/move-forward');

const mv = loadMove();
const T = mv.FORMATS.theater, U = mv.FORMATS.tune;
const solveTune = pt => mv.solve(pt, U);
// 前向き列挙に渡すチューン形式の値（HTML の定数を読まずに書き写す）
const TUNE = { charge: [525, 595], release: [637, -140], bonus: 3000, counts: [0, 5] };

const html = p => p.el('result').innerHTML;
const result = p => parseResult(html(p));
const outline = p => result(p).groups.map(g => [g.title, g.total, g.rows.length]);
const status = p => p.el('result-status').textContent;
const buttons = p => formatButtons(p.el('format-switch').innerHTML);
const fieldError = (p, id) => [p.el(`${id}-error`).textContent, p.el(id).getAttribute('aria-invalid')];

const SUMMARY = (pt, format, likely, rare) => [
  ['指定のポイント', pt.toLocaleString()], ['形式', format], ['主な候補', `${likely}件`], ['その他の候補', `${rare}件`],
];
const EMPTY = c => ({ title: `ボーナス ${c}回`, total: 0, rows: [], empty: true });
const MSG_NONE = format => `<div class="placeholder warn">${format}形式では、指定のポイントに合う組み合わせがありません。入力したポイントと形式を確かめてください</div>`;
const MSG_IDLE = '<div class="placeholder">「計算する」を押すと結果が表示されます</div>';
const PRESSED = key => [['theater', String(key === 'theater'), 'シアター'], ['tune', String(key === 'tune'), 'チューン']];

test('定数: チューン形式の動きのポイント・トリガー数は依頼仕様の値。ボーナスは0回か5回だけを計算する', () => {
  assert.deepEqual(mv.FORMAT_SPECS.tune, {
    name: 'チューン', charge: { point: 525, trigger: 595 }, release: { point: 637, trigger: -140 },
    bonus: { point: 3000, counts: [0, 5] },
    // 「その他の候補」の基準は仮にシアターと同じ値（使いながら調整する）
    unlikely: { release: 1000, trigger: 500000 },
    // ボーナス0回なら吐き0回、5回なら吐き1回以上がほとんど（システム上の特徴）
    zeroRelease: [0],
  });
  // 対照: シアターにはこの特徴が無い
  assert.equal('zeroRelease' in mv.FORMAT_SPECS.theater, false);
  // 定義から決まる値: 吐きの刻みは 525 / gcd(637, 525) = 525 / 7 = 75。1〜4回を計算しないため rare は空
  assert.deepEqual([U.key, U.releaseStep, U.likely, U.rare, U.order, U.views], ['tune', 75, [0, 5], [], [0, 5], []]);
});

test('views: チューンはどのptでも0回・5回の片方にしか候補が出ない（表示する回数の切り替えを出さない根拠）。対照: シアターは両方に出る', () => {
  let has = 0, both = 0;
  for (let pt = 0; pt <= 100000; pt++) {
    const list = solveTune(pt);
    if (list.length) has++;
    if (list.some(x => x.bonus === 0) && list.some(x => x.bonus === 5)) both++;
  }
  // 前提: 範囲内に候補のある pt が十分ある（7で割った余りが0なら0回、6なら5回）
  assert.deepEqual([has, both], [19763, 0]);
  assert.deepEqual([0, 5].map(c => mv.solve(4605373, T).some(x => x.bonus === c)), [true, true]);
});

test('solve: チューンで 0〜100,000 の全ポイントが前向き列挙と一致する（トリガー下限で外れる組を含む範囲）', () => {
  assert.deepEqual(compareRange(solveTune, 0, 100000, TUNE), { compared: 24898, low: 1176, high: 0 });
});

test('solve: チューンで 1,000,000〜1,010,000 の全ポイントが前向き列挙と一致する（トリガー上限で外れる組を含む範囲）', () => {
  assert.deepEqual(compareRange(solveTune, 1000000, 1010000, TUNE), { compared: 44622, low: 9259, high: 5784 });
});

test('solve: チューンで入力上限の直前 99,999,000〜99,999,999 の全ポイントが前向き列挙と一致する（吐きの75回刻みを上限まで検算）', () => {
  assert.deepEqual(compareRange(solveTune, mv.MAX_PT - 999, mv.MAX_PT, TUNE), { compared: 4468, low: 97185, high: 496941 });
});

test('solve: チューンの最小の動きの前後（負・0・1・524・525・526・636・637・638・1,162）', () => {
  const cases = [
    [-1, []],
    [0, [{ charge: 0, release: 0, bonus: 0, trigger: 0 }]],
    [1, []], [524, []],
    [525, [{ charge: 1, release: 0, bonus: 0, trigger: 595 }]],
    [526, []], [636, []],
    [637, [{ charge: 0, release: 1, bonus: 0, trigger: -140 }]],
    [638, []],
    [1162, [{ charge: 1, release: 1, bonus: 0, trigger: 455 }]],
  ];
  for (const [pt, want] of cases) assert.deepEqual(solveTune(pt), want, `pt=${pt}`);
});

test('solve: チューンのボーナスは0回か5回だけ（3,000〜12,000 の1〜4回分は候補なし、15,000 は5回で作れる）', () => {
  // 1〜4回を計算すれば、どれも貯め・吐き0回の組（トリガー数0）が候補になる値
  for (const pt of [3000, 6000, 9000, 12000]) assert.deepEqual(solveTune(pt), [], `pt=${pt}`);
  assert.deepEqual(solveTune(15000), [{ charge: 0, release: 0, bonus: 5, trigger: 0 }]);
  assert.deepEqual(solveTune(15525), [{ charge: 1, release: 0, bonus: 5, trigger: 595 }]);
  // 対照: シアターでは 3,000 はボーナス1回で作れる
  assert.deepEqual(mv.solve(3000, T), [{ charge: 0, release: 0, bonus: 1, trigger: 0 }]);
});

test('solve: チューンのトリガー数の下限（−9,975 は候補に入り、−10,010 は外す）', () => {
  assert.deepEqual(solveTune(55083), [
    { charge: 94, release: 9, bonus: 0, trigger: 54670 },
    { charge: 3, release: 84, bonus: 0, trigger: -9975 },
  ]);
  // 前提: 52,010 = 525×2 + 637×80 で、この組のトリガー数は −10,010
  assert.deepEqual([525 * 2 + 637 * 80, 595 * 2 - 140 * 80], [52010, -10010]);
  assert.deepEqual(solveTune(52010), [{ charge: 93, release: 5, bonus: 0, trigger: 54635 }]);
});

test('solve: チューンのトリガー数の上限（999,985 は候補に入り、7桁の 1,000,020 は外す）。1グループは最大16件', () => {
  const triggers = pt => solveTune(pt).map(x => x.trigger);
  // solve は吐き回数の昇順（トリガー数の降順）に返す。候補どうしの差は 64,645
  assert.deepEqual(triggers(889945), Array.from({ length: 16 }, (_, k) => 999985 - 64645 * k));
  assert.deepEqual(solveTune(889945)[0], { charge: 1683, release: 10, bonus: 0, trigger: 999985 });
  // 前提: 893,018 = 525×1,684 + 637×14 で、この組のトリガー数は 1,000,020
  assert.deepEqual([525 * 1684 + 637 * 14, 595 * 1684 - 140 * 14], [893018, 1000020]);
  assert.deepEqual(triggers(893018), Array.from({ length: 15 }, (_, k) => 935375 - 64645 * k));
});

test('isLikely: チューンも吐き1,000回以上かつトリガー数500,000以上の組を外す。基準は形式の unlikely・likely から読む', () => {
  const x = (bonus, release, trigger, f = U) => mv.isLikely({ charge: 0, release, bonus, trigger }, f);
  // 吐きの回数で外れないよう、ボーナス5回（吐き1回以上が主な候補）で確かめる
  assert.deepEqual([x(5, 1000, 500000), x(5, 999, 500000), x(5, 1000, 499985), x(5, 1, -9975)],
    [false, true, true, true]);
  // 基準の値を変えた形式では、その値で分ける（シアターの値の直書きでない）
  const adjusted = { ...U, unlikely: { release: 10, trigger: 100 } };
  assert.deepEqual([x(5, 10, 100, adjusted), x(5, 9, 100, adjusted), x(5, 10, 99, adjusted), x(5, 1000, 499985, adjusted)],
    [false, true, true, false]);
  // ボーナス回数が形式の likely に無ければ主な候補にしない（対照: likely にある回数は残す）
  assert.deepEqual([x(0, 0, 0, { ...U, likely: [5] }), x(5, 1, 0, { ...U, likely: [5] })], [false, true]);
});

test('isLikely: チューンはボーナス0回で吐き1回以上の組と、5回で吐き0回の組を外す。回数は形式の zeroRelease から読む', () => {
  const x = (bonus, release, trigger, f = U) => mv.isLikely({ charge: 0, release, bonus, trigger }, f);
  // 吐き0回と1回の境目を、ボーナス0回・5回の両方で見る
  assert.deepEqual([x(0, 0, 595), x(0, 1, 455), x(0, 999, 0), x(5, 0, 0), x(5, 1, -140), x(5, 999, 0)],
    [true, false, false, false, true, true]);
  // zeroRelease の回数を変えた形式では、その回数で分ける（0回の直書きでない）
  const flipped = { ...U, zeroRelease: [5] };
  assert.deepEqual([x(0, 0, 0, flipped), x(0, 1, 0, flipped), x(5, 0, 0, flipped), x(5, 1, 0, flipped)],
    [false, true, true, false]);
  // 吐き1回以上でも、吐き1,000回以上かつトリガー数50万以上の基準では外す（両方の基準を重ねる）
  assert.deepEqual(x(5, 1000, 500000), false);
  // 対照: zeroRelease の無いシアターでは、吐きの回数だけでは外さない
  assert.deepEqual([x(0, 1, 455, T), x(5, 0, 0, T)], [true, true]);
});

test('表示: チューンのボーナス0回で吐き1回以上だけの pt は、主な候補0件で「その他の候補」を最初から開く（1,162）', () => {
  const p = loadMove();
  p.clickFormat('tune');
  p.calc(1162);
  const r = result(p);
  assert.deepEqual([r.summary, r.toggle], [SUMMARY(1162, 'チューン', 0, 1), { expanded: 'true', label: 'その他の候補を隠す' }]);
  assert.deepEqual(outline(p), [['ボーナス 0回', 0, 0], ['ボーナス 5回', 0, 0], ['ボーナス 0回', 1, 1]]);
  assert.deepEqual(r.groups[2].rows, [['1', '1', '+455']]);
  assert.equal(status(p), 'チューン形式で計算しました。主な候補は0件、その他の候補は1件です');
  // 対照: 吐き0回で作れる 525 はボーナス0回の主な候補に残り、別枠は閉じたまま
  p.calc(525);
  assert.deepEqual([result(p).summary, result(p).toggle], [SUMMARY(525, 'チューン', 1, 0), null]);
});

test('表示: チューンのボーナス5回で吐き0回の組は「その他の候補」へ移し、吐き1回以上の組は主な候補に残す（15,637）', () => {
  const p = loadMove();
  p.clickFormat('tune');
  // 前提: 15,637 = 3,000×5 + 637 は吐き1回の組だけ、15,525 = 3,000×5 + 525 は吐き0回の組だけ
  assert.deepEqual(solveTune(15637), [{ charge: 0, release: 1, bonus: 5, trigger: -140 }]);
  assert.deepEqual(solveTune(15525), [{ charge: 1, release: 0, bonus: 5, trigger: 595 }]);
  p.calc(15637);
  assert.deepEqual([result(p).summary, result(p).toggle], [SUMMARY(15637, 'チューン', 1, 0), null]);
  p.calc(15525);
  assert.deepEqual([result(p).summary, outline(p)],
    [SUMMARY(15525, 'チューン', 0, 1), [['ボーナス 0回', 0, 0], ['ボーナス 5回', 0, 0], ['ボーナス 5回', 1, 1]]]);
});

test('表示: チューンはボーナス0回・5回のグループだけを出し、1〜4回のグループと表示する回数の切り替えは出さない（3,000,003）', () => {
  const p = loadMove();
  p.clickFormat('tune');
  p.calc(3000003);
  const r = result(p);
  assert.deepEqual([r.summary, r.toggle], [SUMMARY(3000003, 'チューン', 8, 8), { expanded: 'false', label: 'その他の候補を表示' }]);
  // 3,000,003 は7で割って6余るため5回だけ。0回は「該当なし」
  assert.deepEqual(r.groups, [EMPTY(0), {
    title: 'ボーナス 5回', total: 8, empty: false,
    rows: [['961', '3,894', '+26,635'], ['1,052', '3,819', '+91,280'], ['1,143', '3,744', '+155,925'], ['1,234', '3,669', '+220,570'],
      ['1,325', '3,594', '+285,215'], ['1,416', '3,519', '+349,860'], ['1,507', '3,444', '+414,505'], ['1,598', '3,369', '+479,150']],
  }]);
  p.clickResult('rare');
  // 吐き1,000回以上かつトリガー数50万以上の8件は、その他の候補の5回のグループへ移る
  assert.deepEqual(outline(p), [['ボーナス 0回', 0, 0], ['ボーナス 5回', 8, 8], ['ボーナス 5回', 8, 8]]);
  assert.deepEqual(result(p).groups[2].rows.map(row => row[2]),
    ['+543,795', '+608,440', '+673,085', '+737,730', '+802,375', '+867,020', '+931,665', '+996,310']);
  assert.deepEqual(viewButtons(html(p)), []);
  // 対照: シアターで同じ pt を計算すると切り替えが出る
  p.clickFormat('theater');
  assert.equal(viewButtons(html(p)).length, 3);
});

test('切り替え: 開いたときはシアター。押した形式のボタンだけ aria-pressed=true にし、同じボタンへフォーカスを戻す', () => {
  const p = loadMove();
  assert.deepEqual([buttons(p), p.appState.format, p.focused], [PRESSED('theater'), 'theater', []]);
  p.clickFormat('tune');
  assert.deepEqual([buttons(p), p.appState.format, p.focused], [PRESSED('tune'), 'tune', [{ 'data-format': 'tune' }]]);
  p.clickFormat('theater');
  assert.deepEqual([buttons(p), p.appState.format, p.focused.slice(1)], [PRESSED('theater'), 'theater', [{ 'data-format': 'theater' }]]);
});

test('切り替え: 選択中の形式・決まった値以外（大文字違い・空白・プロトタイプの名前・data-format なし・ボタンの外）は何もしない', () => {
  const p = loadMove();
  p.calc(57120);
  p.el('result').innerHTML = 'sentinel';
  p.el('result-status').textContent = 'sentinel';
  p.el('format-switch').innerHTML = 'sentinel';
  const seen = () => [p.appState.format, html(p), status(p), p.el('format-switch').innerHTML, p.focused.length];
  for (const v of ['theater', 'Tune', 'THEATER', '', ' tune', '__proto__', 'toString', 'constructor', undefined, null]) {
    p.clickFormat(v);
    assert.deepEqual(seen(), ['theater', 'sentinel', 'sentinel', 'sentinel', 0], `format=${JSON.stringify(v)}`);
  }
  // 対照: 有効な別の形式なら描き直し、フォーカスを戻す
  p.clickFormat('tune');
  assert.deepEqual([p.appState.format, html(p).startsWith('<div class="summary">'), buttons(p), p.focused.length],
    ['tune', true, PRESSED('tune'), 1]);
});

test('切り替え: 1人用の結果を計算した pt のままその形式で計算し直し、要約を読み上げる（525 はシアターで候補なし・チューンで1件）', () => {
  const p = loadMove();
  p.calc(525);
  assert.deepEqual([html(p), status(p)], [MSG_NONE('シアター'), 'シアター形式では、指定のポイントに合う組み合わせがありません']);
  // 入力欄の値は読み直さない
  p.el('inp-pt').value = '595';
  p.clickFormat('tune');
  assert.deepEqual(result(p), {
    summary: SUMMARY(525, 'チューン', 1, 0),
    groups: [{ title: 'ボーナス 0回', total: 1, rows: [['1', '0', '+595']], empty: false }, EMPTY(5)],
    toggle: null,
  });
  assert.equal(status(p), 'チューン形式で計算しました。主な候補は1件、その他の候補は0件です');
  p.clickFormat('theater');
  assert.deepEqual([html(p), status(p)], [MSG_NONE('シアター'), 'シアター形式では、指定のポイントに合う組み合わせがありません']);
  // チューンで候補なしの pt は、チューンの文言で警告する
  p.clickFormat('tune');
  p.calc(4605373);
  assert.deepEqual([html(p), status(p)], [MSG_NONE('チューン'), 'チューン形式では、指定のポイントに合う組み合わせがありません']);
});

test('切り替え: 計算し直した結果は、先にその形式を選んで計算した結果と一致する（1人用・CSV一括、両方向）', () => {
  const fresh = (format, run) => { const q = loadMove(); if (format !== 'theater') q.clickFormat(format); run(q); return q; };
  const runs = [
    ...[3000003, 4605376, 57120, 15000].map(pt => [`pt=${pt}`, q => q.calc(pt)]),
    ['CSV', q => q.batch('a,3000003\nなし,1\nb,57120\nc,4605376\nbad')],
  ];
  for (const [name, run] of runs) {
    const [theater, tune] = [fresh('theater', run), fresh('tune', run)];
    // 前提: 形式で結果が変わる入力（変わらないと計算し直さない欠陥を拾えない）
    assert.notEqual(html(theater), html(tune), name);
    const a = fresh('theater', run);
    a.clickFormat('tune');
    assert.deepEqual([html(a), status(a)], [html(tune), status(tune)], `${name} シアター→チューン`);
    a.clickFormat('theater');
    assert.equal(html(a), html(theater), `${name} チューン→シアター`);
  }
});

test('切り替え: CSV一括の全員を計算し直し、サマリと要約に形式を出す。読めなかった行のエラーは残す', () => {
  const p = loadMove();
  p.batch('a,3000003\nなし,1\nb,57120\nbad');
  p.clickFormat('tune');
  assert.deepEqual(parseSummary(html(p)), [['計算した人数', '3人'], ['形式', 'チューン'], ['読めなかった行', '1行']]);
  assert.equal(status(p), 'チューン形式で3人分を計算しました。読めなかった行は1行です');
  assert.deepEqual(p.appState.batch.map(x => [x.name, x.list]), [
    ['a', solveTune(3000003)], ['なし', []], ['b', solveTune(57120)],
  ]);
  // 同じ文言は読み上げのため次のフレームで入れ直す（#20）。入れ直した後の表示を見る
  p.flushRaf();
  assert.deepEqual(fieldError(p, 'inp-csv'), ['4行目「bad」: カンマかタブの区切りがありません', 'true']);
  assert.deepEqual(viewButtons(html(p)), []);
});

test('切り替え: 表示中でない側の結果も計算し直す（list・batch は常に選択中の形式の結果）', () => {
  const p = loadMove();
  p.calc(3000003);
  p.batch('a,57120');
  p.clickFormat('tune');
  assert.deepEqual([p.appState.mode, p.appState.list, p.appState.batch[0].list], ['batch', solveTune(3000003), solveTune(57120)]);
  p.calc(3000003);
  p.clickFormat('theater');
  assert.deepEqual([p.appState.mode, p.appState.batch[0].list], ['single', mv.solve(57120, T)]);
});

test('切り替え: 別枠の開閉は初期状態へ戻る（1人用・CSV一括）', () => {
  const p = loadMove();
  p.calc(3000003);
  p.clickResult('rare');
  assert.equal(result(p).toggle.expanded, 'true');
  p.clickFormat('tune');
  assert.equal(result(p).toggle.expanded, 'false');
  p.batch('a,3000003');
  p.clickResult('rare-person', 0);
  assert.equal(p.appState.batch[0].rareOpen, true);
  p.clickFormat('theater');
  assert.equal(p.appState.batch[0].rareOpen, false);
});

test('切り替え: 未計算・入力のエラーの状態は描き直さず、エラーを読み上げ直さない（対照: 結果があれば描き直す）', () => {
  const p = loadMove();
  p.clickFormat('tune');
  assert.deepEqual([html(p), status(p), p.appState.list, p.raf.requested], [MSG_IDLE, '', null, 0]);
  p.calc('abc');
  p.clickFormat('theater');
  assert.deepEqual([html(p), p.appState.list, fieldError(p, 'inp-pt'), p.raf.requested],
    ['', null, ['ポイントが0以上の整数ではありません', 'true'], 0]);
  p.batch('');
  p.clickFormat('tune');
  assert.deepEqual([html(p), p.appState.batch, fieldError(p, 'inp-csv'), p.raf.requested],
    ['', null, ['名前と現在ptを1行以上入力してください', 'true'], 0]);
  // 切り替えた形式は次の計算に使う
  p.calc(525);
  assert.deepEqual(result(p).summary, SUMMARY(525, 'チューン', 1, 0));
});

test('切り替え: チューンでは表示する回数の選択によらず両方を表示する。選んであった回数はシアターへ戻すと元に戻る', () => {
  const p = loadMove();
  p.calc(3000003);
  p.clickView('5');
  assert.deepEqual(outline(p).map(g => g[0]), ['ボーナス 5回']);
  p.clickFormat('tune');
  // 5回だけを表示する選択が効いていれば、0回のグループは出ない
  assert.deepEqual([viewButtons(html(p)), outline(p).map(g => g[0])], [[], ['ボーナス 0回', 'ボーナス 5回']]);
  // チューンの表示中に届いた表示切り替えのクリックは無視する（ボタンは無い）
  const before = p.focused.length;
  p.clickView('0');
  assert.deepEqual([p.appState.bonusView, p.focused.length], ['5', before]);
  p.clickFormat('theater');
  assert.deepEqual(viewButtons(html(p)).map(b => b[1]), ['false', 'false', 'true']);
});

test('仕様: チューンへ切り替えると、チューンの定数から組んだ7項目に替わる（1〜4回の項目の代わりに吐き0回の項目を置き、次の項目は「も」でつなぐ）', () => {
  const p = loadMove();
  const theater = p.el('spec-body').innerHTML;
  p.fire('spec-toggle', 'click');
  p.clickFormat('tune');
  const { charge: C, release: R, bonus: B, unlikely: X } = p.FORMAT_SPECS.tune;
  const n = v => v.toLocaleString();
  const want = [
    `貯め: ${n(C.point)}ptとトリガー${n(C.trigger)}個を得ます。`,
    `吐き: トリガー${n(-R.trigger)}個を使い、${n(R.point)}ptを得ます。`,
    `ボーナス: ${n(B.point)}ptを得ます。回数は0回か5回として計算します。`,
    `開始時のトリガー数は0個とします。最終トリガー数が${n(p.TRIGGER_MIN)}〜${n(p.TRIGGER_MAX)}個に収まらない組み合わせは候補に含めません。`,
    'ボーナスが0回なら吐きは0回、5回なら吐きは1回以上のことがほとんどのため、そうでない組み合わせは「その他の候補」に分けます。',
    `吐きが${n(X.release)}回以上で、最終トリガー数が${n(X.trigger)}個以上の組み合わせも、ほとんど起きないため「その他の候補」に分けます。`,
    '同じボーナス回数の候補は、最終トリガー数が0に近い順に並べます。',
  ];
  assert.equal(p.el('spec-body').innerHTML, want.map(s => `<li>${s}</li>`).join(''));
  // 開閉の状態は切り替えで変えない。シアターへ戻すと開いたときの文言に戻る
  assert.deepEqual([p.el('spec-body').classList.contains('open'), p.el('spec-toggle').getAttribute('aria-expanded')], [true, 'true']);
  p.clickFormat('theater');
  assert.equal(p.el('spec-body').innerHTML, theater);
  // 前提: シアターの文言はチューンと異なる
  assert.notEqual(theater, want.map(s => `<li>${s}</li>`).join(''));
});

test('HTML: 形式の切り替えは結果欄の外（画面上部）に置き、ラベル付きの group にする', () => {
  assert.equal(HTML.includes([
    '<div class="format-row">',
    '  <span id="format-label">形式</span>',
    '  <div class="seg" id="format-switch" role="group" aria-labelledby="format-label"></div>',
    '</div>',
  ].join('\n')), true);
  const at = s => HTML.indexOf(s);
  // 前提: 比べる3か所が HTML にある（-1 だと順序の比較が崩れる）
  assert.deepEqual([at('<h1>') > 0, at('id="format-switch"') > 0, at('<div class="layout">') > 0], [true, true, true]);
  assert.equal(at('<h1>') < at('id="format-switch"') && at('id="format-switch"') < at('<div class="layout">'), true);
  assert.equal(/\n\.format-row \{[^}]*display: flex;[^}]*\}/.test(HTML), true);
  assert.equal(HTML.includes('\n.format-row .seg-btn { min-width: 88px; padding: 6px 14px; font-size: 13px; }'), true);
});

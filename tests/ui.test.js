'use strict';
// 対象: doCalc（入力の正規化・上限）/ 描画（_render*）/ 入力欄への書き戻し / adj・rAF・イベント委譲
//
// 観点表で外したもの（理由）:
// - 入力欄の空白・全角数字: <input type=number> がブラウザ側で受け付けない
// - 合計が目標を超える（↑表示）の UI 操作経路: 消化本数は maxCounts が上限のため到達しない → 描画関数へ直接 vm を渡して検査
// - ok=false の UI 操作経路: calcAlgo の解の部分集合では EL 本数が常に足りる（改修済メモ 2026-09-04）→ 同上
// - CSS・レイアウト・色: 目視確認の範囲

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPst, parseRows, parseOrder } = require('./helpers/load-pst');

const WARN_EL = '　※ Event Live が出現します';
const WARN_ORDER = '　※ この本数ではプレイ順序を組めません';
const MSG_INFEASIBLE = '<div class="placeholder warn">目標ポイントにぴったり合う組み合わせがありません</div>';
const MSG_ACHIEVED = '<div class="placeholder">目標に達しています</div>';

const rows = p => parseRows(p.el('result-rows').innerHTML);
const order = p => parseOrder(p.el('order-list').innerHTML);
const shown = (p, id) => p.el(id).style.display;
const summary = p => ({
  total: p.el('s-total').textContent, target: p.el('s-target').textContent,
  diff: p.el('s-diff').textContent, diffClass: p.el('s-diff').className,
  prog: p.el('s-prog').textContent, progClass: p.el('s-prog').className,
});
const inputs = p => ({ current: String(p.el('inp-current').value), progress: String(p.el('inp-progress').value) });
const tap = (p, id, d) => { p.clickCounter(id, d); p.flushRaf(); };

test('doCalc: 入力の正規化（空・非数・負・小数・上限超え・現在>目標）', () => {
  const cases = [
    [['', 'abc', ''], { target: 0, current: 0, initialProgress: 0 }],
    [['-100', '-5', '-5'], { target: 0, current: 0, initialProgress: 0 }],
    [['600.9', '0', '49.9'], { target: 600, current: 0, initialProgress: 49 }],
    [['600', '0', '100'], { target: 600, current: 0, initialProgress: 100 }],
    [['600', '0', '101'], { target: 600, current: 0, initialProgress: 100 }],
    [['600', '0', '150'], { target: 600, current: 0, initialProgress: 100 }],
    [['300', '500', '0'], { target: 300, current: 300, initialProgress: 0 }],
  ];
  for (const [[t, c, g], want] of cases) {
    const p = loadPst();
    p.calc(t, c, g);
    const { target, current, initialProgress } = p.appState;
    assert.deepEqual({ target, current, initialProgress }, want, `入力 ${JSON.stringify([t, c, g])}`);
  }
});

test('doCalc: 指数表記を数値として読む（小数・負は正規化、非有限は0）', () => {
  const cases = [['1e3', 1000], ['1.5e3', 1500], ['1e-3', 0], ['-1e3', 0], ['1e400', 0], ['Infinity', 0]];
  for (const [t, want] of cases) {
    const p = loadPst();
    p.calc(t, '0', '0');
    assert.equal(p.appState.target, want, `入力 ${t}`);
  }
});

test('doCalc: 目標−現在の上限 MAX_DIFF ちょうどは計算し、+1 で警告して結果を隠す', () => {
  const warn = `<div class="placeholder warn">目標と現在のポイントの差は${(20000).toLocaleString()}以下にしてください</div>`;
  const p = loadPst();
  assert.equal(p.MAX_DIFF, 20000);
  p.calc(20000, 0, 0);
  assert.equal(p.appState.feasible, true);
  assert.equal(shown(p, 'summary'), 'block');
  p.calc(20001, 0, 0);
  assert.equal(p.el('result-rows').innerHTML, warn);
  assert.deepEqual([shown(p, 'summary'), shown(p, 'play-order'), p.appState.feasible], ['none', 'none', false]);
  // 上限は現在ポイントではなく差に掛かる
  p.calc(999999, 979999, 0);
  assert.notEqual(p.el('result-rows').innerHTML, warn);
  p.calc(999999, 979998, 0);
  assert.equal(p.el('result-rows').innerHTML, warn);
});

test('doCalc: 現在>目標は差の上限判定より先に目標へ丸める（警告ではなく達成表示）', () => {
  const p = loadPst();
  p.calc(30000, 50000, 0);
  assert.equal(p.el('result-rows').innerHTML, MSG_ACHIEVED);
});

test('doCalc: 前回の結果が出ている状態から上限超え → 結果・サマリ・順序をすべて隠し、再計算で戻る', () => {
  const p = loadPst();
  p.calc(600, 0, 0);
  assert.deepEqual([shown(p, 'summary'), shown(p, 'play-order')], ['block', 'block']);
  p.calc(20001, 0, 0);
  assert.deepEqual([shown(p, 'summary'), shown(p, 'play-order'), rows(p)], ['none', 'none', []]);
  p.calc(600, 0, 0);
  assert.deepEqual([shown(p, 'summary'), shown(p, 'play-order'), rows(p).length], ['block', 'block', 1]);
});

test('doCalc: 差1（最小曲50未満）は infeasible 表示で入力欄を書き戻さない', () => {
  const p = loadPst();
  p.calc(500, 499, 150);
  assert.equal(p.el('result-rows').innerHTML, MSG_INFEASIBLE);
  assert.deepEqual([shown(p, 'summary'), shown(p, 'play-order')], ['none', 'none']);
  assert.deepEqual(inputs(p), { current: '499', progress: '150' });
});

test('doCalc: 差0は達成表示で、現在=目標・進捗を上限へ丸めて書き戻す', () => {
  const p = loadPst();
  p.calc(500, 900, 150);
  assert.equal(p.el('result-rows').innerHTML, MSG_ACHIEVED);
  assert.deepEqual([shown(p, 'summary'), shown(p, 'play-order')], ['none', 'none']);
  assert.deepEqual(inputs(p), { current: '500', progress: '100' });
});

test('結果行: 0本にした行は残り、−が無効・+で戻せる。合計・差分・順序が連動する', () => {
  const p = loadPst();
  p.calc(600, '-5', 0);
  assert.deepEqual(inputs(p), { current: '0', progress: '0' });
  assert.deepEqual(rows(p), [{ id: 'mm3', name: 'Million Mix', stage: '3rd', count: 1, decDisabled: false, incDisabled: true }]);
  assert.deepEqual(summary(p), { total: '0', target: '600', diff: '⚠ -600', diffClass: 'sval warn', prog: '0', progClass: 'sval' });
  assert.deepEqual(order(p), [{ cls: '', text: 'Million Mix3rd' }]);

  tap(p, 'mm3', -1);
  assert.deepEqual(rows(p), [{ id: 'mm3', name: 'Million Mix', stage: '3rd', count: 0, decDisabled: true, incDisabled: false }]);
  assert.deepEqual(summary(p), { total: '600', target: '600', diff: '✓ +0', diffClass: 'sval ok', prog: '50', progClass: 'sval' });
  assert.equal(shown(p, 'play-order'), 'none');

  tap(p, 'mm3', 1);
  assert.equal(rows(p)[0].count, 1);
  assert.equal(summary(p).diff, '⚠ -600');
  assert.deepEqual([shown(p, 'play-order'), order(p).length], ['block', 1]);
});

test('adj: 0未満・最大超え・未知IDは丸める', () => {
  const p = loadPst();
  p.calc(600, 0, 0);
  p.adj('mm3', 1);
  assert.equal(p.appState.counts.mm3, 1);
  p.adj('mm3', -1); p.adj('mm3', -1);
  assert.equal(p.appState.counts.mm3, 0);
  const before = p.sumState();
  p.adj('zzz', 1);
  assert.equal(p.appState.counts.zzz, 0);
  assert.deepEqual(p.sumState(), before);
});

test('最終進捗: 99 は警告なし / 100 で EL 出現警告 / EL 消化で解除', () => {
  const p = loadPst();
  p.calc(600, 0, 49);
  tap(p, 'mm3', -1);
  assert.deepEqual([summary(p).prog, summary(p).progClass], ['99', 'sval']);

  const q = loadPst();
  q.calc(3600, 0, 50);
  assert.deepEqual(order(q), [{ cls: '', text: 'Million Mix3rd' }, { cls: 'el-step', text: 'Event Live（消化）' }]);
  tap(q, 'mm3', -1);
  assert.deepEqual([summary(q).prog, summary(q).progClass], ['100' + WARN_EL, 'sval warn']);
  assert.deepEqual(order(q), [{ cls: 'el-step', text: 'Event Live（消化）' }]);
  tap(q, 'el', -1);
  assert.deepEqual([summary(q).prog, summary(q).progClass, summary(q).diff], ['0', 'sval', '✓ +0']);
});

test('最終進捗の表示は 0〜100 に丸める（EL先行消化で負 / 進捗100から3rd消化で150）', () => {
  const p = loadPst();
  p.calc(3600, 0, 50);
  tap(p, 'el', -1);   // 内部進捗 -50
  assert.equal(p.sumState().prog, -50);
  assert.deepEqual([summary(p).prog, summary(p).progClass], ['0', 'sval']);
  assert.deepEqual(order(p), [{ cls: '', text: 'Million Mix3rd' }]);

  const q = loadPst();
  q.calc(3600, 0, 100);
  assert.deepEqual(order(q).map(o => o.cls), ['el-step', '']);
  tap(q, 'mm3', -1);  // 内部進捗 150
  assert.equal(q.sumState().prog, 150);
  assert.equal(summary(q).prog, '100' + WARN_EL);
});

test('差分表示: −1 / 0 / +1 で記号と色クラスが切り替わる', () => {
  const p = loadPst();
  p.appState.target = 600;
  const cases = [[599, '⚠ -1', 'sval warn'], [600, '✓ +0', 'sval ok'], [601, '↑ +1', 'sval over']];
  for (const [pts, diff, cls] of cases) {
    p._renderSummary({ kind: 'rows', pts, prog: 0, ok: true });
    assert.deepEqual([summary(p).diff, summary(p).diffClass], [diff, cls], `pts=${pts}`);
  }
  p.appState.target = 20000;
  p._renderSummary({ kind: 'rows', pts: 0, prog: 0, ok: true });
  assert.equal(summary(p).diff, `⚠ -${(20000).toLocaleString()}`);
});

test('順序を組めない（ok=false）ときはサマリと順序の両方に警告を出す', () => {
  const p = loadPst();
  p._renderSummary({ kind: 'rows', pts: 0, prog: 30, ok: false });
  assert.deepEqual([summary(p).prog, summary(p).progClass], ['30' + WARN_ORDER, 'sval warn']);
  p._renderSummary({ kind: 'rows', pts: 0, prog: 100, ok: false });
  assert.equal(summary(p).prog, '100' + WARN_EL + WARN_ORDER);

  p._renderOrder({ kind: 'rows', seq: [], ok: false });
  assert.equal(shown(p, 'play-order'), 'block');
  assert.deepEqual(order(p), [{ cls: 'order-error', text: 'この本数ではプレイ順序を組めません（Event Liveの残り本数と、進捗が100に達する回数が合いません）' }]);
  // 対照: 同じ空の順序でも ok=true なら順序カードを隠す
  p._renderOrder({ kind: 'rows', seq: [], ok: true });
  assert.equal(shown(p, 'play-order'), 'none');
});

test('+/− 操作は入力欄を書き戻さない（再計算すると書き戻す）', () => {
  const p = loadPst();
  p.calc(3600, 0, 50);
  p.el('inp-current').value = '12345';
  p.el('inp-progress').value = '150';
  tap(p, 'mm3', -1);
  assert.deepEqual(inputs(p), { current: '12345', progress: '150' });
  // 対照: 再計算では正規化した値（現在→目標へ丸めて達成 / 進捗→100）を書き戻す
  p.fire('btn-calc');
  assert.deepEqual(inputs(p), { current: '3600', progress: '100' });
});

test('rAF: 同一フレーム内の連打は描画1回にまとめ、フレーム後は次の要求を受け付ける', () => {
  const p = loadPst();
  p.calc(4200, 0, 0);   // { mm3: 2, el: 1 }
  assert.equal(p.raf.requested, 0);
  p.clickCounter('mm3', -1); p.clickCounter('mm3', -1); p.clickCounter('el', -1);
  assert.equal(p.raf.requested, 1);
  assert.deepEqual(rows(p).map(r => r.count), [1, 2], '描画前は旧表示のまま（el, mm3 の順）');
  p.flushRaf();
  assert.deepEqual(rows(p).map(r => r.count), [0, 0]);
  p.clickCounter('mm3', 1);
  assert.equal(p.raf.requested, 2);
});

test('イベント委譲: .cbtn 以外のクリックは無視し、.cbtn は data-id / data-d で adj する', () => {
  const p = loadPst();
  p.calc(600, 0, 0);
  p.clickCounter(null);
  assert.deepEqual([p.raf.requested, p.appState.counts.mm3], [0, 1]);
  p.clickCounter('mm3', -1);
  assert.deepEqual([p.raf.requested, p.appState.counts.mm3], [1, 0]);
});

test('曲名・ステージ名は HTML エスケープして描画する（結果行・順序の両方）', () => {
  const p = loadPst({ patches: [{
    from: "{ id: 'mm3', name: 'Million Mix', stage: '3rd',",
    to: "{ id: 'mm3', name: '<b>&\"M', stage: \"<i>'\",",
  }] });
  p.calc(600, 0, 0);
  const html = p.el('result-rows').innerHTML;
  assert.ok(html.includes('<span class="row-name">&lt;b&gt;&amp;&quot;M</span>'), html);
  assert.ok(html.includes('<span class="stage-badge">&lt;i&gt;&#39;</span>'), html);
  assert.equal(p.el('order-list').innerHTML,
    '<li><span class="order-name">&lt;b&gt;&amp;&quot;M</span><span class="order-stage">&lt;i&gt;&#39;</span></li>');
});

test('esc: 5種の特殊文字・既にエスケープ済みの文字列・数値', () => {
  const p = loadPst();
  assert.equal(p.esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(p.esc('&amp;'), '&amp;amp;');
  assert.equal(p.esc('plain'), 'plain');
  assert.equal(p.esc(0), '0');
});

test('仕様トグル: クリックごとに本文の open と aria-expanded が反転する', () => {
  const p = loadPst();
  assert.equal(p.el('spec-toggle').getAttribute('aria-expanded'), 'false');
  p.fire('spec-toggle');
  assert.deepEqual([p.el('spec-body').classList.contains('open'), p.el('spec-toggle').getAttribute('aria-expanded')], [true, 'true']);
  p.fire('spec-toggle');
  assert.deepEqual([p.el('spec-body').classList.contains('open'), p.el('spec-toggle').getAttribute('aria-expanded')], [false, 'false']);
});

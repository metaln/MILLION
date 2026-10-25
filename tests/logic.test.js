'use strict';
// 対象: calcAlgo / buildSequence / sumState / buildViewModel（DOMに触れない値算出）
//
// 観点表で外したもの（理由）:
// - calcAlgo への NaN・文字列・負の進捗: 呼び出し元 doCalc が toInt で正規化済み（ui.test.js で検査）
// - calcAlgo の実行時間: 環境依存で不安定。計測記録は 改修済メモ.md（2026-09-04）
// - 「EL解をEL無し解より優先」の分岐: EL 1本=3000pt に対し非EL曲は最大600ptのため、
//   総プレイ回数最小の比較と常に同じ解を選ぶ（等価。needed 2900〜20000 × 進捗6種の19,470件で差分0を実測。2026-10-13）
// - buildSequence の guard 上限: 毎反復 push か break のため上限に達しない

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPst } = require('./helpers/load-pst');

const pst = loadPst();
const { calcAlgo, buildSequence, BY_ID, EL, PROGRESS_CAP } = pst;
const ids = seq => seq.map(s => s.id);

// 解の検算: calcAlgo とは別の手順でポイント・進捗・EL出現を数え直す
function assertValidPlan(needed, p0, res) {
  assert.equal(res.feasible, true);
  let pts = 0;
  for (const [id, n] of Object.entries(res.counts)) {
    assert.ok(BY_ID[id], `未知の曲ID ${id}`);
    assert.ok(Number.isInteger(n) && n > 0, `${id} の本数 ${n}`);
    pts += BY_ID[id].point * n;
  }
  assert.equal(pts, needed, 'ポイント合計');
  const { seq, ok } = buildSequence(res.counts, p0);
  assert.equal(ok, true, 'プレイ順序を組めること');
  let prog = p0;
  for (const s of seq) {
    // EL は出現中（進捗100以上）にだけ打てる。出現中は EL 以外を打てない
    assert.equal(s.id === 'el', prog >= PROGRESS_CAP, `進捗${prog}で${s.id}`);
    prog += s.trigger;
  }
  assert.ok(prog >= 0 && prog < PROGRESS_CAP, `最終進捗 ${prog}`);
  assert.equal(res.prog, prog, '返却値 prog と逐次計算の一致');
}

// 進捗を100未満に保ったまま pt を作れるか（needed < 3000 では EL を挟めないため、これが成立条件と同値）
function feasibleBelowEL(needed, p0) {
  const songs = Object.values(BY_ID).filter(s => s.id !== 'el');
  const minGain = new Array(needed + 1).fill(Infinity);
  minGain[0] = 0;
  for (let pt = 1; pt <= needed; pt++)
    for (const s of songs)
      if (s.point <= pt) minGain[pt] = Math.min(minGain[pt], minGain[pt - s.point] + s.trigger);
  return p0 + minGain[needed] < PROGRESS_CAP;
}

test('calcAlgo: 不要（needed≦0）は空の解で進捗をそのまま返す', () => {
  for (const [target, current] of [[500, 500], [500, 501], [0, 0]])
    assert.deepEqual(calcAlgo(target, current, 70), { counts: {}, prog: 70, feasible: true }, `${target}/${current}`);
  // 進捗100でも EL を打たずに済む（needed=0 を DP へ流すと EL 必須扱いで infeasible になる）
  assert.deepEqual(calcAlgo(500, 500, 100), { counts: {}, prog: 100, feasible: true });
});

test('calcAlgo: 最小曲50ptの前後（49は不可・50は2 Mix仕事1本）', () => {
  assert.deepEqual(calcAlgo(49, 0, 0), { counts: {}, prog: 0, feasible: false });
  assert.deepEqual(calcAlgo(50, 0, 0), { counts: { '2mw': 1 }, prog: 0, feasible: true });
  assert.deepEqual(calcAlgo(1, 0, 0), { counts: {}, prog: 0, feasible: false });
});

test('calcAlgo: 3rdで進捗がちょうど100に届くとELが割り込むため別の組み合わせになる', () => {
  // 進捗49+50=99 → Million Mix 3rd 1本で成立
  assert.deepEqual(calcAlgo(600, 0, 49), { counts: { mm3: 1 }, prog: 99, feasible: true });
  // 進捗50+50=100 → EL(+3000)が不可避になり 3rd は使えない → 2nd+1st
  assert.deepEqual(calcAlgo(600, 0, 50), { counts: { mm2: 1, mm1: 1 }, prog: 50, feasible: true });
});

test('calcAlgo: 進捗100入力時はEL消化が必須（3000未満は不可）', () => {
  assert.deepEqual(calcAlgo(2999, 0, 100), { counts: {}, prog: 100, feasible: false });
  assert.deepEqual(calcAlgo(1000, 0, 100), { counts: {}, prog: 100, feasible: false });
  assert.deepEqual(calcAlgo(3000, 0, 100), { counts: { el: 1 }, prog: 0, feasible: true });
  assert.deepEqual(calcAlgo(3050, 0, 100), { counts: { '2mw': 1, el: 1 }, prog: 0, feasible: true });
  assert.deepEqual(ids(buildSequence({ '2mw': 1, el: 1 }, 100).seq), ['el', '2mw']);
});

test('calcAlgo: 端数進捗（90）から3rd 1本でEL出現 → 総プレイ回数最小の解', () => {
  assert.deepEqual(calcAlgo(3426, 0, 90), { counts: { '2m3': 1, el: 1 }, prog: 10, feasible: true });
  assert.deepEqual(calcAlgo(3600, 0, 100), { counts: { mm3: 1, el: 1 }, prog: 50, feasible: true });
});

test('calcAlgo: needed<3000 の可否が独立計算と全件一致し、成立した解はすべて検算を通る', () => {
  const mismatch = [];
  for (const p0 of [0, 50, 99, 100]) {
    for (let needed = 1; needed <= 700; needed++) {
      const res = calcAlgo(needed, 0, p0);
      if (res.feasible !== feasibleBelowEL(needed, p0)) mismatch.push(`${needed}@${p0}`);
      else if (res.feasible) assertValidPlan(needed, p0, res);
      else assert.deepEqual(res, { counts: {}, prog: p0, feasible: false });
    }
  }
  assert.deepEqual(mismatch, []);
});

test('calcAlgo: 進捗0から EL を挟める最小値は 4200（3rd で進捗100に届く最小ポイントが1200）', () => {
  const r3000 = calcAlgo(3000, 0, 0);
  assertValidPlan(3000, 0, r3000);
  assert.equal(r3000.counts.el, undefined);
  assert.deepEqual(calcAlgo(4200, 0, 0), { counts: { mm3: 2, el: 1 }, prog: 0, feasible: true });
});

test('calcAlgo: 3000以上の代表値で解が検算を通る（上限 MAX_DIFF を含む）', () => {
  // 旧検証の代表シナリオ（742/3000/5000/6001/13000/20000 × 進捗0/30/50/90）を統合したもの
  const cases = [[6001, 50], [9999, 37], [13000, 30], [pst.MAX_DIFF, 0], [pst.MAX_DIFF, 100]];
  for (const [needed, p0] of cases) {
    const res = calcAlgo(needed, 0, p0);
    assertValidPlan(needed, p0, res);
    assert.ok(res.counts.el >= 1, `${needed}@${p0} は EL を含む`);
  }
});

test('calcAlgo: 現在ポイントは差分としてだけ効く（目標999999・現在979999でも差20000として解く）', () => {
  assert.deepEqual(calcAlgo(999999, 979999, 0), calcAlgo(pst.MAX_DIFF, 0, 0));
});

test('calcAlgo: 経路復元が途中で切れたら不完全な解を返さず infeasible にする（故障注入）', () => {
  const broken = loadPst({ patches: [{
    from: 'if (cur + 1 < dp[ni]) { dp[ni] = cur + 1; from[ni] = si; }',
    to: 'if (cur + 1 < dp[ni]) { dp[ni] = cur + 1; from[ni] = -1; }',
  }] });
  assert.deepEqual(broken.calcAlgo(600, 0, 0), { counts: {}, prog: 0, feasible: false });
  assert.deepEqual(broken.calcAlgo(3600, 0, 50), { counts: {}, prog: 50, feasible: false });
  // 対照: 復元が不要な解（EL のみ）は破壊の影響を受けない
  assert.deepEqual(broken.calcAlgo(3000, 0, 100), { counts: { el: 1 }, prog: 0, feasible: true });
});

test('buildSequence: 空・本数0のみは空の順序で成立', () => {
  assert.deepEqual(buildSequence({}, 0), { seq: [], ok: true });
  assert.deepEqual(buildSequence({ mm1: 0, el: 0 }, 100), { seq: [], ok: true });
});

test('buildSequence: counts のキー順に関係なく 1st/2nd → 3rd の優先順で並ぶ', () => {
  assert.deepEqual(ids(buildSequence({ '2mw': 1, mm1: 1, mm3: 1, mm2: 1 }, 0).seq), ['mm2', 'mm1', '2mw', 'mm3']);
});

test('buildSequence: 進捗が100に達した直後にELを挟む（99では挟まない）', () => {
  assert.deepEqual(ids(buildSequence({ mm3: 2, mm2: 1, el: 1 }, 0).seq), ['mm2', 'mm3', 'mm3', 'el']);
  assert.deepEqual(ids(buildSequence({ mm3: 1, '2m3': 1, el: 1 }, 49).seq), ['mm3', '2m3', 'el']);
  assert.deepEqual(ids(buildSequence({ mm3: 1, '2m3': 1, el: 1 }, 50).seq), ['mm3', 'el', '2m3']);
});

test('buildSequence: 3rd が残っていて EL が足りなければ ok=false', () => {
  assert.deepEqual(buildSequence({ mm3: 3 }, 0), { seq: [BY_ID.mm3, BY_ID.mm3], ok: false });
});

test('buildSequence: 開始進捗100以上は先頭でELを消化し、ELが足りなければ ok=false', () => {
  assert.deepEqual(ids(buildSequence({ mm1: 1, el: 1 }, 100).seq), ['el', 'mm1']);
  assert.deepEqual(ids(buildSequence({ el: 2 }, 200).seq), ['el', 'el']);
  assert.deepEqual(buildSequence({ el: 1, mm1: 1 }, 200), { seq: [EL], ok: false });
});

test('buildSequence: 進捗由来の出現回数より EL が多ければ、余りを順序へ置かず ok=false', () => {
  assert.deepEqual(buildSequence({ mm1: 1, el: 1 }, 0), { seq: [BY_ID.mm1], ok: false });
  assert.deepEqual(buildSequence({ el: 1 }, 99), { seq: [], ok: false });
  assert.deepEqual(buildSequence({ mm3: 2, el: 2 }, 0), { seq: [BY_ID.mm3, BY_ID.mm3, EL], ok: false });
  // 対照: 出現回数どおりの EL は成立
  assert.deepEqual(buildSequence({ el: 1 }, 100), { seq: [EL], ok: true });
  assert.deepEqual(buildSequence({ mm3: 2, el: 1 }, 0), { seq: [BY_ID.mm3, BY_ID.mm3, EL], ok: true });
});

test('buildSequence: 負の開始進捗（EL先行消化後）でも3rdを順に打てる', () => {
  assert.deepEqual(buildSequence({ mm3: 2 }, -100), { seq: [BY_ID.mm3, BY_ID.mm3], ok: true });
});

test('buildSequence: 未知の曲IDは並べられず ok=false', () => {
  assert.deepEqual(buildSequence({ zzz: 1 }, 0), { seq: [], ok: false });
  assert.deepEqual(buildSequence({ zzz: 1, mm1: 1 }, 0), { seq: [BY_ID.mm1], ok: false });
});

test('sumState: 消化済み本数（max−残り）を加算し、未知IDは無視する', () => {
  const p = loadPst();
  Object.assign(p.appState, {
    current: 100, initialProgress: 30,
    maxCounts: { mm3: 2, el: 1, zzz: 5 }, counts: { mm3: 1, zzz: 0 },   // el は残りキー欠落＝全消化
  });
  assert.deepEqual(p.sumState(), { pts: 100 + 600 + 3000, prog: 30 + 50 - 100 });
  p.appState.maxCounts = {};
  assert.deepEqual(p.sumState(), { pts: 100, prog: 30 });
});

test('buildViewModel: 種別の判定（infeasible は他の値に関係なく優先 / rows 0件は achieved）', () => {
  const p = loadPst();
  assert.deepEqual(p.buildViewModel({ feasible: false, counts: { mm3: 1 }, maxCounts: { mm3: 1 } }), { kind: 'infeasible' });
  assert.deepEqual(p.buildViewModel({ feasible: true, current: 500, initialProgress: 20, counts: {}, maxCounts: {} }), { kind: 'achieved', pts: 500, prog: 20 });
  // maxCounts に未知IDだけ → 表示行なし → achieved
  assert.equal(p.buildViewModel({ feasible: true, current: 0, initialProgress: 0, counts: { zzz: 1 }, maxCounts: { zzz: 1 } }).kind, 'achieved');
});

test('buildViewModel: プレイ順序は −ボタンで消化した後の進捗から組む', () => {
  const p = loadPst();
  p.calc(13000, 0, 0);
  const thirds = p.PROGRESS_SONGS.filter(id => (p.appState.maxCounts[id] || 0) > 0);
  assert.ok(thirds.length > 0, '前提: 解に3rdが含まれる');
  // 3rd を1本ずつ消化して進捗100へ届かせる（消化し切っても届かない変異で止まらないよう本数で打ち切る）
  for (const id of thirds) {
    while (p.sumState().prog < PROGRESS_CAP && p.appState.counts[id] > 0) p.adj(id, -1);
  }
  assert.ok(p.sumState().prog >= PROGRESS_CAP, '前提: 3rd の消化で進捗100に届く');
  // 前提: 初期進捗から組むと先頭は EL にならない（旧実装なら通ってしまう値であること）
  assert.notEqual(buildSequence(p.appState.counts, p.appState.initialProgress).seq[0].id, 'el');
  const vm = p.buildViewModel(p.appState);
  assert.equal(vm.ok, true);
  assert.equal(vm.seq[0].id, 'el');
});

test('buildViewModel: 合計・進捗は引数 state から求める（appState を読まない）', () => {
  const p = loadPst();
  Object.assign(p.appState, { current: 0, initialProgress: 0, counts: {}, maxCounts: {} });
  const vm = p.buildViewModel({ feasible: true, current: 100, initialProgress: 30, counts: { mm1: 0 }, maxCounts: { mm1: 1 } });
  assert.deepEqual({ kind: vm.kind, pts: vm.pts, prog: vm.prog }, { kind: 'rows', pts: 300, prog: 30 });
  // 達成表示の分岐も state から求める
  const done = p.buildViewModel({ feasible: true, current: 700, initialProgress: 40, counts: {}, maxCounts: {} });
  assert.deepEqual(done, { kind: 'achieved', pts: 700, prog: 40 });
});

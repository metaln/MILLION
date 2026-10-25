'use strict';
// 検算用: solve とは別の手順（回数の組を先にすべて作り、合計ポイントで引く）で、pt が [lo, hi] の候補を数え直す。
// moves は形式の定数をテスト側で書き写した値。HTML の定数を読まない（読むと定数の誤りを検算で拾えない）

const assert = require('node:assert/strict');

// moves: { charge: [pt, トリガー], release: [pt, トリガー], bonus: pt, counts: [ボーナス回数] }
function forward(lo, hi, moves) {
  const [cp, ct] = moves.charge, [rp, rt] = moves.release;
  const byPt = new Map();
  let low = 0, high = 0;
  for (const c of moves.counts)
    for (let b = 0; rp * b + moves.bonus * c <= hi; b++) {
      const base = rp * b + moves.bonus * c;
      for (let a = Math.max(0, Math.ceil((lo - base) / cp)); cp * a + base <= hi; a++) {
        const trigger = ct * a + rt * b;
        if (trigger < -10000) { low++; continue; }
        if (trigger > 999999) { high++; continue; }
        const pt = cp * a + base;
        if (!byPt.has(pt)) byPt.set(pt, []);
        byPt.get(pt).push(`${a},${b},${c},${trigger}`);
      }
    }
  return { byPt, low, high };
}

// [lo, hi] の全 pt で solve(pt) と前向き列挙を突き合わせる。戻り値は突き合わせた候補数と、範囲の外で除いた組の数
function compareRange(solve, lo, hi, moves) {
  const key = x => `${x.charge},${x.release},${x.bonus},${x.trigger}`;
  const { byPt, low, high } = forward(lo, hi, moves);
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

module.exports = { compareRange };

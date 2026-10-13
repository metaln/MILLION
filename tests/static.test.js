'use strict';
// 対象: 起動時の前提検証 / 定数の導出 / HTML の静的な取り決め（CSP・インラインハンドラ禁止・label）
//       / window.__pst / pst-point-table.md（曲データの正本）と SONGS の一致
//
// 観点表で外したもの（理由）:
// - CSP 違反の実発生: ブラウザでしか観測できない。meta の値を完全一致で固定して代替
// - 起動時検証で BY_ID に無い ID が FILL_ORDER にある場合: 定数の書き間違いで、t が undefined となり
//   比較がすべて偽になって素通りする。データ側の一致検査（下の SONGS⇔FILL_ORDER）で捕捉

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPst, HTML } = require('./helpers/load-pst');

const MM3_TRIGGER = 'trigger: 50 },';
const withTrigger = (v, extra = []) => loadPst({ patches: [{ from: MM3_TRIGGER, to: `trigger: ${v} },` }, ...extra] });
const setupError = p => p.el('result-rows').children.map(c => [c.className, c.textContent]);
const MSG = id => `設定エラー: 曲 ${id}: trigger は 0 以上 100 未満の 10 の倍数にしてください`;

test('起動時検証: trigger の境界（0・90 は通過 / 100・-10・15 は設定エラーを表示）', () => {
  for (const ok of [0, 90]) assert.deepEqual(setupError(withTrigger(ok)), [], `trigger=${ok}`);
  for (const ng of [100, -10, 15])
    assert.deepEqual(setupError(withTrigger(ng)), [['placeholder warn', MSG('mm3')]], `trigger=${ng}`);
});

test('起動時検証: 失敗しても計算ボタン・仕様トグル・結果行のリスナーは登録される', () => {
  for (const p of [loadPst(), withTrigger(100)]) {
    assert.deepEqual(['btn-calc', 'spec-toggle', 'result-rows'].map(id => (p.el(id).listeners.click || []).length), [1, 1, 1]);
  }
  // 対照: 正常データでは設定エラーを描かず、初期の案内文が残る
  const p = loadPst();
  assert.deepEqual(setupError(p), []);
  assert.equal(p.el('result-rows').innerHTML.trim(), '<div class="placeholder">「計算する」を押すと結果が表示されます</div>');
});

test('起動時検証: 複数曲が不正なら選好順で最初の曲を報告する', () => {
  const p = withTrigger(15, [{ from: 'trigger: 20 },', to: 'trigger: 100 },' }]);   // mm3=15, 2m3=100
  assert.deepEqual(setupError(p), [['placeholder warn', MSG('mm3')]]);
});

test('定数: EL の進捗減少量は PROGRESS_CAP から導出し、3rd 以外の進捗は0', () => {
  const p = loadPst();
  assert.equal(p.EL.trigger, -p.PROGRESS_CAP);
  assert.deepEqual(p.PROGRESS_SONGS, ['mm3', '6m3', '4m3', '2m3']);
  assert.deepEqual(p.FLAT_SONGS, ['mm2', '6m2', '4m2', '2m2', 'mm1', '6m1', '4m1', '2m1', 'mmw', '6mw', '4mw', '2mw']);
});

test('定数: FILL_ORDER は EL 以外の全曲を重複なく1回ずつ含む', () => {
  const p = loadPst();
  const nonEl = p.SONGS.filter(s => s.id !== 'el').map(s => s.id).sort();
  assert.deepEqual([...p.FILL_ORDER].sort(), nonEl);
  assert.equal(new Set(p.FILL_ORDER).size, p.FILL_ORDER.length);
});

test('曲データ: SONGS が pst-point-table.md の表と一致する', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'pst-point-table.md'), 'utf8');
  const table = md.split(/\r?\n/).filter(l => l.startsWith('|')).slice(2).map(l => {
    const [name, stage, point, trigger] = l.split('|').slice(1, -1).map(c => c.trim());
    return { name, stage: stage === '—' ? null : stage, point: Number(point), trigger: Number(trigger.replace('−', '-')) };
  });
  const p = loadPst();
  const fromCode = p.SONGS.map(({ name, stage, point, trigger }) => ({ name, stage, point, trigger }));
  const key = r => JSON.stringify(r);
  const codeKeys = new Set(fromCode.map(key));
  assert.deepEqual(fromCode.filter(r => !table.some(t => key(t) === key(r))), [], 'コードにあって表に無い曲');
  // 表の「Event Live 0pt」行はツールの計算対象外（EL は 3000pt 側だけ扱う）
  assert.deepEqual(table.filter(t => !codeKeys.has(key(t))), [{ name: 'Event Live', stage: null, point: 0, trigger: -100 }]);
});

test('HTML: CSP meta の値', () => {
  const m = HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  assert.ok(m, 'CSP meta が無い');
  assert.equal(m[1], "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'");
});

test('HTML: インラインイベントハンドラ属性（on*=）が無い', () => {
  const pattern = /<[^>]*\son[a-z]+\s*=/gi;
  assert.deepEqual(HTML.match(pattern), null);
  // 対照: 同じ検出式は属性の位置・大小文字・空白に関係なく拾う
  assert.deepEqual('<button class="x" onClick ="a()"><b onload=x>'.match(pattern), ['<button class="x" onClick =', '<b onload=']);
});

test('HTML: すべての入力欄に対応する label[for] がある', () => {
  const inputIds = [...HTML.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map(m => m[1]);
  const labelFor = [...HTML.matchAll(/<label for="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(inputIds, ['inp-target', 'inp-current', 'inp-progress']);
  assert.deepEqual(labelFor, inputIds);
});

test('window.__pst: 公開するのは calcAlgo / buildSequence / sumState の3関数（内部と同一）', () => {
  const p = loadPst();
  assert.deepEqual(Object.keys(p.window.__pst).sort(), ['buildSequence', 'calcAlgo', 'sumState']);
  for (const k of ['calcAlgo', 'buildSequence', 'sumState']) assert.equal(p.window.__pst[k], p[k]);
});

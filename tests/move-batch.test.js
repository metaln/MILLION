'use strict';
// 対象: move-estimate-tool.html の CSV一括計算（parseCsv / doBatch / buildBatchViewModel / 人ごとの描画 / 1人用との切り替え）
// 候補の計算そのもの（solve）は tests/move.test.js で検算済み。ここでは1人用の表示と同じ候補が出るかを突き合わせる
//
// 観点表で外したもの（理由）:
// - 名前にカンマを含む行: 最初の区切りで名前を切る仕様。正しく読めないことはヒント文に書かず、運用で避ける
// - 名前の長さ・文字種: 表示するだけで計算に使わない。esc を通ることだけ見る
// - 人数の上限を超えた入力の計算時間: 上限超過では solve を呼ばない（結果が null のままなことで確かめる）
// - 結果の見た目（色・折り返し）: 目視確認の範囲

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadMove, parseResult, viewButtons, HTML } = require('./helpers/load-move');

const mv = loadMove();
const { parseCsv } = mv;

// 画像（ランキング画面）から写した10人分のサンプル。1行目は見出し
const REAL = fs.readFileSync(path.join(__dirname, '..', 'move-batch-sample.csv'), 'utf8');

// _batchHtml の出力を、サマリと人ごとの枠に分解。行は別枠ボタンの前（主な候補）と後（別枠）に分ける
function parseBatch(html) {
  const summary = [...html.matchAll(/<div class="srow"><span>([^<]*)<\/span><span class="sval">([^<]*)<\/span><\/div>/g)]
    .map(m => [m[1], m[2]]);
  const rowsOf = s => [...s.matchAll(/<div class="result-row">([\s\S]*?)<\/div>/g)]
    .map(m => [...m[1].matchAll(/<span class="num">([^<]*)<\/span>/g)].map(n => n[1]));
  const people = html.split('<section class="person">').slice(1).map(chunk => {
    const head = chunk.match(/<span class="person-name">([^<]*)<\/span><span class="person-pt"><span class="num">([^<]*)<\/span>pt<\/span>/);
    const note = chunk.match(/<div class="group-empty( warn)?">([^<]*)<\/div>/);
    const toggle = chunk.match(/data-action="rare-person" data-index="(\d+)" aria-expanded="(true|false)">([^<]*)<\/button>/);
    const [likely, rare = ''] = chunk.split('<button');
    return {
      name: head[1], pt: head[2], likely: rowsOf(likely), rare: rowsOf(rare),
      note: note ? `${note[1] ? 'warn:' : ''}${note[2]}` : null,
      toggle: toggle ? [toggle[1], toggle[2], toggle[3]] : null,
    };
  });
  return { summary, people };
}

const batchResult = p => parseBatch(p.el('result').innerHTML);
const csvError = p => [p.el('inp-csv-error').textContent, p.el('inp-csv').getAttribute('aria-invalid')];
const ptError = p => [p.el('inp-pt-error').textContent, p.el('inp-pt').getAttribute('aria-invalid')];
const SUMMARY = (n, bad) => [['計算した人数', `${n}人`], ['読めなかった行', `${bad}行`]];
const TOGGLE = (i, open, n) => [String(i), String(open), `◇ その他の候補（${n}件）を${open ? '隠す' : '表示'}`];
const MSG_EMPTY = '名前と現在ptを1行以上入力してください';
const MSG_NOT_INT = 'ポイントが0以上の整数ではありません';
const MSG_NO_SEP = '区切り（カンマかタブ）がありません';
const MSG_NO_NAME = '名前がありません';
const MSG_OVER = 'ポイントは99,999,999以下にしてください';
const MSG_COLS = '列が多すぎます（区切りは名前とポイントの間の1か所だけにしてください）';
const MSG_GROUP = '桁区切りは3桁ごとにしてください';
const MSG_AMBIG = '名前の末尾の数字がポイントの一部かもしれません。名前とポイントの間にカンマかタブを入れてください';
const people = (...xs) => xs.map(([line, name, pt]) => ({ line, name, pt }));

// 1人用の画面で同じptを計算したときの行（ボーナス回数を先頭に足す）。主な候補と別枠を分けて返す
function singleRows(pt) {
  const q = loadMove();
  q.calc(pt);
  if (q.appState.rareOpen === false) q.clickResult('rare');
  const groups = parseResult(q.el('result').innerHTML).groups;
  const rows = gs => gs.flatMap(g => g.rows.map(r => [g.title.match(/(\d+)回/)[1], ...r]));
  return { likely: rows(groups.slice(0, 2)), rare: rows(groups.slice(2)) };
}

test('parseCsv: 区切りはカンマ・タブ・全角カンマ。ptの桁区切り・末尾pt（大文字含む）・全角・空白を読む', () => {
  const text = [
    'かぶりこ,4,605,373pt', 'まさや\t4560338', 'ゆふぃー，4318802', 'たるつ,３，９００，２０５ｐｔ',
    'きっさ , 3 892 771 PT', 'ゼロ,0', '上限,99,999,999',
  ].join('\n');
  assert.deepEqual(parseCsv(text), {
    people: people([1, 'かぶりこ', 4605373], [2, 'まさや', 4560338], [3, 'ゆふぃー', 4318802], [4, 'たるつ', 3900205],
      [5, 'きっさ', 3892771], [6, 'ゼロ', 0], [7, '上限', 99999999]),
    errors: [],
  });
});

test('parseCsv: 行番号は空行を含めた物理行で数える（CRLF・CR・LF の混在、BOM、前後の空白、空白だけの行）', () => {
  const text = '﻿  a,1190  \r\n\r\n \t \rb,595\n\nc,634\r\n';
  // 1: a / 2: 空 / 3: 空白だけ / 4: b（CR 区切り）/ 5: 空 / 6: c / 7: 末尾の CRLF の後の空行
  assert.deepEqual(parseCsv(text), { people: people([1, 'a', 1190], [4, 'b', 595], [6, 'c', 634]), errors: [] });
  // BOM は行の trim で除かれる（U+FEFF は JS の空白に含まれる）。名前の直前・pt の直後に付いても残らない
  assert.deepEqual(parseCsv('﻿a,1﻿').people, people([1, 'a', 1]));
});

test('parseCsv: 最初の行が数字の無い見出しなら読み飛ばす（空行の後でも最初の行）。2行目以降の同じ形はエラー', () => {
  assert.deepEqual(parseCsv('名前,現在pt\na,595'), { people: people([2, 'a', 595]), errors: [] });
  assert.deepEqual(parseCsv('\n\n名前\tpt\na,595'), { people: people([4, 'a', 595]), errors: [] });
  assert.deepEqual(parseCsv('a,595\n名前,現在pt'), {
    people: people([1, 'a', 595]), errors: [{ line: 2, raw: '名前,現在pt', reason: MSG_NOT_INT }],
  });
  // 数字を含む1行目は見出しとして扱わない
  assert.deepEqual(parseCsv('名前,pt2026\na,595'), {
    people: people([2, 'a', 595]), errors: [{ line: 1, raw: '名前,pt2026', reason: MSG_NOT_INT }],
  });
  // 区切りの無い1行目は見出しにならない（区切りの判定が先）
  assert.deepEqual(parseCsv('名前\na,595').errors, [{ line: 1, raw: '名前', reason: MSG_NO_SEP }]);
});

test('parseCsv: 1行目を見出しとするのは pt 側に「pt」か「ポイント」を含むときだけ。それ以外の数字の無い1行目はエラーにする', () => {
  // 見出し: 大文字・全角も NFKC 後に照合する。名前の欄が空でも見出し語があれば見出し
  for (const head of ['名前,ポイント', '名前,ＰＴ', '名前,PT', ',pt', '名前\t現在のポイント'])
    assert.deepEqual(parseCsv(`${head}\na,595`), { people: people([2, 'a', 595]), errors: [] }, head);
  // 見出し語の無い1行目（データ行の誤記）は黙って消さず、2行目以降と同じ理由でエラーにする
  const cases = [
    ['かぶりこ,', MSG_NOT_INT], ['かぶりこ,abc', MSG_NOT_INT], ['かぶりこ,O', MSG_NOT_INT],
    ['かぶりこ,不明', MSG_NOT_INT], ['名前,現在', MSG_NOT_INT], [',abc', MSG_NO_NAME],
  ];
  for (const [first, reason] of cases)
    assert.deepEqual(parseCsv(`${first}\na,595`), { people: people([2, 'a', 595]), errors: [{ line: 1, raw: first, reason }] }, first);
});

test('parseCsv: 読めない行（区切りなし・名前なし・整数でない・上限超え）は行番号と理由を返し、他の行は読む', () => {
  const bad = ['a,1', 'かぶりこ 4605373', ',595', ' \t595', 'b,', 'c,abc', 'd,-5', 'e,1.5', 'f,1e3', 'g,595pts', 'h,pt',
    'i,100,000,000', 'j,99999999'];
  assert.deepEqual(parseCsv(bad.join('\n')), {
    people: people([1, 'a', 1], [13, 'j', 99999999]),
    errors: [
      { line: 2, raw: 'かぶりこ 4605373', reason: MSG_NO_SEP },
      { line: 3, raw: ',595', reason: MSG_NO_NAME },
      // 前後の空白（タブを含む）を除いた結果、区切りが無くなる
      { line: 4, raw: '595', reason: MSG_NO_SEP },
      { line: 5, raw: 'b,', reason: MSG_NOT_INT },
      { line: 6, raw: 'c,abc', reason: MSG_NOT_INT },
      { line: 7, raw: 'd,-5', reason: MSG_NOT_INT },
      { line: 8, raw: 'e,1.5', reason: MSG_NOT_INT },
      { line: 9, raw: 'f,1e3', reason: MSG_NOT_INT },
      { line: 10, raw: 'g,595pts', reason: MSG_NOT_INT },
      { line: 11, raw: 'h,pt', reason: MSG_NOT_INT },
      { line: 12, raw: 'i,100,000,000', reason: MSG_OVER },
    ],
  });
});

test('parseCsv: pt の桁区切りは3桁ごとのカンマか空白だけ。3列目以降の数字を連結しない', () => {
  const bad = ['a,460537,3', 'a,4,6053,73', 'a,3,892 771', 'a,1000,000', 'a, 1 2', 'a,,595', 'かぶりこ\t4605373\t5', 'a\tb\t5', 'a,1\t2'];
  assert.deepEqual(parseCsv(['z,1', ...bad].join('\n')), {
    people: people([1, 'z', 1]),
    errors: [
      { line: 2, raw: 'a,460537,3', reason: MSG_GROUP },
      { line: 3, raw: 'a,4,6053,73', reason: MSG_GROUP },
      // カンマと空白の混在
      { line: 4, raw: 'a,3,892 771', reason: MSG_GROUP },
      { line: 5, raw: 'a,1000,000', reason: MSG_GROUP },
      { line: 6, raw: 'a, 1 2', reason: MSG_GROUP },
      { line: 7, raw: 'a,,595', reason: MSG_GROUP },
      // タブが pt 側に残る行は列が多い（数字でなくても同じ）
      { line: 8, raw: 'かぶりこ\t4605373\t5', reason: MSG_COLS },
      { line: 9, raw: 'a\tb\t5', reason: MSG_COLS },
      { line: 10, raw: 'a,1\t2', reason: MSG_COLS },
    ],
  });
  // 対照: 区切りなし・3桁ごとのカンマ・3桁ごとの空白・1〜3桁の先頭・末尾の pt の前の空白は読む
  assert.deepEqual(parseCsv('a,4605373\nb,1,000\nc,12 345 678\nd,999\ne,4605373 pt\nf,1,000,000PT').people,
    people([1, 'a', 4605373], [2, 'b', 1000], [3, 'c', 12345678], [4, 'd', 999], [5, 'e', 4605373], [6, 'f', 1000000]));
});

test('parseCsv: カンマ区切りで名前が数字で終わり pt が3桁区切りで始まる行は、名前と pt の境目が読めないためエラー', () => {
  const bad = ['かぶりこ 4,605,373', '4,605,373pt', 'かぶりこ ４，６０５，３７３', '1,595', 'かぶりこ 12,345', 'かぶりこ 4,605 373', 'x 123,456'];
  assert.deepEqual(parseCsv(['z,1', ...bad].join('\n')), {
    people: people([1, 'z', 1]),
    errors: bad.map((raw, i) => ({ line: i + 2, raw, reason: MSG_AMBIG })),
  });
  // 対照: 名前の末尾の数字が空白で離れていない・4桁以上・pt が3桁区切りで始まらない・タブ区切りは、そのまま読む
  assert.deepEqual(parseCsv('p1,595\nかぶりこ 1234,567\nかぶりこ 4,4605373\nかぶりこ 4\t605\nかぶりこ 4,60').people,
    people([1, 'p1', 595], [2, 'かぶりこ 1234', 567], [3, 'かぶりこ 4', 4605373], [4, 'かぶりこ 4', 605], [5, 'かぶりこ 4', 60]));
});

test('parseCsv: 空・空行だけは0件。同じ名前は別の人として両方読む', () => {
  for (const text of ['', '\n\r\n  \n', '﻿']) assert.deepEqual(parseCsv(text), { people: [], errors: [] }, JSON.stringify(text));
  assert.deepEqual(parseCsv('a,595\na,634').people, people([1, 'a', 595], [2, 'a', 634]));
});

test('一括: サンプルCSV（画像の10人分）。人ごとの候補は1人用の画面で同じptを計算した結果と一致する', () => {
  // 前提: サンプルは見出し1行＋10人で、読めない行が無い
  assert.deepEqual([parseCsv(REAL).people.length, parseCsv(REAL).errors], [10, []]);
  const p = loadMove();
  assert.equal(p.batch(REAL), true);   // submit の既定動作（送信）を止める
  const r = batchResult(p);
  assert.deepEqual(r.summary, SUMMARY(10, 0));
  assert.deepEqual(csvError(p), ['', 'false']);
  assert.deepEqual(r.people.map(x => [x.name, x.pt]), [
    ['かぶりこ', '4,605,373'], ['まさや', '4,560,338'], ['ゆふぃー', '4,318,802'], ['たるつ', '3,900,205'],
    ['きっさ', '3,892,771'], ['スターダスト', '3,877,849'], ['幸せの多重奏', '3,811,082'], ['らんぜん', '3,650,182'],
    ['ドウガチ(仮)', '3,435,870'], ['タツノスケ', '3,363,601'],
  ]);
  // 先頭の1人は値を直書きで固定する（ボーナス0回→5回、各回数の中はトリガー数が0に近い順）。
  // 吐き4桁かつトリガー数50万以上の2件（+965,165・+555,375）はその他の候補へ移る
  assert.deepEqual(r.people[0], {
    name: 'かぶりこ', pt: '4,605,373', rare: [], note: null, toggle: TOGGLE(0, false, 10),
    likely: [['0', '1,707', '5,662', '-3,495'], ['0', '2,341', '5,067', '+480,835'], ['5', '1,799', '5,552', '+71,045']],
  });
  p.clickResult('rare-person', 0);
  assert.deepEqual(batchResult(p).people[0].rare.slice(0, 2), [['0', '2,975', '4,472', '+965,165'], ['5', '2,433', '4,957', '+555,375']]);
  p.clickResult('rare-person', 0);
  // 全員を開いてから、1人用の結果と突き合わせる
  r.people.forEach((_, i) => p.clickResult('rare-person', i));
  batchResult(p).people.forEach((x, i) => {
    const pt = Number(x.pt.replace(/,/g, ''));
    assert.deepEqual({ likely: x.likely, rare: x.rare }, singleRows(pt), x.name);
    assert.equal(x.toggle[1], 'true', x.name);
    assert.equal(x.toggle[0], String(i));
  });
});

test('一括: 候補なしは警告、主な候補が無い人だけ別枠を最初から開く、別枠0件ならボタンを出さない', () => {
  const p = loadMove();
  p.batch('なし,1\n別枠だけ,3000\n両方,57120\n主だけ,15000');
  assert.deepEqual(batchResult(p).people, [
    { name: 'なし', pt: '1', likely: [], rare: [], note: 'warn:合う組み合わせがありません', toggle: null },
    { name: '別枠だけ', pt: '3,000', likely: [], rare: [['1', '0', '0', '0']], note: '主な候補はありません', toggle: TOGGLE(1, true, 1) },
    { name: '両方', pt: '57,120', likely: [['0', '96', '0', '+57,120']], rare: [], note: null, toggle: TOGGLE(2, false, 1) },
    { name: '主だけ', pt: '15,000', likely: [['5', '0', '0', '0']], rare: [], note: null, toggle: null },
  ]);
});

test('一括: 別枠のボタンは押した人だけ開閉し、範囲外・数字でない index は何も変えない。再計算で初期状態へ戻る', () => {
  const p = loadMove();
  p.batch('a,57120\nb,57120\nc,3000');
  const toggles = () => batchResult(p).people.map(x => x.toggle[1]);
  assert.deepEqual(toggles(), ['false', 'false', 'true']);
  p.clickResult('rare-person', 1);
  assert.deepEqual(toggles(), ['false', 'true', 'true']);
  assert.deepEqual(batchResult(p).people[1].rare, [['2', '6', '75', '-9,930']]);
  p.clickResult('rare-person', 2);
  assert.deepEqual(toggles(), ['false', 'true', 'false']);
  for (const i of [3, -1, 'abc', '']) {
    p.clickResult('rare-person', i);
    assert.deepEqual(toggles(), ['false', 'true', 'false'], `index=${JSON.stringify(i)}`);
  }
  // 1人用の別枠ボタンの action は一括の状態を変えない
  p.clickResult('rare');
  assert.deepEqual(toggles(), ['false', 'true', 'false']);
  p.batch('a,57120\nb,57120\nc,3000');
  assert.deepEqual(toggles(), ['false', 'false', 'true']);
});

test('一括: 人ごとの別枠ボタンを押したら、描画し直した後に同じ人のボタンへフォーカスを戻す', () => {
  const p = loadMove();
  p.batch(Array.from({ length: 8 }, (_, i) => `p${i},57120`).join('\n'));
  assert.equal(batchResult(p).people.length, 8);
  assert.deepEqual(p.focused, []);
  const at = i => ({ 'data-action': 'rare-person', 'data-index': String(i) });
  p.clickResult('rare-person', 4);
  assert.deepEqual(p.focused, [at(4)]);
  p.clickResult('rare-person', 7);
  assert.deepEqual(p.focused, [at(4), at(7)]);
  // 閉じる側のクリックでも戻す
  p.clickResult('rare-person', 4);
  assert.deepEqual(p.focused, [at(4), at(7), at(4)]);
  // 対照ではない負例: 範囲外・数字でない・負・空の index はフォーカスを動かさない
  for (const i of [99, 8, 'abc', '-1', '', '1e0']) {
    p.clickResult('rare-person', i);
    assert.deepEqual(p.focused, [at(4), at(7), at(4)], `index=${JSON.stringify(i)}`);
  }
  // 対照: 同じ経路で有効な index なら記録される（観測経路が生きている）
  p.clickResult('rare-person', 0);
  assert.deepEqual(p.focused, [at(4), at(7), at(4), at(0)]);
});

test('一括: 0回・5回の切り替えは全員の主な候補・その他の候補に効き、再計算しても保つ。候補なしの警告は切り替えによらない', () => {
  const p = loadMove();
  p.batch('かぶりこ,4605373\n主だけ,15000\nなし,1');
  assert.deepEqual(viewButtons(p.el('result').innerHTML), [['all', 'true', '両方'], ['0', 'false', '0回'], ['5', 'false', '5回']]);
  p.clickView('0');
  p.clickResult('rare-person', 0);
  const r = batchResult(p);
  assert.deepEqual(viewButtons(p.el('result').innerHTML)[1], ['0', 'true', '0回']);
  assert.deepEqual(r.people[0].likely, [['0', '1,707', '5,662', '-3,495'], ['0', '2,341', '5,067', '+480,835']]);
  assert.deepEqual([r.people[0].toggle, r.people[0].rare[0], r.people[0].rare.length],
    [TOGGLE(0, true, 9), ['0', '2,975', '4,472', '+965,165'], 9]);
  // 5回の候補しか無い人は、0回だけを表示すると「主な候補はありません」（警告ではない）
  assert.deepEqual([r.people[1].likely, r.people[1].note, r.people[1].toggle], [[], '主な候補はありません', null]);
  assert.equal(r.people[2].note, 'warn:合う組み合わせがありません');
  // 再計算しても切り替えは保つ
  p.batch('主だけ,15000');
  assert.deepEqual([viewButtons(p.el('result').innerHTML)[1], batchResult(p).people[0].note], [['0', 'true', '0回'], '主な候補はありません']);
  p.clickView('5');
  assert.deepEqual(batchResult(p).people[0].likely, [['5', '0', '0', '0']]);
});

test('一括: 読めない行は入力欄の直下に行番号つきで並べ、読めた行は計算する。21文字以上の行は20文字で切る', () => {
  const p = loadMove();
  const k20 = 'あいうえおかきくけこさしすせそたちつてと';
  assert.equal(k20.length, 20);
  // 3行目は24文字、4行目は21文字（19文字＋「,x」）
  p.batch(`a,595\nかぶりこ 4605373\n${k20},abc\n${k20.slice(0, 19)},x`);
  assert.deepEqual(csvError(p), [[
    `2行目「かぶりこ 4605373」: ${MSG_NO_SEP}`,
    `3行目「${k20}…」: ${MSG_NOT_INT}`,
    `4行目「${k20.slice(0, 19)},…」: ${MSG_NOT_INT}`,
  ].join('\n'), 'true']);
  // 20文字ちょうど（18文字＋「,x」）は切らない
  p.batch(`a,595\n${k20.slice(0, 18)},x`);
  assert.deepEqual(csvError(p), [`2行目「${k20.slice(0, 18)},x」: ${MSG_NOT_INT}`, 'true']);
  p.batch('a,595\nb,abc');
  assert.deepEqual(batchResult(p).summary, SUMMARY(1, 1));
  assert.deepEqual(batchResult(p).people.map(x => x.name), ['a']);
});

test('一括: 行を切る20文字はコードポイントで数える（絵文字のサロゲートペアを途中で切らない）', () => {
  const p = loadMove();
  const k19 = 'あ'.repeat(19);
  // 区切りの無い行（行全体がそのまま表示される）。前提: 絵文字は UTF-16 で2単位
  assert.equal('😀'.length, 2);
  const shown = raw => { p.batch(`a,595\n${raw}`); return csvError(p)[0]; };
  // 20文字（UTF-16 では21単位）は切らない。21文字は20文字目の絵文字まで残して切る
  assert.equal(shown(`${k19}😀`), `2行目「${k19}😀」: ${MSG_NO_SEP}`);
  assert.equal(shown(`${k19}😀😀`), `2行目「${k19}😀…」: ${MSG_NO_SEP}`);
  // 対照: 絵文字の無い20文字・21文字
  assert.equal(shown(`${k19}い`), `2行目「${k19}い」: ${MSG_NO_SEP}`);
  assert.equal(shown(`${k19}いう`), `2行目「${k19}い…」: ${MSG_NO_SEP}`);
  // 切った後に片割れのサロゲート（U+D800〜U+DFFF の単独）が残らない
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(shown(`${'あ'.repeat(18)}😀😀😀`)), false);
});

test('一括: 全行が読めないときは結果欄を空にする（前の結果を残さない）', () => {
  const p = loadMove();
  p.batch('a,595');
  assert.deepEqual(batchResult(p).summary, SUMMARY(1, 0));
  p.batch('a\nb,abc');
  assert.deepEqual([p.el('result').innerHTML, csvError(p)],
    ['', [`1行目「a」: ${MSG_NO_SEP}\n2行目「b,abc」: ${MSG_NOT_INT}`, 'true']]);
});

test('一括: 空・空行だけ・見出しだけは「1行以上入力」を出し、結果欄を空にする', () => {
  for (const text of ['', ' \n\r\n\t', '名前,現在pt']) {
    const p = loadMove();
    p.batch('a,595');
    p.batch(text);
    assert.deepEqual([p.el('result').innerHTML, csvError(p), p.appState.batch], ['', [MSG_EMPTY, 'true'], null], JSON.stringify(text));
  }
});

test('一括: 人数は上限50人まで。51人は誰も計算しない。読めない行は人数に数えない', () => {
  const lines = n => Array.from({ length: n }, (_, i) => `p${i},595`);
  const p = loadMove();
  assert.equal(p.BATCH_MAX, 50);
  p.batch(lines(50).join('\n'));
  assert.deepEqual([batchResult(p).summary, csvError(p)], [SUMMARY(50, 0), ['', 'false']]);
  p.batch([...lines(50), 'bad'].join('\n'));
  assert.deepEqual(batchResult(p).summary, SUMMARY(50, 1));
  p.batch(lines(51).join('\n'));
  assert.deepEqual([p.el('result').innerHTML, csvError(p), p.appState.batch],
    ['', ['一度に計算できるのは50人までです（51人分あります）', 'true'], null]);
});

test('一括: 行エラーと入力全体のエラーは状態を分ける。読めなかった行は行エラーだけを数え、エラー欄は全体→行の順に並べる', () => {
  const p = loadMove();
  p.batch('a,595\nb,abc');
  assert.deepEqual([p.appState.batchRowErrors, p.appState.batchError], [[{ line: 2, raw: 'b,abc', reason: MSG_NOT_INT }], '']);
  p.batch('');
  assert.deepEqual([p.appState.batchRowErrors, p.appState.batchError], [[], MSG_EMPTY]);
  // 人がいて全体のエラーもある状態（今の操作経路では起きない）でも、全体のエラーは読めなかった行に数えない
  const state = {
    mode: 'batch', bonusView: 'all', batch: [{ line: 1, name: 'a', pt: 595, list: p.solve(595), rareOpen: false }],
    batchRowErrors: [{ line: 2, raw: 'b,abc', reason: MSG_NOT_INT }], batchError: '全体の警告',
  };
  const vm = p.buildBatchViewModel(state);
  assert.deepEqual([vm.errors, vm.message], [[`2行目「b,abc」: ${MSG_NOT_INT}`], '全体の警告']);
  assert.deepEqual(parseBatch(p._resultHtml(vm)).summary, SUMMARY(1, 1));
  p._renderFieldError(vm);
  assert.deepEqual(csvError(p), [`全体の警告\n2行目「b,abc」: ${MSG_NOT_INT}`, 'true']);
});

test('読み上げ: 一括で計算したときだけ人数と読めなかった行数を要約へ書く。誰も計算できなければ空', () => {
  const p = loadMove();
  const status = () => p.el('result-status').textContent;
  p.batch('a,595\nb,abc\nc,57120');
  assert.equal(status(), '2人を計算しました。読めなかった行 1行');
  // 開閉・表示の切り替えでは書き換えない（対照: 計算し直せば書き換える）
  p.el('result-status').textContent = 'sentinel';
  p.clickResult('rare-person', 1);
  p.clickView('5');
  assert.equal(status(), 'sentinel');
  p.clickView('all');
  p.batch('a,595');
  assert.equal(status(), '1人を計算しました。読めなかった行 0行');
  for (const text of ['', 'a\nb,abc']) {
    p.batch('a,595');
    p.batch(text);
    assert.equal(status(), '', JSON.stringify(text));
  }
  // 1人用へ切り替えると1人用の要約になる
  p.calc(595);
  assert.equal(status(), '主な候補1件、その他の候補0件を計算しました');
});

test('一括: 名前の HTML 特殊文字はエスケープして表示する', () => {
  const p = loadMove();
  p.batch(`<img src=x onerror=alert(1)>,595\n"a'&b,634`);
  assert.deepEqual(batchResult(p).people.map(x => x.name), ['&lt;img src=x onerror=alert(1)&gt;', '&quot;a&#39;&amp;b']);
  assert.equal(p.el('result').innerHTML.includes('<img'), false);
});

test('切り替え: 計算した側の入力欄にだけエラーを出し、もう一方のエラーは消す', () => {
  const p = loadMove();
  // 1行目に数字が無いと見出しとして読み飛ばすため、読めない行は2行目に置く
  p.batch('b,595\na,abc');
  assert.deepEqual([csvError(p), ptError(p)], [[`2行目「a,abc」: ${MSG_NOT_INT}`, 'true'], ['', 'false']]);
  p.calc(100000000);
  assert.deepEqual([csvError(p), ptError(p)], [['', 'false'], ['ポイントは99,999,999以下にしてください', 'true']]);
  p.batch('b,595');
  assert.deepEqual([csvError(p), ptError(p)], [['', 'false'], ['', 'false']]);
  assert.deepEqual(batchResult(p).people.map(x => x.name), ['b']);
  // 1人用へ戻すと1人用の結果を出す（一括の枠は残さない）
  p.calc(595);
  const html = p.el('result').innerHTML;
  assert.deepEqual([html.includes('<section class="person">'), parseResult(html).summary[0]], [false, ['指定のポイント', '595']]);
});

test('フォーム: textarea と submit ボタンを一括用の form に入れ、ヒント文は上限の定数から組む', () => {
  const p = loadMove();
  const inner = p.el('batch-form').innerHTML;
  assert.equal(inner.includes('<textarea id="inp-csv"'), true);
  assert.equal(inner.includes('<button type="submit" class="btn-calc" id="btn-batch">まとめて計算する</button>'), true);
  assert.deepEqual([p.el('inp-csv').listeners, p.el('btn-batch').listeners], [{}, {}]);
  assert.equal(p.el('inp-csv-hint').textContent, p.CSV_HINT);
  assert.equal(p.CSV_HINT.includes(`一度に${p.BATCH_MAX}人まで計算できます。`), true);
  assert.equal(p.CSV_HINT.includes('1行目が見出し（数字が無く「pt」か「ポイント」を含む）なら読み飛ばします。'), true);
  // ヒントとエラーを読み上げの説明として textarea に結び付ける
  assert.equal(p.el('inp-csv').getAttribute('aria-describedby'), 'inp-csv-hint inp-csv-error');
  // 読めない行の一覧は改行で並べるため、エラー欄は改行を表示に反映する
  assert.equal(HTML.includes('#inp-csv-error { white-space: pre-line; }'), true);
});

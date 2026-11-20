import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractMentions, splitMarkets } from '../src/extract.js';

const first = '雨杉做滴灌配件，套管代工不打这个标志。也考虑英文 Yu Shan。';
const second = '本公司简称雨山，现用标是青锋。参考同行的 YUSHAN，但不申请它。';
const third = 'The mark is Rain Cedar for landscape design. Cedar tubing is only a material term.';
const mixed = '雨杉做园艺滴灌配件，也供不带雨杉商标的塑料套管。';

function pick(mentions, text) {
  return mentions.find(mention => mention.text === text);
}

test('经营动词前的品牌写法与商品类目分开', () => {
  const { mentions } = extractMentions(first);
  assert.equal(pick(mentions, '雨杉').role, 'actual');
  assert.equal(pick(mentions, '滴灌配件').role, 'goods');
});

test('不承载标志的供货商品单独标为 outside-use', () => {
  const { mentions } = extractMentions(first);
  const tubing = pick(mentions, '套管');
  assert.equal(tubing.role, 'outside-use');
  assert.equal(tubing.beforeCue, true);
});

test('别名、现用标与比较用标志的角色互不混淆', () => {
  const { mentions } = extractMentions(second);
  assert.equal(pick(mentions, '雨山').role, 'alias');
  assert.equal(pick(mentions, '青锋').role, 'actual');
  const comparative = pick(mentions, 'YUSHAN');
  assert.equal(comparative.role, 'comparative');
  assert.equal(comparative.alsoExcluded, true);
});

test('英文来函区分标志与材料说明', () => {
  const { mentions } = extractMentions(third);
  assert.equal(pick(mentions, 'Rain Cedar').role, 'actual');
  assert.equal(pick(mentions, 'landscape design').role, 'goods');
  assert.equal(pick(mentions, 'Cedar tubing').role, 'descriptive');
});

test('提及保留原文位置，便于回查', () => {
  const { mentions } = extractMentions(first);
  const name = pick(mentions, '雨杉');
  assert.deepEqual(name.range, [0, 2]);
  assert.equal(first.slice(...name.range), '雨杉');
  const alias = pick(mentions, 'Yu Shan');
  assert.equal(first.slice(...alias.range), 'Yu Shan');
});

test('否定标志的供货说明不把标志本身当成商品', () => {
  const { mentions } = extractMentions(mixed);
  const marks = mentions.filter(mention => mention.text === '雨杉');
  assert.deepEqual(marks.map(mention => mention.role), ['actual', 'excluded']);
  const tubing = pick(mentions, '塑料套管');
  assert.equal(tubing.role, 'goods');
  assert.equal(tubing.absentMark, '雨杉');
  assert.equal(mentions.some(mention => mention.text === '雨杉商标'), false);
});

test('市场字段可按顿号、逗号和斜杠拆分', () => {
  assert.deepEqual(splitMarkets('海港区、松岛'), ['海港区', '松岛']);
  assert.deepEqual(splitMarkets('海港区, 松岛/北岸'), ['海港区', '松岛', '北岸']);
});

test('名称片段不会把整句当成一个名称', () => {
  const { mentions } = extractMentions(first);
  assert.ok(mentions.every(mention => !mention.text.includes('做滴灌配件')));
});

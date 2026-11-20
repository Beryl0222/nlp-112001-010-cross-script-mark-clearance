import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareNames } from '../src/compareNames.js';
import { foldLatin, translatedMeaning } from '../src/names.js';
import { romanizeHan } from '../src/readings.js';

test('汉字与跨文字音译写法相互命中', () => {
  for (const latin of ['Yu Shan', 'YUSHAN', 'Yushan', 'Yu-Shan']) {
    const result = compareNames('雨杉', latin);
    assert.equal(result.kind, 'transliteration', latin);
    assert.ok(result.score >= 0.9);
    assert.match(result.evidence.join('\n'), /读音 yushan/u);
  }
});

test('同音不同字单独标出，不当作同形', () => {
  const result = compareNames('雨杉', '雨山');
  assert.equal(result.kind, 'homophone');
  assert.match(result.evidence.join('\n'), /杉／山/u);
});

test('中文近形只按已收录的近形组判定', () => {
  assert.equal(compareNames('杉', '松').kind, 'near-form');
  assert.equal(compareNames('雨杉', '松杉').kind, 'none');
  assert.equal(compareNames('青锋', '青峰').kind, 'near-form');
});

test('拉丁折叠忽略大小写、空格与连字符', () => {
  assert.equal(foldLatin('Rain Cedar'), 'raincedar');
  assert.equal(foldLatin('RainCedar'), 'raincedar');
  assert.equal(compareNames('Rain Cedar', 'RainCedar').kind, 'exact');
});

test('意译命中要求整词义项完整，未收字不会被猜读', () => {
  assert.equal(compareNames('杉软管', 'Cedar tubing').kind, 'translation');
  assert.equal(translatedMeaning('杉软管').complete, true);
  assert.equal(translatedMeaning('杉某管').complete, false);
});

test('短拉丁词的相似阈值更严格，避免无关品牌误配', () => {
  assert.equal(compareNames('Kum', 'Kim').kind, 'none');
  // 两个拉丁写法之间只可能给出拼写变体，不会冒充音译证据。
  assert.equal(compareNames('Yushan', 'Yushann').kind, 'variant');
  assert.equal(compareNames('雨杉', 'Yushann').kind, 'transliteration');
});

test('未收读音的汉字不会产生音译证据', () => {
  const reading = romanizeHan('雨杉鑫');
  assert.deepEqual(reading.unknown, []);
  const unknown = romanizeHan('雨杉龘');
  assert.deepEqual(unknown.unknown, ['龘']);
  assert.equal(compareNames('龘', 'Da').kind, 'none');
});

test('不相干写法返回 none，不凑分数', () => {
  assert.equal(compareNames('青锋', 'Rain Cedar').kind, 'none');
  assert.equal(compareNames('雨杉', '青锋').kind, 'none');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  latinKey, pinyinKeys, compareSurfaces, nearFormEvidence,
} from '../index.js';

test('拉丁写法归一：大小写、空格、连字符不影响键', () => {
  assert.equal(latinKey('Yu-Shan'), 'YUSHAN');
  assert.equal(latinKey('yu shan'), 'YUSHAN');
  assert.equal(latinKey('YUSHAN'), 'YUSHAN');
  assert.equal(latinKey('RainCedar'), 'RAINCEDAR');
  assert.equal(latinKey('Rain Cedar'), 'RAINCEDAR');
});

test('雨杉/雨山 拼音键相同；雨杉 跨文字对应 Yu Shan/YUSHAN', () => {
  assert.ok(pinyinKeys('雨杉').includes('yushan'));
  assert.ok(pinyinKeys('雨山').includes('yushan'));

  const codes1 = compareSurfaces('雨杉', '雨山').map(e => e.code);
  assert.ok(codes1.includes('homophone'));

  const codes2 = compareSurfaces('雨杉', 'YUSHAN').map(e => e.code);
  assert.ok(codes2.includes('transliteration'));

  const codes3 = compareSurfaces('Yu Shan', 'Yu-Shan').map(e => e.code);
  assert.ok(codes3.includes('latin-variant'));
});

test('中文近形：杉/衫 与 己/已/巳 能给出近形证据', () => {
  const ev = nearFormEvidence('雨杉配件', '雨衫配件');
  assert.ok(ev);
  assert.match(ev.detail, /近形|杉／衫/);

  const codes = compareSurfaces('自己', '自已').map(e => e.code);
  assert.ok(codes.includes('near-form'));
});

test('逐字意译：雨杉 ↔ Rain Cedar/RainCedar', () => {
  const a = compareSurfaces('雨杉', 'Rain Cedar');
  assert.ok(a.some(e => e.code === 'calque' && /raincedar/.test(e.detail)));
  const b = compareSurfaces('雨杉', 'RainCedar');
  assert.ok(b.some(e => e.code === 'calque'));
});

test('弱证据不冒充强证据；无关名称无命中', () => {
  const weak = compareSurfaces('雨杉', '杉软管');
  assert.ok(weak.every(e => e.strength === 'weak'));
  assert.ok(weak.some(e => e.code === 'shared-han'));

  assert.deepEqual(compareSurfaces('青锋', 'Rain Cedar'), []);
  assert.deepEqual(compareSurfaces('青锋', '雨山'), []);
});

test('完全相同只给原样证据，不叠加自指拼音/意译噪声', () => {
  const ev = compareSurfaces('雨山', '雨山');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].code, 'exact');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCategories, relateCategories } from '../src/catalog.js';
import {
  buildReview,
  buildReviewFromDirectory,
  consolidateByClient,
  mergeBranches,
  dispatchByMarket
} from '../src/review.js';

const materials = {
  letters: [
    {
      id: 'q1', client: '河岸园艺', market: '海港区、松岛', language: 'zh',
      text: '雨杉做滴灌配件，套管代工不打这个标志。也考虑英文 Yu Shan。'
    },
    {
      id: 'q2', client: '雨山零件', market: '海港区', language: 'zh',
      text: '本公司简称雨山，现用标是青锋。参考同行的 YUSHAN，但不申请它。'
    },
    {
      id: 'q3', client: '雨海设计', market: '松岛', language: 'en',
      text: 'The mark is Rain Cedar for landscape design. Cedar tubing is only a material term.'
    }
  ],
  trademarks: [
    { id: 't1', label: '雨山', variant: 'YUSHAN', market: '海港区', category: 'H-12', nature: '注册字样' },
    { id: 't2', label: 'Yu-Shan', variant: 'Yushan', market: '松岛', category: 'S-71', nature: '注册字样' },
    { id: 't3', label: '杉软管', variant: 'Cedar tubing', market: '松岛', category: 'S-72', nature: '品类说明' },
    { id: 't4', label: 'Rain Cedar', variant: 'RainCedar', market: '松岛', category: 'S-53', nature: '注册字样' }
  ],
  categories: [
    { id: 'H-12', market: '海港区', revision: '1', parent: '园艺器具', text: '滴灌接头及阀' },
    { id: 'S-71', market: '松岛', revision: '1', parent: '工业配件', text: '仅供工业流体传输' },
    { id: 'S-71', market: '松岛', revision: '2', parent: '工业配件', text: '包括商业园艺滴灌接头' },
    { id: 'S-72', market: '松岛', revision: '1', parent: '工业配件', text: '杉木纹套管' },
    { id: 'S-53', market: '松岛', revision: '1', parent: '设计服务', text: '景观规划' }
  ]
};

async function review() {
  return buildReview(materials);
}

function candidate(result, letterId, market, name) {
  return result.reviews
    .find(item => item.id === letterId).candidates
    .find(item => item.market === market && item.name === name);
}

test('资料目录可直接生成核查范围', async () => {
  const result = await buildReviewFromDirectory();
  assert.deepEqual(result.reviews.map(item => item.id), ['q1', 'q2', 'q3']);
  assert.ok(result.reviews.every(item => item.candidates.length > 0));
});

test('候选按市场拆分，同一写法在两地各自成条', async () => {
  const result = await review();
  const harbour = candidate(result, 'q1', '海港区', '雨杉');
  const island = candidate(result, 'q1', '松岛', '雨杉');
  assert.ok(harbour && island);
  assert.deepEqual(harbour.hits.map(hit => hit.trademarkId), ['t1']);
  assert.deepEqual(island.hits.map(hit => hit.trademarkId).sort(), ['t2', 't4']);
});

test('比较用标志保留证据但不纳入申请范围', async () => {
  const result = await review();
  const comparative = candidate(result, 'q2', '海港区', 'YUSHAN');
  assert.equal(comparative.nameRole, 'comparative');
  assert.equal(comparative.included, false);
  assert.equal(comparative.hits[0].trademarkId, 't1');
  assert.match(comparative.reasons.join('\n'), /不申请该写法/u);
});

test('不承载标志的供货商品不会成为候选写法', async () => {
  const result = await review();
  const goodsNames = result.reviews
    .flatMap(item => item.candidates)
    .map(item => item.name);
  assert.ok(!goodsNames.includes('套管'));
  assert.ok(goodsNames.includes('滴灌配件') === false);
});

test('类目补充释义后，旧判为不相关的候选列入重看', async () => {
  const result = await review();
  const rechecks = result.revisionRechecks.filter(item => item.categoryId === 'S-71');
  assert.ok(rechecks.length >= 1);
  assert.equal(rechecks[0].previousText, '仅供工业流体传输');
  assert.equal(rechecks[0].currentText, '包括商业园艺滴灌接头');
  assert.match(rechecks[0].evidence.join('\n'), /滴灌/u);
});

test('同一客户多封来函合并为一次咨询但候选不合并', async () => {
  const result = await review();
  const merged = consolidateByClient([
    ...result.reviews,
    {
      ...result.reviews[0],
      id: 'q1b',
      candidates: result.reviews[0].candidates.map(item => ({ ...item, id: `${item.id}:b` }))
    }
  ]);
  const client = merged.find(item => item.client === '河岸园艺');
  assert.deepEqual(client.letters, ['q1', 'q1b']);
  assert.equal(client.sharedConsultation, true);
  assert.equal(new Set(client.candidates.map(item => item.id)).size, client.candidates.length);
});

test('分派后合并仍保留每个候选的标志与证据', async () => {
  const result = await review();
  const branches = result.reviews
    .flatMap(item => dispatchByMarket(item))
    .map(branch => ({ ...branch, conclusion: '待当地核查' }));
  const merged = mergeBranches(branches);
  assert.equal(merged.candidates.length, branches.flatMap(item => item.candidates).length);
  for (const item of merged.candidates) {
    assert.ok(item.name);
    assert.ok(Array.isArray(item.hits));
    assert.ok(item.hits.every(hit => hit.evidence.length > 0));
  }
  const sameName = merged.candidates.filter(item => item.market === '松岛' && item.name === '雨杉');
  assert.equal(sameName.length, 1);
});

test('不同市场的同一类目编号不视为同一审核范围', () => {
  const catalog = resolveCategories(materials.categories);
  const harbour = catalog.latest('海港区', 'H-12');
  const island = catalog.latest('松岛', 'S-71');
  assert.equal(relateCategories(harbour, island).relation, 'other-market');
  const sibling = relateCategories(
    catalog.latest('松岛', 'S-71'),
    catalog.latest('松岛', 'S-72'));
  assert.equal(sibling.relation, 'sibling');
  assert.match(sibling.evidence.join('\n'), /上下位关系/u);
});

test('品类说明档案不会被当成注册字样', async () => {
  const result = await review();
  const errors = result.branchErrors;
  assert.ok(errors.some(item => item.trademarkId === 't3'));
  const hit = candidate(result, 'q3', '松岛', 'Rain Cedar').hits;
  assert.ok(hit.every(item => item.trademarkId !== 't3'));
});

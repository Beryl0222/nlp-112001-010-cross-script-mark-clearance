import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { analyzeTables } from '../lib/analyze.js';
import { Taxonomy } from '../lib/taxonomy.js';

let analysis;
let taxonomy;
test.before(async () => {
  const tables = await readMaterials();
  analysis = analyzeTables(tables);
  taxonomy = Taxonomy.fromTables(tables);
});

function findings(qId) {
  return analysis.queries.find(q => q.id === qId).findings;
}
function find(qId, text, tmId) {
  const f = findings(qId).find(x => x.mention.text === text && x.trademark.id === tmId);
  assert.ok(f, `缺少候选 ${qId} ${text} × ${tmId}`);
  return f;
}

test('候选总数稳定：每个“写法 × 档案 × 市场/类目”独立成条', () => {
  assert.equal(findings('q1').length, 6);
  assert.equal(findings('q2').length, 5);
  assert.equal(findings('q3').length, 5);
  const keys = analysis.findings.map(f => f.key);
  assert.equal(new Set(keys).size, keys.length, 'key 必须唯一');
});

test('q1 雨杉/Yu Shan 在海港区 H-12 高优先，且两个写法候选独立', () => {
  const a = find('q1', '雨杉', 't1');
  const b = find('q1', 'Yu Shan', 't1');
  assert.equal(a.key === b.key, false);
  assert.equal(a.inScope, true);
  assert.equal(a.status, '需核查');
  assert.equal(a.priority, 'P1');
  assert.ok(a.evidences.some(e => e.code === 'homophone'));
  assert.ok(a.evidences.some(e => e.code === 'transliteration'));
  assert.match(a.categoryAssessment.reason, /滴灌接头及阀/);

  assert.equal(b.status, '需核查');
  assert.ok(b.evidences.some(e => e.code === 'latin-variant'));
});

test('q1 松岛 S-71 按当前 rev2 与滴灌相关；rev1 旧文本不相关', () => {
  const f = find('q1', '雨杉', 't2');
  assert.equal(f.inScope, true);
  assert.equal(f.trademark.categoryRevision, '2');
  assert.equal(f.categoryAssessment.related, true);
  assert.match(f.categoryAssessment.reason, /商业园艺滴灌接头/);

  const old = taxonomy.assessGoods(
    [{ text: '滴灌配件', conceptId: 'DRIP_FITTINGS' }], 'S-71', '松岛', '1',
  );
  assert.equal(old.related, false);
  assert.match(old.reason, /仅供工业流体传输/);
});

test('q1 × t3 描述词档案：可排除且理由包含档案性质与无牌代工', () => {
  const f = find('q1', '雨杉', 't3');
  assert.equal(f.status, '可排除');
  assert.ok(f.reasonCodes.includes('archive-is-descriptor'));
  assert.ok(f.reasonCodes.includes('no-brand-use-on-goods'));
  assert.equal(f.categoryAssessment.related, true); // 套管 ↔ 杉木纹套管
});

test('q1 雨杉 × t4 意译对应但类目不对应，保留 P2 人工判断', () => {
  const f = find('q1', '雨杉', 't4');
  assert.equal(f.confidence, '中');
  assert.equal(f.status, '需核查');
  assert.ok(f.evidences.some(e => e.code === 'calque'));
  assert.equal(f.categoryAssessment.related, false);
});

test('q2 简称精确命中 t1 走 abbreviation 通道；YUSHAN 仅作比较记录', () => {
  const abbr = find('q2', '雨山', 't1');
  assert.equal(abbr.lane, 'abbreviation');
  assert.equal(abbr.status, '需核查');
  assert.ok(abbr.questions.some(q => /商标性使用/.test(q)));

  const cmp = find('q2', 'YUSHAN', 't1');
  assert.equal(cmp.status, '仅记录');
  assert.equal(cmp.assignable, false);
});

test('q2 松岛档案属于跨市场提示；青锋零命中但保留检索覆盖', () => {
  const out = find('q2', '雨山', 't2');
  assert.equal(out.inScope, false);
  assert.match(out.scopeReason, /不在来函指定市场/);

  const q2 = analysis.queries.find(q => q.id === 'q2');
  const zero = q2.coverage.find(c => c.text === '青锋');
  assert.ok(zero);
  assert.equal(zero.hitCount, 0);
});

test('q3 Rain Cedar × t4 相同标志同类服务；Cedar tubing × t3 按描述词排除', () => {
  const core = find('q3', 'Rain Cedar', 't4');
  assert.equal(core.priority, 'P1');
  assert.ok(core.evidences.some(e => e.code === 'exact'));
  assert.equal(core.categoryAssessment.related, true);
  assert.match(core.categoryAssessment.reason, /景观规划/);

  const desc = find('q3', 'Cedar tubing', 't3');
  assert.equal(desc.status, '可排除');
  assert.ok(desc.reasonCodes.includes('client-stated-material-term'));
  assert.ok(desc.reasonCodes.includes('archive-is-descriptor'));
});

test('同一词在不同市场落到不同档案/类目，不共用审核范围', () => {
  const h12 = find('q2', '雨山', 't1');
  const s71 = find('q2', '雨山', 't2');
  assert.equal(h12.trademark.market, '海港区');
  assert.equal(h12.trademark.category, 'H-12');
  assert.equal(s71.trademark.market, '松岛');
  assert.equal(s71.trademark.category, 'S-71');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { analyzeTables } from '../lib/analyze.js';
import { Taxonomy } from '../lib/taxonomy.js';
import { newWorkbook, newAliasLibrary } from '../lib/store.js';
import {
  syncFindings, assignByMarket, mergeLocalChecks, recordDecision,
  revisionImpacts, correctAbbreviation, recheckDescriptor,
  hasIndependentBrandEvidence, newAliasLink, flagAbbreviationImpact,
} from '../lib/workflow.js';

let tables, analysis, taxonomy;
test.before(async () => {
  tables = await readMaterials();
  analysis = analyzeTables(tables);
  taxonomy = Taxonomy.fromTables(tables);
});

function syncedWorkbook() {
  const wb = newWorkbook();
  syncFindings(wb, analysis);
  return wb;
}
function key(qId, text, tmId) {
  const f = analysis.findings.find(x => x.queryId === qId && x.mention.text === text && x.trademark.id === tmId);
  assert.ok(f, `缺 ${qId} ${text} ${tmId}`);
  return f.key;
}

test('合并回函时候选身份、具体标志与语言证据互不抹掉（含跨查询共用 H-12）', () => {
  const wb = syncedWorkbook();
  const kQ1 = key('q1', '雨杉', 't1');
  const kQ1Latin = key('q1', 'Yu Shan', 't1');
  const kQ2 = key('q2', '雨山', 't1');

  const assignment = assignByMarket(wb, { market: '海港区', assignee: '周岚' });
  assert.ok(assignment.findingKeys.includes(kQ1));
  assert.ok(assignment.findingKeys.includes(kQ2));

  const r = mergeLocalChecks(wb, {
    assignmentId: assignment.id,
    colleague: '周岚',
    checks: [
      { finding: kQ1, verdict: '近似风险成立', note: 'q1 雨杉独立结论' },
      { finding: kQ1Latin, verdict: '拉丁变体成立', note: 'q1 Yu Shan 独立结论' },
      { finding: kQ2, verdict: '简称待证', note: 'q2 雨山独立结论' },
    ],
  });
  assert.deepEqual(r.missing, []);
  assert.equal(r.merged.length, 3);

  const f1 = wb.findings[kQ1];
  const f1l = wb.findings[kQ1Latin];
  const f2 = wb.findings[kQ2];
  assert.equal(f1.localChecks[0].note, 'q1 雨杉独立结论');
  assert.equal(f2.localChecks[0].note, 'q2 雨山独立结论');
  assert.equal(f1.mention.text, '雨杉');
  assert.equal(f1l.mention.text, 'Yu Shan');
  assert.equal(f2.mention.text, '雨山');
  assert.ok(f1.evidences.length > 0, '语言证据必须保留');
  assert.ok(f2.evidences.some(e => e.code === 'exact'));
  assert.notEqual(f1.localChecks[0].note, f2.localChecks[0].note);
  assert.equal(f1.flowState, '已合并');

  // 无法定位的条目必须上报，不能静默丢弃
  const bad = mergeLocalChecks(wb, { checks: [{ finding: 'nope|nope', verdict: 'x' }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.missing.length, 1);
});

test('多个查询涉及同一 S-71 分类关系，合并后各自写法与证据仍在', () => {
  const wb = syncedWorkbook();
  const kHan = key('q1', '雨杉', 't2');
  const kLatin = key('q1', 'Yu Shan', 't2');
  assignByMarket(wb, { market: '松岛', assignee: '林岚', findingKeys: [kHan, kLatin] });
  mergeLocalChecks(wb, {
    colleague: '林岚',
    checks: [
      { finding: kHan, verdict: 'rev2 同类', note: '汉字写法' },
      { finding: kLatin, verdict: '变体同类', note: '拉丁写法' },
    ],
  });
  assert.equal(wb.findings[kHan].localChecks[0].note, '汉字写法');
  assert.equal(wb.findings[kLatin].localChecks[0].note, '拉丁写法');
  assert.ok(wb.findings[kHan].evidences.some(e => e.code === 'transliteration'));
  assert.ok(wb.findings[kLatin].evidences.some(e => e.code === 'latin-variant'));
});

test('S-71 出 rev2 后，旧 rev1 的“不相关”决定被识别并重开', () => {
  const wb = syncedWorkbook();
  const k = key('q1', '雨杉', 't2');
  recordDecision(wb, {
    findingKey: k, actor: '旧顾问', status: '不相关', categoryRevision: '1',
    reason: '仅供工业流体传输，与园艺无关',
  });
  assert.equal(wb.findings[k].flowState, '已排除');

  const preview = revisionImpacts(wb, taxonomy);
  assert.equal(preview.length, 1);
  assert.equal(preview[0].findingKey, k);
  assert.equal(preview[0].fromRevision, '1');
  assert.equal(preview[0].toRevision, '2');
  assert.ok(preview[0].matchingAdded.includes('DRIP_FITTINGS'));

  // 预演不应改状态
  assert.equal(wb.findings[k].flowState, '已排除');

  const applied = revisionImpacts(wb, taxonomy, { apply: true });
  assert.equal(applied.length, 1);
  assert.equal(wb.findings[k].flowState, '需重看');
  assert.ok(wb.findings[k].decisionHistory.some(h => h.action === 'revision-reopen'));

  // 重复检查应幂等，不重复提示或写历史
  const second = revisionImpacts(wb, taxonomy, { apply: true });
  assert.equal(second.length, 0);
  assert.equal(wb.findings[k].decisionHistory.filter(h => h.action === 'revision-reopen').length, 1);
});

test('纠正公司简称：查出传播到其他客户别名库的错误关联', () => {
  const lib = newAliasLibrary();
  lib.links.push(
    newAliasLink({ id: 'AL-01', client: '雨山零件', canonical: '雨山', alias: '雨杉', assignmentRefs: ['A-X'] }),
    newAliasLink({ id: 'AL-02', client: '河岸园艺', canonical: '雨杉', alias: '雨山', derivedFrom: ['AL-01'] }),
    newAliasLink({ id: 'AL-03', client: '雨海设计', canonical: 'Rain Cedar', alias: '雨山', derivedFrom: ['AL-02'] }),
    newAliasLink({ id: 'OK-1', client: '河岸园艺', canonical: '雨杉', alias: 'Rain Cedar', relation: '意译线索（独立）' }),
  );
  const wb = syncedWorkbook();
  wb.assignments.push({ id: 'A-X', market: '海港区', findingKeys: [key('q2', '雨山', 't1')], status: '已合并' });

  const report = correctAbbreviation(lib, {
    client: '雨山零件', correctName: '雨山', wrongName: '雨杉',
  }, { apply: true });

  assert.deepEqual(report.affectedLinkIds.sort(), ['AL-01', 'AL-02', 'AL-03']);
  assert.deepEqual(report.otherClients.sort(), ['河岸园艺', '雨海设计']);
  assert.deepEqual(report.propagatedLinkIds.sort(), ['AL-02', 'AL-03']);
  assert.ok(report.assignmentRefs.includes('A-X'));
  assert.equal(lib.links.find(l => l.id === 'AL-01').status, 'corrected');
  assert.equal(lib.links.find(l => l.id === 'OK-1').status, 'active', '无关别名不能被误伤');

  const flagged = flagAbbreviationImpact(wb, report);
  assert.ok(flagged.includes(key('q2', '雨山', 't1')));
  assert.equal(wb.assignments.find(a => a.id === 'A-X').status, '需重核（公司简称纠正）');
});

test('描述词误认多个品牌俗称：重开 t3 分派，但保留有独立证据的候选', () => {
  const wb = syncedWorkbook();
  const lib = newAliasLibrary();
  lib.links.push(
    newAliasLink({ id: 'DL-1', descriptorId: 't3', client: '河岸园艺', canonical: '雨杉', alias: '杉软管' }),
    newAliasLink({ id: 'DL-2', descriptorId: 't3', client: '雨海设计', canonical: 'Rain Cedar', alias: 'Cedar tubing' }),
  );
  wb.assignments.push({
    id: 'A-OLD-1', market: '松岛', descriptorId: 't3',
    findingKeys: [key('q1', '雨杉', 't3')], status: '核查中',
  });

  // t3 自身候选没有独立品牌证据
  assert.deepEqual(hasIndependentBrandEvidence(wb.findings[key('q1', '雨杉', 't3')]), []);
  assert.deepEqual(hasIndependentBrandEvidence(wb.findings[key('q3', 'Cedar tubing', 't3')]), []);
  // t1/t4 候选有
  assert.ok(hasIndependentBrandEvidence(wb.findings[key('q1', '雨杉', 't1')]).length > 0);
  assert.ok(hasIndependentBrandEvidence(wb.findings[key('q3', 'Rain Cedar', 't4')]).includes('exact'));

  const report = recheckDescriptor(wb, { trademarkId: 't3', aliasLibrary: lib }, { apply: true });

  assert.equal(report.reopenedKeys.length, 3);
  assert.ok(report.reopenedKeys.includes(key('q1', '雨杉', 't3')));
  assert.ok(report.affectedAssignmentIds.includes('A-OLD-1'));
  assert.deepEqual(report.brandNames.sort(), ['Rain Cedar', '雨杉']);

  const retainedKeys = report.retained.map(r => r.key);
  assert.ok(retainedKeys.includes(key('q1', '雨杉', 't1')));
  assert.ok(retainedKeys.includes(key('q1', '雨杉', 't2')));
  assert.ok(retainedKeys.includes(key('q3', 'Rain Cedar', 't4')));
  assert.ok(report.retained.length >= 4);

  // 保留候选的证据原样还在，且没有被改成重看
  const kept = wb.findings[key('q1', '雨杉', 't1')];
  assert.ok(kept.evidences.some(e => e.code === 'homophone'));
  assert.ok(kept.decisionHistory.some(h => h.action === 'independent-evidence-retained'));

  // t3 候选与派单被重开；俗称链接撤销
  assert.equal(wb.findings[key('q1', '雨杉', 't3')].flowState, '需重看');
  assert.equal(wb.assignments.find(a => a.id === 'A-OLD-1').status, '需重核（描述词误认）');
  assert.equal(lib.links.find(l => l.id === 'DL-1').status, 'revoked');

  // 重复执行不追加重复的重开/保留历史
  recheckDescriptor(wb, { trademarkId: 't3', aliasLibrary: lib }, { apply: true });
  const t3 = wb.findings[key('q1', '雨杉', 't3')];
  assert.equal(t3.decisionHistory.filter(h => h.action === 'descriptor-reopen').length, 1);
  const kept2 = wb.findings[key('q1', '雨杉', 't1')];
  assert.equal(kept2.decisionHistory.filter(h => h.action === 'independent-evidence-retained').length, 1);
});

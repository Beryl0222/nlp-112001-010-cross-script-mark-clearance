import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aliasLibrariesFrom,
  recheckDescriptiveAliases,
  traceAliasPropagation
} from '../src/audit.js';
import { resolveTrademarks } from '../src/trademarks.js';

const aliases = [
  { client: '河岸园艺', aliases: [{ text: 'Yu Shan', source: 'q1' }] },
  { client: '雨山零件', aliases: [{ text: '雨山', source: 'q2' }, { text: 'YUSHAN' }] }
];

test('纠正公司简称时按字面判断哪些别名仍是旧写法', () => {
  const result = traceAliasPropagation({
    previous: '雨山',
    replacement: '雨杉',
    libraries: aliases
  });
  const byAlias = Object.fromEntries(result.affected.map(item => [item.alias, item.relation]));
  assert.equal(byAlias['雨山'], 'still-old');
  assert.equal(byAlias['Yu Shan'], 'needs-review');
  assert.equal(byAlias['YUSHAN'], 'needs-review');
  assert.equal(result.crossClient, true);
});

test('已有别名与更正写法字面一致时标为已更新', () => {
  const result = traceAliasPropagation({
    previous: '雨山',
    replacement: 'Yu Shan',
    libraries: [{ client: '甲', aliases: [{ text: 'YUSHAN' }] }]
  });
  assert.equal(result.affected[0].relation, 'already-updated');
  assert.equal(result.crossClient, false);
});

test('仅大小写或连字符不同的一对写法无法区分别名指向', () => {
  const result = traceAliasPropagation({
    previous: 'Yu Shan',
    replacement: 'YUSHAN',
    libraries: [{ client: '甲', aliases: [{ text: 'Yushan' }] }]
  });
  assert.equal(result.affected[0].relation, 'same-both');
  assert.match(result.affected[0].action, /人工确认/u);
});

test('别名库可由来函直接导出，便于回查传播范围', async () => {
  const { buildReviewFromDirectory } = await import('../src/review.js');
  const review = await buildReviewFromDirectory();
  const libraries = aliasLibrariesFrom(review.reviews);
  assert.deepEqual(libraries.map(library => library.client), ['河岸园艺', '雨山零件', '雨海设计']);
  assert.deepEqual(libraries[0].aliases, [{ text: 'Yu Shan', source: 'q1' }]);
});

test('品类说明被多个客户当作品牌俗称时分派需要重核', () => {
  const markIndex = resolveTrademarks([
    { id: 't3', label: '杉软管', variant: 'Cedar tubing', market: '松岛', category: 'S-72', nature: '品类说明' }
  ]);
  const findings = recheckDescriptiveAliases({
    markIndex,
    aliasLibraries: [
      { client: '甲', aliases: [{ text: 'Cedar tubing' }] },
      { client: '乙', aliases: [{ text: '杉软管' }] }
    ],
    assignments: [
      { id: 'a1', client: '甲', market: '松岛', name: 'Cedar tubing', trademarkId: 't3', evidence: [] },
      {
        id: 'a2', client: '乙', market: '松岛', name: '杉软管', trademarkId: 't3',
        evidence: [{ trademarkId: 't9', kind: 'exact' }]
      }
    ]
  });
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.trademarkId, 't3');
  assert.deepEqual(finding.misinterpretedBy.map(item => item.client), ['甲', '乙']);
  const dispositions = Object.fromEntries(
    finding.affectedAssignments.map(item => [item.id, item.disposition]));
  assert.match(dispositions.a1, /撤回后重新核查/u);
  assert.match(dispositions.a2, /独立证据仍成立，保留/u);
  assert.equal(finding.affectedAssignments.find(item => item.id === 'a2').keep, true);
});

test('只有单个客户使用的别名不触发描述词误判', () => {
  const markIndex = resolveTrademarks([
    { id: 't3', label: '杉软管', variant: 'Cedar tubing', market: '松岛', category: 'S-72', nature: '品类说明' }
  ]);
  const findings = recheckDescriptiveAliases({
    markIndex,
    aliasLibraries: [{ client: '甲', aliases: [{ text: 'Cedar tubing' }] }]
  });
  assert.deepEqual(findings, []);
});

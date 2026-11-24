// 端到端演练：在指定目录生成工作簿、别名库、当地回函、快照与报告。
// 历史“错误传播/描述词误认/旧修订决定”均为合成演练数据。

import path from 'node:path';
import { readMaterials } from '../materials.js';
import { analyzeTables } from './analyze.js';
import { Taxonomy } from './taxonomy.js';
import {
  newWorkbook, newAliasLibrary, loadJson, saveJsonAtomic,
} from './store.js';
import {
  syncFindings, assignByMarket, mergeLocalChecks, recordDecision,
  revisionImpacts, correctAbbreviation, flagAbbreviationImpact,
  recheckDescriptor, newAliasLink,
} from './workflow.js';
import { clientChecklist, consultantDocket, overviewMarkdown } from './report.js';

function findKey(analysis, predicate) {
  const f = analysis.findings.find(predicate);
  if (!f) throw new Error('演练缺少预期候选：' + predicate.toString());
  return f.key;
}

export async function runDemo(options = {}) {
  const root = options.root ?? process.cwd();
  const workDir = path.join(root, '工作');
  const reportDir = path.join(root, '报告');
  const tables = options.tables ?? await readMaterials(options.materialsDirectory);
  const analysis = analyzeTables(tables);
  const taxonomy = Taxonomy.fromTables(tables);
  const counts = Object.fromEntries(Object.entries(tables).map(([n, rows]) => [n, rows.length]));

  const wb = newWorkbook({ now: '2026-11-20T09:00:00+08:00', materialsCounts: counts });
  syncFindings(wb, analysis, { now: '2026-11-20T09:05:00+08:00' });
  const lib = newAliasLibrary({ now: '2025-09-01T09:00:00+08:00' });

  const keyQ1YuShanT2 = findKey(analysis, f => f.queryId === 'q1' && f.mention.text === '雨杉' && f.trademark.id === 't2');
  const keyQ1YuShanLatinT2 = findKey(analysis, f => f.queryId === 'q1' && f.mention.text === 'Yu Shan' && f.trademark.id === 't2');
  const keyQ1YuShanT1 = findKey(analysis, f => f.queryId === 'q1' && f.mention.text === '雨杉' && f.trademark.id === 't1');
  const keyQ1LatinT1 = findKey(analysis, f => f.queryId === 'q1' && f.mention.text === 'Yu Shan' && f.trademark.id === 't1');
  const keyQ1T4 = findKey(analysis, f => f.queryId === 'q1' && f.mention.text === '雨杉' && f.trademark.id === 't4');
  const keyQ1T3 = findKey(analysis, f => f.queryId === 'q1' && f.mention.text === '雨杉' && f.trademark.id === 't3');
  const keyQ2T1Abbr = findKey(analysis, f => f.queryId === 'q2' && f.mention.text === '雨山' && f.trademark.id === 't1');
  const keyQ3T4 = findKey(analysis, f => f.queryId === 'q3' && f.mention.text === 'Rain Cedar' && f.trademark.id === 't4');
  const keyQ3T3Brand = findKey(analysis, f => f.queryId === 'q3' && f.mention.text === 'Rain Cedar' && f.trademark.id === 't3');

  // —— 合成历史：公司简称“雨山”被音近补成“雨杉”，并传播到另外两个客户的别名库 ——
  lib.links.push(newAliasLink({
    id: 'AL-01', client: '雨山零件', canonical: '雨山', alias: '雨杉',
    relation: '音近异写（早年按读音补录，未经客户确认）',
    origin: '2025 年 intake 备注', status: 'active',
    assignmentRefs: ['A-2024-018'],
  }));
  lib.links.push(newAliasLink({
    id: 'AL-02', client: '河岸园艺', canonical: '雨杉', alias: '雨山',
    relation: '同步自雨山零件别名库的“关联写法”', derivedFrom: ['AL-01'], status: 'active',
  }));
  lib.links.push(newAliasLink({
    id: 'AL-03', client: '雨海设计', canonical: 'Rain Cedar', alias: '雨山',
    relation: '别名同步时误带的“中文对应名”', derivedFrom: ['AL-02'], status: 'active',
  }));

  // 历史派单：错误简称关联曾被用于海港区核对。
  wb.assignments.push({
    id: 'A-2024-018', market: '海港区', assignee: '周岚',
    at: '2025-09-10T10:00:00+08:00',
    findingKeys: [keyQ2T1Abbr, keyQ1YuShanT1, keyQ1LatinT1],
    status: '已合并', note: '早年按“雨山/雨杉音近关联”并单核对',
  });

  // —— 合成历史：t3 描述词“杉软管/Cedar tubing”被当成两个品牌的俗称 ——
  lib.links.push(newAliasLink({
    id: 'DL-01', descriptorId: 't3', client: '河岸园艺',
    canonical: '雨杉', alias: '杉软管', relation: '误认的品牌俗称',
    origin: '旧笔记：杉软管像是“雨杉牌软管”的简称', status: 'active',
    assignmentRefs: ['A-OLD-1'],
  }));
  lib.links.push(newAliasLink({
    id: 'DL-02', descriptorId: 't3', client: '雨海设计',
    canonical: 'Rain Cedar', alias: 'Cedar tubing', relation: '误认的品牌俗称',
    origin: '旧笔记：Cedar tubing 被当成 Rain Cedar 的材料线简称', status: 'active',
    assignmentRefs: ['A-OLD-2'],
  }));
  wb.assignments.push({
    id: 'A-OLD-1', market: '松岛', assignee: '林岚',
    at: '2025-10-08T10:00:00+08:00',
    findingKeys: [keyQ1T3], status: '核查中', descriptorId: 't3',
    basis: '把描述词“杉软管”当作雨杉俗称',
  });
  wb.assignments.push({
    id: 'A-OLD-2', market: '松岛', assignee: '林岚',
    at: '2025-10-09T10:00:00+08:00',
    findingKeys: [keyQ3T3Brand], status: '核查中', descriptorId: 't3',
    basis: '把“Cedar tubing”当作 Rain Cedar 俗称',
  });

  // —— 旧修订下的“不相关”决定：S-71 rev1 仅供工业流体传输 ——
  recordDecision(wb, {
    findingKey: keyQ1YuShanT2, actor: '顾问（旧）',
    status: '不相关', categoryRevision: '1',
    reason: 'S-71 rev1 文本为“仅供工业流体传输”，与园艺滴灌配件无关，当时排除。',
  }, { now: '2025-09-15T16:20:00+08:00' });

  // 1) 类目修订触发重看（先预演再应用）
  const impactPreview = revisionImpacts(wb, taxonomy);
  const impacts = revisionImpacts(wb, taxonomy, { apply: true, now: '2026-11-24T09:10:00+08:00' });

  // 2) 公司简称纠正与跨客户传播
  const abbr = correctAbbreviation(lib, {
    client: '雨山零件', correctName: '雨山', wrongName: '雨杉',
  }, { apply: true, now: '2026-11-24T09:20:00+08:00' });
  const abbrFlaggedKeys = flagAbbreviationImpact(wb, abbr, { now: '2026-11-24T09:21:00+08:00' });

  // 3) 描述词误认重核（独立证据候选保留）
  const descriptor = recheckDescriptor(wb, { trademarkId: 't3', aliasLibrary: lib },
    { apply: true, now: '2026-11-24T09:40:00+08:00' });

  // 4) 新派单：海港区按市场分派全部“待分派”
  const assignH = assignByMarket(wb, {
    market: '海港区', assignee: '周岚', note: '海港区字样与 H-12 类目核对',
  }, { now: '2026-11-24T10:00:00+08:00' });

  // 松岛：显式包含因 rev2 重开的 S-71 候选与意译候选
  const assignS = assignByMarket(wb, {
    market: '松岛', assignee: '林岚',
    findingKeys: [keyQ1YuShanT2, keyQ1YuShanLatinT2, keyQ1T4, keyQ3T4],
    note: '松岛 S-71 修订重看、S-53 相同标志核对',
  }, { now: '2026-11-24T10:05:00+08:00' });

  // 给当地同事的独立派单文件（发出时的候选、语言证据与回复格式）。
  const dispatchFile = async (assignment) => {
    await saveJsonAtomic(path.join(workDir, '派单', `${assignment.id}-${assignment.market}.json`), {
      ...assignment,
      findings: assignment.findingKeys.map(k => wb.findings[k]),
      replyFormat: { colleague: assignment.assignee, checks: [{ finding: '<finding key 或短码>', verdict: '', note: '', evidences: [] }] },
    });
  };
  await dispatchFile(assignH);
  await dispatchFile(assignS);

  // 5) 当地回函（按候选 key 逐条，同一 H-12 / S-71 分类关系下的不同标志均保留）
  const submissionH = {
    assignmentId: assignH.id, colleague: '周岚', receivedAt: '2026-11-25T11:00:00+08:00',
    checks: [
      { finding: keyQ1YuShanT1, verdict: '近似风险成立', note: '雨山/YUSHAN 在 H-12 为有效注册，滴灌接头及阀与滴灌配件对应，建议正式注册查询并评估避让。' },
      { finding: keyQ1LatinT1, verdict: '拉丁写法同一档案', note: 'Yu Shan 与档案 YUSHAN 仅空格差异，证据独立记录在本写法名下。' },
      { finding: keyQ2T1Abbr, verdict: '字样相同，使用性质待证', note: '档案确实存在；客户主张是公司简称，需补充商标性使用证据后再定风险。' },
    ],
  };
  const submissionS = {
    assignmentId: assignS.id, colleague: '林岚', receivedAt: '2026-11-25T15:30:00+08:00',
    checks: [
      { finding: keyQ1YuShanT2, verdict: '修订后构成同类，需核查', note: 'S-71 rev2 已包括商业园艺滴灌接头，旧“不相关”结论不再适用。' },
      { finding: keyQ1YuShanLatinT2, verdict: '拉丁变体成立', note: 'Yu Shan 与 Yu-Shan/Yushan 归一相同；与上一条是同一类目下两个独立写法候选，分别留痕。' },
      { finding: keyQ1T4, verdict: '未发现实际对应使用', note: 'Rain Cedar 在 S-53 景观规划注册；未发现其在滴灌/套管商品上使用，是否意译关联请客户确认。' },
      { finding: keyQ3T4, verdict: '相同标志+同类服务', note: 'Rain Cedar/RainCedar 在 S-53 有效注册，景观规划与 landscape design 对应，高优先级。' },
    ],
  };
  const mergeH = mergeLocalChecks(wb, submissionH);
  const mergeS = mergeLocalChecks(wb, submissionS);

  wb.updatedAt = '2026-11-25T15:31:00+08:00';

  // —— 落盘 ——
  await saveJsonAtomic(path.join(workDir, 'workbook.json'), wb);
  await saveJsonAtomic(path.join(workDir, 'alias-library.json'), lib);
  await saveJsonAtomic(path.join(workDir, 'submissions', '海港区.json'), submissionH);
  await saveJsonAtomic(path.join(workDir, 'submissions', '松岛.json'), submissionS);
  await saveJsonAtomic(path.join(workDir, 'snapshots', 'consult-001.json'), {
    id: 'consult-001', at: '2026-11-24T09:00:00+08:00',
    note: '当次分析快照：资料读取后立即固定，便于还原当次候选、分类与排除理由',
    materialsCounts: counts,
    queries: analysis.queries,
  });
  await saveJsonAtomic(path.join(workDir, 'workflow-report.json'), {
    revisionImpacts: impacts, abbreviation: abbr, abbreviationFlaggedKeys: abbrFlaggedKeys,
    descriptor, mergeH, mergeS, impactPreviewCount: impactPreview.length,
  });

  for (const q of analysis.queries) {
    await saveText(path.join(reportDir, `客户清单-${q.id}.md`), clientChecklist(q, wb));
    await saveText(path.join(reportDir, `顾问底稿-${q.id}.md`), consultantDocket(q, wb));
  }
  await saveText(path.join(reportDir, '总览.md'),
    overviewMarkdown(analysis, wb, { revision: impacts, abbreviation: abbr, descriptor }));

  return { root, workDir, reportDir, analysis, taxonomy, wb, lib, impacts, abbr, descriptor, mergeH, mergeS };
}

async function saveText(file, text) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

// 供 CLI 的 report/build 子命令复用：从默认资料生成（不依赖演练历史）。
export async function buildFreshWorkbook() {
  const tables = await readMaterials();
  const analysis = analyzeTables(tables);
  const wb = newWorkbook({ materialsCounts: Object.fromEntries(Object.entries(tables).map(([n, r]) => [n, r.length])) });
  syncFindings(wb, analysis);
  return { tables, analysis, wb };
}

export async function loadWorkbookOrNew(file) {
  return (await loadJson(file, null)) ?? newWorkbook();
}

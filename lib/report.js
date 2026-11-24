// 报告：客户版“有依据的排查清单与待核问题”，顾问版“当次候选/分类/排除还原”。

import { roleLabel } from './extract.js';

const DISCLAIMER = '说明：本清单仅整理人工核查范围与语言/分类线索，供顾问和当地同事复核，不构成、也不能代替正式商标注册意见或法律判断。';

function locator(source, span) {
  if (!source) return '';
  const where = `${source.file}#${source.id}`;
  return span ? `${where} 字符区间[${span[0]},${span[1]})` : where;
}

function wfOf(wb, key) {
  return wb?.findings?.[key] ?? null;
}

function evidenceLines(f, indent = '    ') {
  // 同一证据可能分别针对 label/variant，保留 against 以说明来源字段。
  const seen = new Set();
  const lines = [];
  for (const e of f.evidences ?? []) {
    const k = `${e.code}|${e.detail}|${e.against}`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(`${indent}- [${e.label}/${e.strength}] ${e.detail}（档案字段值：${e.against}）`);
  }
  return lines;
}

function flowLine(wf) {
  if (!wf) return '';
  const parts = [`流转状态：${wf.flowState}`];
  if (wf.assignee) parts.push(`承办：${wf.assignee}`);
  if (wf.localChecks?.length) {
    const last = wf.localChecks.at(-1);
    parts.push(`当地回复（${last.colleague ?? ''}）：${last.verdict}${last.note ? `——${last.note}` : ''}`);
  }
  return `  - ${parts.join('；')}`;
}

export function clientChecklist(query, wb = null) {
  const L = [];
  L.push(`# 商标排查清单（客户核对版） ${query.id} · ${query.client}`);
  L.push('');
  L.push(`来函编号：${query.id}；语言：${query.language}；指定市场：${query.markets.map(m => m.name).join('、') || '未识别'}`);
  L.push('');
  L.push('## 一、我们从来函中辨认的内容');
  L.push('');
  L.push('| 类别 | 写法/内容 | 原文位置 | 说明 |');
  L.push('| --- | --- | --- | --- |');
  for (const m of query.mentions) {
    L.push(`| ${m.roleLabel} | ${m.text} | ${locator(query.source, m.span)} | ${m.filingIntent === false ? '客户明示不申请/仅作比较' : roleLabel(m.role)} |`);
  }
  for (const g of query.goods) {
    L.push(`| 商品/服务 | ${g.text} | ${locator(query.source, g.span)} | ${g.kind}；${g.brandUse ? '按品牌使用理解' : g.qualifier} |`);
  }
  if (query.clientTradeTerm && query.goods.length === 0) {
    L.push(`| 客户名称中的行业词 | ${query.clientTradeTerm} | 字段 client | 仅为弱线索，需核实经营范围 |`);
  }
  L.push('');

  const inScope = query.findings.filter(f => f.inScope);
  const active = inScope.filter(f => f.status === '需核查');
  const exclusions = inScope.filter(f => f.status === '可排除');
  const records = inScope.filter(f => f.status === '仅记录');
  const crossMarket = query.findings.filter(f => !f.inScope);

  L.push('## 二、建议人工核查的候选（按市场/类目独立确认）');
  L.push('');
  if (active.length === 0) L.push('（无）');
  for (const f of active) {
    const wf = wfOf(wb, f.key);
    L.push(`### ${f.code}｜“${f.mention.text}”（${f.mention.roleLabel}） × 档案 ${f.trademark.id}「${f.trademark.label} / ${f.trademark.variant}」`);
    L.push('');
    L.push(`- 市场/类目：${f.market} · ${f.trademark.category} rev${f.trademark.categoryRevision}「${f.trademark.categoryText}」（${f.trademark.categoryParent}）；档案性质：${f.trademark.nature}`);
    L.push(`- 置信度：${f.confidence ?? '无'}；优先级：${f.priority}；初步处置：${f.status}`);
    L.push(`- 分类核对：${f.categoryAssessment.reason}`);
    L.push('- 语言证据：');
    L.push(...evidenceLines(f));
    if (wf) L.push(flowLine(wf));
    if ((f.questions ?? []).length) {
      L.push('- 待核问题：');
      for (const q of f.questions) L.push(`  - ${q}`);
    }
    L.push('');
  }

  L.push('## 三、有依据的排除/低优先级项（仍可复核）');
  L.push('');
  if (exclusions.length === 0) L.push('（无）');
  for (const f of exclusions) {
    const wf = wfOf(wb, f.key);
    L.push(`- **${f.code} “${f.mention.text}” × ${f.trademark.id}「${f.trademark.label}/${f.trademark.variant}」（${f.market}/${f.trademark.category}）**：${(f.reasons ?? []).join(' ')}`);
    L.push(...evidenceLines(f, '  '));
    if (wf) L.push(`  - 流转状态：${wf.flowState}${wf.localChecks?.length ? `；当地回复：${wf.localChecks.at(-1).verdict}` : ''}`);
  }
  L.push('');

  L.push('## 四、比较标志记录与跨市场提示');
  L.push('');
  for (const f of records) {
    L.push(`- ${f.code} “${f.mention.text}” × ${f.trademark.id}（${f.market}/${f.trademark.category}）：${(f.reasons ?? []).join(' ')}`);
  }
  for (const f of crossMarket) {
    L.push(`- ${f.code} “${f.mention.text}” × ${f.trademark.id}（${f.market}/${f.trademark.category}）：${f.scopeReason}；置信度 ${f.confidence ?? '无'}`);
  }
  if (records.length === 0 && crossMarket.length === 0) L.push('（无）');
  L.push('');

  L.push('## 五、待客户/当地同事确认的问题');
  L.push('');
  const qs = [];
  for (const q of query.questions) {
    const text = typeof q === 'string' ? q : q.text;
    if (!qs.includes(text)) qs.push(text);
  }
  if (qs.length === 0) L.push('（无）');
  qs.forEach((q, i) => L.push(`${i + 1}. ${q}`));
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  L.push('');
  return L.join('\n');
}

export function consultantDocket(query, wb = null) {
  const L = [];
  L.push(`# 顾问复核底稿（可还原当次候选） ${query.id} · ${query.client}`);
  L.push('');
  L.push('## 1. 解析结果（含字符区间，按 UTF-16 下标）');
  L.push('```json');
  L.push(JSON.stringify({
    id: query.id, client: query.client, language: query.language,
    markets: query.markets, mentions: query.mentions, goods: query.goods,
    cues: query.cues, clientTradeTerm: query.clientTradeTerm,
  }, null, 2));
  L.push('```');
  L.push('');
  L.push('## 2. 检索覆盖（含零命中写法）');
  L.push('');
  L.push('| 写法 | 角色 | 命中档案 |');
  L.push('| --- | --- | --- |');
  for (const c of query.coverage) {
    L.push(`| ${c.text} | ${c.role} | ${c.hitCount === 0 ? '零命中（已检索）' : c.trademarkIds.join('、')} |`);
  }
  L.push('');
  L.push('## 3. 全部候选、分类与排除理由（含跨市场）');
  L.push('');
  for (const f of query.findings) {
    const wf = wfOf(wb, f.key);
    L.push(`### ${f.code} · key \`${f.key}\``);
    L.push(`- 候选：${JSON.stringify({ mention: f.mention, trademark: f.trademark, market: f.market, inScope: f.inScope, confidence: f.confidence, priority: f.priority, status: f.status, lane: f.lane }, null, 0)}`);
    L.push(`- 分类：${JSON.stringify(f.categoryAssessment)}`);
    L.push(`- 依据代码：${(f.reasonCodes ?? []).join(', ')}`);
    for (const r of f.reasons ?? []) L.push(`  - 理由：${r}`);
    L.push('- 语言证据：');
    L.push(...evidenceLines(f, '  '));
    if (wf) {
      L.push('- 工作流记录：');
      L.push('```json');
      L.push(JSON.stringify({
        flowState: wf.flowState, assignee: wf.assignee,
        assignments: wf.assignments, localChecks: wf.localChecks,
        decisionHistory: wf.decisionHistory, flags: wf.flags,
      }, null, 2));
      L.push('```');
    }
    L.push('');
  }
  L.push(`> ${DISCLAIMER}`);
  return L.join('\n');
}

export function overviewMarkdown(analysis, wb = null, workflowReports = null) {
  const L = [];
  L.push('# 出海商标核查 · 工作总览');
  L.push('');
  L.push(`来函 ${analysis.queries.length} 件；候选记录 ${analysis.findings.length} 条（每个“写法 × 档案 × 市场/类目”独立）。`);
  L.push('');
  for (const q of analysis.queries) {
    const c = { P1: 0, P2: 0, P3: 0 };
    for (const f of q.findings.filter(x => x.inScope && x.status === '需核查')) c[f.priority] += 1;
    L.push(`- ${q.id} ${q.client}（${q.markets.map(m => m.name).join('、')}）：需核查 P1=${c.P1} P2=${c.P2}；候选共 ${q.findings.length}；待核问题 ${q.questions.length}`);
  }
  if (wb) {
    L.push('');
    L.push('## 派单');
    for (const a of wb.assignments) L.push(`- ${a.id} ${a.market ?? ''} → ${a.assignee}：${a.findingKeys.length} 项，状态 ${a.status}`);
  }
  if (workflowReports?.revision?.length) {
    L.push('');
    L.push('## 类目修订触发的重看');
    for (const i of workflowReports.revision) {
      L.push(`- ${i.code}（${i.queryId} “${i.mention}” × ${i.trademarkId}）：${i.categoryId} rev${i.fromRevision}→rev${i.toRevision}，新增概念 ${i.matchingAdded.join('、') || i.addedConcepts.join('、')}`);
    }
  }
  if (workflowReports?.abbreviation) {
    const r = workflowReports.abbreviation;
    L.push('');
    L.push('## 公司简称纠正与传播追溯');
    L.push(`- 客户 ${r.client} 确认简称“${r.correctName}”，撤销与“${r.wrongName}”的错误关联 ${r.affectedLinkIds.length} 条；传播到的其他客户：${r.otherClients.join('、') || '无'}；关联派单：${r.assignmentRefs.join('、') || '无'}`);
  }
  if (workflowReports?.descriptor) {
    const r = workflowReports.descriptor;
    L.push('');
    L.push('## 描述词误认俗称重核');
    L.push(`- 档案 ${r.descriptorId} 被误认作品牌俗称：涉及品牌 ${r.brandNames.join('、')}；重开候选 ${r.reopenedKeys.length} 条、派单 ${r.affectedAssignmentIds.join('、') || '无'}；撤销俗称关联 ${r.affectedLinkIds.length} 条。`);
    L.push(`- 独立证据成立而保留的候选：${r.retained.map(x => `${x.code}(${x.independentCodes.join('+')})`).join('；') || '无'}`);
  }
  L.push('');
  L.push(`> ${DISCLAIMER}`);
  return L.join('\n');
}

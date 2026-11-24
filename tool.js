#!/usr/bin/env node
// 本地商标核查工具入口（零依赖，Node 22 ESM）。
// 用法见 README.md；所有数据处理均在本机完成。

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { readMaterials } from './materials.js';
import { analyzeTables } from './lib/analyze.js';
import { Taxonomy } from './lib/taxonomy.js';
import { saveJsonAtomic, loadJson } from './lib/store.js';
import {
  syncFindings, assignByMarket, mergeLocalChecks, revisionImpacts,
  correctAbbreviation, recheckDescriptor,
} from './lib/workflow.js';
import { runDemo } from './lib/demo.js';
import { clientChecklist, consultantDocket, overviewMarkdown } from './lib/report.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

async function getAnalysis() {
  const tables = await readMaterials();
  return { tables, result: analyzeTables(tables) };
}

function printAnalysisText(result, qId) {
  const queries = qId ? result.queries.filter(q => q.id === qId) : result.queries;
  for (const q of queries) {
    process.stdout.write(`\n== ${q.id} ${q.client}｜市场：${q.markets.map(m => m.name).join('、') || '未识别'} ==\n`);
    process.stdout.write(`名称：${q.mentions.map(m => `${m.text}〈${m.roleLabel}〉`).join('；') || '无'}\n`);
    process.stdout.write(`商品服务：${q.goods.map(g => `${g.text}(${g.brandUse ? '品牌使用' : '非品牌/材料'})`).join('；') || '未识别'}\n`);
    for (const f of q.findings) {
      const scope = f.inScope ? '' : '[跨市场] ';
      process.stdout.write(`  ${f.code} ${scope}${f.mention.text} × ${f.trademark.id} ${f.trademark.label}/${f.trademark.variant} `
        + `(${f.market}/${f.trademark.category} rev${f.trademark.categoryRevision}) `
        + `${f.confidence ?? '-'}置信 → ${f.status} ${f.priority}\n`);
      for (const e of f.evidences) {
        process.stdout.write(`      · ${e.label}：${e.detail}\n`);
      }
      process.stdout.write(`      分类：${f.categoryAssessment.reason}\n`);
    }
    const zero = q.coverage.filter(c => c.hitCount === 0);
    if (zero.length) process.stdout.write(`  零命中（已检索）：${zero.map(c => c.text).join('、')}\n`);
    if (q.questions.length) {
      process.stdout.write('  待核问题：\n');
      for (const question of q.questions) process.stdout.write(`    ? ${typeof question === 'string' ? question : question.text}\n`);
    }
  }
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const wbPath = path.join(cwd, '工作', 'workbook.json');
  const aliasPath = path.join(cwd, '工作', 'alias-library.json');

  if (command === 'text') {
    // 临时分析任意一句话：node tool.js text "雨杉做滴灌配件……" [--market 海港区] [--json]
    const text = positional.join(' ').trim();
    if (!text) throw new Error('请提供要分析的句子，例如 node tool.js text "雨杉做滴灌配件"');
    const { tables, result } = await getAnalysis();
    const allMarkets = result.taxonomy.knownMarkets(tables['商标档案.json'].map(t => t.market));
    const row = {
      id: 'adhoc', client: '临时来函',
      market: flags.market ?? allMarkets.join('、'),
      language: /[一-鿿]/.test(text) ? 'zh' : 'en',
      text,
    };
    const q = (await import('./lib/analyze.js')).analyzeQuery(row, tables, result.taxonomy);
    if (flags.json) {
      process.stdout.write(JSON.stringify(q, null, 2) + '\n');
    } else {
      printAnalysisText({ queries: [q] });
    }
    return;
  }

  if (!command || command === 'help' || flags.help) {
    process.stdout.write([
      'cross-script-mark-clearance — 跨文字商标候选核查本地工具',
      '',
      '命令：',
      '  text "句子" [--market M] [--json]  临时分析任意一句话（题首例句可直接试）',
      '  parse [qId] [--json]        解析来函中的名称角色/市场/商品与原文区间',
      '  analyze [qId] [--json]      生成候选、语言证据、分类与初步处置',
      '  build                       读取资料并同步 工作/workbook.json',
      '  assign --market M --assignee 姓名   按市场分派“待分派”候选',
      '  merge <回函.json>            合并当地同事逐条回复（保留候选与证据）',
      '  impacts [--apply]           检查类目修订导致的旧排除决定重看',
      '  correct-abbr --client C --name 正确简称 --wrong 错误关联 [--apply]',
      '  recheck-descriptor --tm t3 [--apply]  重核描述词被误认俗称的分派',
      '  report [--out 报告] [--id q1]         输出客户清单与顾问底稿',
      '  demo                        跑完整合成演练并生成 工作/ 与 报告/',
      '',
      '本工具只整理人工核查范围，不代替正式注册意见。',
    ].join('\n') + '\n');
    return;
  }

  if (command === 'demo') {
    const out = await runDemo({ root: flags.root ? path.resolve(flags.root) : cwd });
    process.stdout.write('演练完成。\n');
    process.stdout.write(`- 工作簿：${path.relative(cwd, path.join(out.workDir, 'workbook.json'))}\n`);
    process.stdout.write(`- 别名库：${path.relative(cwd, path.join(out.workDir, 'alias-library.json'))}\n`);
    process.stdout.write(`- 报告目录：${path.relative(cwd, out.reportDir)}\n`);
    process.stdout.write(`- 修订重看 ${out.impacts.length} 项；错误别名关联 ${out.abbr.affectedLinkIds.length} 条，涉及其他客户 ${out.abbr.otherClients.join('、') || '无'}；描述词重开 ${out.descriptor.reopenedKeys.length} 项、保留独立证据候选 ${out.descriptor.retained.length} 项。\n`);
    return;
  }

  const { tables, result } = await getAnalysis();

  if (command === 'parse') {
    const q = positional[0];
    const queries = q ? result.queries.filter(x => x.id === q) : result.queries;
    if (flags.json) {
      process.stdout.write(JSON.stringify(queries.map(x => ({
        id: x.id, client: x.client, markets: x.markets, mentions: x.mentions, goods: x.goods, cues: x.cues, questions: x.questions,
      })), null, 2) + '\n');
    } else {
      for (const x of queries) {
        process.stdout.write(JSON.stringify({ id: x.id, markets: x.markets, mentions: x.mentions, goods: x.goods, cues: x.cues }, null, 2) + '\n');
      }
    }
    return;
  }

  if (command === 'analyze') {
    const q = positional[0];
    if (flags.json) {
      const queries = q ? result.queries.filter(x => x.id === q) : result.queries;
      process.stdout.write(JSON.stringify({ queries, findings: queries.flatMap(x => x.findings) }, null, 2) + '\n');
    } else {
      printAnalysisText(result, q);
    }
    return;
  }

  if (command === 'build') {
    const wb = (await loadJson(wbPath, null)) ?? { schemaVersion: 1, findings: {}, assignments: [], events: [] };
    const counts = Object.fromEntries(Object.entries(tables).map(([n, rows]) => [n, rows.length]));
    const summary = syncFindings(wb, result, { materialsCounts: counts });
    await saveJsonAtomic(wbPath, wb);
    process.stdout.write(`已同步 ${wbPath}：新增 ${summary.added}，更新 ${summary.updated}，候选共 ${summary.total}\n`);
    return;
  }

  if (command === 'assign') {
    const wb = await loadJson(wbPath, null);
    if (!wb) throw new Error('找不到工作簿，请先运行 node tool.js build 或 demo');
    const assignment = assignByMarket(wb, { market: flags.market, assignee: flags.assignee });
    await saveJsonAtomic(wbPath, wb);
    process.stdout.write(`派单 ${assignment.id} → ${assignment.assignee}（${assignment.market}）：${assignment.findingKeys.length} 项\n`);
    return;
  }

  if (command === 'merge') {
    const file = positional[0];
    if (!file) throw new Error('请提供回函 JSON 路径');
    const submission = JSON.parse(await readFile(path.resolve(cwd, file), 'utf8'));
    const wb = await loadJson(wbPath, null);
    if (!wb) throw new Error('找不到工作簿');
    const r = mergeLocalChecks(wb, submission);
    await saveJsonAtomic(wbPath, wb);
    process.stdout.write(`已合并 ${r.merged.length} 条候选回复；无法定位 ${r.missing.length} 条\n`);
    if (r.missing.length) process.exitCode = 2;
    return;
  }

  if (command === 'impacts') {
    const wb = await loadJson(wbPath, null);
    if (!wb) throw new Error('找不到工作簿');
    const taxonomy = Taxonomy.fromTables(tables);
    const impacts = revisionImpacts(wb, taxonomy, { apply: Boolean(flags.apply) });
    if (flags.apply) await saveJsonAtomic(wbPath, wb);
    process.stdout.write((impacts.length ? JSON.stringify(impacts, null, 2) : '没有需要重看的旧排除决定') + '\n');
    return;
  }

  if (command === 'correct-abbr') {
    const lib = await loadJson(aliasPath, { schemaVersion: 1, links: [], corrections: [] });
    const report = correctAbbreviation(lib, {
      client: flags.client, correctName: flags.name, wrongName: flags.wrong,
    }, { apply: Boolean(flags.apply) });
    if (flags.apply) await saveJsonAtomic(aliasPath, lib);
    process.stdout.write(JSON.stringify({
      ...report, links: report.links.map(l => ({ id: l.id, client: l.client, canonical: l.canonical, alias: l.alias, derivedFrom: l.derivedFrom })),
    }, null, 2) + '\n');
    return;
  }

  if (command === 'recheck-descriptor') {
    const wb = await loadJson(wbPath, null);
    if (!wb) throw new Error('找不到工作簿');
    const lib = await loadJson(aliasPath, null);
    const report = recheckDescriptor(wb, { trademarkId: flags.tm, aliasLibrary: lib }, { apply: Boolean(flags.apply) });
    if (flags.apply) {
      await saveJsonAtomic(wbPath, wb);
      if (lib) await saveJsonAtomic(aliasPath, lib);
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  if (command === 'report') {
    const outDir = path.resolve(cwd, flags.out ?? '报告');
    const wb = await loadJson(wbPath, null);
    const qId = flags.id;
    const queries = qId ? result.queries.filter(q => q.id === qId) : result.queries;
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(outDir, { recursive: true });
    for (const q of queries) {
      await writeFile(path.join(outDir, `客户清单-${q.id}.md`), clientChecklist(q, wb), 'utf8');
      await writeFile(path.join(outDir, `顾问底稿-${q.id}.md`), consultantDocket(q, wb), 'utf8');
    }
    await writeFile(path.join(outDir, '总览.md'), overviewMarkdown(result, wb), 'utf8');
    process.stdout.write(`报告已写入 ${outDir}\n`);
    return;
  }

  throw new Error(`未知命令：${command}（运行 node tool.js help 查看用法）`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});

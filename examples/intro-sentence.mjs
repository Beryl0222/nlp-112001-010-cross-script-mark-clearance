// 题首例句演示：同一句里既有品牌“雨杉”，也有无牌供货类目“塑料套管”，
// 还能跨文字命中 Yu Shan/YUSHAN 线索。
// 运行：node examples/intro-sentence.mjs

import { readMaterials } from '../materials.js';
import { analyzeTables } from '../lib/analyze.js';
import { extractLetter } from '../lib/extract.js';

const tables = await readMaterials();
const knownMarkets = ['海港区', '松岛'];
const text = '雨杉做园艺滴灌配件，也供不带雨杉商标的塑料套管。';

const parsed = extractLetter(
  { id: 'intro', client: '河岸园艺（示例）', market: '海港区', language: 'zh', text },
  { knownMarkets },
);

process.stdout.write(`例句：${text}\n\n`);
process.stdout.write('名称角色：\n');
for (const m of parsed.mentions) {
  process.stdout.write(`  - ${m.text}〈${m.roleLabel}〉 区间${JSON.stringify(m.span)}，出现 ${m.occurrences.length} 次\n`);
}
process.stdout.write('商品/服务与品牌使用判断：\n');
for (const g of parsed.goods) {
  process.stdout.write(`  - ${g.text} [${g.conceptId}] brandUse=${g.brandUse}（${g.usageCues.join(',') || '正面经营表述'}）\n`);
}

// 用完整引擎看“雨杉”在档案中的跨文字命中
const analysis = analyzeTables(tables);
const q1 = analysis.queries.find(q => q.id === 'q1');
process.stdout.write('\n资料 q1 中“雨杉”的证据化候选（示例句与 q1 用法一致）：\n');
for (const f of q1.findings.filter(f => f.mention.text === '雨杉')) {
  process.stdout.write(`  - ${f.code} × ${f.trademark.id} ${f.trademark.label}/${f.trademark.variant}`
    + `（${f.market}/${f.trademark.category}）=> ${f.status}\n`);
  for (const e of f.evidences) process.stdout.write(`      · ${e.label}：${e.detail}\n`);
}
process.stdout.write('\n结论：塑料套管只走“无牌供货/描述词”核对，不进入品牌近似；雨杉同时有同音、音译与意译证据。\n');

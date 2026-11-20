import { buildReviewFromDirectory } from './review.js';
import { consolidateByClient, mergeBranches } from './review.js';
import { aliasLibrariesFrom } from './audit.js';

const USAGE = `用法：node src/cli.js [选项]

  --json              输出完整 JSON（默认输出人工阅读的清单）
  --client <名称>     只看某个客户的合并咨询
  --market <名称>     只看某个市场的分派单
  --help              显示本说明

资料固定从 资料/ 目录读取。输出仅供人工核查，不构成注册意见。`;

const args = process.argv.slice(2);

if (args.includes('--help')) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

const review = await buildReviewFromDirectory();
const consultations = consolidateByClient(review.reviews);

if (args.includes('--json')) {
  const payload = {
    consultations,
    aliasIssues: review.aliasIssues,
    branchErrors: review.branchErrors,
    aliasLibraries: aliasLibrariesFrom(review.reviews),
    revisionRechecks: review.revisionRechecks,
    disclaimer: '本工具只整理人工核查范围与证据，不构成商标注册意见。'
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(0);
}

const onlyClient = optionValue('--client');
const onlyMarket = optionValue('--market');
const lines = [];

lines.push('人工核查范围');
lines.push('==============');

for (const consultation of consultations) {
  if (onlyClient && consultation.client !== onlyClient) continue;
  lines.push('');
  lines.push(`客户：${consultation.client}（来函 ${consultation.letters.join('、')}）`);
  lines.push(`市场：${consultation.markets.join('、')}`);
  lines.push(`写法：${consultation.names.join('、')}`);
  lines.push(consultation.note);

  const candidates = onlyMarket
    ? consultation.candidates.filter(candidate => candidate.market === onlyMarket)
    : consultation.candidates;
  // 合并前保留每个候选自带的写法与证据，不因共用分类关系而合并条目。
  const branches = mergeBranches(candidates.map(candidate => ({
    market: candidate.market,
    candidates: [candidate]
  })));

  for (const candidate of branches.candidates) {
    lines.push('');
    lines.push(`  [${candidate.included ? '纳入' : '仅线索'}] ${candidate.name} · ${candidate.market}`);
    lines.push(`    原文：${candidate.nameClause}（${candidate.nameRange.join('–')}）`);
    for (const reason of candidate.reasons) lines.push(`    理由：${reason}`);
    for (const use of candidate.excludedUses ?? []) {
      lines.push(`    不带标志：${use.clause}（${use.mark}）`);
    }
    for (const check of candidate.goodsChecks ?? []) {
      const categories = check.categories.length
        ? check.categories.map(item => `${item.categoryId}「${item.text}」`).join('、')
        : '无对应类目';
      lines.push(`    商品范围：${check.goods} → ${categories}`);
      for (const evidence of check.categories.flatMap(item => item.evidence)) {
        lines.push(`      依据：${evidence}`);
      }
    }
    if (!candidate.hits.length) {
      lines.push('    档案命中：无');
    }
    for (const hit of candidate.hits) {
      lines.push(
        `    档案命中：${hit.trademarkId}「${hit.label}」/「${hit.variant}」` +
        ` 类目 ${hit.category}（${hit.categoryText ?? '未载'}）` +
        ` ${hit.kind} ${hit.score.toFixed(2)}`
      );
      for (const evidence of hit.evidence) lines.push(`      证据：${evidence}`);
      for (const evidence of hit.relevance.evidence) {
        lines.push(`      商品关联：${evidence}`);
      }
      if (hit.categoryHistory) {
        lines.push(`      类目修订：${hit.categoryHistory.map(item => `v${item.revision} ${item.text}`).join(' → ')}`);
      }
    }
  }

  if (consultation.candidates.length) {
    const questions = review.reviews
      .filter(letter => consultation.letters.includes(letter.id))
      .flatMap(letter => letter.questions);
    for (const question of [...new Set(questions)]) lines.push(`  待核：${question}`);
  }
}

if (review.aliasIssues.length) {
  lines.push('');
  lines.push('别名传播');
  for (const issue of review.aliasIssues) {
    lines.push(`  ${issue.name}：${issue.note}`);
  }
}

if (review.revisionRechecks.length) {
  lines.push('');
  lines.push('类目修订后需重看');
  for (const finding of review.revisionRechecks) {
    lines.push(`  ${finding.letterId} ${finding.market} ${finding.name} → ${finding.trademarkId}`);
    lines.push(`    类目 ${finding.categoryId}：v${finding.previousRevision}「${finding.previousText}」→ v${finding.currentRevision}「${finding.currentText}」`);
    for (const evidence of finding.evidence) lines.push(`    证据：${evidence}`);
  }
}

if (review.branchErrors.length) {
  lines.push('');
  lines.push('品类说明误用品类');
  for (const error of review.branchErrors) {
    lines.push(`  ${error.letterId} ${error.name} → ${error.trademarkId}：${error.note}`);
  }
}

lines.push('');
lines.push('以上为检索线索与待核问题，不代替正式注册意见。');
process.stdout.write(`${lines.join('\n')}\n`);

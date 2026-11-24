// 把来函解析、语言检索和市场类目拼成“候选核查项”。
// 关键约束：每个 来函写法 × 档案标志 × 市场/类目 都是独立可定位的候选，
// 即使多个查询落在同一分类关系上，也绝不合并掉各自的标志与证据。

import { readMaterials } from '../materials.js';
import { extractLetter } from './extract.js';
import { Taxonomy } from './taxonomy.js';
import { searchTrademarks } from './match.js';

function spansOverlap(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}

function selectBasisGoods(mention, goods) {
  const overlapping = goods.filter(g => mention.span && spansOverlap(mention.span, g.span));
  if (overlapping.length > 0) return overlapping;
  // 无局部对应时保留全部商品（含明示无牌/材料用途的说法），
  // 否则描述词档案（如 S-72 套管）会被“只看主营”漏掉。
  return goods;
}

function triage({ mention, tm, hit, inScope, scopeReason, assessment, basisGoods }) {
  const reasonCodes = [];
  const reasons = [];
  const questions = [];
  let status;
  let priority = 'P3';
  let lane = 'brand';

  if (mention.role === 'comparison') lane = 'comparison';
  else if (mention.role === 'abbreviation') lane = 'abbreviation';
  else if (mention.role === 'current') lane = 'current';
  if (mention.role === 'generic' || tm.nature === '品类说明') lane = 'descriptor';

  if (!inScope) {
    status = '跨市场提示';
    reasonCodes.push('out-of-designated-market');
    reasons.push(scopeReason);
    priority = 'P3';
    return { status, priority, lane, reasonCodes, reasons, questions, assignable: false };
  }

  if (mention.role === 'comparison') {
    status = '仅记录';
    priority = 'P3';
    reasonCodes.push('comparison-mark-not-filed');
    reasons.push('该名称在来函中是“参考的同行标志”，客户明示不申请；保留命中证据用于比较，不立申请排查任务。');
    return { status, priority, lane, reasonCodes, reasons, questions, assignable: false };
  }

  const goodsUnknown = !assessment || assessment.relation === 'unknown' || basisGoods.length === 0;
  const categoryRelated = assessment?.related === true;
  const categoryUnrelated = assessment?.related === false;

  if (mention.role === 'abbreviation') {
    status = '需核查';
    priority = 'P1';
    reasonCodes.push('company-abbreviation');
    reasons.push('来函称其为公司简称；简称是否构成商标性使用需单独核实，不能直接按品牌主张，也不能当作无关词丢弃。');
    questions.push('该简称是否构成商标性使用：是否在商品、包装、合同、店招或宣传中作为标志单独使用？有无证据（照片、发票、网页）？');
    if (goodsUnknown) {
      reasonCodes.push('goods-scope-unknown');
      reasons.push(assessment?.reason ?? '来函未说明商品/服务，无法比对类目。');
      questions.push('请确认实际经营的商品/服务清单，再判定 H-12 等类目的审核范围。');
    } else {
      reasons.push(assessment.reason);
      if (categoryRelated) reasonCodes.push('goods-related');
    }
    return { status, priority, lane, reasonCodes, reasons, questions, assignable: true };
  }

  if (lane === 'descriptor') {
    reasonCodes.push('descriptor-lane');
    if (tm.nature === '品类说明') {
      reasonCodes.push('archive-is-descriptor');
      reasons.push(`档案 ${tm.id} 的性质为“品类说明”而非注册字样，不能把“${tm.label}”当成某品牌的俗称。`);
    }
    if (mention.role === 'generic') {
      reasonCodes.push('client-stated-material-term');
      reasons.push('来函明示该写法只是材料/通用描述词，不是客户主张的标志。');
    }
    if (basisGoods.length > 0) {
      const matchedGoods = assessment?.matches
        ? [...new Map(assessment.matches.map(m => [m.goods.id, m.goods])).values()]
        : [];
      const checkGoods = matchedGoods.length > 0 ? matchedGoods : basisGoods;
      if (checkGoods.every(g => !g.brandUse)) {
        reasonCodes.push('no-brand-use-on-goods');
        reasons.push(`对应商品“${checkGoods.map(g => g.text).join('、')}”在函中为无牌代工/材料用途：${checkGoods.map(g => g.qualifier).join('；')}。`);
      }
    }
    reasons.push(assessment?.reason ?? '未取得类目比对结果。');

    // 描述性写法却与“注册字样”高度同形时，不能简单排除：可能涉及描述性合理使用。
    if (tm.nature === '注册字样' && hit.confidence === '高') {
      status = '需核查';
      priority = 'P1';
      reasonCodes.push('descriptive-use-vs-registered-mark');
      questions.push('该描述性写法与在先注册字样高度同形，需判断是否属于描述性合理使用、实际使用样式是否突出为标志。');
      return { status, priority, lane, reasonCodes, reasons, questions, assignable: true };
    }
    status = '可排除';
    priority = 'P3';
    questions.push('请当地同事确认该词在本地是否确为行业通用描述，以及使用方式未突出为品牌。');
    return { status, priority, lane, reasonCodes, reasons, questions, assignable: true, exclusionReason: reasons.join(' ') };
  }

  // actual / alias / current 的一般品牌候选
  reasons.push(assessment?.reason ?? '未取得类目比对结果。');
  if (categoryRelated) {
    reasonCodes.push('goods-related');
    status = '需核查';
    priority = hit.confidence === '高' ? 'P1' : 'P2';
    if (hit.confidence === '高') reasonCodes.push('strong-mark-match');
    if (hit.confidence === '中') reasonCodes.push('medium-mark-match');
  } else if (goodsUnknown) {
    reasonCodes.push('goods-scope-unknown');
    status = '需核查';
    priority = 'P2';
    questions.push('来函未写清商品/服务，需补齐后才能判断与该类目是否构成类似。');
  } else if (categoryUnrelated) {
    reasonCodes.push('category-not-related');
    if (hit.confidence === '高') {
      status = '需核查';
      priority = 'P2';
      reasonCodes.push('strong-mark-match-cross-category');
      questions.push('字样证据很强但当前类目不对应：需确认客户是否有上下游/扩展商品或在其他类别使用，以及驰名/跨类保护可能。');
    } else if (hit.confidence === '中') {
      status = '需核查';
      priority = 'P2';
      reasonCodes.push('medium-mark-match-cross-category');
      questions.push('存在意译/近形等中等强度线索但类目不对应，需人工判断两个品牌是否实际指向同一来源或存在扩展计划。');
    } else {
      status = '可排除';
      priority = 'P3';
      reasonCodes.push('weak-mark-match');
      questions.push('字样仅有弱证据且类目不对应，可由顾问复核后排除；如客户有新市场/新品类计划需重看。');
    }
  }
  return { status, priority, lane, reasonCodes, reasons, questions, assignable: status === '需核查' };
}

export function analyzeQuery(row, tables, taxonomy) {
  const knownMarkets = taxonomy.knownMarkets(
    (tables['商标档案.json'] ?? []).map(t => t.market),
  );
  const extracted = extractLetter(row, { knownMarkets });
  const designated = new Set(extracted.markets.map(m => m.name));
  const trademarks = tables['商标档案.json'] ?? [];

  const findings = [];
  const coverage = [];

  for (const mention of extracted.mentions) {
    if (!mention.searchable) {
      // 通用描述词仍然检索，用于形成“描述词排除”证据，因此这里不跳过；
      // searchable=false 仅表示它不是客户主张的标志。
    }
    const hits = searchTrademarks(mention.text, trademarks);
    coverage.push({
      mentionId: mention.id,
      text: mention.text,
      role: mention.role,
      hitCount: hits.length,
      trademarkIds: hits.map(h => h.trademarkId),
    });

    for (const hit of hits) {
      const inScope = designated.has(hit.market);
      const scopeReason = inScope
        ? `档案市场 ${hit.market} 在来函指定市场内`
        : `档案市场 ${hit.market} 不在来函指定市场（${[...designated].join('、') || '未解析'}），仅作跨市场提示；同一写法在不同市场对应不同类目与用语`;

      const basisGoods = selectBasisGoods(mention, extracted.goods);
      const assessment = taxonomy.assessGoods(
        basisGoods, hit.category, hit.market,
      );

      const tri = triage({
        mention, tm: { id: hit.trademarkId, ...hit }, hit,
        inScope, scopeReason, assessment, basisGoods,
      });

      const key = [row.id, mention.id, hit.trademarkId, hit.market, hit.category].join('|');
      findings.push({
        key,
        queryId: row.id,
        client: row.client,
        source: extracted.source,
        mention: {
          id: mention.id,
          text: mention.text,
          span: mention.span,
          role: mention.role,
          roleLabel: mention.roleLabel,
          rule: mention.rule,
          filingIntent: mention.filingIntent,
          quote: mention.quote,
        },
        trademark: {
          id: hit.trademarkId,
          label: hit.label,
          variant: hit.variant,
          nature: hit.nature,
          market: hit.market,
          category: hit.category,
          categoryRevision: assessment?.category?.revision ?? taxonomy.latestRevision(hit.category),
          categoryText: assessment?.category?.text ?? null,
          categoryParent: assessment?.category?.parent ?? null,
        },
        market: hit.market,
        inScope,
        scopeReason,
        confidence: hit.confidence,
        evidences: hit.evidences,
        surfaceMatches: hit.surfaceMatches,
        basisGoods: basisGoods.map(g => ({ id: g.id, text: g.text, span: g.span, conceptId: g.conceptId, brandUse: g.brandUse })),
        categoryAssessment: {
          related: assessment.related,
          relation: assessment.relation,
          reason: assessment.reason,
          decidedAgainstRevision: assessment.category?.revision ?? null,
        },
        ...tri,
      });
    }
  }

  // 稳定排序：指定市场内、优先级、市场、类目、置信度、键。
  const pRank = { P1: 1, P2: 2, P3: 3 };
  const cRank = { 高: 1, 中: 2, 低: 3 };
  findings.sort((a, b) =>
    Number(b.inScope) - Number(a.inScope)
    || (pRank[a.priority] ?? 9) - (pRank[b.priority] ?? 9)
    || a.market.localeCompare(b.market, 'zh')
    || a.trademark.category.localeCompare(b.trademark.category)
    || (cRank[a.confidence] ?? 9) - (cRank[b.confidence] ?? 9)
    || a.key.localeCompare(b.key));
  findings.forEach((f, i) => { f.code = `${row.id.toUpperCase()}-C${String(i + 1).padStart(2, '0')}`; });

  const questions = [...extracted.questions];
  for (const f of findings) {
    for (const q of f.questions ?? []) {
      questions.push({ code: 'finding-question', findingKey: f.key, code2: f.code, text: q });
    }
  }

  // 咨询级问题：跨候选的拼写规格、无牌使用依据等。
  if (extracted.mentions.some(m => m.role === 'actual')
    && extracted.mentions.some(m => m.role === 'alias' && /[A-Za-z]/.test(m.text))) {
    questions.push({
      code: 'confirm-romanization',
      text: '请客户确认对外正式拼写及大小写/空格/连字符规格；本次已按归一规则覆盖 Yu Shan、Yushan、Yu-Shan、YUSHAN 等变体。',
    });
  }
  for (const g of extracted.goods.filter(x => !x.brandUse)) {
    questions.push({
      code: 'confirm-no-brand-use',
      text: `请确认“${g.text}”确为${g.usageCues.includes('material-term') ? '材料/通用描述' : '无牌代工'}用途，并留存包装、代工条款或页面依据；该商品说法本身不作为品牌主张。`,
    });
  }

  return {
    id: row.id,
    client: row.client,
    source: extracted.source,
    markets: extracted.markets,
    language: extracted.language,
    mentions: extracted.mentions,
    goods: extracted.goods,
    cues: extracted.cues,
    clientTradeTerm: extracted.clientTradeTerm,
    questions,
    coverage,
    findings,
  };
}

export function analyzeTables(tables) {
  const taxonomy = Taxonomy.fromTables(tables);
  const queries = tables['来函.json'].map(row => analyzeQuery(row, tables, taxonomy));
  const findings = queries.flatMap(q => q.findings);
  return { taxonomy, queries, findings };
}

export async function analyzeDefault() {
  const tables = await readMaterials();
  return analyzeTables(tables);
}

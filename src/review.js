import { readMaterials } from '../materials.js';
import { resolveCategories, relateCategories } from './catalog.js';
import { compareNames } from './compareNames.js';
import { extractMentions, splitMarkets } from './extract.js';
import { categoryRelevance } from './relevance.js';
import { resolveTrademarks } from './trademarks.js';

export const NAME_ROLES = ['actual', 'alias', 'unmarked', 'comparative'];

export const NAME_ROLE_REASON = {
  actual: '来函明确指示的现用或拟用标志',
  alias: '来函提出的别名或公司简称，可能作为标志使用',
  unmarked: '名称与经营说明混写，需确认是否作为标志',
  comparative: '仅用于比较的标志，不进入申请范围',
  'outside-use': '客户说明该商品不承载该标志，不作为标志使用'
};

const MAX_UNMARKED_HAN = 4;
const MAX_UNMARKED_LATIN_WORDS = 3;

/**
 * 对一批来函生成人工核查范围。
 * 每条来函拆成可独立确认的候选（写法 × 市场 × 类目 × 理由）；
 * 不同来函中语义相同的候选不会被合并。
 */
export async function buildReview({ letters, trademarks, categories }) {
  const catalog = resolveCategories(categories);
  const markIndex = resolveTrademarks(trademarks);
  const reviews = letters.map(letter => reviewLetter({ letter, catalog, markIndex }));
  for (const review of reviews) {
    for (const check of review.descriptiveChecks) check.letterId = review.id;
  }
  return {
    reviews,
    aliasIssues: findAliasIssues(reviews, markIndex),
    branchErrors: findBranchErrors(reviews),
    revisionRechecks: collectRevisionRechecks(reviews, catalog),
    catalog,
    markIndex
  };
}

/**
 * 类目补充释义后，旧版判为不相关、新版出现商品关联的候选。
 * 这些候选的「不相关」结论需要重看，而不是自动改判。
 */
export function collectRevisionRechecks(reviews, catalog) {
  const findings = [];
  for (const review of reviews) {
    for (const candidate of review.candidates) {
      for (const hit of candidate.hits) {
        if (!hit.relevanceHistory || hit.relevanceHistory.length < 2) continue;
        const current = hit.relevanceHistory.at(-1);
        const earlier = hit.relevanceHistory.slice(0, -1)
          .filter(item => !item.relevance.relevant);
        if (!current.relevance.relevant || !earlier.length) continue;
        const latestEarlier = earlier.at(-1);
        findings.push({
          letterId: review.id,
          client: review.client,
          candidateId: candidate.id,
          name: candidate.name,
          market: candidate.market,
          trademarkId: hit.trademarkId,
          categoryId: hit.category,
          previousRevision: latestEarlier.revision,
          previousText: latestEarlier.text,
          currentRevision: current.revision,
          currentText: current.text,
          evidence: current.relevance.evidence,
          action: `类目 ${hit.category} 补充释义后，「${candidate.name}」与 ` +
            `${hit.trademarkId} 由「不相关」转为需重看`
        });
      }
    }
  }
  return findings;
}

export async function buildReviewFromDirectory(directory) {
  const tables = await readMaterials(directory);
  return buildReview({
    letters: tables['来函.json'],
    trademarks: tables['商标档案.json'],
    categories: tables['市场类目.json']
  });
}

export function reviewLetter({ letter, catalog, markIndex }) {
  const markets = splitMarkets(letter.market);
  const { mentions } = extractMentions(letter.text);
  const names = dedupeMentions(mentions
    .filter(mention => NAME_ROLES.includes(mention.role))
    .filter(mention => !(mention.role === 'unmarked' && isOverlong(mention))));
  const goods = mentions.filter(mention =>
    ['goods', 'outside-use', 'descriptive'].includes(mention.role));

  const candidates = [];
  for (const name of names) {
    for (const market of markets) {
      candidates.push(candidatesFor({ letter, name, market, catalog, markIndex, goods }));
    }
  }
  // 客户明确不带某标志的商品，附在候选的说明里；不另立申请候选。
  const excludedUses = mentions
    .filter(mention => mention.role === 'excluded' && mention.markAbsent)
    .map(mention => ({
      mark: mention.text,
      clause: mention.clause,
      range: mention.range,
      goods: goods
        .filter(item => item.absentMark === mention.text)
        .map(item => item.text),
      note: '该标志不用于客户说明的商品，商品范围仍需单独列明'
    }));
  for (const candidate of candidates) {
    const related = excludedUses.filter(use =>
      compareNames(use.mark, candidate.name).kind !== 'none');
    // 找不到同名写法时仍保留为整封来函的约束，避免遗漏。
    candidate.excludedUses = related.length ? related : excludedUses;
  }
  const review = {
    id: letter.id,
    client: letter.client,
    language: letter.language,
    markets,
    text: letter.text,
    names,
    goods,
    candidates,
    descriptiveChecks: matchDescriptiveTerms({ mentions, markets, markIndex }),
    questions: []
  };
  review.questions = openQuestions(review);
  return review;
}

function isOverlong(mention) {
  if (mention.type === 'han') return mention.text.length > MAX_UNMARKED_HAN;
  return mention.latinWords.length > MAX_UNMARKED_LATIN_WORDS;
}

/** 同一分句里重复出现的同一写法只保留一次，避免重复候选。 */
function dedupeMentions(mentions) {
  const seen = new Map();
  for (const mention of mentions) {
    const key = `${mention.role}::${mention.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.set(key, mention);
  }
  return [...seen.values()];
}

function candidatesFor({ letter, name, market, catalog, markIndex, goods }) {
  const hits = [];
  for (const record of markIndex.inMarket(market)) {
    const matches = [
      { compared: record.label, as: 'label', comparison: compareNames(name.text, record.label) },
      { compared: record.variant, as: 'variant', comparison: compareNames(name.text, record.variant) }
    ]
      .filter(item => item.compared)
      .filter(item => item.comparison.kind !== 'none')
      .sort((left, right) => right.comparison.score - left.comparison.score);
    if (!matches.length) continue;
    const best = matches[0];

    const category = catalog.latest(record.market, record.category);
    const goodsTexts = goods.map(mention => mention.text);
    const entry = catalog.get(record.market, record.category);
    const relevanceHistory = entry
      ? entry.revisions.map(item => ({
        revision: item.revision,
        text: item.text,
        relevance: categoryRelevance(goodsTexts, item.text)
      }))
      : [];
    hits.push({
      trademarkId: record.id,
      label: record.label,
      variant: record.variant,
      nature: record.nature,
      market: record.market,
      category: record.category,
      categoryRevision: category?.revision ?? null,
      categoryText: category?.text ?? null,
      parent: category?.parent ?? null,
      matchedAgainst: best.as,
      matchedText: best.compared,
      kind: best.comparison.kind,
      score: best.comparison.score,
      evidence: best.comparison.evidence,
      matches: matches.map(item => ({
        against: item.as,
        text: item.compared,
        kind: item.comparison.kind,
        score: item.comparison.score,
        evidence: item.comparison.evidence
      })),
      relevance: category
        ? categoryRelevance(goodsTexts, category.text)
        : { relevant: false, shared: [], evidence: ['该市场无类目释义可对照'] },
      relevanceHistory
    });
  }
  hits.sort((left, right) => right.score - left.score);

  const included = name.role !== 'comparative';
  const reasons = [NAME_ROLE_REASON[name.role]];
  if (name.inferred) reasons.push(`由语境推定（${name.inferred}），需人工确认`);
  if (name.alsoExcluded) reasons.push('同一分句内出现不申请说明');
  if (name.role === 'comparative') reasons.push('客户说明不申请该写法，仅保留检索线索');

  const goodsNotes = goods.map(mention => ({
    text: mention.text,
    role: mention.role,
    clause: mention.clause,
    range: mention.range,
    markAbsent: Boolean(mention.markAbsent),
    absentMark: mention.absentMark ?? null,
    absentMarkRange: mention.absentMarkRange ?? null
  }));

  const goodsChecks = goodsNotes.length
    ? checkGoodsAgainstMarket({ market, catalog, goods })
    : [];

  const candidate = {
    id: `${letter.id}:${market}:${slug(name.text)}:${hits.length ? 'hits' : 'none'}`,
    client: letter.client,
    letterId: letter.id,
    market,
    name: name.text,
    nameRole: name.role,
    nameRange: name.range,
    nameClause: name.clause,
    included,
    reasons,
    goodsNotes,
    goodsChecks,
    hits
  };

  // 补入无档可查的提示与修订影响，均作为候选自带的证据。
  if (!hits.length) {
    candidate.reasons.push(`该市场档案中未找到与「${name.text}」相关的记录，仍需人工复核`);
  }
  const revisionNotes = new Set();
  const crossScriptNotes = new Set();
  for (const hit of hits) {
    const entry = catalog.get(hit.market, hit.category);
    if (entry?.superseded?.length) {
      const older = entry.superseded.at(-1);
      revisionNotes.add(
        `类目 ${hit.category} 已有修订 ${older.revision}→${hit.categoryRevision}：` +
        `旧释义「${older.text}」，现行「${entry.latest.text}」；涉及该类的既有结论需重看`
      );
      hit.categoryHistory = entry.revisions.map(item => ({
        revision: item.revision,
        text: item.text,
        parent: item.parent
      }));
    }
    if (CROSS_SCRIPT_KINDS.has(hit.kind)) {
      crossScriptNotes.add(
        `与档案 ${hit.trademarkId} 的命中依赖${KIND_LABELS[hit.kind]}证据，需由顾问确认`
      );
    }
    if (hit.nature === '品类说明') {
      candidate.reasons.push(
        `档案 ${hit.trademarkId} 标注为「${hit.nature}」：若说明词曾被当作品牌俗称，相关既有分派需重核`
      );
    }
  }
  candidate.reasons.push(...revisionNotes, ...crossScriptNotes);

  return candidate;
}

/**
 * 来函中的材料/品类说明若与档案里的「品类说明」写法一致，记录为佐证：
 * 该词是通用描述，不能作为品牌命中。
 */
function matchDescriptiveTerms({ mentions, markets, markIndex }) {
  const checks = [];
  for (const mention of mentions) {
    if (!['descriptive', 'outside-use'].includes(mention.role)) continue;
    for (const market of markets) {
      for (const record of markIndex.inMarket(market)) {
        if (record.nature === '注册字样') continue;
        const comparisons = [
          compareNames(mention.text, record.label),
          compareNames(mention.text, record.variant)
        ].sort((left, right) => right.score - left.score);
        const best = comparisons[0];
        if (best.kind === 'none') continue;
        checks.push({
          letterId: null,
          market,
          text: mention.text,
          mentionRole: mention.role,
          clause: mention.clause,
          trademarkId: record.id,
          label: record.label,
          variant: record.variant,
          nature: record.nature,
          kind: best.kind,
          evidence: best.evidence,
          note: `来函中的「${mention.text}」与档案 ${record.id} 的品类说明一致，属通用描述而非品牌`
        });
      }
    }
  }
  return checks;
}

/**
 * 客户说明的商品服务在该市场能落到哪些类目。只提示候选范围，
 * 不做跨市场的类目等同判断。
 */
function checkGoodsAgainstMarket({ market, catalog, goods }) {
  const checks = [];
  for (const mention of goods) {
    const matches = catalog.entries(market)
      .map(entry => ({
        categoryId: entry.id,
        revision: entry.latest.revision,
        text: entry.latest.text,
        parent: entry.latest.parent,
        relevance: categoryRelevance([mention.text], entry.latest.text)
      }))
      .filter(item => item.relevance.relevant);
    checks.push({
      goods: mention.text,
      role: mention.role,
      markAbsent: Boolean(mention.markAbsent),
      absentMark: mention.absentMark ?? null,
      market,
      categories: matches.map(item => ({
        categoryId: item.categoryId,
        revision: item.revision,
        text: item.text,
        parent: item.parent,
        evidence: item.relevance.evidence
      })),
      note: mention.role === 'outside-use' || mention.markAbsent
        ? '该商品不承载标志，但商品范围仍需在分派单中列出'
        : null
    });
  }
  return checks;
}

const CROSS_SCRIPT_KINDS = new Set([
  'translation', 'transliteration', 'homophone', 'near-form', 'variant'
]);

const KIND_LABELS = {
  transliteration: '音译',
  homophone: '同音',
  'near-form': '中文近形',
  variant: '拉丁拼写变体',
  translation: '意译',
  partial: '部分重合',
  exact: '完全相同'
};

function slug(text) {
  const ascii = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (ascii) return ascii;
  return [...text].map(char => char.codePointAt(0).toString(16)).join('-');
}

/** 待核问题：客户需要回答的先决条件，按来函自身的候选与说明生成。 */
function openQuestions({ names, markets, candidates }) {
  const questions = [];
  for (const name of names) {
    if (name.role === 'comparative') {
      questions.push(`「${name.text}」是否确实只用于比较，不作为申请写法？`);
    }
    if (name.role === 'alias') {
      questions.push(`「${name.text}」是公司简称还是拟注册标志？其使用范围限于哪些商品服务？`);
    }
    if (name.role === 'unmarked' && name.inferred) {
      questions.push(`「${name.text}」是否为实际使用的标志，还是仅描述经营内容？`);
    }
  }
  const missing = candidates.filter(candidate => candidate.included && candidate.hits.length === 0);
  for (const candidate of missing) {
    questions.push(`「${candidate.name}」在${candidate.market}无档案记录：是否需要在当地补充检索？`);
  }
  for (const market of markets) {
    const forMarket = candidates.find(candidate => candidate.market === market) ?? candidates[0];
    for (const check of forMarket?.goodsChecks ?? []) {
      if (check.categories.length > 1) {
        questions.push(
          `「${forMarket.name}」在${market}涉及多个类目` +
          `（${check.categories.map(item => item.categoryId).join('、')}），需分别确认指定范围`
        );
      }
      if (check.role === 'outside-use' || check.markAbsent) {
        const mark = check.absentMark ? `「${check.absentMark}」` : '该标志';
        questions.push(
          `「${check.goods}」不带${mark}，是否仍在${market}单独列明商品范围？`
        );
      }
    }
  }
  const descriptive = new Map();
  for (const candidate of candidates) {
    for (const hit of candidate.hits) {
      if (hit.nature !== '品类说明') continue;
      descriptive.set(
        hit.trademarkId,
        `档案 ${hit.trademarkId} 为品类说明：是否曾把「${hit.label}」误当作品牌俗称分派给其它客户？`
      );
    }
  }
  questions.push(...descriptive.values());
  if (markets.length > 1) {
    questions.push(`客户列出的 ${markets.join('、')} 需分别按当地类目确认，是否各由当地同事承接？`);
  }
  return [...new Set(questions)];
}

/**
 * 同一名称被多个客户的别名库引用，而商标档案中相应写法标注为品类说明：
 * 说明错误关联已经传播，需要回查既有分派。
 */
export function findAliasIssues(reviews, markIndex) {
  const aliasUses = new Map();
  for (const review of reviews) {
    for (const name of review.names) {
      if (name.role !== 'alias') continue;
      const key = name.text.toLowerCase();
      if (!aliasUses.has(key)) aliasUses.set(key, []);
      aliasUses.get(key).push({ client: review.client, letterId: review.id, name });
    }
  }
  const findings = [];
  for (const [key, uses] of aliasUses) {
    const clients = [...new Set(uses.map(use => use.client))];
    // 别名若与档案中的品类说明写法相近，可能是把描述词当成了品牌俗称。
    const descriptive = markIndex.all()
      .filter(record => record.nature !== '注册字样')
      .map(record => ({
        record,
        comparison: [compareNames(key, record.label), compareNames(key, record.variant)]
          .sort((left, right) => right.score - left.score)[0]
      }))
      .filter(item => item.comparison.kind !== 'none');

    const notes = [];
    if (clients.length > 1) {
      notes.push(`别名「${key}」已出现在 ${clients.length} 个客户的来函中，纠正简称时需回查对方的别名库`);
    } else {
      notes.push(`别名「${key}」只出现在单个客户的来函中`);
    }
    for (const item of descriptive) {
      notes.push(
        `与档案 ${item.record.id}「${item.record.label}」的${KIND_LABELS[item.comparison.kind]}写法相近，` +
        '但该档案标注为品类说明，需确认是否把描述词当作品牌俗称'
      );
    }
    findings.push({
      name: key,
      clientCount: clients.length,
      clients,
      uses: uses.map(use => ({ letterId: use.letterId, client: use.client, range: use.name.range })),
      crossedClients: clients.length > 1,
      descriptiveMatches: descriptive.map(item => ({
        trademarkId: item.record.id,
        label: item.record.label,
        kind: item.comparison.kind,
        evidence: item.comparison.evidence
      })),
      note: notes.join('；')
    });
  }
  return findings;
}

/**
 * 描述性用语被误当作品牌俗称的记录。
 * 包括两类：来函自己标注为材料/品类说明、且与档案品类说明一致；
 * 以及候选命中了标注为「品类说明」的档案（这类命中不应直接采信）。
 */
export function findBranchErrors(reviews) {
  const errors = [];
  for (const review of reviews) {
    for (const check of review.descriptiveChecks ?? []) {
      errors.push({
        letterId: review.id,
        client: review.client,
        market: check.market,
        name: check.text,
        trademarkId: check.trademarkId,
        category: null,
        kind: check.kind,
        evidence: check.evidence,
        note: check.note
      });
    }
    for (const candidate of review.candidates) {
      for (const hit of candidate.hits) {
        if (hit.nature === '注册字样') continue;
        errors.push({
          letterId: review.id,
          client: review.client,
          market: candidate.market,
          name: candidate.name,
          trademarkId: hit.trademarkId,
          category: hit.category,
          kind: hit.kind,
          evidence: hit.evidence,
          note: `「${candidate.name}」命中了标注为「${hit.nature}」的档案 ${hit.trademarkId}，不得直接当作品牌命中`
        });
      }
    }
  }
  return errors;
}

export function relateCandidateCategories(left, right, catalog) {
  return relateCategories(left, right, catalog);
}

/** 按市场拆出可分派的工作单，保留每个候选的标志与证据。 */
export function dispatchByMarket(review) {
  const groups = new Map();
  for (const candidate of review.candidates) {
    if (!groups.has(candidate.market)) groups.set(candidate.market, []);
    groups.get(candidate.market).push(candidate);
  }
  return [...groups.entries()].map(([market, candidates]) => {
    const goods = new Map();
    for (const candidate of candidates) {
      for (const check of candidate.goodsChecks) {
        if (!goods.has(check.goods)) {
          goods.set(check.goods, {
            goods: check.goods,
            role: check.role,
            markAbsent: check.markAbsent,
            absentMark: check.absentMark,
            categories: check.categories
          });
        }
      }
    }
    return {
      letterId: review.id,
      client: review.client,
      market,
      candidates,
      goods: [...goods.values()],
      questions: review.questions.filter(question => question.includes(market))
    };
  });
}

/**
 * 同一客户的多封来函合并为一次咨询。
 * 合并只合并展示层：每个候选仍保留各自的来函编号、标志写法、市场与证据。
 */
export function consolidateByClient(reviews) {
  const groups = new Map();
  for (const review of reviews) {
    if (!groups.has(review.client)) {
      groups.set(review.client, { client: review.client, letters: [], candidates: [] });
    }
    const group = groups.get(review.client);
    group.letters.push(review.id);
    group.candidates.push(...review.candidates);
  }
  return [...groups.values()].map(group => ({
    ...group,
    markets: [...new Set(group.candidates.map(candidate => candidate.market))],
    names: [...new Set(group.candidates.map(candidate => candidate.name))],
    sharedConsultation: group.letters.length > 1,
    note: group.letters.length > 1
      ? '同一客户的多封来函共用一次咨询，候选仍逐条独立确认'
      : '单一来函，无需合并咨询'
  }));
}

/**
 * 合并分派给当地同事后的核查结果。
 * 保留每个候选的标志、分类关系与语义证据；只在确实一致时归并结论，
 * 不因多个查询共用同一分类关系而抹掉各自的标志。
 */
export function mergeBranches(branches) {
  const merged = [];
  for (const branch of branches) {
    for (const candidate of branch.candidates) {
      merged.push({
        ...candidate,
        branch: branch.market,
        reviewers: branch.reviewers ?? null,
        conclusion: branch.conclusion ?? null,
        conclusionReason: branch.conclusionReason ?? null
      });
    }
  }
  // 不同写法的候选若落在同一分类关系内，只作提示，不合并条目。
  const categoryGroups = new Map();
  for (const candidate of merged) {
    for (const hit of candidate.hits) {
      const key = `${hit.market}::${hit.category}`;
      if (!categoryGroups.has(key)) categoryGroups.set(key, new Set());
      categoryGroups.get(key).add(candidate.name);
    }
  }
  const sharedCategories = [...categoryGroups.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([key, names]) => ({
      category: key,
      names: [...names],
      note: '多个写法共用同一分类关系，仍需逐条确认各自标志'
    }));
  return { candidates: merged, sharedCategories };
}

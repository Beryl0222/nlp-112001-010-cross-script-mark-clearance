// 来函解析：把几句话拆成带原文位置的名称（按用途分角色）、市场、商品服务和使用说明。
// 规则全部显式、可复核；解析不了的部分进入 questions，而不是静默猜测。

import { GOODS_CONCEPTS } from './terminology.js';

const HAN_NAME = '[一-鿿]{2,6}';
const LATIN_NAME = "[A-Za-z][A-Za-z0-9'’.\\-]*(?:\\s+[A-Za-z0-9'’.\\-]+){0,4}?";

function spanOf(match, groupName) {
  const idx = match.indices?.groups?.[groupName];
  return idx ? [idx[0], idx[1]] : [match.index, match.index + match[0].length];
}

function makeRule(id, role, re, group = 'name', extra = {}) {
  return { id, role, re, group, ...extra };
}

const ZH_NAME_RULES = [
  makeRule('zh-abbr', 'abbreviation',
    new RegExp(`(?:(?:本)?公司)?简称(?:是|为)?(?<name>${HAN_NAME})`, 'd')),
  makeRule('zh-current', 'current',
    new RegExp(`现用标(?:志)?是(?<name>${HAN_NAME}|${LATIN_NAME})`, 'd')),
  makeRule('zh-comparison', 'comparison',
    new RegExp(`参考(?:同行)?的?\\s*(?<name>${LATIN_NAME}|${HAN_NAME})(?=\\s*[，,。；;]|但不申请)`, 'd')),
  makeRule('zh-alias-en', 'alias',
    new RegExp(`也考虑(?:英文|英语|拉丁写法)?\\s*(?<name>${LATIN_NAME})(?=\\s*[。，,.；;]|$)`, 'd')),
  makeRule('zh-alias-word', 'alias',
    new RegExp(`(?:暂拟别名|暂定别名|暂用名|别名)(?:是|为)?(?<name>${HAN_NAME}|${LATIN_NAME})`, 'd')),
  makeRule('zh-actual-zuo', 'actual',
    new RegExp(`(?:^|[。；;])(?<name>${HAN_NAME})(?=做[一-鿿])`, 'dm')),
  makeRule('zh-brand-is', 'actual',
    new RegExp(`品牌(?:名|名称)?(?:是|为)(?<name>${HAN_NAME}|${LATIN_NAME})`, 'd')),
];

const EN_NAME_RULES = [
  makeRule('en-the-mark-is', 'actual',
    /[Tt]he mark is\s+(?<name>[A-Z][A-Za-z0-9'’.&-]*(?:\s+[A-Za-z0-9'’.&-]+){0,3}?)\s+for\s+/d),
  makeRule('en-we-use', 'actual',
    /(?:we use|using)\s+(?<name>[A-Z][A-Za-z0-9'’.&-]*(?:\s+[A-Za-z0-9'’.&-]+){0,3}?)\s+(?:for|on)\s+/d),
  makeRule('en-alias', 'alias',
    /(?:also consider|possible romani[sz]ation|alias)\s*:?\s*(?<name>[A-Z][A-Za-z0-9'’.& -]{0,40}?)(?=[.;,\n]|$)/di),
  makeRule('en-compared', 'comparison',
    /(?:compared with|reference mark|peer mark)\s+(?<name>[A-Z][A-Za-z0-9'’.& -]{0,40}?)(?=[.;,\n]|$)/d),
];

const GENERIC_RULES = [
  {
    id: 'en-material-term',
    re: /(?<name>[A-Z][A-Za-z]+(?:\s+[A-Za-z]+){0,4}?)\s+(?:is|are)\s+(?:only\s+)?(?:a\s+)?(?:material|generic|descriptive)\s+term/gid,
    lang: 'en',
  },
  {
    id: 'zh-generic-term',
    re: new RegExp(`(?<name>${HAN_NAME})(?:只)?是(?:材料词|通用词|通名|品类说明)`, 'gd'),
    lang: 'zh',
  },
];

const ROLE_LABELS = {
  actual: '拟实际使用名称',
  alias: '暂拟别名/异写',
  comparison: '用作比较的标志',
  abbreviation: '公司简称（未必作商标使用）',
  current: '现用标志',
  generic: '材料/通用描述词（非品牌主张）',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}

function clauseAt(text, start, end) {
  const stops = '，。；！？,.!?;\n';
  let l = start;
  while (l > 0 && !stops.includes(text[l - 1])) l -= 1;
  let r = end;
  while (r < text.length && !stops.includes(text[r])) r += 1;
  return { text: text.slice(l, r), span: [l, r] };
}

const NO_BRAND_CUES = [
  { code: 'no-mark-oem', re: /不打(?:这个|该)?标志|不打商标/ },
  { code: 'without-mark', re: /不带[^，,。；;]{0,12}?商标/ },
  { code: 'no-brand-print', re: /不(?:标|印|打)[^，,。；;]{0,6}?(?:商标|牌子|标志)/ },
  { code: 'material-term', re: /only a material term|material term|通用词|材料词|通名/i },
];

const OEM_CUE = /代工|OEM/i;

function brandUseInClause(clause) {
  const hits = NO_BRAND_CUES.filter(c => c.re.test(clause)).map(c => c.code);
  return { brandUse: hits.length === 0, negationCues: hits };
}

// 从 client 字段识别行业通名（弱商品线索，只能形成待核问题）。
const CLIENT_TRADE_SUFFIX = /(零件|配件|园艺|设计|科技|贸易|管业|园林)$/;

function scanGoods(text) {
  const surfaces = [];
  for (const [conceptId, concept] of Object.entries(GOODS_CONCEPTS)) {
    for (const surface of concept.surfaces) surfaces.push({ surface, conceptId, kind: concept.kind });
  }
  // 长词优先，避免“滴灌配件”被“配件”截断。
  surfaces.sort((a, b) => b.surface.length - a.surface.length);
  const lowerText = text.toLowerCase();
  const occupied = [];
  const goods = [];
  const overlaps = (s, e) => occupied.some(([a, b]) => s < b && e > a);

  for (const { surface, conceptId, kind } of surfaces) {
    const lower = surface.toLowerCase();
    let from = 0;
    while (true) {
      const idx = lowerText.indexOf(lower, from);
      if (idx < 0) break;
      from = idx + Math.max(1, surface.length);
      const end = idx + surface.length;
      // 英文要求词边界，防止 tubing 命中 tubingx 之类。
      if (/[A-Za-z]/.test(surface[0])) {
        const before = text[idx - 1];
        const after = text[end];
        if (before && /[A-Za-z]/.test(before)) continue;
        if (after && /[A-Za-z]/.test(after)) continue;
      }
      if (overlaps(idx, end)) continue;
      occupied.push([idx, end]);
      const clause = clauseAt(text, idx, end);
      const use = brandUseInClause(clause.text);
      goods.push({
        id: null,
        text: text.slice(idx, end),
        span: [idx, end],
        conceptId,
        kind,
        clause: clause.text,
        brandUse: use.brandUse,
        usageCues: [
          ...use.negationCues,
          ...(OEM_CUE.test(clause.text) ? ['oem'] : []),
        ],
        qualifier: use.brandUse
          ? (/做/.test(text.slice(Math.max(0, idx - 4), idx)) ? '来函称经营/制造该品' : '一般提及')
          : '来函明示不作为品牌使用或仅为材料词',
      });
    }
  }
  goods.sort((a, b) => a.span[0] - b.span[0]);
  goods.forEach((g, i) => { g.id = `G${i + 1}`; });
  return goods;
}

function parseMarkets(row, knownMarkets) {
  const raw = row.market ?? '';
  const markets = [];
  if (knownMarkets && knownMarkets.length > 0) {
    const sorted = [...knownMarkets].sort((a, b) => b.length - a.length);
    let rest = raw;
    let offset = 0;
    // 依次在字符串中定位已知市场名，允许顿号逗号间隔；无法解释的残片留作问题。
    const used = [];
    for (const name of sorted) {
      let from = 0;
      while (true) {
        const idx = raw.indexOf(name, from);
        if (idx < 0) break;
        from = idx + name.length;
        const end = idx + name.length;
        if (used.some(([a, b]) => idx < b && end > a)) continue;
        used.push([idx, end]);
        markets.push({ name, span: [idx, end] });
      }
    }
    markets.sort((a, b) => a.span[0] - b.span[0]);
    const unmatched = raw
      .split('')
      .map((ch, i) => (used.some(([a, b]) => i >= a && i < b) ? '' : ch))
      .join('')
      .replace(/[、,，\s]+/g, '')
      .trim();
    return { markets, unmatched };
  }
  for (const m of raw.split(/[、,，]/).map(s => s.trim()).filter(Boolean)) {
    const idx = raw.indexOf(m);
    markets.push({ name: m, span: idx >= 0 ? [idx, idx + m.length] : null });
  }
  return { markets, unmatched: null };
}

// 结构化“不带 X 商标”“X 代工不打标志”等使用说明。
// 注意：此时 mention id 尚未按最终跨度重排，故只记录名称，id 在重排后解析。
function parseUsageCues(text) {
  const cues = [];
  const re1 = new RegExp(
    `不带(?<mark>${HAN_NAME}|${LATIN_NAME})?商标的?(?<goods>[一-鿿A-Za-z]{2,12})`, 'gd',
  );
  for (const m of text.matchAll(re1)) {
    cues.push({
      code: 'without-trademark-on-goods',
      mark: m.groups.mark ?? null,
      markSpan: m.indices.groups.mark ?? null,
      goods: m.groups.goods,
      goodsSpan: m.indices.groups.goods ?? null,
      brandUse: false,
      quote: m[0],
    });
  }
  const re2 = /(?<goods>[一-鿿]{2,8})代工不打(?<anaphor>这个标志|该标志|商标)/gd;
  for (const m of text.matchAll(re2)) {
    cues.push({
      code: 'oem-no-mark-anaphor',
      goods: m.groups.goods,
      goodsSpan: m.indices.groups.goods ?? null,
      anaphor: m.groups.anaphor,
      resolvedMentionId: null,
      mark: null,
      brandUse: false,
      quote: m[0],
    });
  }
  const re3 = /(?<term>[A-Z][A-Za-z]+(?:\s+[A-Za-z]+){0,4}?)\s+is only a material term/gd;
  for (const m of text.matchAll(re3)) {
    cues.push({
      code: 'material-term-statement',
      term: m.groups.term,
      termSpan: m.indices.groups.term ?? null,
      brandUse: false,
      quote: m[0],
    });
  }
  return cues;
}

export function extractLetter(row, options = {}) {
  const text = row.text ?? '';
  const questions = [];
  const mentions = [];
  const seenSpans = new Set();

  const addMatch = (rule, m, roleOverride) => {
    const groupName = rule.group ?? 'name';
    const span = spanOf(m, groupName);
    const raw = m.groups[groupName];
    let name = raw.trim();
    // 修正修剪后的跨度
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    span[0] += lead;
    span[1] -= trail;
    name = raw.trim();
    const key = `${roleOverride ?? rule.role}:${span[0]}:${span[1]}`;
    if (seenSpans.has(key)) return null;
    seenSpans.add(key);
    const mention = {
      id: `${row.id}-M${mentions.length + 1}`,
      text: name,
      span,
      role: roleOverride ?? rule.role,
      roleLabel: ROLE_LABELS[roleOverride ?? rule.role],
      rule: rule.id,
      quote: text.slice(Math.max(0, span[0] - 6), Math.min(text.length, span[1] + 8)),
      searchable: !['generic'].includes(roleOverride ?? rule.role),
      filingIntent: (roleOverride ?? rule.role) === 'comparison' ? false : null,
      occurrences: [{ span, text: name }],
    };
    mentions.push(mention);
    return mention;
  };

  const rules = [...ZH_NAME_RULES, ...EN_NAME_RULES];
  for (const rule of rules) {
    for (const m of text.matchAll(new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g'))) {
      addMatch(rule, m);
    }
  }
  for (const rule of GENERIC_RULES) {
    for (const m of text.matchAll(new RegExp(rule.re.source, rule.re.flags))) {
      addMatch(rule, m, 'generic');
    }
  }

  // “但不申请它”绑定到比较标志。
  if (/但不申请(?:它|该标志|此标志)?/.test(text)) {
    const cmp = mentions.find(m => m.role === 'comparison');
    if (cmp) {
      cmp.filingIntent = false;
      cmp.dispositionCue = '来函明示不申请该比较标志';
    }
  }

  // 使用说明里重复出现的品牌名并入既有 mention 的 occurrences。
  const cues = parseUsageCues(text);

  mentions.sort((a, b) => a.span[0] - b.span[0]);
  mentions.forEach((m, i) => { m.id = `${row.id}-M${i + 1}`; });

  // id 重排后再解析“这个标志”的先行词（取第一个实际使用名称）。
  const actual = mentions.find(m => m.role === 'actual');
  for (const cue of cues) {
    if (cue.code === 'oem-no-mark-anaphor' && actual) {
      cue.resolvedMentionId = actual.id;
      cue.mark = actual.text;
    }
    if (cue.mark) {
      const hit = mentions.find(m => m.text === cue.mark);
      if (hit && cue.markSpan) hit.occurrences.push({ span: cue.markSpan, text: cue.mark, via: cue.code });
    }
  }

  const goods = scanGoods(text);
  const { markets, unmatched } = parseMarkets(row, options.knownMarkets);
  if (unmatched) {
    questions.push({
      code: 'unparsed-market',
      text: `市场字段中“${unmatched}”无法对应已知市场，需人工确认，不能按顿号静默拆分。`,
    });
  }
  if (markets.length === 0) {
    questions.push({ code: 'no-market', text: '未从来函市场字段识别出任何已知市场。' });
  }

  const tradeMatch = (row.client ?? '').match(CLIENT_TRADE_SUFFIX);
  const clientTradeTerm = tradeMatch ? tradeMatch[1] : null;
  if (clientTradeTerm && goods.length === 0) {
    questions.push({
      code: 'client-name-trade-term',
      text: `客户名称含行业词“${clientTradeTerm}”，但正文未说明商品/服务，需核实实际经营范围，不能直接按公司名定类。`,
      source: { field: 'client', client: row.client },
    });
  }
  if (!goods.some(g => g.brandUse)) {
    // 没有可作为主营商品的正面表述时提示，但不阻断。
    if (goods.length === 0) {
      questions.push({ code: 'no-goods', text: '来函未识别出商品/服务，需向客户索取具体清单。' });
    }
  }

  return {
    id: row.id,
    client: row.client,
    language: row.language,
    source: { file: '来函.json', id: row.id },
    markets,
    mentions,
    goods,
    cues,
    clientTradeTerm,
    questions,
  };
}

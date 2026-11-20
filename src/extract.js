import { analyzeName, splitLatinWords } from './names.js';

// 来函名称抽取：先按分句找语气线索（现用标、简称、参考、仅作说明……），
// 再在分句内切出汉字/拉丁片段。抽取结果只是候选，保留原文范围供复核。

const CLAUSE_BREAK = /[，。；;！？!?\n]|(?<=[.!?])\s+/gu;

// 线索按角色归类；同一位置重叠时，靠前的角色优先。
const CUES = [
  { role: 'actual', pattern: /现用标(?:是|为|：|:)?/gu },
  { role: 'actual', pattern: /(?:拟|打算|计划)(?:申请|使用|注册)(?:的)?(?:标|标志|名称|商标)?(?:是|为|：|:)?/gu },
  { role: 'actual', pattern: /申请(?:的)?(?:标|标志|名称|商标)(?:是|为|：|:)?/gu },
  { role: 'actual', pattern: /(?:the\s+)?mark\s+is\s+/giu },
  { role: 'actual', pattern: /(?:our|the)\s+(?:proposed\s+)?(?:mark|brand)\s+(?:is|will\s+be)\s+/giu },

  { role: 'alias', pattern: /(?:本公司|公司)简称(?:是|为|：|:)?/gu },
  { role: 'alias', pattern: /简称(?:是|为|：|:)?/gu },
  { role: 'alias', pattern: /(?:又称|亦称|别名)(?:是|为|：|:)?/gu },
  { role: 'alias', pattern: /(?:也|还)(?:考虑|可写作|写作|使用)(?:英文|中文|拉丁)?/gu },
  { role: 'alias', pattern: /(?:英文|拉丁)(?:写法|名称|名|是|为|：|:)?/gu },

  { role: 'comparative', pattern: /参考(?:同行)?(?:的)?/gu },
  { role: 'comparative', pattern: /similar\s+to\s+/giu },
  { role: 'comparative', pattern: /reference\s+to\s+/giu },

  // 明确不申请：该标志不进入申请范围。
  { role: 'excluded', pattern: /不(?:申请|注册|使用)(?:它|此标志|该标志|这个标志)?/gu },
  { role: 'excluded', pattern: /not\s+(?:seeking|applying\s+for)(?:\s+it)?/giu },

  // 商品不承载标志：供货类别存在，但不是标志使用。
  { role: 'outside-use', pattern: /不(?:打|带|含|贴|印)(?:这个|该|此)?(?:标志|商标)?/gu },
  { role: 'outside-use', pattern: /(?:代工|贴牌)(?:生产)?/gu },
  { role: 'outside-use', pattern: /without\s+(?:the\s+)?(?:mark|brand)/giu },
  { role: 'outside-use', pattern: /does\s+not\s+bear/giu },

  { role: 'descriptive', pattern: /仅(?:供|是|为|属)(?:是)?/gu },
  { role: 'descriptive', pattern: /只是(?:材料|品类|通用|行业)?/gu },
  { role: 'descriptive', pattern: /(?:材料|品类|通用|行业)(?:说明|术语|词|名称)/gu },
  { role: 'descriptive', pattern: /(?:is|as)\s+only\s+(?:a|an)\s+/giu },
  { role: 'descriptive', pattern: /only\s+(?:a|an)\s+/giu },
  { role: 'descriptive', pattern: /material\s+term/giu },

  // 指定商品/服务。
  { role: 'goods', pattern: /\bfor\s+(?=[a-z])/gu },
  { role: 'goods', pattern: /(?:做|供|生产|销售|经营|从事|提供|制造|代工)(?:于|给)?/gu }
];

// 分句内的谓语与虚词把汉字串切开，避免把“雨杉做滴灌配件”整串当成名称。
const PRODUCTION_VERBS = ['代工', '加工', '生产', '销售', '经营', '从事', '提供', '制造', '做', '供'];
const HAN_BOUNDARIES = [
  ...PRODUCTION_VERBS,
  '是', '为', '用', '打', '有', '在', '现', '也', '但', '却',
  '的', '了', '及', '和', '与', '或', '它', '这', '该', '此', '不带', '不含',
  '申请', '注册', '使用', '考虑', '参考', '包括', '属于', '带',
  '商标', '标志', '品牌'
].sort((a, b) => b.length - a.length);

const STOP_WORDS = new Set([
  '我', '我们', '你', '您', '他', '她', '本公司', '公司', '同行', '英文', '中文',
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'for', 'to', 'of', 'in',
  'on', 'we', 'our', 'it', 'its', 'but', 'only', 'as', 'also', 'this', 'that',
  'be', 'will', 'not', 'with', 'seeking', 'applying', 'mark', 'brand', 'material', 'term'
]);

const GENERIC_TERMS = /^(?:这|该|此)?个?(?:标志|商标|品牌|名称|标|词|术语|说明|称呼|写法)$/u;

const ROLE_PRIORITY = ['actual', 'alias', 'excluded', 'outside-use', 'comparative', 'descriptive', 'goods'];

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function findCues(clause) {
  const found = [];
  for (const cue of CUES) {
    cue.pattern.lastIndex = 0;
    let match;
    while ((match = cue.pattern.exec(clause)) !== null) {
      if (!match[0]) {
        cue.pattern.lastIndex += 1;
        continue;
      }
      found.push({
        role: cue.role,
        text: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }
  found.sort((a, b) =>
    a.start - b.start ||
    b.end - a.end ||
    ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));
  const kept = [];
  for (const cue of found) {
    if (kept.some(other => overlaps(cue, other))) continue;
    kept.push(cue);
  }
  return kept;
}

function maskCues(clause, cues) {
  const chars = [...clause];
  for (const cue of cues) {
    for (let index = cue.start; index < cue.end; index += 1) chars[index] = ' ';
  }
  return chars.join('');
}

function splitHanRun(atom) {
  const pieces = [];
  let start = 0;
  let buffer = '';
  let previousBoundary = null;
  const flush = end => {
    if (buffer) {
      pieces.push({
        text: buffer,
        start: atom.start + start,
        end: atom.start + end,
        previousBoundary
      });
    }
    buffer = '';
  };
  for (let index = 0; index < atom.text.length;) {
    const boundary = HAN_BOUNDARIES.find(word => atom.text.startsWith(word, index));
    if (boundary) {
      flush(index);
      previousBoundary = boundary;
      start = index + boundary.length;
      index += boundary.length;
    } else {
      if (!buffer) start = index;
      buffer += atom.text[index];
      index += 1;
    }
  }
  flush(atom.text.length);
  return pieces;
}

function tokenize(masked) {
  const tokens = [];
  const pattern = /(\p{Script=Han}+)|([A-Za-z][A-Za-z'’\-]*)|(\s+)|([^\s])/gu;
  let match;
  while ((match = pattern.exec(masked)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (match[1]) {
      for (const piece of splitHanRun({ text: match[0], start, end })) {
        tokens.push({ ...piece, type: 'han' });
      }
    } else if (match[2]) {
      tokens.push({ text: match[0], start, end, type: 'latin', previousBoundary: null });
    }
  }
  return tokens;
}

function roleFor(token, cues, cueIndex) {
  const preceding = cues.filter(cue => cue.end <= token.start).at(-1);
  const following = cues.filter(cue => cue.start >= token.end);
  const exclusionAfter = following.find(cue =>
    cue.role === 'excluded' || cue.role === 'outside-use' || cue.role === 'descriptive');

  if (preceding) {
    // “不带雨杉商标的塑料套管”：标志出现处仍是排除用法，而「的」之后
    // 的商品属于不承载标志的供货说明。
    if (preceding.role === 'outside-use' && token.previousBoundary === '的') {
      return {
        role: 'goods',
        cue: preceding,
        basis: `不承载标志：${preceding.text}`,
        markAbsent: true,
        cueIndex: cueIndex(preceding)
      };
    }
    const outcome = {
      role: preceding.role,
      cue: preceding,
      basis: preceding.text,
      cueIndex: cueIndex(preceding)
    };
    // “参考同行的 YUSHAN，但不申请它”：保留“比较”角色，同时记下排除。
    if (preceding.role === 'comparative' &&
        cues.some(cue => cue.role === 'excluded' && cue.start >= token.start)) {
      outcome.alsoExcluded = true;
    }
    return outcome;
  }
  if (exclusionAfter) {
    // 名词出现在否定/说明之后或之前，都属于被说明对象。
    return {
      role: exclusionAfter.role,
      cue: exclusionAfter,
      basis: exclusionAfter.text,
      beforeCue: true,
      cueIndex: cueIndex(exclusionAfter)
    };
  }
  if (token.previousBoundary && PRODUCTION_VERBS.includes(token.previousBoundary)) {
    return { role: 'goods', cue: null, basis: token.previousBoundary, cueIndex: -1 };
  }
  return { role: 'unmarked', cue: null, basis: null, cueIndex: -1 };
}

function isNoise(token) {
  const text = token.text.trim();
  if (!text) return true;
  if (GENERIC_TERMS.test(text)) return true;
  if (token.type === 'han' && STOP_WORDS.has(text)) return true;
  if (token.type === 'latin' && STOP_WORDS.has(text.toLowerCase())) return true;
  return false;
}

/**
 * 抽取一条来函的名称、商品说明与比较性提及。
 * 返回 { clauses, mentions }，mention.role 属于
 * actual | alias | comparative | excluded | outside-use | descriptive | goods | unmarked。
 * mention.range 是原文中的 UTF-16 起止位置，用于回查。
 */
export function extractMentions(text) {
  const clauses = [];
  const mentions = [];
  let clauseStart = 0;
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    clauses.push({ start: clauseStart, end: match.index });
    clauseStart = match.index + match[0].length;
  }
  if (clauseStart < text.length) clauses.push({ start: clauseStart, end: text.length });

  for (const [clauseIndex, clause] of clauses.entries()) {
    const raw = text.slice(clause.start, clause.end);
    if (!raw.trim()) continue;
    const cues = findCues(raw);
    const masked = maskCues(raw, cues);
    const tokens = tokenize(masked)
      .filter(token => !isNoise(token))
      .map(token => ({
        ...token,
        ...roleFor(token, cues, cue => cues.indexOf(cue))
      }));

    const annotated = mergeLatinRuns(tokens, raw);
    // “不带雨杉商标的塑料套管”：紧跟「商标/标志」的写法是被否定的标志，
    // 不是商品本身。
    for (const token of annotated) {
      if (token.role !== 'outside-use') continue;
      const after = raw.slice(token.end).replace(/^\s*/, '');
      if (/^(?:商标|标志|品牌)/u.test(after)) {
        token.role = 'excluded';
        token.markAbsent = true;
        token.basis = '不带该标志';
      }
    }
    // 把“不带某标志的 X 商品”接回该标志，便于在候选中注明使用范围。
    for (const [index, token] of annotated.entries()) {
      if (!token.markAbsent) continue;
      for (let back = index - 1; back >= 0; back -= 1) {
        if (annotated[back].markAbsent && annotated[back].role !== 'goods') {
          token.absentMark = annotated[back].text;
          token.absentMarkRange = [
            clause.start + annotated[back].start,
            clause.start + annotated[back].end
          ];
          break;
        }
      }
    }
    // 下一分句开头的排除说明，如“参考同行的 YUSHAN，但不申请它”。
    const nextClause = clauses[clauseIndex + 1]
      ? text.slice(clauses[clauseIndex + 1].start, clauses[clauseIndex + 1].end)
      : '';
    const exclusionFollows = /^\s*(?:但|却|而)?\s*不(?:申请|注册|使用)/u.test(nextClause);

    for (const [tokenIndex, token] of annotated.entries()) {
      let role = token.role;
      let inferred = null;
      // 句首主语＋经营动词，如“雨杉做滴灌配件”，推定为拟用名称但仍标为需复核。
      if (role === 'unmarked' && tokenIndex === 0 && clauseIndex === 0 &&
          annotated[tokenIndex + 1]?.role === 'goods') {
        role = 'actual';
        inferred = '经营动词前的主语';
      }
      mentions.push({
        text: token.text,
        clause: raw.trim(),
        clauseRange: [clause.start, clause.end],
        range: [clause.start + token.start, clause.start + token.end],
        role,
        basis: token.basis,
        beforeCue: Boolean(token.beforeCue),
        markAbsent: Boolean(token.markAbsent),
        absentMark: token.absentMark ?? null,
        absentMarkRange: token.absentMarkRange ?? null,
        alsoExcluded: Boolean(token.alsoExcluded) ||
          (role === 'comparative' && exclusionFollows),
        inferred,
        type: token.type,
        analysis: analyzeName(token.text),
        latinWords: token.type === 'latin' ? splitLatinWords(token.text) : []
      });
    }
  }
  return { clauses, mentions };
}

function mergeLatinRuns(tokens, raw) {
  const merged = [];
  for (let index = 0; index < tokens.length; index += 1) {
    let token = { ...tokens[index] };
    while (true) {
      const next = tokens[index + 1];
      const gap = next ? raw.slice(token.end, next.start) : null;
      if (next && next.type === 'latin' && token.type === 'latin' &&
          next.role === token.role && gap === ' ') {
        token.text = `${token.text} ${next.text}`;
        token.end = next.end;
        index += 1;
      } else break;
    }
    merged.push(token);
  }
  return merged;
}

/** 市场字段可能用顿号、逗号或斜杠分隔。 */
export function splitMarkets(value) {
  return value
    .split(/[、,，/;；|]+/u)
    .map(part => part.trim())
    .filter(Boolean);
}

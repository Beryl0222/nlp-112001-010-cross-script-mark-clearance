// 语言证据工具：拉丁写法归一、拼音/音译键、中文近形、中英意译线索。
// 全部为本地可扩充的小词表，只服务合成商标资料；不依赖网络或第三方包。

// 资料用字的无声调拼音（多音字列出常见读法）。
const PINYIN = {
  不: ['bu'], 业: ['ye'], 个: ['ge'], 也: ['ye'], 仅: ['jin'],
  代: ['dai'], 件: ['jian'], 传: ['chuan', 'zhuan'], 但: ['dan'],
  体: ['ti'], 供: ['gong'], 做: ['zuo'], 公: ['gong'], 具: ['ju'],
  册: ['ce'], 划: ['hua'], 务: ['wu'], 包: ['bao'], 区: ['qu', 'ou'],
  参: ['can', 'shen'], 及: ['ji'], 司: ['si'], 同: ['tong'], 品: ['pin'],
  商: ['shang'], 器: ['qi'], 园: ['yuan'], 头: ['tou'], 套: ['tao'],
  字: ['zi'], 它: ['ta'], 山: ['shan'], 岛: ['dao'], 岸: ['an'],
  工: ['gong'], 志: ['zhi'], 打: ['da'], 括: ['kuo'], 接: ['jie'],
  文: ['wen'], 明: ['ming'], 是: ['shi'], 景: ['jing'], 服: ['fu'],
  木: ['mu'], 本: ['ben'], 杉: ['shan', 'sha'], 松: ['song'],
  标: ['biao'], 样: ['yang'], 河: ['he'], 注: ['zhu'], 流: ['liu'],
  海: ['hai'], 港: ['gang'], 滴: ['di'], 灌: ['guan'], 现: ['xian'],
  用: ['yong'], 申: ['shen'], 的: ['de', 'di'], 称: ['cheng', 'chen'],
  简: ['jian'], 管: ['guan'], 类: ['lei'], 纹: ['wen'], 考: ['kao'],
  艺: ['yi'], 英: ['ying'], 虑: ['lv'], 行: ['xing', 'hang'],
  观: ['guan'], 规: ['gui'], 计: ['ji'], 设: ['she'], 说: ['shuo', 'shui'],
  请: ['qing'], 软: ['ruan'], 输: ['shu'], 这: ['zhe'], 配: ['pei'],
  锋: ['feng'], 阀: ['fa'], 雨: ['yu'], 零: ['ling'], 青: ['qing'],
  // 常见近形/测试补充字
  衫: ['shan'], 己: ['ji'], 已: ['yi'], 巳: ['si'], 土: ['tu'],
  士: ['shi'], 未: ['wei'], 末: ['mo'], 日: ['ri'], 曰: ['yue'],
  峰: ['feng'], 两: ['liang'],
};

// 公认/整理过的近形字组（顾问可继续补充）。
const CONFUSABLE_GROUPS = [
  ['杉', '衫'],
  ['己', '已', '巳'],
  ['土', '士'],
  ['未', '末'],
  ['日', '曰'],
  ['戊', '戌', '戍'],
  ['锋', '峰'],
];

// 部件分解线索（只列名称与近形核查用到的字），用于说明“近形”依据。
const COMPONENTS = {
  杉: ['木', '彡'],
  衫: ['衤', '彡'],
  锋: ['钅', '夆'],
  峰: ['山', '夆'],
  河: ['氵', '可'],
  海: ['氵', '每'],
};

// 单字英文释义线索，用于跨文字意译（如 雨杉 ↔ Rain Cedar）。
const CHAR_GLOSS = {
  雨: ['rain'],
  杉: ['cedar', 'fir'],
  山: ['mountain', 'hill'],
  海: ['sea', 'ocean'],
  港: ['harbor', 'port'],
  河: ['river'],
  松: ['pine'],
  青: ['blue', 'green'],
  锋: ['edge', 'blade'],
  软: ['soft'],
  管: ['tube', 'pipe'],
  木: ['wood', 'timber'],
  纹: ['grain', 'pattern'],
  景: ['view', 'scenery'],
};

// 多字词的英文对应，优先于单字释义。
const WORD_GLOSS = [
  ['套管', ['sleeve', 'casing', 'tubing']],
  ['软管', ['hose', 'tubing']],
  ['塑料管', ['plastic tube', 'plastic tubing']],
  ['景观设计', ['landscape design', 'landscaping']],
  ['景观规划', ['landscape planning', 'landscape plan']],
  ['景观', ['landscape']],
  ['滴灌', ['drip irrigation', 'drip']],
];

const HAN_RE = /[一-鿿]/;

export function hasHan(s) {
  return HAN_RE.test(String(s ?? ''));
}

// 拉丁写法归一：大写、去空格/连字符/撇点等，使 Yu-Shan、Yushan、YU SHAN 同键。
export function latinKey(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function cartesian(arrays) {
  return arrays.reduce(
    (acc, curr) => acc.flatMap(a => curr.map(c => [...a, c])),
    [[]],
  );
}

// 一个词所有可能的无声调拼音连写键（多音字给出全部组合）。
export function pinyinKeys(word) {
  const chars = [...String(word ?? '')].filter(ch => HAN_RE.test(ch));
  if (chars.length === 0) return [];
  const readings = chars.map(ch => PINYIN[ch] ?? []);
  if (readings.some(r => r.length === 0)) return []; // 有未收录字，不强行给证据
  return cartesian(readings).map(seq => seq.join(''));
}

// 拉丁词的读音键：去分隔符后小写（合成资料中的 Yu Shan/YUSHAN 可直接对应拼音）。
export function latinSoundKey(word) {
  const k = latinKey(word);
  return k ? [k.toLowerCase()] : [];
}

// 任意名称的“读音键”：中文给拼音，拉丁给归一拼写。
export function soundKeys(word) {
  const s = String(word ?? '');
  if (hasHan(s)) return pinyinKeys(s);
  return latinSoundKey(s);
}

export function pinyinDisplay(word) {
  const chars = [...String(word ?? '')].filter(ch => HAN_RE.test(ch));
  return chars.map(ch => (PINYIN[ch]?.[0] ? `${ch}(${PINYIN[ch][0]})` : ch)).join(' ');
}

function confusablePartner(a, b) {
  for (const group of CONFUSABLE_GROUPS) {
    if (group.includes(a) && group.includes(b) && a !== b) return group;
  }
  return null;
}

// 单字字形相似度与理由。
export function charFormEvidence(a, b) {
  if (a === b) return { score: 1, reason: '同字' };
  const group = confusablePartner(a, b);
  if (group) {
    return { score: 0.92, reason: `列入近形字组（${group.join('／')}）` };
  }
  const ca = COMPONENTS[a];
  const cb = COMPONENTS[b];
  if (ca && cb) {
    const shared = ca.filter(x => cb.includes(x));
    if (shared.length > 0) {
      return { score: 0.62, reason: `共有字形部件 ${shared.join('、')}` };
    }
  }
  return { score: 0, reason: null };
}

// 多字名称的近形判断：等长、逐位对齐，允许一处近形字替换。
export function nearFormEvidence(a, b) {
  const sa = [...String(a ?? '')];
  const sb = [...String(b ?? '')];
  if (sa.length < 2 || sa.length !== sb.length) return null;
  if (sa.join('') === sb.join('')) return null;
  let diffs = 0;
  let weakest = 1;
  const reasons = [];
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] === sb[i]) continue;
    diffs += 1;
    const ev = charFormEvidence(sa[i], sb[i]);
    if (ev.score === 0) return null;
    weakest = Math.min(weakest, ev.score);
    reasons.push(`第 ${i + 1} 字“${sa[i]}／${sb[i]}”${ev.reason}`);
  }
  if (diffs === 0 || diffs > 2) return null;
  if (diffs === 1 && weakest >= 0.6) {
    return {
      strength: weakest >= 0.9 ? 'strong' : 'medium',
      detail: `中文近形（一字之差）：${reasons.join('；')}`,
      score: weakest,
    };
  }
  if (diffs === 2 && weakest >= 0.9) {
    return { strength: 'medium', detail: `两处近形替换：${reasons.join('；')}`, score: weakest };
  }
  return null;
}

// 把中文词切成“最长词释义 + 单字释义”的英文词集合（保留来源映射）。
export function glossEntries(word) {
  const s = String(word ?? '');
  const entries = [];
  let i = 0;
  while (i < s.length) {
    let matched = null;
    for (const [zh, ens] of WORD_GLOSS) {
      if (s.startsWith(zh, i) && (!matched || zh.length > matched[0].length)) {
        matched = [zh, ens];
      }
    }
    if (matched) {
      for (const en of matched[1]) {
        for (const tok of en.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
          entries.push({ token: tok, source: matched[0] });
        }
      }
      i += matched[0].length;
      continue;
    }
    const ch = s[i];
    if (CHAR_GLOSS[ch]) {
      for (const en of CHAR_GLOSS[ch]) {
        for (const tok of en.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
          entries.push({ token: tok, source: ch });
        }
      }
    }
    i += 1;
  }
  // 拉丁词本身
  for (const tok of s.toLowerCase().split(/[^a-z]+/).filter(t => /[a-z]/.test(t))) {
    entries.push({ token: tok, source: tok });
  }
  return entries;
}

// 逐字/逐词意译全键，如 雨杉 -> raincedar。
export function calqueKeys(word) {
  const s = String(word ?? '');
  if (!hasHan(s)) {
    const k = latinKey(s).toLowerCase();
    return k ? [k] : [];
  }
  const charGlosses = [...s].map(ch => CHAR_GLOSS[ch] ?? []);
  if (charGlosses.some(g => g.length === 0)) return [];
  return cartesian(charGlosses).map(seq => seq.join(''));
}

// 共有汉字（弱证据），忽略极通用的“大、小”等（当前词表未涉及）。
export function sharedHanEvidence(a, b) {
  const ca = new Set([...String(a ?? '')].filter(ch => HAN_RE.test(ch)));
  const cb = new Set([...String(b ?? '')].filter(ch => HAN_RE.test(ch)));
  const shared = [...ca].filter(ch => cb.has(ch));
  if (shared.length === 0) return null;
  return {
    strength: 'weak',
    detail: `共有汉字：${shared.join('、')}（单独不足以认定近似）`,
    chars: shared,
  };
}

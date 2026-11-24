// 名称 × 商标档案检索：输出每条命中的具体语言证据，而不是只给一个相似度分数。

import {
  hasHan, latinKey, soundKeys, nearFormEvidence,
  calqueKeys, glossEntries, sharedHanEvidence,
} from './lexicon.js';

function exactEvidence(a, b) {
  if (a === b) return { code: 'exact', strength: 'strong', label: '原样一致', detail: `“${a}”与“${b}”完全相同` };
  return null;
}

function latinVariantEvidence(a, b) {
  if (hasHan(a) || hasHan(b)) return null;
  const ka = latinKey(a);
  const kb = latinKey(b);
  if (ka && ka === kb && a !== b) {
    return {
      code: 'latin-variant',
      strength: 'strong',
      label: '拉丁写法变体',
      detail: `忽略大小写、空格与连字符后均为 ${ka}（${a} ↔ ${b}）`,
      normalized: ka,
    };
  }
  return null;
}

function soundEvidence(a, b) {
  const ka = soundKeys(a);
  const kb = soundKeys(b);
  if (ka.length === 0 || kb.length === 0) return null;
  const common = ka.find(k => kb.includes(k));
  if (!common) return null;
  const crossScript = hasHan(a) !== hasHan(b);
  if (!crossScript && !hasHan(a)) return null; // 拉丁之间交给 latin-variant
  return {
    code: crossScript ? 'transliteration' : 'homophone',
    strength: 'strong',
    label: crossScript ? '跨文字音译' : '中文同音/谐音',
    detail: crossScript
      ? `读音键 ${common} 对应：${a} ↔ ${b}（无声调、多音字取可用读法）`
      : `拼音相同（无声调）：${common}，${a} ↔ ${b}`,
    soundKey: common,
  };
}

function nearForm(a, b) {
  if (!hasHan(a) || !hasHan(b)) return null;
  const ev = nearFormEvidence(a, b);
  if (!ev) return null;
  return { code: 'near-form', strength: ev.strength, label: '中文近形', detail: ev.detail };
}

function translationEvidence(a, b) {
  const crossScript = hasHan(a) !== hasHan(b);
  // 全键意译：雨杉 -> raincedar ↔ RainCedar（仅在跨文字时作为独立证据，
  // 避免拉丁词与自身的拉丁键重复“意译”）。
  if (crossScript) {
    const ca = calqueKeys(a);
    const cb = calqueKeys(b);
    const full = ca.find(k => cb.includes(k) && k.length >= 4);
    if (full) {
      return {
        code: 'calque',
        strength: 'medium',
        label: '逐字意译对应',
        detail: `逐字义译连写均为 ${full}：${a} ↔ ${b}（可能是有意的中英对应，需人工确认）`,
        calqueKey: full,
      };
    }
  }
  // 词级释义交集，要求至少一侧是汉字来源，避免普通拉丁同词被重复算作翻译。
  const ea = glossEntries(a);
  const eb = glossEntries(b);
  const details = [];
  for (const x of ea) {
    for (const y of eb) {
      if (x.token === y.token && x.source !== y.source) {
        const hanSide = [x.source, y.source].find(s => /[一-鿿]/.test(s));
        const latinSide = [x.source, y.source].find(s => /[a-z]/i.test(s));
        if (hanSide && latinSide && hanSide !== latinSide) {
          const d = `${hanSide}=${latinSide}→${x.token}`;
          if (!details.includes(d)) details.push(d);
        }
      }
    }
  }
  if (details.length > 0) {
    return {
      code: 'translation-word',
      strength: 'weak',
      label: '部分字义/释义对应',
      detail: details.join('；'),
    };
  }
  return null;
}

function sharedWordEvidence(a, b) {
  if (hasHan(a) || hasHan(b)) {
    const ev = sharedHanEvidence(a, b);
    if (ev) return { code: 'shared-han', strength: 'weak', label: '共有汉字', detail: ev.detail };
    return null;
  }
  const wa = new Set(a.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2));
  const wb = b.toLowerCase().split(/[^a-z]+/).filter(w => wa.has(w));
  if (wb.length > 0) {
    return {
      code: 'shared-word',
      strength: 'weak',
      label: '共有拉丁词',
      detail: `共有词：${[...new Set(wb)].join('、')}（单独不足以认定近似）`,
    };
  }
  return null;
}

export function compareSurfaces(mentionText, archiveSurface) {
  const a = mentionText.trim();
  const b = String(archiveSurface ?? '').trim();
  if (!a || !b) return [];
  const exact = exactEvidence(a, b);
  // 完全相同时只保留原样证据，避免“与自身拼音/共有字”之类冗余说明。
  if (exact) return [exact];
  const evidences = [
    latinVariantEvidence(a, b),
    soundEvidence(a, b),
    nearForm(a, b),
    translationEvidence(a, b),
    sharedWordEvidence(a, b),
  ].filter(Boolean);
  // 去重（同一 code+detail）
  const seen = new Set();
  return evidences.filter(e => {
    const k = `${e.code}:${e.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const STRENGTH_RANK = { strong: 3, medium: 2, weak: 1 };

export function rollupConfidence(surfaceMatches) {
  let best = 0;
  for (const sm of surfaceMatches) {
    for (const e of sm.evidences) best = Math.max(best, STRENGTH_RANK[e.strength] ?? 0);
  }
  if (best >= 3) return '高';
  if (best === 2) return '中';
  if (best === 1) return '低';
  return null;
}

// 在全部商标档案中检索一个名称。
export function searchTrademarks(mentionText, trademarks) {
  const hits = [];
  for (const tm of trademarks) {
    const surfaceMatches = [];
    for (const field of ['label', 'variant']) {
      const value = tm[field];
      if (typeof value !== 'string' || value.trim() === '') continue;
      const evidences = compareSurfaces(mentionText, value);
      if (evidences.length > 0) surfaceMatches.push({ field, value, evidences });
    }
    if (surfaceMatches.length === 0) continue;
    hits.push({
      trademarkId: tm.id,
      label: tm.label,
      variant: tm.variant,
      nature: tm.nature,
      market: tm.market,
      category: tm.category,
      confidence: rollupConfidence(surfaceMatches),
      surfaceMatches,
      evidences: surfaceMatches.flatMap(sm =>
        sm.evidences.map(e => ({ ...e, against: sm.value, field: sm.field }))),
    });
  }
  const confRank = { 高: 3, 中: 2, 低: 1 };
  hits.sort((a, b) =>
    (confRank[b.confidence] ?? 0) - (confRank[a.confidence] ?? 0)
    || a.trademarkId.localeCompare(b.trademarkId));
  return hits;
}

import {
  areNearForm,
  foldLatin,
  hanContainment,
  hanOf,
  latinSimilarity,
  normalizeName,
  translatedMeaning
} from './names.js';
import { romanizeHan } from './readings.js';

/**
 * 比较两个名称写法，返回命中类型、分数与证据。
 * kind：exact → near-form → homophone → transliteration → variant → translation → partial。
 * 命中只是检索线索，不构成相同或近似的正式判断。
 */
export function compareNames(leftText, rightText) {
  const left = clean(leftText);
  const right = clean(rightText);
  if (!left || !right) return miss();

  const leftLatin = foldLatin(left);
  const rightLatin = foldLatin(right);
  const leftHan = hanOf(left);
  const rightHan = hanOf(right);
  const leftIsLatinOnly = leftHan.length === 0 && leftLatin.length > 0;
  const rightIsLatinOnly = rightHan.length === 0 && rightLatin.length > 0;

  if (leftLatin && leftLatin === rightLatin &&
      (leftIsLatinOnly || rightIsLatinOnly || leftHan.length === 0)) {
    return {
      kind: 'exact',
      score: 1,
      evidence: [`拉丁写法折叠后相同：${leftLatin}`]
    };
  }
  if (leftHan.length && rightHan.length && leftHan.join('') === rightHan.join('')) {
    return {
      kind: 'exact',
      score: 1,
      evidence: [`汉字写法相同：${leftHan.join('')}`]
    };
  }

  const nearForm = nearFormEvidence(leftHan, rightHan);
  if (nearForm) return nearForm;

  const homophone = homophoneEvidence(leftHan, rightHan);
  if (homophone) return homophone;

  const transliteration = transliterationEvidence(left, right, {
    leftHan, rightHan, leftIsLatinOnly, rightIsLatinOnly
  });
  if (transliteration) return transliteration;

  if (leftLatin && rightLatin) {
    const score = latinSimilarity(left, right);
    if (score > 0) {
      return {
        kind: 'variant',
        score,
        evidence: [`拉丁拼写相近：${leftLatin} / ${rightLatin}，相似度 ${score.toFixed(2)}`]
      };
    }
  }

  const translation = translationEvidence(left, right, {
    leftHan, rightHan, leftIsLatinOnly, rightIsLatinOnly
  });
  if (translation) return translation;

  const containment = hanContainment(left, right);
  if (containment?.relation === 'contains' && containment.shorter.length >= 2) {
    return {
      kind: 'partial',
      score: 0.5,
      evidence: [`汉字部分重合：共同「${containment.shorter}」，完整写法为「${containment.longer}」`]
    };
  }

  return miss();
}

function clean(text) {
  return normalizeName(String(text ?? ''));
}

function miss() {
  return { kind: 'none', score: 0, evidence: [] };
}

function nearFormEvidence(leftHan, rightHan) {
  if (!leftHan.length || !rightHan.length || leftHan.length !== rightHan.length) return null;
  const differing = [];
  for (let index = 0; index < leftHan.length; index += 1) {
    const a = leftHan[index];
    const b = rightHan[index];
    if (a === b) continue;
    if (!areNearForm(a, b)) return null;
    differing.push([a, b]);
  }
  if (!differing.length) return null;
  return {
    kind: 'near-form',
    score: 0.8,
    evidence: [
      `中文近形：${differing.map(([a, b]) => `${a}≈${b}`).join('、')}`,
      `字位一致（${leftHan.length} 字），仅字形不同`
    ]
  };
}

function homophoneEvidence(leftHan, rightHan) {
  if (!leftHan.length || !rightHan.length || leftHan.length !== rightHan.length) return null;
  const leftReading = romanizeHan(leftHan.join(''));
  const rightReading = romanizeHan(rightHan.join(''));
  if (leftReading.unknown.length || rightReading.unknown.length) return null;
  if (!leftReading.text || leftReading.text !== rightReading.text) return null;
  const differing = [];
  for (let index = 0; index < leftHan.length; index += 1) {
    if (leftHan[index] !== rightHan[index]) differing.push([leftHan[index], rightHan[index]]);
  }
  if (!differing.length) return null;
  return {
    kind: 'homophone',
    score: 0.85,
    evidence: [
      `同音：${differing.map(([a, b]) => `${a}／${b}`).join('、')} 读音相同`,
      `整词读音均为 ${leftReading.text}`
    ]
  };
}

function transliterationEvidence(left, right, context) {
  const cases = [];
  const consider = (hanText, latinText, label) => {
    const hanOnly = hanOf(hanText).join('');
    const latin = foldLatin(latinText);
    if (!hanOnly || !latin) return;
    const reading = romanizeHan(hanOnly);
    if (reading.unknown.length || !reading.text) return;
    const score = latinSimilarity(reading.text, latin);
    if (!score) return;
    cases.push({
      score,
      evidence: [
        `音译：${hanOnly}（读音 ${reading.text}）与 ${latinText}（折叠 ${latin}）相似度 ${score.toFixed(2)}`,
        label
      ]
    });
  };
  if (context.leftHan.length && context.rightIsLatinOnly) {
    consider(left, right, '左侧为汉字、右侧为拉丁写法');
  }
  if (context.rightHan.length && context.leftIsLatinOnly) {
    consider(right, left, '右侧为汉字、左侧为拉丁写法');
  }
  if (!cases.length) return null;
  cases.sort((a, b) => b.score - a.score);
  return {
    kind: 'transliteration',
    score: cases[0].score,
    evidence: cases[0].evidence
  };
}

function translationEvidence(left, right, context) {
  const cases = [];
  if (context.leftHan.length && context.rightIsLatinOnly) {
    pushTranslation(left, right, '左侧汉字写法的字面义', cases);
  }
  if (context.rightHan.length && context.leftIsLatinOnly) {
    pushTranslation(right, left, '右侧汉字写法的字面义', cases);
  }
  if (!cases.length) return null;
  cases.sort((a, b) => b.score - a.score);
  return { kind: 'translation', score: cases[0].score, evidence: cases[0].evidence };
}

function pushTranslation(hanText, latinText, label, cases) {
  const meaning = translatedMeaning(hanText);
  if (!meaning.complete) return;
  const score = latinSimilarity(meaning.text, latinText);
  if (!score) return;
  cases.push({
    score,
    evidence: [`意译：${hanText} 的字面义 ${meaning.text} 与 ${latinText} 相近（相似度 ${score.toFixed(2)}）`, label]
  });
}

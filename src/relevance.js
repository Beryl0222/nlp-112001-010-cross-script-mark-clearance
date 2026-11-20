import { translatedMeaning } from './names.js';

const STOP_TOKENS = new Set([
  '包括', '以及', '及其', '其他', '相关', '用于', '属于', '一种', '以上',
  '仅供', '此类', '该类', '这类', '所有', '部分', '仅限'
]);

export function hanBigrams(text) {
  const han = [...String(text ?? '')].filter(char => /\p{Script=Han}/u.test(char)).join('');
  const grams = new Set();
  for (let index = 0; index + 1 < han.length; index += 1) {
    const gram = han.slice(index, index + 2);
    if (!STOP_TOKENS.has(gram)) grams.add(gram);
  }
  return grams;
}

export function latinWords(text) {
  return (String(text ?? '').match(/[A-Za-z]{4,}/g) ?? []).map(word => word.toLowerCase());
}

/**
 * 客户说明的商品服务与某类目释义之间的可复核关联。
 * 只使用字面重合与已收录的字词义项，不推断客户未说明的类别。
 */
export function categoryRelevance(goodsTexts, categoryText) {
  const evidence = [];
  const shared = new Set();

  const categoryHan = hanBigrams(categoryText);
  for (const goods of goodsTexts) {
    const hits = [...hanBigrams(goods)].filter(gram => categoryHan.has(gram));
    for (const hit of hits) shared.add(hit);
    if (hits.length) evidence.push(`「${goods}」与类目释义共用汉字「${hits.join('、')}」`);
  }

  const categoryWords = new Set(latinWords(categoryText));
  for (const goods of goodsTexts) {
    for (const word of latinWords(goods)) {
      if (categoryWords.has(word)) {
        shared.add(word);
        evidence.push(`「${goods}」与类目释义共用拉丁词 ${word}`);
      }
    }
  }

  const meaning = translatedMeaning(categoryText);
  if (meaning.complete) {
    for (const goods of goodsTexts) {
      for (const word of latinWords(goods)) {
        if (meaning.text.includes(word) && !shared.has(word)) {
          shared.add(word);
          evidence.push(
            `「${goods}」中的 ${word} 与类目「${categoryText}」的字面义 ${meaning.text} 对应`
          );
        }
      }
    }
  }

  return {
    relevant: evidence.length > 0,
    shared: [...shared],
    evidence
  };
}

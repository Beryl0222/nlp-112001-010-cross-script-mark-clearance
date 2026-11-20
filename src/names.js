import { romanizeHan } from './readings.js';

/** 只保留比较所需字符：汉字、拉丁字母、数字。 */
export function normalizeName(text) {
  return [...String(text ?? '')]
    .filter(char => /\p{Script=Han}|[A-Za-z0-9]/u.test(char))
    .join('');
}

/** 折叠拉丁写法：大小写、变音符、空格与常见分隔符不构成区别。 */
export function foldLatin(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\s'’._\-·]+/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const NUMERAL_LOOKALIKES = new Map([['0', 'o'], ['1', 'i'], ['5', 's'], ['3', 'e']]);

function bigrams(value) {
  const grams = new Set();
  for (let index = 0; index + 1 < value.length; index += 1) {
    const pair = value.slice(index, index + 2);
    grams.add(pair);
    const mapped = [...pair].map(char => NUMERAL_LOOKALIKES.get(char) ?? char).join('');
    if (mapped !== pair) grams.add(mapped);
  }
  return grams;
}

function diceCoefficient(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** 编辑距离，允许音译写法中的字母次序颠倒、增删。 */
export function editDistance(left, right) {
  const a = [...left];
  const b = [...right];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * 拉丁写法相似度（0–1）。短词要求更严格的阈值，避免四字母以内的
 * 无关品牌因一两个字母之差被判为同一写法。
 */
export function latinSimilarity(left, right) {
  const a = foldLatin(left);
  const b = foldLatin(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  const editScore = 1 - editDistance(a, b) / longest;
  const diceScore = diceCoefficient(a, b);
  const score = Math.max(editScore, diceScore);
  const threshold = longest <= 4 ? 0.8 : longest <= 6 ? 0.72 : 0.7;
  return score >= threshold ? score : 0;
}

// 只收录可逐字互换的常见近形组；不作部件猜测，避免把不同品牌算近。
const nearFormGroups = [
  ['杉', '松', '柏'], ['雨', '雪', '云', '两'], ['锋', '峰', '丰'],
  ['青', '清', '晴'], ['山', '仙'], ['滴', '摘'], ['管', '营'],
  ['纹', '文'], ['圆', '园'], ['蓝', '篮'], ['凤', '风'],
  ['龙', '尤'], ['达', '远'], ['华', '花'], ['美', '每'],
  ['新', '亲'], ['星', '晨'], ['泰', '秦'], ['海', '悔'], ['杉', '彬']
];

const nearFormIndex = new Map();
for (const group of nearFormGroups) {
  for (const char of group) {
    if (!nearFormIndex.has(char)) nearFormIndex.set(char, new Set());
    for (const other of group) {
      if (other !== char) nearFormIndex.get(char).add(other);
    }
  }
}

export function areNearForm(left, right) {
  return nearFormIndex.get(left)?.has(right) ?? false;
}

export function hanOf(text) {
  return [...String(text ?? '')].filter(char => /\p{Script=Han}/u.test(char));
}

export function hanContainment(leftText, rightText) {
  const a = hanOf(leftText).join('');
  const b = hanOf(rightText).join('');
  if (!a || !b) return null;
  if (a === b) return { relation: 'same', shorter: a, longer: a };
  if (a.includes(b)) return { relation: 'contains', shorter: b, longer: a };
  if (b.includes(a)) return { relation: 'contains', shorter: a, longer: b };
  return null;
}

export function splitLatinWords(text) {
  return (String(text ?? '').match(/[A-Za-z]+/g) ?? []).map(word => word.toLowerCase());
}

/** 名称的分析视图：汉字、拉丁词、拼音读音、未收字。 */
export function analyzeName(text) {
  const han = hanOf(text);
  const latinWords = splitLatinWords(text);
  const reading = han.length ? romanizeHan(han.join('')) : { text: '', unknown: [] };
  return {
    original: String(text ?? ''),
    han,
    latinWords,
    foldedLatin: foldLatin(text) || null,
    reading: reading.text || null,
    unknownHan: reading.unknown,
    scripts: {
      han: han.length > 0,
      latin: latinWords.length > 0
    }
  };
}

const semanticWords = {
  雨: 'rain', 杉: 'cedar', 松: 'pine', 柏: 'cypress', 雪: 'snow',
  山: 'mountain', 海: 'sea', 河: 'river', 岛: 'island', 港: 'harbor',
  青: 'green', 锋: 'edge', 蓝: 'blue', 红: 'red', 金: 'gold',
  星: 'star', 月: 'moon', 日: 'sun', 云: 'cloud', 风: 'wind', 凤: 'phoenix',
  龙: 'dragon', 花: 'flower', 木: 'wood', 林: 'forest', 纹: 'grain',
  光: 'light', 新: 'new', 华: 'china', 美: 'beauty', 泰: 'peace',
  软管: 'tubing', 套管: 'tubing', 管: 'tube', 滴灌: 'dripirrigation',
  配件: 'parts', 接头: 'fitting', 阀: 'valve', 园艺: 'horticulture',
  园林: 'garden', 景观: 'landscape', 设计: 'design', 规划: 'planning',
  塑料: 'plastic', 工业: 'industrial', 流体: 'fluid', 传输: 'transfer',
  商业: 'commercial', 服务: 'service', 商品: 'goods', 材料: 'material',
  建筑: 'building', 食品: 'food', 服装: 'clothing', 化妆: 'cosmetic',
  医药: 'medicine', 教育: 'education', 餐饮: 'catering', 旅游: 'travel',
  能源: 'energy', 环保: 'environmental', 电子: 'electronic', 机械: 'machinery',
  家具: 'furniture', 玩具: 'toy', 珠宝: 'jewelry', 钟表: 'watch',
  茶: 'tea', 咖啡: 'coffee', 糖: 'sugar', 果: 'fruit', 粮: 'grain',
  油: 'oil', 肉: 'meat', 奶: 'milk', 酒: 'wine', 件: 'piece',
  有: 'have', 限: 'limit', 科: 'science', 技: 'technology', 贸: 'trade',
  易: 'exchange', 农: 'agriculture', 五: 'five', 电: 'electric',
  子: 'child', 食: 'food', 装: 'pack', 化: 'transform', 妆: 'makeup',
  械: 'device', 医: 'medical', 药: 'drug', 教: 'teach', 育: 'nurture',
  餐: 'meal', 饮: 'drink', 酒: 'wine', 店: 'shop', 旅: 'travel',
  游: 'tour', 房: 'house', 地: 'land', 产: 'property', 建: 'build',
  筑: 'construct', 家: 'home', 灯: 'lamp', 玩: 'play', 媒: 'media',
  广: 'wide', 告: 'announce', 咨: 'consult', 询: 'inquire', 网: 'net',
  络: 'network', 硬: 'hard', 通: 'connect', 信: 'message', 汽: 'steam',
  车: 'vehicle', 能: 'energy', 源: 'source', 环: 'ring', 保: 'protect',
  纺: 'spin', 织: 'weave', 饰: 'decorate', 鞋: 'shoe', 帽: 'hat',
  箱: 'box', 珠: 'pearl', 宝: 'treasure', 钟: 'clock', 表: 'watch',
  眼: 'eye', 镜: 'lens', 蔬: 'vegetable', 机: 'machine', 天: 'sky',
  鑫: 'prosper', 盛: 'flourish', 达: 'reach', 和: 'harmony',
  丽: 'beautiful', 中: 'middle', 国: 'country', 亚: 'asia', 欧: 'europe',
  北: 'north', 京: 'capital', 上: 'up', 深: 'deep', 圳: 'ditch',
  杭: 'hang', 州: 'state', 苏: 'revive', 宁: 'peace', 波: 'wave',
  厦: 'mansion', 门: 'door', 台: 'platform', 湾: 'bay', 香: 'fragrant',
  澳: 'bay', 长: 'long', 重: 'heavy', 乐: 'joy', 藏: 'store',
  朝: 'dynasty', 西: 'west', 安: 'peace', 福: 'fortune', 湖: 'lake',
  南: 'south', 东: 'east', 陕: 'shaan', 甘: 'sweet', 肃: 'solemn',
  疆: 'territory', 内: 'inside', 蒙: 'mongol', 古: 'ancient', 辽: 'liao',
  吉: 'auspicious', 黑: 'black', 江: 'river', 贵: 'precious', 四: 'four',
  川: 'river'
};

const semanticKeys = Object.keys(semanticWords).sort((a, b) => b.length - a.length);

/** 汉字写法的字面义；未收录字会让 complete 为 false。 */
export function translatedMeaning(text) {
  const hanOnly = hanOf(text).join('');
  let output = '';
  const unknown = [];
  for (let index = 0; index < hanOnly.length;) {
    const word = semanticKeys.find(key => hanOnly.startsWith(key, index));
    if (word) {
      output += semanticWords[word];
      index += word.length;
    } else {
      unknown.push(hanOnly[index]);
      index += 1;
    }
  }
  return {
    text: output,
    complete: unknown.length === 0 && output.length > 0,
    unknown
  };
}

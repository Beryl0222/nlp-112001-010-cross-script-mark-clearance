import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractLetter } from '../lib/extract.js';

const markets = ['海港区', '松岛'];

test('q1 辨认实际使用名、暂拟英文别名、市场与无牌代工商品', () => {
  const row = {
    id: 'q1', client: '河岸园艺', market: '海港区、松岛', language: 'zh',
    text: '雨杉做滴灌配件，套管代工不打这个标志。也考虑英文 Yu Shan。',
  };
  const q = extractLetter(row, { knownMarkets: markets });

  const roles = Object.fromEntries(q.mentions.map(m => [m.text, m.role]));
  assert.equal(roles['雨杉'], 'actual');
  assert.equal(roles['Yu Shan'], 'alias');

  // 所有跨度都能切回原文
  for (const m of q.mentions) assert.equal(row.text.slice(m.span[0], m.span[1]), m.text);
  for (const g of q.goods) assert.equal(row.text.slice(g.span[0], g.span[1]), g.text);

  assert.deepEqual(q.markets.map(m => m.name), ['海港区', '松岛']);
  for (const m of q.markets) assert.equal(row.market.slice(m.span[0], m.span[1]), m.name);

  const drip = q.goods.find(g => g.text === '滴灌配件');
  assert.ok(drip);
  assert.equal(drip.conceptId, 'DRIP_FITTINGS');
  assert.equal(drip.brandUse, true);

  const tube = q.goods.find(g => g.text === '套管');
  assert.ok(tube);
  assert.equal(tube.conceptId, 'TUBING');
  assert.equal(tube.brandUse, false);
  assert.ok(tube.usageCues.includes('no-mark-oem'));

  const cue = q.cues.find(c => c.code === 'oem-no-mark-anaphor');
  assert.ok(cue);
  const actual = q.mentions.find(m => m.role === 'actual');
  assert.equal(cue.resolvedMentionId, actual.id);
  assert.equal(cue.mark, '雨杉');
});

test('q2 区分公司简称、现用标与“不申请”的比较标志', () => {
  const row = {
    id: 'q2', client: '雨山零件', market: '海港区', language: 'zh',
    text: '本公司简称雨山，现用标是青锋。参考同行的 YUSHAN，但不申请它。',
  };
  const q = extractLetter(row, { knownMarkets: markets });
  const byText = Object.fromEntries(q.mentions.map(m => [m.text, m]));

  assert.equal(byText['雨山'].role, 'abbreviation');
  assert.equal(byText['青锋'].role, 'current');
  assert.equal(byText['YUSHAN'].role, 'comparison');
  assert.equal(byText['YUSHAN'].filingIntent, false);
  assert.match(byText['YUSHAN'].dispositionCue, /不申请/);
  assert.equal(q.clientTradeTerm, '零件');

  for (const m of q.mentions) assert.equal(row.text.slice(m.span[0], m.span[1]), m.text);
});

test('q3 辨认英文标志、服务与明示材料词', () => {
  const row = {
    id: 'q3', client: '雨海设计', market: '松岛', language: 'en',
    text: 'The mark is Rain Cedar for landscape design. Cedar tubing is only a material term.',
  };
  const q = extractLetter(row, { knownMarkets: markets });
  const byText = Object.fromEntries(q.mentions.map(m => [m.text, m.role]));
  assert.equal(byText['Rain Cedar'], 'actual');
  assert.equal(byText['Cedar tubing'], 'generic');

  const landscape = q.goods.find(g => g.conceptId === 'LANDSCAPE');
  assert.ok(landscape);
  assert.equal(landscape.kind, '服务');
  assert.equal(landscape.brandUse, true);

  const tubing = q.goods.find(g => g.text === 'Cedar tubing');
  assert.ok(tubing);
  assert.equal(tubing.brandUse, false);
  assert.ok(tubing.usageCues.includes('material-term'));

  const cue = q.cues.find(c => c.code === 'material-term-statement');
  assert.ok(cue);
  assert.equal(row.text.slice(cue.termSpan[0], cue.termSpan[1]), 'Cedar tubing');

  for (const m of q.mentions) assert.equal(row.text.slice(m.span[0], m.span[1]), m.text);
});

test('题首例句：不带雨杉商标的塑料套管不被当成品牌使用', () => {
  const row = {
    id: 'intro', client: '河岸园艺', market: '海港区', language: 'zh',
    text: '雨杉做园艺滴灌配件，也供不带雨杉商标的塑料套管。',
  };
  const q = extractLetter(row, { knownMarkets: markets });
  assert.ok(q.mentions.some(m => m.text === '雨杉' && m.role === 'actual'));
  const mention = q.mentions.find(m => m.text === '雨杉');
  assert.ok(mention.occurrences.length >= 2, '“不带雨杉商标”中的重复出现应并入 occurrences');

  const tube = q.goods.find(g => g.text === '塑料套管');
  assert.ok(tube);
  assert.equal(tube.brandUse, false);
  assert.ok(tube.usageCues.includes('without-mark'));

  const drip = q.goods.find(g => g.conceptId === 'DRIP_FITTINGS');
  assert.ok(drip);
  assert.equal(drip.brandUse, true);

  const cue = q.cues.find(c => c.code === 'without-trademark-on-goods');
  assert.equal(cue.goods, '塑料套管');
  assert.equal(cue.mark, '雨杉');
});

test('市场字段里无法识别的残片形成待核问题，而不是静默拆分', () => {
  const row = {
    id: 'bad-market', client: 'x', market: '海港区、云中城', language: 'zh',
    text: '简称小雨。',
  };
  const q = extractLetter(row, { knownMarkets: markets });
  assert.deepEqual(q.markets.map(m => m.name), ['海港区']);
  assert.ok(q.questions.some(x => x.code === 'unparsed-market' && x.text.includes('云中城')));
});

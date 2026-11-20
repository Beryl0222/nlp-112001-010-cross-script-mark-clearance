// 商标档案索引。档案里的字段按原样保存，索引只添加派生视图。
import { analyzeName } from './names.js';

export function resolveTrademarks(rows) {
  return new TrademarkIndex(rows.map(row => ({
    ...row,
    analysis: analyzeName(row.label),
    variantAnalysis: analyzeName(row.variant)
  })));
}

export class TrademarkIndex {
  constructor(records) {
    this.records = records;
  }

  all() {
    return this.records;
  }

  get(id) {
    return this.records.find(record => record.id === id) ?? null;
  }

  inMarket(market) {
    return this.records.filter(record => record.market === market);
  }

  markets() {
    return [...new Set(this.records.map(record => record.market))];
  }

  categories() {
    return [...new Set(this.records.map(record => record.category))];
  }
}

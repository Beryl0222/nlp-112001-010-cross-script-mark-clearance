// 市场类目索引：保留每次修订，默认取最新一版；旧版仍可供复核当时的决定。

const REVISION_PATTERN = /^\d+$/;

function revisionNumber(value) {
  return REVISION_PATTERN.test(value) ? Number(value) : Number.NEGATIVE_INFINITY;
}

export function resolveCategories(rows) {
  const byMarket = new Map();
  for (const row of rows) {
    if (!byMarket.has(row.market)) byMarket.set(row.market, new Map());
    const market = byMarket.get(row.market);
    if (!market.has(row.id)) {
      market.set(row.id, {
        id: row.id,
        market: row.market,
        parent: row.parent,
        revisions: []
      });
    }
    market.get(row.id).revisions.push({
      revision: row.revision,
      parent: row.parent,
      text: row.text
    });
  }
  for (const market of byMarket.values()) {
    for (const entry of market.values()) {
      entry.revisions.sort((a, b) =>
        revisionNumber(a.revision) - revisionNumber(b.revision));
      entry.latest = entry.revisions.at(-1);
      entry.superseded = entry.revisions.slice(0, -1);
    }
  }
  return new CategoryIndex(byMarket);
}

export class CategoryIndex {
  constructor(byMarket) {
    this.byMarket = byMarket;
  }

  markets() {
    return [...this.byMarket.keys()];
  }

  hasMarket(market) {
    return this.byMarket.has(market);
  }

  entries(market) {
    return [...(this.byMarket.get(market)?.values() ?? [])];
  }

  get(market, id) {
    return this.byMarket.get(market)?.get(id) ?? null;
  }

  latest(market, id) {
    const entry = this.get(market, id);
    return entry ? { ...entry.latest, id: entry.id, market } : null;
  }

  /** 指定修订版；找不到时明确告知，不拿最新版冒充旧版。 */
  atRevision(market, id, revision) {
    const entry = this.get(market, id);
    if (!entry) return null;
    const found = entry.revisions.find(item => item.revision === String(revision));
    if (found) return { ...found, id: entry.id, market, fallback: false };
    return { ...entry.latest, id: entry.id, market, fallback: true };
  }

  /** 类目修订变化：返回从旧版到最新版之间被改写或新增的释义。 */
  revisionChanges(market, id, fromRevision) {
    const entry = this.get(market, id);
    if (!entry) return null;
    const sorted = entry.revisions;
    const fromIndex = sorted.findIndex(item => item.revision === String(fromRevision));
    if (fromIndex === -1) {
      return { changed: true, reason: '旧修订版不在档案中，需人工确认当时依据' };
    }
    const later = sorted.slice(fromIndex + 1);
    if (!later.length) return { changed: false, later: [] };
    return {
      changed: true,
      later,
      before: sorted[fromIndex],
      current: entry.latest
    };
  }
}

/**
 * 类目之间的关系。不同市场即使类目编号或文字相同，也视为不同审核范围。
 * same → 同市场同编号；child → 同市场上下位；
 * sibling → 同市场同一上级；other-market → 异市场；unrelated → 无档案关系。
 */
export function relateCategories(left, right, catalog) {
  if (!left || !right) return { relation: 'unrelated', evidence: [] };
  if (left.market !== right.market) {
    return {
      relation: 'other-market',
      evidence: [`${left.market} ${left.id} 与 ${right.market} ${right.id} 分属不同市场，不能合并审核范围`]
    };
  }
  if (left.id === right.id) {
    return {
      relation: 'same',
      evidence: [`同市场同编号：${left.market} ${left.id}`]
    };
  }
  const parentOf = (entry) => catalog?.latest(entry.market, entry.parent) ?? null;
  const leftParent = parentOf(left);
  const rightParent = parentOf(right);
  if (leftParent?.id === right.id) {
    return {
      relation: 'child',
      evidence: [
        `${left.id} 是 ${right.id} 的下位类目（上级「${left.parent}」）`,
        '上下位关系只能提示相邻范围，不能替代逐类目确认'
      ]
    };
  }
  if (rightParent?.id === left.id) {
    return {
      relation: 'child',
      evidence: [
        `${right.id} 是 ${left.id} 的下位类目（上级「${right.parent}」）`,
        '上下位关系只能提示相邻范围，不能替代逐类目确认'
      ]
    };
  }
  if (left.parent && left.parent === right.parent) {
    return {
      relation: 'sibling',
      evidence: [
        `同属上级类目「${left.parent}」：${left.id} / ${right.id}`,
        '上下位关系只能提示相邻范围，不能替代逐类目确认'
      ]
    };
  }
  return { relation: 'unrelated', evidence: [] };
}

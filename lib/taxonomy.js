// 市场类目：同一编号可能有多个 revision；按市场隔离；结合本地用语表判断商品关系与修订影响。

import { CATEGORY_CONCEPTS, conceptRelation } from './terminology.js';

export class Taxonomy {
  constructor(categoryRows = []) {
    this.rows = categoryRows;
    this.byId = new Map();
    this.markets = new Set();
    for (const row of categoryRows) {
      if (!this.byId.has(row.id)) this.byId.set(row.id, []);
      this.byId.get(row.id).push(row);
      this.markets.add(row.market);
    }
    for (const list of this.byId.values()) {
      list.sort((a, b) => Number(a.revision) - Number(b.revision));
    }
  }

  static fromTables(tables) {
    return new Taxonomy(tables['市场类目.json'] ?? []);
  }

  knownMarkets(extra = []) {
    return [...new Set([...this.markets, ...extra])];
  }

  revisions(categoryId) {
    return this.byId.get(categoryId) ?? [];
  }

  row(categoryId, revision) {
    const list = this.revisions(categoryId);
    if (list.length === 0) return null;
    if (revision == null) return list[list.length - 1];
    return list.find(r => String(r.revision) === String(revision)) ?? null;
  }

  current(categoryId, market) {
    const list = this.revisions(categoryId).filter(r => !market || r.market === market);
    list.sort((a, b) => Number(a.revision) - Number(b.revision));
    return list.at(-1) ?? null;
  }

  // 取某市场下某编号在“某修订时点”的最新文本（用于还原旧决定依据）。
  atOrBefore(categoryId, market, revision) {
    const list = this.revisions(categoryId)
      .filter(r => (!market || r.market === market) && Number(r.revision) <= Number(revision));
    return list.at(-1) ?? null;
  }

  latestRevision(categoryId) {
    return this.row(categoryId)?.revision ?? null;
  }

  // 评估一个来函商品说法与档案类目（可指定修订）的关系。
  assessGoods(goods, categoryId, market, revision = null) {
    const cat = revision != null
      ? this.row(categoryId, revision)
      : this.current(categoryId, market);
    if (!cat) {
      return { related: false, relation: 'unknown', reason: `市场类目缺少 ${categoryId} 记录，需人工补表` };
    }
    if (!goods || goods.length === 0) {
      return { related: null, relation: 'unknown', category: cat, reason: '来函未说明商品/服务，无法比对类目，需先补齐经营范围' };
    }
    const mapping = CATEGORY_CONCEPTS[categoryId];
    const revKey = String(cat.revision);
    const spec = mapping?.[revKey] ?? mapping?.['*'] ?? null;

    if (!spec) {
      // 无本地注释时的保守词汇比对：只在出现相同关键词时给弱结论。
      const text = `${cat.text} ${cat.parent}`;
      const hit = goods.find(g => text.includes(g.text) || g.text.includes(cat.text.slice(0, 2)));
      return hit
        ? {
            related: true,
            relation: 'lexical-weak',
            category: cat,
            reason: `字面弱对应：“${hit.text}”↔类目“${cat.text}”，未经用语表确认`,
          }
        : {
            related: false,
            relation: 'none',
            category: cat,
            reason: `用语表未注释 ${categoryId}，且无字面对应，需当地同事确认`,
          };
    }

    const catConcepts = spec.concepts;
    const matches = [];
    for (const g of goods) {
      for (const cc of catConcepts) {
        const rel = conceptRelation(g.conceptId, cc);
        if (rel.relation !== 'none') {
          matches.push({ goods: g, categoryConcept: cc, ...rel });
        }
      }
    }

    if (matches.length === 0) {
      return {
        related: false,
        relation: 'none',
        category: cat,
        spec,
        reason: spec.exclusive
          ? `类目修订 ${cat.revision} 限定“${spec.exclusive}”，与来函商品不同范围`
          : `来函商品概念与类目“${cat.text}”（${cat.parent}）不对应`,
      };
    }

    // 选择最强关系：same > narrower/broader
    matches.sort((a, b) => (a.relation === 'same' ? -1 : 1) - (b.relation === 'same' ? -1 : 1));
    const best = matches[0];
    let reason = `“${best.goods.text}”与 ${categoryId} rev${cat.revision}“${cat.text}”：${best.label}`;
    if (spec.added) reason += `；该修订新增“${spec.added}”`;
    if (spec.narrowerText) reason += `；${spec.narrowerText}`;
    return {
      related: true,
      relation: best.relation,
      matches,
      category: cat,
      spec,
      reason,
    };
  }

  // 类目修订后，检查旧决定引用的依据是否发生范围变化。
  revisionDrift(categoryId, market, decidedRevision) {
    const old = this.row(categoryId, decidedRevision);
    const now = this.current(categoryId, market);
    if (!old || !now || String(old.revision) === String(now.revision)) return null;
    const oldSpec = CATEGORY_CONCEPTS[categoryId]?.[String(old.revision)]
      ?? CATEGORY_CONCEPTS[categoryId]?.['*'];
    const newSpec = CATEGORY_CONCEPTS[categoryId]?.[String(now.revision)]
      ?? CATEGORY_CONCEPTS[categoryId]?.['*'];
    const addedConcepts = (newSpec?.concepts ?? []).filter(c => !(oldSpec?.concepts ?? []).includes(c));
    return {
      categoryId,
      market,
      fromRevision: old.revision,
      toRevision: now.revision,
      oldText: old.text,
      newText: now.text,
      addedConcepts,
      scopeExpanded: addedConcepts.length > 0 || old.text !== now.text,
    };
  }
}

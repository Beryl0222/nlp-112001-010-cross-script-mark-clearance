// 各地“商品服务用语”对照表（可由顾问/当地同事扩充）。
// 表面说法 -> 概念；类目编号+修订 -> 该修订实际覆盖的概念。
// 这是透明的本地知识表，不是正式分类意见。

export const GOODS_CONCEPTS = {
  DRIP_FITTINGS: {
    label: '滴灌接头/配件',
    kind: '商品',
    surfaces: [
      '园艺滴灌配件', '滴灌配件', '滴灌接头及阀', '商业园艺滴灌接头',
      '滴灌接头', '滴灌阀', '滴灌',
      'drip irrigation fittings', 'drip fittings', 'drip irrigation connectors',
    ],
    broader: ['IRRIGATION_EQUIPMENT', 'PARTS'],
  },
  IRRIGATION_EQUIPMENT: {
    label: '园艺/灌溉器具（上位）',
    kind: '商品',
    surfaces: ['园艺器具', '灌溉器具', '园艺设备'],
    broader: [],
  },
  TUBING: {
    label: '套管/软管',
    kind: '商品',
    surfaces: [
      '塑料套管', '杉木纹套管', 'cedar tubing', 'Cedar tubing',
      '套管', '软管', 'tubing', 'sleeve', 'casing', 'hose',
    ],
    broader: ['FLUID_PARTS'],
  },
  FLUID_PARTS: {
    label: '流体/工业配件（上位）',
    kind: '商品',
    surfaces: ['工业配件', '流体配件'],
    broader: ['PARTS'],
  },
  INDUSTRIAL_FLUID: {
    label: '工业流体传输（限定用途）',
    kind: '商品',
    surfaces: ['仅供工业流体传输', '工业流体传输', 'industrial fluid transfer'],
    broader: ['FLUID_PARTS'],
  },
  LANDSCAPE: {
    label: '景观设计/规划',
    kind: '服务',
    surfaces: [
      'landscape design', '景观设计', '景观规划',
      'landscape planning', 'landscape architecture', '景观',
    ],
    broader: ['DESIGN_SERVICE'],
  },
  DESIGN_SERVICE: {
    label: '设计服务（上位）',
    kind: '服务',
    surfaces: ['设计服务'],
    broader: [],
  },
  PARTS: {
    label: '零件/配件（未明确具体品）',
    kind: '商品',
    surfaces: ['零件', '配件', 'parts', 'components'],
    broadTerm: true,
    broader: [],
  },
};

// 类目记录（按 市场/编号/修订）到概念的解释。
// scopeNote 保留类目原文中的用途限定，作为“不相关/重看”的理由。
export const CATEGORY_CONCEPTS = {
  'H-12': {
    '*': { concepts: ['DRIP_FITTINGS'], note: '滴灌接头及阀，隶属园艺器具' },
  },
  'S-71': {
    1: { concepts: ['INDUSTRIAL_FLUID'], exclusive: '仅供工业流体传输' },
    2: {
      concepts: ['INDUSTRIAL_FLUID', 'DRIP_FITTINGS'],
      added: '包括商业园艺滴灌接头',
      note: '修订 2 增列商业园艺滴灌接头',
    },
  },
  'S-72': {
    '*': { concepts: ['TUBING'], narrowerText: '杉木纹套管为套管的具体下位形制' },
  },
  'S-53': {
    '*': { concepts: ['LANDSCAPE'], note: '景观规划，隶属设计服务' },
  },
};

export function conceptLabel(id) {
  return GOODS_CONCEPTS[id]?.label ?? id;
}

// 判断两个概念之间的上下位方向。
export function conceptRelation(a, b) {
  if (a === b) return { relation: 'same', label: '同一商品/服务概念' };
  const chain = (id) => {
    const out = new Set();
    const walk = (x) => {
      for (const p of GOODS_CONCEPTS[x]?.broader ?? []) {
        if (!out.has(p)) { out.add(p); walk(p); }
      }
    };
    walk(id);
    return out;
  };
  const pa = chain(a);
  const pb = chain(b);
  if (pa.has(b)) return { relation: 'narrower', label: `“${conceptLabel(a)}”是“${conceptLabel(b)}”的下位` };
  if (pb.has(a)) return { relation: 'broader', label: `“${conceptLabel(b)}”是“${conceptLabel(a)}”的下位` };
  return { relation: 'none', label: '无上下位关系' };
}

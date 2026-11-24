// 可复核工作流：同步候选、按市场分派、合并且保留候选/证据、
// 类目修订重看、公司简称纠正的跨客户传播追溯、描述词误认重核。
// 所有函数尽量直接操作普通对象，便于在测试中使用临时 JSON 落盘。

function nowIso(now) {
  return now ?? new Date().toISOString();
}

function addEvent(wb, type, detail, now) {
  wb.events.push({ at: nowIso(now), type, detail });
}

export function syncFindings(wb, analysis, options = {}) {
  const now = nowIso(options.now);
  wb.materialsCounts = options.materialsCounts ?? wb.materialsCounts ?? null;
  let added = 0;
  let updated = 0;
  for (const fresh of analysis.findings) {
    const old = wb.findings[fresh.key];
    if (old) {
      const preserved = {
        flowState: old.flowState,
        assignee: old.assignee ?? null,
        assignments: old.assignments ?? [],
        localChecks: old.localChecks ?? [],
        decisionHistory: old.decisionHistory ?? [],
        flags: old.flags ?? {},
      };
      wb.findings[fresh.key] = { ...fresh, ...preserved };
      updated += 1;
    } else {
      const assignable = fresh.assignable !== false;
      const flowState = !assignable
        ? '记录在案'
        : fresh.status === '可排除'
          ? '待复核排除'
          : '待分派';
      wb.findings[fresh.key] = {
        ...fresh,
        flowState,
        assignee: null,
        assignments: [],
        localChecks: [],
        decisionHistory: [],
        flags: {},
      };
      added += 1;
    }
  }
  wb.updatedAt = now;
  addEvent(wb, 'sync', { queryIds: analysis.queries?.map?.(q => q.id) ?? [analysis.id], added, updated }, now);
  return { added, updated, total: Object.keys(wb.findings).length };
}

export function resolveFinding(wb, keyOrCode) {
  if (wb.findings[keyOrCode]) return wb.findings[keyOrCode];
  return Object.values(wb.findings).find(f => f.code === keyOrCode) ?? null;
}

function nextAssignmentId(wb) {
  let max = 0;
  for (const a of wb.assignments) {
    const m = /^A-(\d+)$/.exec(a.id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `A-${String(max + 1).padStart(3, '0')}`;
}

// 按市场分派（默认只分派“待分派”项）。返回派单。
export function assignByMarket(wb, spec, options = {}) {
  const now = nowIso(options.now);
  const states = spec.states ?? ['待分派'];
  let keys = spec.findingKeys;
  if (!keys) {
    keys = Object.values(wb.findings)
      .filter(f => f.market === spec.market && states.includes(f.flowState))
      .map(f => f.key);
  }
  const resolved = keys.map(k => resolveFinding(wb, k)).filter(Boolean)
    .filter(f => !spec.market || f.market === spec.market);
  const id = spec.assignmentId ?? nextAssignmentId(wb);
  const assignment = {
    id,
    market: spec.market ?? null,
    assignee: spec.assignee,
    at: now,
    findingKeys: resolved.map(f => f.key),
    status: '已发出',
    note: spec.note ?? null,
  };
  wb.assignments.push(assignment);
  for (const f of resolved) {
    f.flowState = '已分派';
    f.assignee = spec.assignee;
    f.assignments.push({ assignmentId: id, at: now, assignee: spec.assignee, market: f.market });
  }
  addEvent(wb, 'assign', { assignmentId: id, market: spec.market, assignee: spec.assignee, count: resolved.length }, now);
  return assignment;
}

// 合并当地同事回函：逐条按 finding 身份写入，绝不按类目合并候选。
export function mergeLocalChecks(wb, submission, options = {}) {
  const now = nowIso(options.now ?? submission.receivedAt);
  const merged = [];
  const missing = [];
  for (const check of submission.checks ?? []) {
    const f = resolveFinding(wb, check.finding ?? check.key ?? check.code);
    if (!f) {
      missing.push(check.finding ?? check.key ?? check.code);
      continue;
    }
    const record = {
      at: now,
      colleague: submission.colleague ?? check.colleague ?? null,
      assignmentId: submission.assignmentId ?? check.assignmentId ?? null,
      verdict: check.verdict,
      note: check.note ?? '',
      evidences: check.evidences ?? [],
    };
    f.localChecks.push(record);
    f.decisionHistory.push({
      at: now,
      actor: record.colleague,
      action: 'local-check',
      status: check.verdict,
      reason: record.note,
    });
    f.flowState = '已合并';
    f.flags = f.flags ?? {};
    merged.push(f.key);
  }
  if (submission.assignmentId) {
    const a = wb.assignments.find(x => x.id === submission.assignmentId);
    if (a) {
      a.status = missing.length === 0 ? '已交回并合并' : '部分交回（有无法定位条目）';
      a.mergedAt = now;
    }
  }
  addEvent(wb, 'merge', {
    colleague: submission.colleague ?? null,
    merged: merged.length,
    missing,
    principle: '按候选身份逐条合并；同一类目下不同来函写法/标志均独立保留',
  }, now);
  return { merged, missing, ok: missing.length === 0 };
}

// 记录顾问决定（如“不相关”），可绑定当时的类目修订。
export function recordDecision(wb, spec, options = {}) {
  const now = nowIso(options.now);
  const f = resolveFinding(wb, spec.findingKey ?? spec.key ?? spec.code);
  if (!f) throw new Error(`找不到候选：${spec.findingKey ?? spec.key ?? spec.code}`);
  const entry = {
    at: now,
    actor: spec.actor ?? '顾问',
    action: 'decision',
    status: spec.status,
    reason: spec.reason ?? '',
    categoryRevision: spec.categoryRevision ?? f.trademark.categoryRevision ?? null,
  };
  f.decisionHistory.push(entry);
  if (/不相关|排除|不成立/.test(spec.status)) f.flowState = '已排除';
  else if (/重看|重核|重开/.test(spec.status)) f.flowState = '需重看';
  else f.flowState = '已决定';
  addEvent(wb, 'decision', { findingKey: f.key, status: spec.status, categoryRevision: entry.categoryRevision }, now);
  return entry;
}

// 类目修订影响：旧“不相关/排除”决定所依据的修订被新修订扩大时，提示重看。
export function revisionImpacts(wb, taxonomy, options = {}) {
  const now = nowIso(options.now);
  const impacts = [];
  for (const f of Object.values(wb.findings)) {
    let decIndex = -1;
    (f.decisionHistory ?? []).forEach((e, i) => {
      if (e.action === 'decision' && /不相关|排除/.test(e.status) && e.categoryRevision) decIndex = i;
    });
    if (decIndex < 0) continue;
    const exclusion = f.decisionHistory[decIndex];
    const drift = taxonomy.revisionDrift(f.trademark.category, f.market, exclusion.categoryRevision);
    if (!drift || !drift.scopeExpanded) continue;
    // 幂等：该排除决定之后已经重开过，就不重复提示/写历史。
    const reopened = f.decisionHistory.slice(decIndex + 1).some(e => e.action === 'revision-reopen');
    if (reopened) continue;
    const basisConcepts = new Set((f.basisGoods ?? []).map(g => g.conceptId));
    const matchingAdded = drift.addedConcepts.filter(c => basisConcepts.has(c));
    // 即使没有显式 concept 交集，只要修订文本新增了来函商品词，也由 assess 结果兜底；
    // 这里要求有交集或当前类目评估为相关。
    const currentlyRelated = f.categoryAssessment?.related === true;
    if (matchingAdded.length === 0 && !currentlyRelated) continue;
    const impact = {
      findingKey: f.key,
      code: f.code,
      queryId: f.queryId,
      mention: f.mention.text,
      trademarkId: f.trademark.id,
      categoryId: drift.categoryId,
      market: drift.market,
      fromRevision: drift.fromRevision,
      toRevision: drift.toRevision,
      oldText: drift.oldText,
      newText: drift.newText,
      addedConcepts: drift.addedConcepts,
      matchingAdded,
      priorDecision: exclusion,
    };
    impacts.push(impact);
    if (options.apply) {
      f.flags.revisionImpact = impact;
      f.flowState = '需重看';
      f.decisionHistory.push({
        at: now, actor: '系统', action: 'revision-reopen',
        status: '需重看',
        reason: `类目 ${drift.categoryId} 从 rev${drift.fromRevision} 更新到 rev${drift.toRevision}：${drift.oldText} → ${drift.newText}`,
      });
      addEvent(wb, 'revision-reopen', { findingKey: f.key, categoryId: drift.categoryId }, now);
    }
  }
  return impacts;
}

// ---------- 别名库与公司简称纠正 ----------

export function newAliasLink(link) {
  return {
    status: 'active',
    origin: null,
    derivedFrom: [],
    assignmentRefs: [],
    ...link,
  };
}

function sameName(a, b) {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

// 纠正公司简称：查出该错误关联在所有客户别名库中的传播。
export function correctAbbreviation(lib, spec, options = {}) {
  const now = nowIso(options.now);
  const { correctName, wrongName, client } = spec;
  const involved = l =>
    (sameName(l.canonical, correctName) && sameName(l.alias, wrongName))
    || (sameName(l.canonical, wrongName) && sameName(l.alias, correctName))
    || l.alias === wrongName && l.canonical === correctName;

  const direct = lib.links.filter(l => l.status === 'active' && involved(l));
  const affectedIds = new Set(direct.map(l => l.id));

  // 沿 derivedFrom 反向找出下游传播副本（即使其名称对已变化也能追到）。
  const descendants = [];
  let frontier = [...affectedIds];
  while (frontier.length) {
    const next = lib.links.filter(l => l.status === 'active'
      && (l.derivedFrom ?? []).some(id => frontier.includes(id))
      && !affectedIds.has(l.id));
    for (const l of next) {
      descendants.push(l);
      affectedIds.add(l.id);
    }
    frontier = next.map(l => l.id);
  }

  const affected = lib.links.filter(l => affectedIds.has(l.id));
  // 只要关联的来源链落在本次受影响集合内，就算“传播而来的副本”
  // （直接配对的 AL-02 也可能同时带有 derivedFrom）。
  const propagated = affected.filter(l =>
    (l.derivedFrom ?? []).some(id => affectedIds.has(id)));
  const otherClients = [...new Set(affected.map(l => l.client).filter(c => c !== client))];
  const assignmentRefs = [...new Set(affected.flatMap(l => l.assignmentRefs ?? []))];
  const report = {
    client,
    correctName,
    wrongName,
    applied: Boolean(options.apply),
    affectedLinkIds: affected.map(l => l.id),
    directLinkIds: direct.map(l => l.id),
    propagatedLinkIds: propagated.map(l => l.id),
    otherClients,
    assignmentRefs,
    links: affected,
  };

  if (options.apply) {
    if (affected.length > 0) {
      lib.corrections.push({ at: now, client, correctName, wrongName, affectedLinkIds: report.affectedLinkIds });
    }
    for (const l of affected) {
      l.status = 'corrected';
      l.correctedAt = now;
      l.correction = `经 ${client} 来函确认简称为“${correctName}”，“${wrongName}”这一错误音近关联撤销，并追查传播副本`;
    }
    lib.updatedAt = now;
  }
  return report;
}

// 简称纠正后，在工作簿中标记引用这些别名/派单的核查项。
export function flagAbbreviationImpact(wb, correctionReport, options = {}) {
  const now = nowIso(options.now);
  const refs = new Set(correctionReport.assignmentRefs ?? []);
  const keys = [];
  for (const a of wb.assignments) {
    if (refs.has(a.id)) {
      a.status = '需重核（公司简称纠正）';
      for (const k of a.findingKeys) {
        const f = wb.findings[k];
        if (f) {
          f.flags.abbreviationCorrection = {
            correctName: correctionReport.correctName,
            wrongName: correctionReport.wrongName,
          };
          if (f.flowState === '已排除' || f.flowState === '待复核排除') f.flowState = '需重看';
          keys.push(k);
        }
      }
    }
  }
  addEvent(wb, 'abbreviation-correction', {
    client: correctionReport.client,
    links: correctionReport.affectedLinkIds,
    otherClients: correctionReport.otherClients,
    assignmentRefs: [...refs],
    findingKeys: keys,
  }, now);
  return keys;
}

// ---------- 描述词被误认成品牌俗称 ----------

const INDEPENDENT_CODES = new Set([
  'exact', 'latin-variant', 'transliteration', 'homophone', 'near-form', 'calque',
]);

// 判断候选是否拥有不依赖“描述词=俗称”假设的独立字样证据。
export function hasIndependentBrandEvidence(finding) {
  if (!finding) return [];
  const descriptorRecord = finding.trademark?.nature === '品类说明' || finding.lane === 'descriptor';
  const codes = new Set();
  for (const e of finding.evidences ?? []) {
    if (!INDEPENDENT_CODES.has(e.code)) continue;
    // 描述词档案上的“原样一致”只证明两个描述短语相同，不是品牌证据。
    if (descriptorRecord && (e.code === 'exact' || e.code === 'latin-variant')) continue;
    if (e.strength === 'weak') continue;
    codes.add(e.code);
  }
  return [...codes];
}

export function recheckDescriptor(wb, spec, options = {}) {
  const now = nowIso(options.now);
  const descriptorId = spec.trademarkId ?? spec.descriptorId;
  const lib = spec.aliasLibrary ?? null;

  const descriptorFindings = Object.values(wb.findings).filter(f => f.trademark.id === descriptorId);
  const affectedLinks = (lib?.links ?? []).filter(l =>
    (l.descriptorId === descriptorId) && (!spec.onlyActive || l.status === 'active'));
  const brandNames = [...new Set(affectedLinks.map(l => l.canonical).filter(Boolean))];

  // 受影响的既有分派：显式引用描述词的派单，或包含该档案候选的派单。
  const descriptorKeys = new Set(descriptorFindings.map(f => f.key));
  const affectedAssignments = wb.assignments.filter(a =>
    a.descriptorId === descriptorId
    || (a.findingKeys ?? []).some(k => descriptorKeys.has(k))
    || affectedLinks.some(l => (l.assignmentRefs ?? []).includes(a.id)));

  const reopened = [];
  let changed = false;
  for (const f of descriptorFindings) {
    reopened.push(f.key);
    if (options.apply && !f.flags?.descriptorRecheck) {
      changed = true;
      f.flags.descriptorRecheck = {
        descriptorId,
        reason: '档案性质为品类说明，且来函有材料词/无牌代工表述；需撤销“品牌俗称”假设并重新核对分派',
        at: now,
      };
      f.flowState = '需重看';
      f.decisionHistory.push({
        at: now, actor: '系统', action: 'descriptor-reopen', status: '需重看',
        reason: '描述词曾被误记为多个品牌的俗称，按档案 nature=品类说明 与来函用法重核',
      });
    }
  }

  if (options.apply) {
    for (const l of affectedLinks) {
      if (l.status === 'active') {
        changed = true;
        l.status = 'revoked';
        l.revokedAt = now;
        l.revokeReason = '描述词误认为品牌俗称；独立字样证据另行保留';
      }
    }
    for (const a of affectedAssignments) {
      if (a.status !== '需重核（描述词误认）') {
        changed = true;
        a.status = '需重核（描述词误认）';
      }
    }
  }

  // 对每个被牵连的品牌，检查它的其他候选是否有独立证据。
  const retained = [];
  for (const brand of brandNames) {
    for (const f of Object.values(wb.findings)) {
      if (f.trademark.id === descriptorId) continue;
      if (f.mention.text !== brand) continue;
      const codes = hasIndependentBrandEvidence(f);
      if (codes.length > 0) {
        retained.push({
          key: f.key, code: f.code, queryId: f.queryId,
          mention: f.mention.text, trademarkId: f.trademark.id,
          market: f.market, category: f.trademark.category,
          independentCodes: codes,
        });
        if (options.apply && f.flags?.independentEvidenceRetained?.descriptorId !== descriptorId) {
          changed = true;
          f.flags.independentEvidenceRetained = { descriptorId, codes, at: now };
          f.decisionHistory.push({
            at: now, actor: '系统', action: 'independent-evidence-retained',
            status: f.flowState, reason: `撤销描述词 ${descriptorId} 的俗称关联后，仍有独立证据：${codes.join('、')}`,
          });
        }
      }
    }
  }

  const report = {
    descriptorId,
    brandNames,
    affectedLinkIds: affectedLinks.map(l => l.id),
    affectedAssignmentIds: affectedAssignments.map(a => a.id),
    reopenedKeys: reopened,
    retained,
    applied: Boolean(options.apply),
  };
  if (options.apply && changed) {
    addEvent(wb, 'descriptor-recheck', {
      descriptorId, brands: brandNames, reopened: reopened.length, retained: retained.length,
    }, now);
  }
  return report;
}

import { compareNames } from './compareNames.js';

/**
 * 纠正某个客户的简称后，找出错误关联已经传播到的其它客户别名库。
 * `libraries` 形如 [{ client, aliases: [{ text, source? }] }]；
 * `previous` 是被纠正的旧写法，`replacement` 为更正后的写法。
 */
export function traceAliasPropagation({ previous, replacement, libraries }) {
  const affected = [];
  for (const library of libraries) {
    for (const alias of library.aliases) {
      const oldComparison = compareNames(alias.text, previous);
      const newComparison = replacement ? compareNames(alias.text, replacement) : { kind: 'none' };
      if (oldComparison.kind === 'none' && newComparison.kind === 'none') continue;

      // 只有字面完全一致才判断为已更新或仍旧写法；音译、同音、近形
      // 在不同客户库里可能指向任一写法，一律交人工确认。
      let relation;
      let action;
      if (newComparison.kind === 'exact' && oldComparison.kind !== 'exact') {
        relation = 'already-updated';
        action = '别名写法已与更正后的名称一致，无需再传播';
      } else if (oldComparison.kind === 'exact' && newComparison.kind !== 'exact') {
        relation = 'still-old';
        action = `仍沿用旧写法「${previous}」，需要回查该客户的既有分派`;
      } else if (oldComparison.kind === 'exact' && newComparison.kind === 'exact') {
        relation = 'same-both';
        action = '新旧写法在此别名上无法区分，需人工确认该客户实际指向';
      } else {
        relation = 'needs-review';
        const basis = oldComparison.kind === 'none' ? newComparison : oldComparison;
        action = `与旧写法或新写法仅有${describeKind(basis.kind)}关系，不能自动视为已更正`;
      }

      affected.push({
        client: library.client,
        alias: alias.text,
        source: alias.source ?? null,
        relation,
        evidence: [...new Set([...oldComparison.evidence, ...newComparison.evidence])],
        action
      });
    }
  }
  return {
    previous,
    replacement: replacement ?? null,
    affected,
    crossClient: new Set(affected.map(item => item.client)).size > 1
  };
}

const KIND_LABELS = {
  transliteration: '音译',
  homophone: '同音',
  'near-form': '近形',
  variant: '拼写变体',
  translation: '意译',
  partial: '部分重合'
};

function describeKind(kind) {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * 档案里标注为「品类说明」的描述词，若曾在别名库中作为品牌俗称传播，
 * 列出受影响的既有分派；同时保留有独立证据的候选。
 * `assignments` 形如 [{ id, client, market, name, trademarkId, evidence }]。
 */
export function recheckDescriptiveAliases({ markIndex, aliasLibraries, assignments = [] }) {
  const descriptiveRecords = markIndex.all().filter(record => record.nature !== '注册字样');
  const contaminated = [];

  for (const record of descriptiveRecords) {
    const aliases = [];
    for (const library of aliasLibraries) {
      for (const alias of library.aliases) {
        const comparison = compareNames(alias.text, record.label);
        const variant = compareNames(alias.text, record.variant);
        const best = comparison.score >= variant.score ? comparison : variant;
        if (best.kind === 'none') continue;
        aliases.push({
          client: library.client,
          alias: alias.text,
          kind: best.kind,
          evidence: best.evidence
        });
      }
    }
    if (aliases.length < 2) continue;

    const affectedAssignments = assignments.filter(assignment =>
      assignment.trademarkId === record.id ||
      aliases.some(alias =>
        alias.client === assignment.client &&
        compareNames(alias.alias, assignment.name).kind !== 'none'));

    contaminated.push({
      trademarkId: record.id,
      term: record.label,
      variant: record.variant,
      nature: record.nature,
      misinterpretedBy: aliases,
      affectedAssignments: affectedAssignments.map(assignment => ({
        ...assignment,
        keep: hasIndependentEvidence(assignment, record),
        disposition: hasIndependentEvidence(assignment, record)
          ? '独立证据仍成立，保留分派并注明描述词来源'
          : '仅凭描述词的俗称关联，撤回后重新核查'
      }))
    });
  }
  return contaminated;
}

function hasIndependentEvidence(assignment, record) {
  return Array.isArray(assignment.evidence) && assignment.evidence.some(item =>
    item && item.trademarkId && item.trademarkId !== record.id);
}

/**
 * 汇总别名库中跨客户出现的同一描述词，供纠正简称时排查传播范围。
 */
export function aliasLibrariesFrom(reviews) {
  return reviews.map(review => ({
    client: review.client,
    letterId: review.id,
    aliases: review.names
      .filter(name => name.role === 'alias')
      .map(name => ({ text: name.text, source: review.id }))
  }));
}

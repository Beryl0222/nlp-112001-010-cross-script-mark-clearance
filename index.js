// 对外稳定 API 汇总（程序化使用时可 `import * as toolkit from './index.js'`）。
export { readMaterials } from './materials.js';
export { extractLetter, roleLabel } from './lib/extract.js';
export { Taxonomy } from './lib/taxonomy.js';
export { analyzeTables, analyzeQuery, analyzeDefault } from './lib/analyze.js';
export { searchTrademarks, compareSurfaces } from './lib/match.js';
export {
  latinKey, pinyinKeys, soundKeys, nearFormEvidence, calqueKeys,
} from './lib/lexicon.js';
export {
  syncFindings, resolveFinding, assignByMarket, mergeLocalChecks,
  recordDecision, revisionImpacts, correctAbbreviation,
  flagAbbreviationImpact, recheckDescriptor, hasIndependentBrandEvidence,
} from './lib/workflow.js';
export {
  newWorkbook, newAliasLibrary, loadJson, saveJsonAtomic,
} from './lib/store.js';
export {
  clientChecklist, consultantDocket, overviewMarkdown,
} from './lib/report.js';
export { runDemo } from './lib/demo.js';

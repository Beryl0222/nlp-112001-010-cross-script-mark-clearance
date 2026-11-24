# 跨文字商标检索的候选处置

出海服务中心收到注册查询时，客户常把品牌写法、公司简称、比较标志和经营说明混在几句话里。
本工具是一个**零第三方依赖、完全本地运行**的 Node.js 22 ESM 命令行/程序库，处理合成的中英文来函、
商标档案和各地商品服务用语，输出**可分派、可合并、可复核、可还原**的人工核查范围。

它做四件事：

1. 从来函辨认名称的**用途角色**（拟实际使用名 / 暂拟别名 / 比较标志 / 公司简称 / 现用标 / 材料通用词）、
   指定市场、商品服务，全部带 `资料/来函.json#q1 [起,止)` 原文区间。
2. 按**中文近形、同音/音译、拉丁写法变体、逐字意译、共有字/词**检索商标档案，逐条给出语言证据与强弱。
3. 按**市场隔离 + 类目修订 + 商品上下位/用语对照**评估分类关系，生成独立的“写法 × 档案 × 市场/类目”候选。
4. 支撑顾问工作流：按市场分派、逐条合并当地回复、类目修订后重看旧“不相关”决定、
   纠正公司简称并追查跨客户别名传播、描述词被误认俗称后的重核与独立证据保留。

> 本工具只整理人工核查范围和证据，**不构成、也不能代替正式商标注册意见**。

## 环境与资料

商标咨询索引采用 UTF-8 编码，人物、单位和记录均为合成内容。

| 资料 | 字段 |
| --- | --- |
| `资料/来函.json` | `id`、`client`、`market`、`language`、`text` |
| `资料/商标档案.json` | `id`、`label`、`variant`、`market`、`category`、`nature` |
| `资料/市场类目.json` | `id`、`market`、`revision`、`parent`、`text` |

每份资料是 JSON 数组。字段值按来源原样保留为字符串，逗号和顿号可以属于字段内容，
因此市场按《市场类目》中已知市场名匹配，无法解释的残片会形成待核问题而不是被静默拆分。
同一类目编号可以有多条不同 `revision`。原文位置以记录编号及文本范围（UTF-16 字符下标）定位。

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run materials     # 只读取资料并输出条数
```

## 三分钟演示

```sh
npm run demo          # = node tool.js demo
```

该命令读取三份资料，在 `工作/` 生成工作簿、别名库、派单与回函、当次快照，在 `报告/` 生成客户清单与顾问底稿。
当前工作区已包含一份跑完的结果，可直接阅读（删除 `工作/`、`报告/` 后重跑 `npm run demo` 可无损重建）：

- `报告/总览.md`：全部候选、派单、三类复核事件汇总。
- `报告/客户清单-q1.md` / `q2` / `q3.md`：给客户看的排查清单与待核问题。
- `报告/顾问底稿-q1.md` / `q2` / `q3.md`：含字符区间、全部候选、reason code、决定与合并历史的还原底稿。
- `工作/workbook.json`：16 条独立候选、5 张派单、完整事件流。
- `工作/alias-library.json`：简称/俗称别名关联及纠正、撤销记录。
- `工作/snapshots/consult-001.json`：当次分析的不可变快照。

## 常用命令

```sh
node tool.js text "雨杉做园艺滴灌配件，也供不带雨杉商标的塑料套管。"  # 临时分析任意句子
node tool.js parse [q1] [--json]      # 只看来函解析（角色/市场/商品/区间/使用说明）
node tool.js analyze [q1] [--json]    # 候选 + 语言证据 + 分类 + 初步处置
node tool.js build                    # 把候选同步进 工作/workbook.json（保留已有人工状态）
node tool.js assign --market 松岛 --assignee 林岚
node tool.js merge 工作/submissions/松岛.json
node tool.js impacts [--apply]        # 类目修订导致的旧排除决定
node tool.js correct-abbr --client 雨山零件 --name 雨山 --wrong 雨杉 [--apply]
node tool.js recheck-descriptor --tm t3 [--apply]
node tool.js report [--id q1] [--out 报告]
```

除 CLI 外也可程序化使用，统一从 `index.js` 导出：

```js
import { readMaterials, analyzeTables, syncFindings, mergeLocalChecks } from './index.js';
const tables = await readMaterials();
const { queries, findings } = analyzeTables(tables);
```

## 候选模型：为什么不会“整句搜相似词”

解析层（`lib/extract.js`）先把句子拆成**名称提及**和**商品/服务提及**，并识别使用说明：

- q1「雨杉做滴灌配件，套管代工不打这个标志。也考虑英文 Yu Shan。」
  - `雨杉=拟实际使用名`、`Yu Shan=暂拟别名`；
  - `滴灌配件` 按品牌使用理解；`套管` 命中“代工不打标志”，标记 `brandUse:false`，
    **不会**把“套管”当品牌去做近似；
  - 题首例句“也供不带雨杉商标的塑料套管”由 `without-trademark-on-goods` 规则覆盖，
    “雨杉”的重复出现并入 `occurrences`，`塑料套管` 标为无牌用途。
- q2：`雨山=公司简称`（未必商标性使用）、`青锋=现用标`、`YUSHAN=比较标志`且 `filingIntent:false`（不申请）。
- q3：`Rain Cedar=拟实际使用名`；`Cedar tubing=材料通用词`（"only a material term"）。

每个候选的稳定身份是

```
来函id | 提及id | 商标id | 市场 | 类目
```

即使 q1 的“雨杉”和“Yu Shan”命中同一 t2/S-71、或 q1/q2 都落到 t1/H-12，
它们仍是**不同 key、不同证据、可分别回复**的候选；合并回函按 key（或报告短码 `Q1-C03`）逐条写入，
只追加 `localChecks/decisionHistory`，绝不覆盖或合并标志与语言证据。

## 语言证据（`lib/lexicon.js`、`lib/match.js`）

| code | 含义 | 例子 |
| --- | --- | --- |
| `exact` | 原样一致 | Rain Cedar = t4 label |
| `latin-variant` | 大小写/空格/连字符归一后相同 | Yu Shan ↔ Yu-Shan ↔ Yushan ↔ YUSHAN / RainCedar |
| `homophone` | 中文同音（无声调，多音字给全部读法） | 雨杉(yǔ-shān) ↔ 雨山 |
| `transliteration` | 跨文字音译键相同 | 雨杉 ↔ YUSHAN / Yu-Shan |
| `near-form` | 中文近形字组/共有部件，逐位对齐 | 雨杉配件 ↔ 雨衫配件；自己 ↔ 自已 |
| `calque` | 跨文字逐字意译全键 | 雨杉 ↔ Rain Cedar（rain+cedar） |
| `translation-word` | 部分字义/释义对应（弱） | 杉=cedar、软管=tubing |
| `shared-han` / `shared-word` | 共有字/词（弱，不单独定案） | 雨杉 ↔ 杉软管（共有“杉”） |

证据带 `strong/medium/weak` 与置信度（高/中/低）。弱命中也保留为低优先级候选，
以保证召回，但明确标注“单独不足以认定近似”。拼音表、近形字组、释义表都是
`lib/lexicon.js` 里可继续扩充的本地小词表。

## 市场、类目修订与上下位（`lib/taxonomy.js`、`lib/terminology.js`）

- **市场隔离**：q2 只指定海港区，因此 t2（松岛 S-71）只作“跨市场提示”，不进入派单；
  同一个“雨山/YUSHAN”在海港区对应 H-12《滴灌接头及阀》，在松岛对应 S-71，审核范围不同。
- **修订重看**：S-71 rev1 是“仅供工业流体传输”，与园艺滴灌不对应；rev2“包括商业园艺滴灌接头”后，
  `node tool.js impacts --apply` 会找到当年绑定 `categoryRevision:'1'` 的“不相关”决定并置为“需重看”，
  旧结论与新文本都留在历史里。
- **上下位/各地用语**：`lib/terminology.js` 维护“表面说法 → 概念”和“类目编号+修订 → 概念”的对照，
  概念间有 `broader` 链（滴灌接头 ⊂ 园艺器具/配件；套管 ⊂ 工业流体配件；景观设计 ⊂ 设计服务）。
  S-72“杉木纹套管”被识别为“套管”的具体下位形制。未注释类目只给保守的字面弱结论并要求当地补表。

## 三个状态化复核故事（测试全部覆盖）

1. **简称纠正与传播**：`correctAbbreviation` 确认 q2 的公司简称是“雨山”而非“雨杉”时，
   会在整个别名库中找出 `AL-01`，以及经 `derivedFrom` 传播到河岸园艺（`AL-02`）、
   雨海设计（`AL-03`）的错误关联，并通过 `assignmentRefs` 标记受影响派单；无关的意译别名保持 active。
2. **描述词误认俗称**：t3 `杉软管 / Cedar tubing`（`nature:"品类说明"`）曾被当成
   “雨杉”和“Rain Cedar”两个品牌的俗称（`DL-01/DL-02`、`A-OLD-1/2`）。
   `recheckDescriptor` 重开 t3 上的 3 条候选与旧派单、撤销俗称链接；
   而 `雨杉×t1`（同音+音译）、`雨杉×t2`（音译）、`雨杉×t4`（意译）、
   `Rain Cedar×t4`（原样+拉丁变体）因有**独立证据**而保留。
3. **跨查询合并**：海港区回函里 q1 的两个写法与 q2 的简称是 H-12 同一条分类关系上的三个独立候选，
   合并后各自的 note、mention、证据都仍在（见 `test/workflow.test.js`）。

## 目录结构

```
materials.js          资料读取与字段校验（题目原有，保持不变）
tool.js               CLI 入口
index.js              程序化 API 汇总导出
lib/
  lexicon.js          拼音/归一/近形/意译
  extract.js          来函角色、市场、商品、使用说明抽取（带区间）
  terminology.js      各地商品服务用语 + 概念上下位
  taxonomy.js         类目修订、市场隔离、商品-类目评估
  match.js            名称 × 商标档案证据化检索
  analyze.js          生成独立候选、初步处置与待核问题
  store.js            JSON 原子持久化
  workflow.js         分派/合并/修订重看/简称传播/描述词重核
  report.js           客户清单 + 顾问底稿 + 总览
  demo.js             端到端合成演练
test/                 node:test 套件（34 个测试）
资料/                 题目提供的三份 JSON（未改动）
工作/ 报告/           demo 生成的可复核状态与报告（已含示例）
  工作/workbook.json        候选、派单、当地回复、决定与事件流
  工作/派单/                按市场给当地同事的独立派单（含候选证据与回复格式）
  工作/submissions/         合成的当地回函样例
  工作/alias-library.json   别名库及传播/纠正记录
  工作/snapshots/           当次分析快照（还原当次结论）
```

## 后续扩充

- 新品牌用字：补 `lib/lexicon.js` 的 `PINYIN / CONFUSABLE_GROUPS / COMPONENTS / CHAR_GLOSS`。
- 新市场用语或新类目：补 `lib/terminology.js` 的 `GOODS_CONCEPTS / CATEGORY_CONCEPTS`；
  类目修订直接向 `资料/市场类目.json` 追加更高 `revision` 行，再跑 `impacts --apply`。
- 所有状态都是可读 JSON，可直接纳入顾问自己的工单系统或 Git 留痕。

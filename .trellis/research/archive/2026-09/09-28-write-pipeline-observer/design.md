# T3.2 设计 · 写库流水观测（到解析出的 SQL）

父任务：`09-28-ai-write-transparency`。前置 T3.1（`09-28-streaming-incremental-read`）已归档、已推送 `59a6180`。

## 1. 边界（先划死，避免越界）

**做**：在写库链路的单一收口点打点，产出「出站提示词 → 流式正文 → 解析出的 SQL 操作」三段式，
在 Developer 页呈现。

**不做（硬边界）**：
- 不碰 `src/data/sqlite/**`（父 R4、子 C3）。行级 diff 与持久化帧内容不属本任务。
- 不重执行 SQL、不写回。本任务只**观测**，提交语义与返回值逐字节不变。
- 不新增第二套展示/过滤设施（父 R6）：复用 `_lib/` 下的 `AcuPanel` / `AcuDisclosureGroup` /
  `AcuStatsList` / `AcuBadge` / `AcuToggle` 等既有件。

**UI 落点（用户 2026-09-28 裁定）**：**DeveloperPage**。理由：三段式的头两段（出站提示词 + 流式正文）
已在同页的 `PromptInspectionPanel`，AC-B「一个面板内看到三段」最直接；仍复用 `_lib/` 通用展示件，
不违反父 R6 的「复用展示设施」本意。
> 与子 PRD R6 字面「UI 落点与 T3.2 一致（AdvancedToolsPage 内）」的差异：该句写在 T3.3 里、
> 指「T3.3 与 T3.2 同页」，不是「T3.2 必须在 AdvancedToolsPage」。本设计取 DeveloperPage，
> T3.3 随 T3.2 同页，两处一致。

## 2. 关键落点（已实测，勿按计划书旧行号）

| 项 | 实测落点 |
| --- | --- |
| 写库单一收口点 | `src/service/table/table-update-commit.ts:263` `runTableUpdateCommit_ACU` |
| SQL 直通变体 | 同文件 `:460` `runSqliteRuntimeMutationCommit_ACU`（内部转调收口点，**无需单独埋点**） |
| 实际提交的 operations | `table-update-commit.ts:365` `const operations = persistOptions.operations ?? options.operations;` |
| 填表链提供 operations 处 | `src/service/table/update-orchestrator.ts:2027`（apply 返回 `persist.operations`） |
| 出站提示词埋点 | `src/service/ai/api-call.ts:495-501`（`buildCustomApiRequestBody_ACU` 内） |
| AI 唯一出口 | `src/service/ai/api-call.ts:516` `postChatCompletion_ACU` |
| T3.1 已就位但**未接线**的逐块回调 | `src/service/ai/prompt-builder/prompt-api-call.ts:551` `parseStreamResponse_ACU(..., onDelta?)` |
| 裸 SQL 方言解析器（复用） | `src/shared/restricted-sql-dml.ts:119` `parseRestrictedSqlDml_ACU` |
| DSL 方言关键字 | `insertRow` / `updateRow` / `deleteRow`（`prompt-builder/table-edit-parser.ts:213`） |
| 观测开关先例 | `src/presentation-v2/stores/dev-options-store.ts:102` `setPromptInspectEnabled` |

**三个 `postChatCompletion_ACU` 调用点**（全部直接把 `buildCustomApiRequestBody_ACU` 的**返回值**
原样传入 ⇒ body 是**同一个对象引用**，这是本设计关联键成立的前提）：
`api-call.ts:565`、`api-call.ts:626`、`prompt-builder/prompt-api-call.ts:334`。

## 3. 关联键：WeakMap(body) 而非指纹/时间窗

**问题**：三段要能「配对」。第一段（提示词）在 `buildCustomApiRequestBody_ACU` 里落记录；
第二段（正文）在 `postChatCompletion_ACU` 拿到；第三段（SQL）在收口点。三段分处不同栈帧，
中间隔着「解析 → 编排 → 提交」多层调用，无法靠参数传递。

**方案**：第一段记录时，把**请求体对象引用**记进 `WeakMap<object, number>`（recordId）。
`postChatCompletion_ACU` 拿到的正是同一引用 ⇒ 直接查表得到 recordId，**精确关联、零歧义**。

理由对比：
- **指纹（hash body 字符串）**：可行但需序列化整个请求体（性能 + 大对象开销），且同提示词两次调用会撞。
- **时间窗 + scope 就近**：配错风险高（连续两次填表会串），且「配对」变成「猜测」。
- **WeakMap 引用**：O(1)、无序列化、无哈希冲突；对象被 GC 后条目自动消失，不泄漏。
  唯一前提是「同一引用」——已逐点核实（见 §2 末）。

**降级**：若某调用点未来改成重新构造 body，WeakMap 查不到 ⇒ 正文段记为缺失，
**不猜、不回落时间窗**（如实呈现「本次未关联到出站记录」）。

**第三段的关联**：提交时请求体对象已不在作用域（apply 回调已返回），无法用 WeakMap。
此处用 **scope 就近 + 时间窗**，并**只在窗口内才标注**：
`source → scope` 映射（`auto_fill`/`manual_fill`/`group_fill` → `'table-fill'`；
`merge_summary` → `'summary'`）取该 scope 最近一条记录，要求 `now - at <= 10min`。
UI 上如实标注为「关联到最近一次 table-fill 提示词记录」，不断言「同一次调用」。

## 4. 数据流

```
填表链:
  buildCustomApiRequestBody_ACU ──► recordPromptAssembly_ACU(input, linkBody=body)   [第一段]
                                    └─ _recordIdByBody.set(body, id)
  postChatCompletion_ACU(body) ───► beginPromptStreamObservation_ACU(body) → handle
       └─ handleApiResponse_ACU(res, wantsStream, undefined, handle?.onDelta)
             └─ parseStreamResponse_ACU(..., onDelta)        [第二段：逐块]
                    └─ handle.finish(text) ⇒ record.response 原地补写 + notify
  update-orchestrator: 解析 → apply → persist.operations
  runTableUpdateCommit_ACU:
       persist 成功/skipChatSave/失败 ──► recordTableWritePipeline_ACU({ operations, ... })  [第三段]
                                            └─ promptRecordId = 就近关联(§3)
```

三段在 UI 上由 `useWritePipeline` 组装：写库记录展开时，按 `promptRecordId` 从 `prompt-observer`
读回该条提示词记录（消息数 / 分段 / 正文），内联呈现。

## 5. 模块与契约

### 5.1 `service/ai/prompt-observer.ts`（扩展，不新建）

新增：

```ts
/** 第二段：AI 响应正文的观测（只在开关开启且有正文时写入）。 */
export interface PromptResponseStat_ACU {
  chars: number;          // 截断前字符数
  content: string;        // 上限截断后正文（导出时脱敏）
  truncated?: boolean;
  /**
   * 本次响应的取回方式：
   * - 'incremental'：真流式增量读（`response.body.getReader()` 能力检测通过）
   * - 'buffered'：SSE 但退回 `response.text()` 整读（测试桩 / 不支持流体的宿主）
   * - 'json'：压根没走 SSE（请求未带 stream）
   * **不能**用 chunkCount 判增量 —— 见下方说明。
   */
  transport: 'incremental' | 'buffered' | 'json';
  /** onDelta 回调次数（SSE 的两条路径**都会**触发）。 */
  chunkCount: number;
  firstDeltaMs?: number;  // 首次回调距开始的毫秒数（首字延迟）
  totalMs: number;
}
```

> **实测更正（勿再按旧假设写）**：`parseStreamResponse_ACU` 的**整读回退分支同样会触发 onDelta**
> （`prompt-builder/prompt-api-call.ts:583` 对 `text.split('\n')` 逐行调 `consumeSseLine_ACU(line, state, onDelta)`）。
> 因此 `chunkCount > 0` **不能**用来判断「走了真增量」。`transport` 由 `postChatCompletion_ACU`
> 依 `res.body?.getReader` 能力检测判定（与 `parseStreamResponse_ACU:557` 同一判据）。


export const PROMPT_OBSERVATION_MAX_RESPONSE_CHARS_ACU = 120_000;

/** 逐块观测句柄；开关关闭时返回 null（调用方只需一次判空）。 */
export interface PromptStreamObservationHandle_ACU {
  onDelta(delta: string): void;
  finish(assembledText?: string): void;
  abort(reason?: string): void;
}

export function beginPromptStreamObservation_ACU(body: unknown): PromptStreamObservationHandle_ACU | null;

/** 供写库流水关联：某 scope 最近一条记录的 id 与时间。 */
export function getLatestObservationIdForScope_ACU(scope: string): { id: number; at: number } | null;
```

`PromptObservationRecord_ACU` 增加可选 `response?: PromptResponseStat_ACU`。
`recordPromptAssembly_ACU` 的 `input` 增加可选 `linkBody?: object`。
`exportPromptObservations_ACU` 对 `response.content` 逐字段脱敏（与 messages 同口径）。
`__resetPromptObservationForTests_ACU` 重置 WeakMap（`_recordIdByBody` 声明为 `let`，重置时换新对象）。

**契约保持**：新增字段全部可选；关闭时调用方只做一次 `isPromptObservationEnabled_ACU()` 判断后返回；
`beginPromptStreamObservation_ACU` 在关闭时**直接返回 null**（连 handle 都不构造）。
`handle.onDelta` 内部 try/catch 吞异常，绝不 await、绝不抛错（延续 T3.1 的 `notifySseDelta_ACU` 纪律）。

### 5.2 `service/table/write-pipeline-observer.ts`（新）

```ts
export type WriteStatementDialect_ACU = 'sql' | 'dsl' | 'structured';
export type WriteStatementOperation_ACU = 'insert' | 'update' | 'delete' | 'replace' | 'schema' | 'other';

export interface WriteStatementStat_ACU {
  dialect: WriteStatementDialect_ACU;
  operation: WriteStatementOperation_ACU;
  /** 语句/指令原文；超上限截断并置 truncated。 */
  text: string;
  chars: number;            // 截断前
  truncated?: boolean;
  /** 目标表：SQL 用表名，DSL/结构化用 sheetKey。 */
  tables: string[];
}

export interface TableWritePipelineRecord_ACU {
  id: number;
  at: number;
  source: string;                        // TableMutationSourceV2_ACU
  reason: string;
  outcome: 'saved' | 'runtime_only' | 'failed';
  targetMessageIndex: number;
  targetSheetKeys: string[];
  statements: WriteStatementStat_ACU[];
  statementCount: number;
  /** 关联的第三段→第一段：出站提示词记录 id（窗口内才给）。 */
  promptRecordId?: number;
  errorCategory?: string;
  /** operations 未由调用方提供（由持久化层构建）时置位——如实标注，不假装看得到语句。 */
  operationsUnavailable?: boolean;
  truncated?: boolean;
}

export function setTableWriteObservationEnabled_ACU(enabled: boolean): void;
export function isTableWriteObservationEnabled_ACU(): boolean;   // 热路径纯布尔读
export function recordTableWritePipeline_ACU(input): void;        // 不返回值、不 await、不抛错
export function getTableWritePipelineRecords_ACU(): readonly TableWritePipelineRecord_ACU[];
export function subscribeTableWritePipeline_ACU(cb): () => void;
export function clearTableWritePipeline_ACU(caller?: string): void;
export function exportTableWritePipeline_ACU(): string;           // 脱敏
export function __resetTableWriteObservationForTests_ACU(): void;

/** 纯函数：operations → 语句统计（可单测，不依赖开关）。 */
export function summarizeMutationOperations_ACU(operations: unknown): { statements: WriteStatementStat_ACU[]; truncated: boolean };
```

**上限**（照抄 prompt-observer 的三重口径）：条数 `30`；单条语句 `8_000` 字符；总字符预算 `2 MiB`。

**富化规则**（`summarizeMutationOperations_ACU`，逐 kind 处理，**未知 kind 不得抛错**）：

| operation kind | dialect | operation | 取值 |
| --- | --- | --- | --- |
| `sql_batch` / `sql_sheet_batch` | `sql` | 由 `parseRestrictedSqlDml_ACU` 逐条得出 insert/update/delete | 逐条建 stat；解析失败降级 `operation:'other'`、原文保留 |
| `table_edit_dsl` | `dsl` | 正则 `/(insertRow\|updateRow\|deleteRow)\s*\(/g` 出现的类型（可多个 → 取首个并计入 tables） | `text` = DSL 原文 |
| `sheet_replace` | `structured` | `replace` | `tables:[sheetKey]` |
| `data_replace` | `structured` | `replace` | 无 sheetKey ⇒ `tables:[]`、`text` 记 reason |
| `sheet_schema_migrate` | `structured` | `schema` | `tables:[sheetKey]` |
| `row_upsert` / `row_delete` / `meta_update` | `structured` | `other` | `tables:[sheetKey]` |
| 其他/畸形 | `structured` | `other` | `text` 记 kind 名，不抛错 |

> kind 名以 `storage-frame-v2-types.ts:273-282` 的联合为准（9 种）：
> `sql_batch` / `sql_sheet_batch` / `table_edit_dsl` / `row_upsert` / `row_delete` /
> `meta_update` / `sheet_schema_migrate` / `sheet_replace` / `data_replace`。

> 复用而非重写：裸 SQL 走 `parseRestrictedSqlDml_ACU`（已有、有测试）；不自己写 SQL 解析。

### 5.3 埋点 `service/table/table-update-commit.ts`

单点埋进 `runTableUpdateCommit_ACU`，三处调用同一个 `recordTableWritePipeline_ACU`：

1. **成功且落盘**：`:397` 附近 `saved === true` 之后 → `outcome: 'saved'`，带 `messageIndex`、
   `operations`、`targetSheetKeys`。
2. **成功但 skipChatSave**：`:407` else 分支之后 → `outcome: 'runtime_only'`。
3. **失败**：外层 `catch`（`:426` 起）→ `outcome: 'failed'`，带 `errorCategory`。

每处前置 `if (isTableWriteObservationEnabled_ACU())`（R4 零开销：关闭时一次布尔判断即返回）。
`operations` 一律取 `persistOptions.operations ?? options.operations`；二者皆空 ⇒
`operationsUnavailable: true`（不伪造语句）。

**边界（实测确定，勿当成遗漏）**：函数入口的**前置门禁失败**（provisional bridge 未清理、
legacy 迁移未通过、commit scope 已切换、stage_only 分支）是**直接 `return`**、不经 `catch`，
因此**不产出记录**。这属「提交根本没开始」而非「提交失败」，其诊断信息仍由既有 warn/error 日志承载；
`observeWritePipeline_ACU` 覆盖的是**已进入提交的尝试**（落盘成功 / 仅改运行时 / 提交过程失败）。
另：填表链把 `operations` 放在 apply 返回的 `persist` 里，闭包外拿不到 ⇒ 失败记录常带
`operationsUnavailable: true`，这是如实标注，不是缺陷。

**AC1 判据落地**：五个写入来源（填表 / agent 协议 / chat-service / 可视化保存 / 导入）分别走
`update-orchestrator`、`agent-protocol`、`chat-service`、`useVisualizerSave`、`table-import-service`，
但**都经** `runTableUpdateCommit_ACU` ⇒ 观测代码**不识别来源**，只透传 `options.source`。
新增来源无需改观测代码。

### 5.4 正文接线 `service/ai/api-call.ts`

`postChatCompletion_ACU` 内：
```ts
const streamHandle = beginPromptStreamObservation_ACU(body);   // 关闭时 null，零开销
try {
  return await handleApiResponse_ACU(res, requestWantsStream, undefined,
    streamHandle ? (delta) => streamHandle.onDelta(delta) : undefined);
} finally {
  streamHandle?.finish();
}
```
`chunkCount` 与 `firstDeltaMs` 由 handle 内部按 `onDelta` 累计；`transport` 由
`postChatCompletion_ACU` 依 `res.body?.getReader` 能力检测判定后经 `finish({ transport })` 传入
（**不靠 onDelta 是否发生来判路径**，见 §5.1 的实测更正）。
`finish()` 在 handle 内部读 recordId → 原地补写 `record.response` → notify。

> 注意：`handleApiResponse_ACU` 抛错时（`:532` 的 `!res.ok` 分支在 handle 之前），handle 未启动；
> 已在 `finally` 里容错。真正的流中断（120s 超时）由既有计时器负责，本观测**只报不掐**（延续 T3.1）。

### 5.5 UI

**`presentation-v2/stores/dev-options-store.ts`**（扩展）
新增 `writePipelineEnabled: boolean`（默认 false），照抄 `promptInspectEnabled` 全链路：
`PersistedShape` / `loadFromStorage` / `persist` / `setWritePipelineEnabled` / `refresh` /
state 构造期 `applyTableWriteObservationEnabled`。

**`presentation-v2/composables/useDevOptions.ts`**（扩展）：透出 `writePipelineEnabled` 与 setter。

**`presentation-v2/composables/useWritePipeline.ts`**（新）
桥接（组件不直接 import service，沿用 `usePromptInspection` 口径）：
- 订阅写库记录；读 `getPromptObservations_ACU()` 做三段式组装
- 组装函数 `buildPipelineView(record)` → `{ statements, prompt: { id, at, model, messageCount, segments?, response? } | null }`
- 导出 / 清空 / 开关转发
- **不在 composable 里做富化**（富化在 service 纯函数，UI 只渲染）

**`presentation-v2/components/WritePipelinePanel.vue`**（新）
`AcuPanel` 结构照 `PromptInspectionPanel.vue`：
- `#actions`：徽章（记录中 / 未开启、条数）
- 开关行（`AcuToggle`）+ 操作行（导出 JSON / 清空）
- `AcuInfoBanner` 说明（三段式是什么、内存态、不写盘）
- 记录列表：`AcuDisclosureGroup`，标题 = `时间 · source · 楼层`，
  meta = `N 条语句 · M 张表`；展开后：
  1. 「出站提示词」区：关联记录的消息数 / 总字符 / 分段；无关联时显式写「本次未关联到出站提示词记录」
  2. 「响应正文」区：`transport` 徽章（真增量 / 整读回退 / 非流式）、chunk 数、首字延迟、正文（截断提示）
  3. 「SQL 操作」区：`AcuStatsList` + 每条语句（方言徽章 + 操作类型 + 表 + 原文 `pre`）
- 高频更新合帧：记录追加是低频（每次提交至多一条），沿用 `usePromptInspection` 的
  「低频无需合帧」判断；若 token 类异步补写触发通知，订阅回调内只赋值 ref（Vue 自身合帧）。

**`presentation-v2/pages/DeveloperPage.vue`**：`<WritePipelinePanel />` 挂在 `PromptInspectionPanel` 之后。

## 6. 安全与纪律

- **密钥在结构上拿不到**（子 C4）：写库观测的输入只取 `source` / `reason` / `targetMessageIndex` /
  `targetSheetKeys` / `operations` / `errorCategory` —— **不透传整个 options**（其含 chatKey 等）。
  语句文本可能藏用户密钥（如某单元格写了 `api_key: sk-…`）⇒ 导出前逐字段过 `maskSensitiveText_ACU`，
  且**在对象图上、转义之前**（阶段 2 实测教训）。
- **绝不改提交语义**（R5）：观测函数无返回值、不 await；埋点在 `saved` 赋值**之后**，
  异常被观测器内部吞掉，不外溢。失败路径的记录放在 `catch` 内、`return` 之前。
- **UI 不得 import 副作用模块**（子 C1）：`WritePipelinePanel` 只 import `_lib` 组件与 composable；
  类型经 composable 再导出。
- **读清单类常量进 `shared/`**：本任务 UI 不需要读清单常量（`source` 是 service 层的字符串联合），
  故不触发。

## 7. 测试策略

| 用例文件 | 覆盖 |
| --- | --- |
| `tests/service/table/write-pipeline-observer.test.ts`（新） | 富化双方言；未知 kind 不抛错；截断（单条 + 总预算 + 条数）；开关关闭零记录；脱敏导出；关联窗口内外 |
| `tests/service/ai/prompt-observer.test.ts`（扩展） | `linkBody` WeakMap 关联；`beginPromptStreamObservation` 关闭返回 null；`finish` 原地补写 + notify；`abort` 安全；`chunkCount`/`firstDeltaMs`/`transport` 三档 |
| `tests/service/table/table-update-commit.test.ts`（扩展或新建） | 三种 outcome 各产出一条；`operationsUnavailable`；关闭时零调用（spy） |
| `tests/service/ai/api-call-observer.test.ts`（新） | `postChatCompletion` 接线：真增量路径 `transport='incremental'`、整读回退 `'buffered'`（**且同样有 chunkCount>0**）、非流式 `'json'`；body 引用同一性 |
| `tests/presentation/`（若同层有先例） | composable 三段式组装、无关联时的显式态 |

**验证命令**（`source/` 下）：
```
npx vitest run tests/service/table/write-pipeline-observer.test.ts
npx vitest run tests/service/ai/
npx vitest run          # 全量零回退
npx tsc --noEmit
npm run build           # 产物同步到仓库根
```

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 改 `prompt-observer` 打挂阶段 2 既有用例 | 新增字段全可选；关闭路径不改；先跑 `tests/service/ai/` 与 `tests/presentation/` 现有套件 |
| `postChatCompletion` 接线引入行为变化 | handle 在关闭时为 null，`onDelta` 恒为 undefined ⇒ 与现状逐字一致；AC4 用例对比开启/关闭的响应与落盘 |
| 语句文本过大打爆内存 | 单条 8k + 总量 2MiB + 30 条三重上限，超限置 `truncated` |
| 收口点埋点被异常外溢 | 观测函数整体 try/catch；埋点在 `saved` 之后，失败路径在 `catch` 内 |
| 三段关联配错（连续填表） | WeakMap 精确配对第一/二段；第三段用 scope + 10min 窗口且 UI 如实标注为「就近」 |
| 新增 source 需要改观测代码（违反 AC1） | 观测代码只透传 `options.source` 字符串，无 switch/白名单分支 |

## 9. 回滚

- 观测层可整体回滚：删除三个埋点调用 + 新模块，`prompt-observer` 的 `response` 字段可选，
  不回滚也不影响主链（仅多一个内存字段）。
- UI 可单独回滚：移除 `DeveloperPage` 的一行挂载 + 面板组件；store 字段留着无害。
- 无数据迁移、无落盘格式变化 ⇒ **无存储层回滚需求**。

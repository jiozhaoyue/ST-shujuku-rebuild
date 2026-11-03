# T3.3 设计 · 历史楼层只读回放

父任务：`09-28-ai-write-transparency`。前置 T3.2（`09-28-write-pipeline-observer`）——
复用其**语句富化纯函数**与展示件；未闭环前内核可独立完成（本设计按 T3.2 收口后的形态写）。

## 1. 边界（先划死）

**做**：从**当前聊天**某个指定消息的 `TavernDB_ACU_IsolatedData` 取出 `TableStorageFrameV2_ACU`，
只读列出该帧的全部日志条目与语句；显式区分帧的三种形态；坏帧降级为诊断态。

**不做（硬边界）**：
- **不重执行 SQL、不写回、不建库、不重放求值**（子 R 范围裁剪）。没有 sql.js、没有 DDL 解析、
  没有表名改写、没有冲突容忍改写 —— 那些是 `replay-chat.mjs` 的**回放期**职责，本任务不执行语句。
- 不修改任何存储 / 持久化路径；不调任何写接口。
- 不造第二套展示与富化：语句富化复用 T3.2 的 `summarizeMutationOperations_ACU`（`service/table/`）。

**UI 落点（用户 2026-09-28 裁定）**：与 T3.2 同页（**DeveloperPage**），
新增一个相邻的**独立面板**「历史楼层回放」。
> 为何不复用同一面板：写库流水是「实时追加流」，历史回放是「先选楼层、再看该帧」，
> 交互与数据源都不同；同页独立面板既满足「落点与 T3.2 一致」，又不会被混成一条时间线。
> 与子 PRD R6 字面「AdvancedToolsPage 内」的差异同 T3.2 design §1 的说明：该句是「与 T3.2 同页」。

## 2. 关键落点（已实测）

| 项 | 实测落点 |
| --- | --- |
| 聊天消息数组（宿主无关） | `src/data/gateways/chat-gateway.ts:19` `getChatArray_ACU()` → `SillyTavern_API_ACU?.chat` |
| 读某楼隔离标签数据 | `src/data/repositories/chat-message-data-repo.ts:1113` `readIsolatedTagData_ACU(msg, isolationKey)` |
| 底层字段解析（含缓存） | 同文件 `:56` `parseIsolatedDataField` —— **返回原始引用**，注释明示「调用方如需修改必须先克隆」 |
| 当前隔离键 | `src/service/runtime/state-manager` 的 `getCurrentIsolationKey_ACU()` |
| 帧类型 | `src/service/table/storage-frame-v2-types.ts:674` `TableStorageFrameV2_ACU` |
| checkpoint | 同文件 `:179` `TableCheckpointV2_ACU`（`kind:'full'` / `createdAt` / `reason` / `data`）；per-sheet 见 `:255` `TableSheetCheckpointV2_ACU`（`kind:'sheet_full'` / `sheetKey`） |
| 日志条目 | 同文件 `:499` `TableMutationLogEntryV2_ACU`（`seq` / `entryId` / `createdAt` / `source` / `targetMessageIndex` / `aiFloor` / `operations[]` / `commitRevision` / `restoreUpToAiFloor?` / `writeSet?`） |
| 形状守卫先例 | 仓储层 `:227` / `:609` / `:820` 均用 `Array.isArray(frame?.logEntries)` 的**宽容**风格 |
| 帧模型参照实现 | `source/scripts/rescue/replay-chat.mjs`（文件头 :12-31） |
| 语句富化（复用） | T3.2 产出的 `service/table/write-pipeline-observer.ts` 的 `summarizeMutationOperations_ACU` |

## 3. 与 `replay-chat.mjs` 的逐项对齐与差异（AC5 的落地）

### 3.1 对齐项（同口径）

| # | 项 | replay-chat.mjs | 本任务 |
| --- | --- | --- | --- |
| A1 | 帧位置 | `TavernDB_ACU_IsolatedData[iso].storageFrame`（`:128-135`） | 同（经仓储 `readIsolatedTagData_ACU`） |
| A2 | 帧可解析性 | `ensureFrameParsed` 容忍 string / object 两种（`:107`） | 同（仓储 `parseIsolatedDataField` 同一容忍） |
| A3 | checkpoint 判据 | `frame.checkpoint && cp.kind === 'full'`（`:137-140`） | 同判据 |
| A4 | 日志条目形状 | `frame.logEntries` 数组，逐条 `operations[].statements` | 同判据 |
| A5 | 语句来源 | `operations[].statements`（纯 SQL 字符串） | 同（且额外覆盖 DSL 与结构化 kind，见 §4） |
| A6 | 坏帧态度 | 宽容：跳过该帧并记诊断，不中断其它帧（`:127` 的 try/catch） | 同：降级为诊断态，不抛错到 UI |
| A7 | 表名 key 形式 | `keyFormOf(sheetKey)`：`sheet_ji_yao_biao` → `jiyaobiao`（`:59`） | 同口径用于把 sheetKey 显示为物理表名（**仅显示，不建表**） |

### 3.2 差异项（须在 UI 与测试中体现，不得静默）

| # | 项 | 差异 | 理由 |
| --- | --- | --- | --- |
| D1 | **不建库、不执行** | replay-chat 用 checkpoint DDL 建库 + 按 seq 重放 statements；本任务**只列语句** | 子 R 范围裁剪：「重建当时执行了哪些 SQL」= 列出语句，不需要重放求值 |
| D2 | **无冲突容忍改写** | replay-chat 的 `INSERT OR IGNORE` 改写、失败语句跳过与 `diagnostics.json` 属**回放期**规则；本任务无执行 ⇒ 不适用 | 同上；但「宽容 + 可诊断」的**精神**沿用（A6） |
| D3 | **不读 chat_metadata 分支** | replay-chat 兼容 `msg.chat_metadata.TavernDB_ACU_IsolatedData`（`:130`）；本任务不兼容 | 实测：`TavernDB_ACU_IsolatedData` 写入权威位置**是消息字段**，插件侧从不写 chat_metadata（chat_metadata 承载的是 `ScopedConfig` / `SheetGuide` / `HotSnapshot`）。replay-chat 的分支是为**离线聊天文件**的历史遗留形态，对运行中的聊天无对象 |
| D4 | **语句口径更宽** | replay-chat 只处理纯 SQL；本任务同时呈现 DSL 与结构化 kind | 本插件的 operations 联合类型含 9 种（§4），只列 SQL 会漏掉填表链的 DSL 方言 |

## 4. 数据流与模块

### 4.1 `src/service/table/historical-frame-replay.ts`（新，纯逻辑 + 只读取数）

```ts
export type FrameShape_ACU = 'full_checkpoint' | 'delta' | 'empty' | 'invalid';

export interface FrameFloorEntry_ACU {
  messageIndex: number;
  aiFloor: number;
  shape: FrameShape_ACU;
  entryCount: number;          // logEntries.length
  /**
   * 粗粒度条数：各条目 operations 槽位之和，**不富化**（列表刷新才快）。
   * 精确语句条数由详情给出 —— 列表与详情刻意不同口径（实现时定的取舍，优于为算列表而全量富化整个聊天）。
   */
  operationCount: number;
  checkpointReason?: string;   // TableCheckpointV2_ACU['reason']
  createdAt?: number;          // checkpoint.createdAt，无则首条 logEntry.createdAt
  invalidReason?: string;      // shape === 'invalid' 时的人读原因
}

export interface FrameReplayEntry_ACU {
  seq: number;
  entryId: string;
  createdAt: number;
  source: string;
  aiFloor: number;
  targetMessageIndex: number;
  commitRevision?: string;
  statements: WriteStatementStat_ACU[];   // 复用 T3.2 的富化类型
}

export interface FrameReplayView_ACU {
  messageIndex: number;
  shape: FrameShape_ACU;
  invalidReason?: string;
  checkpoint?: {
    kind: 'full';
    createdAt: number;
    reason: string;
    sheetKeys: string[];
    perSheetSheetKeys?: string[];   // perSheetCheckpoints 的 key（仅形状，不读数据）
  };
  entries: FrameReplayEntry_ACU[];
  /** 语句总数（= entries.flatMap(statements).length）。 */
  statementCount: number;
  /** 任一语句被截断时置位。 */
  truncated?: boolean;
}

/** 扫描当前聊天，列出含帧的楼层（供 UI 点选）。只读。 */
export function listFrameBearingFloors_ACU(): FrameFloorEntry_ACU[];

/** 单帧视图。坏帧返回 shape:'invalid' + invalidReason，不抛错。 */
export function buildFrameReplayView_ACU(messageIndex: number): FrameReplayView_ACU;

/** 纯函数（可单测）：帧 → 形状判定。 */
export function classifyStorageFrame_ACU(frame: unknown): { shape: FrameShape_ACU; invalidReason?: string };
```

**形状判定**（`classifyStorageFrame_ACU`，宽容、无副作用）：

| 条件 | shape |
| --- | --- |
| `frame` 不是非数组对象 | `invalid`（原因：帧不是对象） |
| `logEntries` 不是数组 | `invalid`（原因：logEntries 不是数组 —— 沿用仓储的守卫口径） |
| `checkpoint?.kind === 'full'`（有 `data`）**或** `perSheetCheckpoints` 非空 | `full_checkpoint` |
| 否则 `logEntries.length > 0` | `delta` |
| 否则 | `empty` |

> 注意「checkpoint 与 logEntries 可共存」：一轮填表后同一帧既有 checkpoint 又有本次 delta 条目。
> 故形状判定**先看 checkpoint**（有 checkpoint ⇒ `full_checkpoint`），但 `entries` 仍**照常列出全部
> logEntries** —— 不因为「有 checkpoint」就把 delta 丢掉。这正是不静默跳过的落点。

### 4.2 只读保证（AC3 的实现与判据）

**唯一风险源**：`readIsolatedTagData_ACU` 返回的是**活引用的同一个对象**
（`parseIsolatedDataField` 有按 msg 的解析缓存，且注释明示「调用方如需修改必须先克隆」）。
若回放代码原地改写 `frame` 或其中的 `operations`，会直接污染运行中的持久化数据与缓存。

**对策（三条同时成立才算只读）**：
1. 回放模块**只读字段**，从不赋值写回；不调 `writeIsolatedTagData_ACU` / `persistTablesToChatMessage_ACU`
   等任何写接口（模块内不 import 任何 `write*` / `persist*` 符号 —— 用测试守卫 grep 这条）。
2. 富化产出的 `WriteStatementStat_ACU` 全部是**新建对象**；文本用 `String(...)` / `slice` 取值，不持有引用。
3. 测试判据：调用前后
   - 同一 `isolationKey` 的 `TavernDB_ACU_IsolatedData` **序列化字节不变**（`JSON.stringify` 逐字节比较），
   - 写库观测器的记录数不变、`runTableUpdateCommit_ACU` 未被调用（spy 断言零调用）。

### 4.3 `presentation-v2/composables/useFrameReplay.ts`（新）

- `floors`（`listFrameBearingFloors_ACU()` 结果）、`selectedMessageIndex`、`view`（computed）
- `refreshFloors()`：重新扫描（换聊天 / 新填表后手动刷新）
- 订阅 `watchChatChanged_ACU` 清空选择（沿用 `AdvancedToolsPage.vue:356` 的先例口径）
- 组件不直接 import `data|service`

### 4.4 `presentation-v2/components/FrameReplayPanel.vue`（新）

`AcuPanel`（`id="developer-frame-replay-panel"`），结构照 `PromptInspectionPanel.vue`：
- `#actions`：徽章（含帧楼层数 / 未选择）
- 楼层列表：`AcuDisclosureGroup` 或按钮列表（照 `AdvancedToolsPage` 的 SQL 历史列表形态），
  标题 `#楼层 · AI 楼层 N`，meta `帧形态徽章 + 条目数 + 语句数`
- 选中后展开视图：
  1. 形状徽章行：`full_checkpoint` / `delta` / `empty` / `invalid`，空帧与坏帧**显式文案**（不显示「无数据」）
  2. checkpoint 概要（有则显示）：`reason` / `createdAt` / 表清单（sheetKey → 物理表名）
  3. 条目列表：每条 `AcuStatsList`（seq / source / aiFloor / 目标楼层 / commitRevision）+ 语句列表
     （方言徽章 + 操作类型 + 表 + 原文 `pre`）
- 复用 T3.2 的语句渲染与徽章口径（同一份组件/格式化函数）

### 4.5 `presentation-v2/pages/DeveloperPage.vue`：`<FrameReplayPanel />` 挂在 `WritePipelinePanel` 之后。

## 5. 安全与纪律

- **必须走既有仓储层读帧**（子 C2）：只用 `readIsolatedTagData_ACU`，**不自己解析**
  `TavernDB_ACU_IsolatedData` 的 string/object 格式（那是仓储的契约）。
- **宿主差异只许进桥**（子 C1）：本任务取聊天数组走 `data/gateways/chat-gateway.ts`（既有通道），
  不在 UI 或 service 里直接摸 `SillyTavern_API_ACU` / `window`。
- **UI 不得 import 副作用模块**（子 C3）；类型经 composable 再导出。
- **坏帧不抛错到 UI**（子 C4）：`classifyStorageFrame_ACU` 与 `buildFrameReplayView_ACU` 全程
  try/catch + 宽容守卫，降级为 `invalid` + `invalidReason`。
- **脱敏**：帧内语句可能含用户数据里的密钥 ⇒ 导出/复制走 T3.2 同一脱敏通道。

## 6. 测试策略

| 用例文件 | 覆盖 |
| --- | --- |
| `tests/service/table/historical-frame-replay.test.ts`（新） | AC2 三形态 + invalid 各一例；checkpoint 与 delta 共存时条目真列全；`perSheetCheckpoints` 判 full；AC4 坏帧（截断 JSON / logEntries 缺失 / frame 非对象）不抛错且给原因 |
| 同文件（只读组） | AC3：回放前后 `JSON.stringify(msg.TavernDB_ACU_IsolatedData)` 逐字节相等；`runTableUpdateCommit_ACU` spy 零调用；写库观测记录数不变 |
| 同文件（对齐组） | AC5：与 replay-chat 的口径 A1–A7 逐项断言（帧位置 / string-object 容忍 / checkpoint 判据 / entries 来源 / 坏帧诊断 / keyFormOf 显示）；D1–D4 差异以显式断言固定（如「不建库 ⇒ 不产生任何 SQL 执行 API 调用」） |
| `tests/presentation/`（若同层有先例） | composable：换聊天清空选择；未选时无视图；坏帧显式态 |

**验证命令**（`source/` 下）：
```
npx vitest run tests/service/table/historical-frame-replay.test.ts
npx vitest run          # 全量零回退
npx tsc --noEmit
npm run build
```

**真机（AC7）**：Dev ST **8001**（严禁 8002/8004）打开开发者页 → 历史楼层回放 → 选一个真实含帧楼层
→ 列表条目数与该帧 `operations` 展开一致 → 截图留证。回放前后同一消息的持久化字段应无变化
（可在浏览器控制台比对同一 msg 的 `TavernDB_ACU_IsolatedData` 字符串）。

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 只读回放意外污染活数据（返回引用！） | §4.2 三条对策 + AC3 字节比对用例；模块内不 import 写接口 |
| 大帧（全量 checkpoint + 数千条语句）卡 UI | 语句按 T3.2 的单条/总预算上限截断；楼层列表只渲染扫描到的楼层（数量 = 聊天楼层数，非语句数）；条目区按需展开 |
| 老聊天帧形态不齐（无 `logEntries`、只有 `patches`） | 宽容判定为 `invalid`/`empty` 并给原因；`patches` 是「旧 V2 derived patch log，新写入不再使用」（`:513`），**不做富化**，但在 invalid/summary 文案里如实点出「该帧只含旧 patches，本视图不解析」 |
| 与 replay-chat 口径漂移 | A1–A7 逐项断言；D1–D4 差异写进 UI 文案与测试，避免后人误以为「漏了回放」 |
| `perSheetCheckpoints` 与 `checkpoint` 同时存在 | 形状判 full，但两个来源都列出（sheetKey 清单合并去重） |

## 8. 回滚

- UI 可单独回滚（移除 `DeveloperPage` 一行挂载 + 两个新组件 + composable）。
- 内核 `historical-frame-replay.ts` 是纯函数 + 只读取数，删除即可，无副作用残留。
- 无落盘格式变化、无数据迁移 ⇒ 无存储层回滚需求。

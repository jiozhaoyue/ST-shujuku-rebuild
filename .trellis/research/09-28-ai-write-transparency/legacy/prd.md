# 阶段 3 · AI 写库全透明（父任务）

## Goal

从「AI 收到的提示词」到「写库的 SQL 操作」全链可看，并支持回看历史楼层当时写了什么。

本任务是**父任务**：持有阶段 3 的源需求集、任务地图、跨子任务验收标准与最终集成评审；
**本身不是实施目标**（不直接写产品代码），实施落在三个子任务。

## 背景与定位

阶段 2 已交付「出站提示词可看/可比/可导出」（`service/ai/prompt-observer.ts` +
`PromptInspectionPanel.vue`），埋点在 `buildCustomApiRequestBody_ACU` —— 覆盖全部 AI 功能域。
阶段 3 把它往两端延伸：

- **往上游延伸**：正文此前是**一次性整段拿到**（`response.text()`），观测里只能看到最终字符串，
  看不到「流是什么时候来的、来了多少」。→ 子任务 ①
- **往下游延伸**：AI 说「要写什么」之后，**解析成了哪些 SQL 操作、提交了什么**，目前只有 warn/error 级碎片日志。→ 子任务 ②
- **往历史延伸**：历史楼层当时写了什么，目前完全不可回看。→ 子任务 ③

## Requirements

### 源需求（用户 2026-09-27 定的阶段 3 口径，2026-09-28 两处裁剪已确认）

- **R1** 正文读取从其一次性整段改为**真流式增量读取**。
  **理由重定位（2026-09-28 研究后确认）**：真正的收益是**健壮性** ——
  ① 「停滞/空闲可诊断」（现状 `response.text()` 在流中途卡死会**静默挂到 120s 超时**，零进度反馈）；
  ② 「截断可判」（现在只能靠 `[DONE]` 缺失事后推断）。
  逐块回调仅为**副产品**，不作为主要目的。
- **R2** 真流式改造**不得改变现有可观察行为**：最终拼接结果逐字节一致；未收到 `[DONE]` 仍按截断返回 `null`。
  **且必须保留整读回退**（`response.body` 不可用时退回 `response.text()`），使测试桩与不支持流体的宿主零影响。
- **R3** 在 AI 写库链路上打点，产出「写库流水」：出站提示词 → 流式正文 → **解析出的 SQL 操作**。
- **R4** R3 的观测深度**止于「解析出的 SQL」**（2026-09-28 裁剪：不碰 `data/sqlite` 层，
  行级 diff 与持久化帧留待后续任务）。
- **R5** 支持从历史聊天消息的持久化帧**只读回放**：读出该帧的 `operations[].statements` 并富化展示，
  **只读、不重执行 SQL、不写回**（2026-09-28 裁剪：「重建当时执行了哪些 SQL」= 列出语句，不需要重放求值）。
- **R6** UI 复用既有能力（`AdvancedToolsPage.vue` 已挂 SQL 控制台与日志查看器），
  **不得再造一套展示/过滤设施**。
- **R7** 观测默认关闭；关闭时零行为变化、零额外开销（延续阶段 2 的观测契约）。

### 约束

- **C1** 观测埋点绝不抛错影响主流程；密钥在**结构上**拿不到（延续阶段 2 契约）。
- **C2** 高频回调驱动 DOM 必须 rAF 合帧（规则 L1-MR-9）。
- **C3** 所有 `await` 必须能 settle：abort / 超时经信号或超时兜底，**禁止** promise 永久 pending（规则 L1-MR-7）。
- **C4** UI 不得 import 副作用模块；读清单类常量进 `shared/`（阶段 2 两条硬教训，已落 spec）。
- **C5** 宿主差异只许进 `shared/host-bridge.ts`（规则 L0-9）。
- **C6** 改数据层 / 存储格式前先读 `docs/superpowers/specs/` 相关设计文档。
- **C7** 凡新增「我方差量」（相对上游的改动），**必须登记** `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`，
  并写明「上游是否已自行实现 / 能否回归上游 / 下次追平的冲突口径」。本阶段 **T3.1 必然新增一条**。
- **C8** 不造轮子：能复用既有实现就复用（T3.3 的帧回放模型已有 `source/scripts/rescue/replay-chat.mjs` 先例，
  其文件头注明「与插件 `data/sqlite/sync-bridge.ts` 一致」，须先读再用）。

## 研究结论（2026-09-28，落点核实）

上游计划里的落点行号**已漂移**，实测如下（**以本表为准**）：

| 计划所记 | 实测落点 |
| --- | --- |
| `prompt-api-call.ts:337`（`parseStreamResponse_ACU`） | `source/src/service/ai/prompt-builder/prompt-api-call.ts:460`（`response.text()` 在 `:462`） |
| `service/ai/prompt-builder/table-edit-parser.ts` | 同（路径正确） |
| `data/sqlite/`（行级 diff） | 本轮**不涉及**（R4 裁剪已止于 SQL） |

两处与计划前提不符的事实（已据以重定 R1/R5）：

1. **上游也是 `response.text()` 整读** —— `git show upstream/master:...prompt-api-call.ts` 实测 `:413` 即 `const text = await response.text();`。
   故 T3.1 **不是**「回归上游形态」，而是**新增我方差量**（原先的动机描述有误）。
   另：`tests/service/ai/prompt-api-call.test.ts:797` 注释「上游为 `body.getReader` 增量」**是错的**，属该分支自己引入的写法；
   顺带更正该注释。
2. **我方历史上有意保留该形态** —— `3f6f534` 的提交信息写明「保 …`parseStreamResponse` 形态」，
   即曾在追平上游时**刻意不接受**上游改动。T3.1 的方向与该次口径相反，因此台账必须显式记这一笔。

写库链路的**单一收口点**已找到：`source/src/service/table/table-update-commit.ts:263` 的 `runTableUpdateCommit_ACU`
（`service/` 层，**不在** `data/sqlite/` 层）—— 填表、agent 协议、chat-service、可视化保存、导入全走它。
另有 `runSqliteRuntimeMutationCommit_ACU`（`:460`）作为 SQL 直通变体。**T3.2 的埋点应落在这里，而非 data 层**，与 R4 的裁剪天然吻合。

两个 SQL 方言并存（T3.2 需同时覆盖）：
① `insertRow` / `updateRow` / `deleteRow` DSL（`table-edit-parser.ts` 的指令重组）；
② 裸 SQL（`shared/restricted-sql-dml.ts:119` 的 `parseRestrictedSqlDml_ACU`，被 `service/continuation/agent/agent-protocol.ts` 使用）。

## 任务地图

| 子任务 | 目录 | 交付 | 依赖 |
| --- | --- | --- | --- |
| ① T3.1 真流式增量读取 | `09-28-streaming-incremental-read` | `parseStreamResponse_ACU` 改为 `getReader()` 增量读取 + 逐块回调；分块边界用例 | 无（可独立交付） |
| ② T3.2 写库流水观测（到 SQL） | `09-28-write-pipeline-observer` | 写库链路的观测内核 + `AdvancedToolsPage` 内面板 | 复用 ① 的流式正文（① 未闭环前只显示最终正文） |
| ③ T3.3 历史楼层只读回放 | `09-28-historical-frame-replay` | 从 `TavernDB_ACU_IsolatedData` 单帧重建当时执行的 SQL，只读 | 复用 ② 的展示设施（② 未闭环前可独立完成内核） |

**执行顺序**：① → ② → ③。②③ 的 PRD 先建占位，**在其各自 `task.py start` 前**才补 `design.md` + `implement.md`
（规则：复杂任务在 `start` 前需三件套，不要求提前于其前置任务）。

## Acceptance Criteria（跨子任务 / 集成层）

- [ ] **AC-A** 三个子任务各自的 AC 全部闭环。
      **未闭环**：T3.2 AC7 真机「部分达成」（无 API 预设 ⇒ 无 AI 调用；靶子聊天写入被既存缺陷拒绝）。
- [ ] **AC-B** 一次**真实**填表调用中，能在一个面板内看到：出站提示词 → 流式正文 → 解析出的 SQL 操作。
      **未达成（环境阻塞）**：见「进度记录」的集成验收现状 —— Dev ST 无 API 预设 + 靶子聊天写入被既存缺陷拒绝，
      两因均**不属阶段 3 范围**；错误路径的三段式已在真机验证。
- [x] **AC-C** 同一个面板能对**历史楼层**回放同一视图，且回放**不产生任何写操作**（提交计数不变）。
      **已达成**：回放面板与写库流水面板同页相邻，语句渲染**共用** `write-statement-display.ts`；
      真机字节自比（点选前后 `TavernDB_ACU_IsolatedData` 逐字节一致）+ 内核静态检查（不 import 写接口）双证。
- [ ] **AC-D** 观测**关闭**时，一次填表调用的外部可观察行为与阶段 2 结束时**逐字节一致**
      （正文、SQL、落盘帧、日志级别均无差异）。
      **真机未覆盖**（同上无 AI 端点）；由 `api-call-observer.test.ts` 与 `table-update-commit.test.ts`
      的关闭态用例覆盖（返回值、`handleApiResponse_ACU` 参数逐字节比对）。
- [x] **AC-E** 全量测试零回退（发版前 `npx vitest run` 全绿）。**已达成**：8788 通过 / 0 失败。
- [x] **AC-F** 真机验收只在 **Dev 实例 8001** 进行（严禁 8002/8004，见 P-11）。**已达成**。

## 进度记录

| 子任务 | 状态 | 证据 |
| --- | --- | --- |
| ① T3.1 真流式增量读取 | **已完成 · 已归档** | 提交 `59a6180`（已推 origin）；全量 8705 通过 / 0 失败；真机 A/B（Dev ST 8001）`getReader` 0→1、chunk 0→3、结果等价；AC1–AC10 全闭 |
| ② T3.2 写库流水观测（到 SQL） | **代码已交付 · 真机待合并验收** | 提交 `3c3a99d`（已推 origin）；AC1–AC6 闭（含 AC1「新增来源无需改观测代码」判据）；全量 **8765 通过 / 0 失败**（+60）；tsc/build/smoke 全过；AC7 真机与 T3.3 合并执行 |
| ③ T3.3 历史楼层只读回放 | **代码已交付 · 回放侧真机已验** | 提交 `51806a4`；AC1–AC7 全闭；全量 **8788 通过 / 0 失败**（+23）；tsc/build/smoke 全过；真机 Dev ST 8001：对 209 层聊天回放含帧楼层 `#207`，条目与覆盖表同帧内 `checkpoint.data` 一致，点选前后持久化字段**逐字节不变**（截图 `evidence/03-frame-replay-detail.png`） |

**集成验收现状（截至 2026-09-29，②③ 同一轮真机）**：

- **AC-C 达成**：历史回放视图落同页新面板 `FrameReplayPanel`，语句渲染复用 T3.2 抽出的 `write-statement-display.ts`（**同一份单一事实源**，非另造一套）；回放**零写入**（持久化字段字节自比一致）。
- **AC-B 未达成（环境阻塞）**：需要一次**真实成功**填表产出三段式，但 Dev ST 实例**无任何 API 预设**（`getApiPresets()` 为空 ⇒ 无 AI 调用），且靶子聊天写入被**既存缺陷**拒绝
  （`V2 写入被拒绝：… fallback DDL 表头不合法：第 2 列「」empty_column_name`，即总台账「已登记的后续任务 ②」）。
  该聊天写入被拒 ⇒ 数据未被改动。真机上只验到**错误路径**的三段式（T3.2 AC7「部分达成」）。
- **AC-D 真机未覆盖**：观测关闭零差异由 `api-call-observer.test.ts` / `table-update-commit.test.ts` 的关闭态用例覆盖（含返回值与 `handleApiResponse_ACU` 参数逐字节比对）。
- **AC-A 未闭环**：取决于 T3.2 AC7 能否补全。

**结论**：阶段 3 的**代码交付已完成并各自闭环**；唯一缺口是**真机端到端三段式**，它被两件事挡住（无 API 预设 + 既存写入缺陷），二者都**不属阶段 3 范围**。建议先收口三个子任务，待缺陷修复后再补 AC-B 的真机验收。

### AC-B 复评（2026-09-29，子任务 `09-29-no-ddl-legacy-chat-write-failure` 收口后）

两个阻塞项其一已解，其一仍在，**AC-B 仍不可达**：

- **写入缺陷：已解**。子任务提交 `5e111e4` 把孤儿身份列复位提前到回放基底构造
  （`storage-frame-v2-replay.ts` 的 `normalizeLegacyDuplicateCheckpointState_ACU` 函数首），
  真机 A/B 证明同一 `insertRow`（`sql_sheet_batch`，即失败形态）旧构建返回 `-1` / 新构建返回 `3`；
  且手动重填新增 D-A 前置 fail-closed。证据见该任务 `research/S5-real-machine-verification.md`。
- **无 API 预设：仍在（环境阻塞）**。Playwright 全新浏览器上下文里 `getApiPresets()` 仍为 `[]`
  （预设存浏览器本地存储，新 context 无历史），且用户明令**禁止配置本地代理**充当 AI 端点。
  ⇒ **AC-B 需要一次「真实成功」填表**，必须由用户在**已登录、带预设**的浏览器里执行一次手动填表，
  才能补齐三段式真机验收。代码侧无遗留动作。

**故本任务 AC-B 的收口动作转移到用户侧**（一次真机手动填表），不再由 agent 会话推进。

## Notes

- 上游锚点：`~/.claude/plans/eager-whistling-lovelace.md`（阶段 3 原文）。
- 上游计划里记的落点行号已漂移，**以本任务研究结论为准**：
  `parseStreamResponse_ACU` 实际在 `source/src/service/ai/prompt-builder/prompt-api-call.ts:460`
  （计划记的 `prompt-api-call.ts:337` 已因阶段 1/2 改动漂移到 462 行附近）。
  同理 `table-edit-parser.ts` 在 `source/src/service/ai/prompt-builder/` 下，不在 `service/table/`。
- 阶段 2 遗留的开放项（`table-fill` 域真机证据）**不属于本任务**，由「无 DDL 旧聊天手动填表恒失败」缺陷修复一并做。

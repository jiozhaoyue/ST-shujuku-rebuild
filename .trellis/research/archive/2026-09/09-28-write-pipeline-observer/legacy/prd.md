# T3.2 · 写库流水观测（到解析出的 SQL）

父任务：`09-28-ai-write-transparency`（阶段 3 · AI 写库全透明）
前置：`09-28-streaming-incremental-read`（T3.1，提供逐 delta 回调；**未闭环前正文只显示最终字符串**）

## Goal

把「AI 说完了之后到底要写什么」变得可看：在写库链路的**单一收口点**打点，
产出「出站提示词 → 正文 → **解析出的 SQL 操作**」三段式流水，并在 `AdvancedToolsPage` 内呈现。

## 范围边界（2026-09-28 用户裁剪，务必遵守）

- **做到「解析出的 SQL 操作」为止**。**不碰 `data/sqlite/` 层** —— 行级 diff 与持久化帧留待后续任务。
- 因此**禁止**修改 `data/sqlite/sync-bridge.ts`、`sqlite-engine.ts` 等数据层文件。
- UI **复用** `AdvancedToolsPage.vue` 已有的 SQL 控制台（`useSqlConsole.ts`）与日志查看器（`useLogViewer.ts`）
  的展示与过滤能力，**不得再造一套**（父 R6）。

## Requirements

- **R1** 在写库链路的**单一收口点**打点，覆盖全部写入来源（填表、agent 协议、chat-service、
  可视化保存、导入），而非逐调用方接线。
- **R2** 必须同时覆盖**两个 SQL 方言**：
  ① `insertRow` / `updateRow` / `deleteRow` DSL（`prompt-builder/table-edit-parser.ts` 的指令重组产物）；
  ② 裸 SQL（`shared/restricted-sql-dml.ts:119` 的 `parseRestrictedSqlDml_ACU`，
     被 `service/continuation/agent/agent-protocol.ts` 使用）。
- **R3** 记录内容：来源（`TableMutationSourceV2_ACU`）、`reason`、目标楼层、目标表集合、
  解析出的语句（方言 + 文本 + 结构化富化：表 / 操作类型 / 关键列）、以及与出站提示词记录的**关联键**（可跳转/配对）。
- **R4** 默认关闭；关闭时**零行为变化、零额外开销**（延续阶段 2 观测契约）。
- **R5** 埋点**绝不抛错**、绝不改变提交语义与返回值；观测异常只降级为 debug 日志。
- **R6** 高频回调驱动 DOM 必须 **rAF 合帧**（规则 L1-MR-9）。
- **R7** 密钥与用户数据脱敏复用既有通道（`maskSensitiveText_ACU` 等），
  **必须在对象图上脱敏、转义之前**（阶段 2 实测教训，已落 spec）。

### 约束

- **C1** UI 不得 import 副作用模块；读清单类常量进 `shared/`（阶段 2 两条硬教训，已落 spec）。
- **C2** 观测内核与 UI 解耦：内核为纯逻辑（可单测），UI 只消费。
- **C3** 不得修改 `data/sqlite/` 下任何文件（范围门，见上）。
- **C4** 密钥在**结构上**拿不到（只传必要字段，不透传整个请求/响应对象）。

## Acceptance Criteria

- [x] **AC1 单一收口**：五个写入来源**同一段代码**产出记录（用「新增一个来源不需要改观测代码」为判据）。
      证据：埋点在 `table-update-commit.ts` 的 `runTableUpdateCommit_ACU`；观测代码只透传 `options.source`、
      无来源白名单分支；用例 `table-update-commit.test.ts`「AC1：不同写入来源走同一段代码各产出一条」
      （`auto_fill` / `import` / `merge_summary` 三来源各一条）。
- [x] **AC2 双方言**：一次填表（DSL 方言）与一次 agent 协议调用（裸 SQL）各产出一条记录，语句内容与真实提交一致。
      证据：DSL 富化按行拆 `insertRow/updateRow/deleteRow`；裸 SQL 走 `parseRestrictedSqlDml_ACU`；
      `sql_sheet_batch` / `sql_batch` / `table_edit_dsl` 均有单测；收口点用例断言语句取自
      `persistOptions.operations`（即实际提交给持久化层的那一份）。
- [x] **AC3 关联**：写库记录能关联到同一次调用的出站提示词记录。
      证据：`promptRecordId` 由「来源→scope + 10 分钟窗口」就近关联；三段式面板把关联记录内联展开；
      窗口外/无映射来源如实显示「无关联」；另有更精确的响应侧配对（`WeakMap` 按请求体引用）。
- [x] **AC4 关闭零差异**：观测关闭时，一次填表的正文/语句/落盘帧/日志级别与开启前**完全一致**。
      证据：`api-call-observer.test.ts`「观测关闭：onDelta 恒为 undefined、返回值不变、不写 response」；
      `table-update-commit.test.ts`「观测关闭：不产出任何记录，且提交结果不变」。
- [x] **AC5 脱敏**：含密钥/令牌的真实数据经导出后，密钥不出现在输出里。
      证据：导出在对象图上逐字段过 `maskSensitiveText_ACU`；`write-pipeline-observer.test.ts` 与
      `prompt-observer.test.ts` 各有假密钥导出用例。
- [x] **AC6 零回退**：`npx vitest run` 全绿；`npx tsc --noEmit` 干净。
      证据：**8765 通过 / 0 失败**（基线 8705，+60）；tsc 干净；build + smoke 通过。
- [ ] **AC7 真机**：Dev 实例 **8001**（严禁 8002/8004）一次真实填表，面板内可见三段式流水。
      **部分达成**（2026-09-29，Dev ST 8001）。已证：
      - 面板渲染 + 开关生效（`记录中 · N 条`）；
      - **记录到一条真实提交**并完整呈现：`#1 · 01:29:00 · raw_sql_mutation`，meta `失败 · 0 条语句 · 1 张表`，
        展开后可见来源 / 结果 / 原因 / 目标表 `sheet_dCudvUnH` / 关联提示词「无」/ 错误类别 `model`；
      - **错误路径同样留痕**（设计中的 `outcome: 'failed'` 在真机验证）；
      - 「不经 AI 调用」与「未提供语句（由持久化层构建）」两处**显式态**在真机如实呈现。
      **未达成**：一次**成功**填表产出的三段式（提示词 → 正文 → SQL）。原因：Dev ST 实例
      **没有任何 API 预设**（`getApiPresets()` 返回空），且靶子聊天上的写入被**既有缺陷**拒绝
      （`fallback DDL 表头不合法：第 2 列「」empty_column_name`，见总台账「已登记的后续任务 ②」）。
      详见 Notes 与 T3.3 的 Notes（同一轮真机）。

## Notes（真机验收记录，2026-09-29）

- 环境与部署细节、以及 Dev ST 前端的四个踩坑（角色列表不自动加载 / 切角色方式 / UI 就绪判据 /
  preloader 时序）记录在 `09-28-historical-frame-replay/prd.md` 的 Notes —— 同一次真机，不重复。
- 真机证据（文本，取自面板 DOM）：
  `#1 · 01:29:00 · raw_sql_mutation 失败 · 0 条语句 · 1 张表` →
  `来源 raw_sql_mutation / 结果 失败 / 目标表 sheet_dCudvUnH / 关联提示词 无 / 错误类别 model` →
  响应正文「本次写库不经 AI 调用（如手动 CRUD / SQL 控制台），因此没有出站提示词与响应正文。」→
  语句「本次提交未由调用方提供语句（由持久化层自行构建），观测层拿不到 —— 不是『没有写任何东西』。」
- **AC1 的真机副证**：`raw_sql_mutation` 这个来源**没有**在观测代码里出现任何分支，
  却照样被记录 —— 与「新增来源无需改观测代码」的设计判据一致。

## Notes

- 收口点（研究已定）：`source/src/service/table/table-update-commit.ts:263` 的 `runTableUpdateCommit_ACU`，
  另有 `runSqliteRuntimeMutationCommit_ACU`（`:460`）作为 SQL 直通变体。**在 `service/` 层，不在 `data/` 层**。
- 可复用的观测先例：阶段 2 的 `source/src/service/ai/prompt-observer.ts`（内核契约、开关自守、脱敏纪律）。
- 复杂任务：`task.py start` 前须补 `design.md` + `implement.md`（在 T3.1 闭环后按当时代码状态细化）。

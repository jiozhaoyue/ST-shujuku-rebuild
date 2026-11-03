# T3.2 实施计划 · 写库流水观测（到解析出的 SQL）

父任务：`09-28-ai-write-transparency`。设计见同目录 `design.md`。
全程在 `source/` 下执行。**复选框随执行实时勾选**（L0-2 / L0-17）。

## 执行前门禁

- [ ] `prd.md` 无 TBD（已填实）
- [ ] `design.md` 存在且含边界 / 契约 / 数据流 / 测试 / 回滚（已完成）
- [ ] 基线测试绿：`npx vitest run`（记录基线用例数与通过数，作为 AC6 的对比基准）
- [ ] 确认工作区干净：`git status --short`（若 T3.1 后有未提交改动，先弄清来源）

## 步骤

### S1 内核：写库流水观测器（纯逻辑先行）

- [x] S1.1 新建 `src/service/table/write-pipeline-observer.ts`
  - [x] 类型：`WriteStatementStat_ACU` / `TableWritePipelineRecord_ACU` / `WriteStatementDialect_ACU` / `WriteStatementOperation_ACU`
  - [x] 上限常量：`WRITE_PIPELINE_MAX_RECORDS_ACU = 30` / `WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU = 8000` / `WRITE_PIPELINE_MAX_TOTAL_CHARS_ACU = 2 MiB` / `WRITE_PIPELINE_PROMPT_LINK_MAX_AGE_MS_ACU = 10min`
  - [x] 开关：`setTableWriteObservationEnabled_ACU` / `isTableWriteObservationEnabled_ACU`
  - [x] 纯函数 `summarizeMutationOperations_ACU(operations)`：按 design §5.2 表逐 kind 映射；
        **未知/畸形 kind 不得抛错**
  - [x] `recordTableWritePipeline_ACU(input)`：自守开关 + try/catch + 环形缓冲（条数 + 总字符预算，丢最旧）
  - [x] 关联：`resolvePromptRecordId_ACU(source)` —— source→scope 映射 + 窗口校验（调
        `getLatestObservationIdForScope_ACU`，该导出在 S2 加；此处先落接口）
  - [x] 读 / 订阅 / 清空 / `exportTableWritePipeline_ACU`（脱敏，逐字段过 `maskSensitiveText_ACU`）
  - [x] `__resetTableWriteObservationForTests_ACU`
- [x] S1.2 新建 `tests/service/table/write-pipeline-observer.test.ts`
  - [x] 双方言富化（`sql_batch` 走 `parseRestrictedSqlDml_ACU`；`table_edit_dsl` 走正则）
  - [x] 9 种 operation kind 全覆盖，未知 kind 不抛错
  - [x] 三重上限截断 + `truncated` 标记
  - [x] 开关关闭 ⇒ 零记录（用例断言记录数为 0；关闭路径是提前 return）
  - [x] 导出脱敏（含假密钥的语句导出后不出现密钥）
  - [x] 关联窗口内 / 窗外
- [x] S1.3 验证：`npx vitest run tests/service/table/write-pipeline-observer.test.ts` 全绿
      —— **27 用例通过**

### S2 第一/二段：`prompt-observer` 扩展 + 正文接线

- [x] S2.1 `src/service/ai/prompt-observer.ts`
  - [x] 类型 `PromptResponseStat_ACU`；`PromptObservationRecord_ACU.response?: PromptResponseStat_ACU`
  - [x] 常量 `PROMPT_OBSERVATION_MAX_RESPONSE_CHARS_ACU = 120_000`
  - [x] `_recordIdByBody`（`let`，便于测试重置）+ `recordPromptAssembly_ACU` 的可选 `linkBody?: object`
  - [x] `beginPromptStreamObservation_ACU(body)` → `PromptStreamObservationHandle_ACU | null`（关闭时返回 null）
        —— handle 内含 `onDelta` / `finish` / `abort`，`onDelta` 内部 try/catch 且不 await
  - [x] `getLatestObservationIdForScope_ACU(scope)`
  - [x] `exportPromptObservations_ACU` 对 `response.content` 脱敏
  - [x] `__resetPromptObservationForTests_ACU` 重置 WeakMap
- [x] S2.2 `src/service/ai/api-call.ts`
  - [x] `buildCustomApiRequestBody_ACU` 的 `recordPromptAssembly_ACU` 调用加 `linkBody: body`
  - [x] `postChatCompletion_ACU` 内启 handle，把 `onDelta` 传给 `handleApiResponse_ACU` 第 4 参；
        以 try/成功路 `finish()`、catch 路 `abort()` 双路兜底让句柄 settle（有界等待，规则 L1-MR-7）
  - [x] **追加（实测发现）**：第二个 AI 出口 `callAIWithResolvedPreset_ACU`（智能续写用）同样经请求组装点，
        一并接线；取回方式判据抽为 `resolveStreamTransport_ACU`，避免两处重复
- [x] S2.3 扩展 `tests/service/ai/prompt-observer.test.ts` + 新建 `tests/service/ai/api-call-observer.test.ts`
  - [x] WeakMap 关联：同一 body 引用能取到 recordId；不同对象取不到（不猜、不回落时间窗）
  - [x] 关闭时 `beginPromptStreamObservation_ACU` 返回 null
  - [x] `finish` 原地补写 `response` 并 notify；`abort` 不抛错
  - [x] **AC4 对比**：同一请求在观测开/关两种状态下，`postChatCompletion_ACU` 的返回值、
        调用 `handleApiResponse_ACU` 的参数（除 onDelta 外）逐字节一致
  - [x] **实测更正**：整读回退分支**同样**触发 onDelta（`prompt-api-call.ts`），故 transport 不可由
        chunkCount 推断；用例显式固定这一点
- [x] S2.4 验证：`npx vitest run tests/service/ai/` —— **484 通过 / 0 失败**
      （既有 463 + prompt-observer 新增 13 + api-call-observer 新增 8）

### S3 第三段埋点：写库收口点

- [x] S3.1 `src/service/table/table-update-commit.ts` 三处埋点（design §5.3）
  - [x] `saved === true` 后 → `outcome: 'saved'`
  - [x] `skipChatSave` else 分支后 → `outcome: 'runtime_only'`
  - [x] 外层 catch 内、return 前 → `outcome: 'failed'` + `errorCategory`
  - [x] 每处前置 `isTableWriteObservationEnabled_ACU()`；`operations` 取
        `persistOptions.operations ?? options.operations`，皆空则 `operationsUnavailable: true`
  - [x] 统一入口 `observeWritePipeline_ACU`（开关判 + 局部 try/catch，确保观测绝不影响提交）
- [x] S3.2 测试 —— 追加进既有 `tests/service/table/table-update-commit.test.ts`（复用其 mock 骨架）
  - [x] 三种 outcome 各产出一条记录
  - [x] `operationsUnavailable` 如实置位
  - [x] **AC1 判据**：以「新增一个 source 不需要改观测代码」为断言 —— 三个不同 source 走同一段
        代码各产出一条，且观测模块内无 source 白名单分支
  - [x] 关闭时记录数为 0
  - [x] **实测边界**：门禁失败的**提前 return**（bridge / 迁移 / scope）不经 catch ⇒ 不产记录；
        用例把这个边界固定下来（不是缺口）
- [x] S3.3 验证：`npx vitest run tests/service/table/` —— **1521 通过 / 0 失败**（含本文件 26）

### S4 UI：开关 + 面板

- [x] S4.1 `stores/dev-options-store.ts` 加 `writePipelineEnabled`（全链路照抄 `promptInspectEnabled`）
- [x] S4.2 `composables/useDevOptions.ts` 透出开关
- [x] S4.3 新建 `composables/useWritePipeline.ts`（三段式组装、订阅、导出/清空/开关）
      —— 同时订阅写库与**提示词**两个观察器：响应正文是异步补写的，不订阅它就永远停在「未补写」
- [x] S4.4 新建 `components/WritePipelinePanel.vue`（design §5.5 结构）
- [x] S4.5 `pages/DeveloperPage.vue` 挂 `<WritePipelinePanel />`（紧随 `PromptInspectionPanel`）
- [x] S4.6 在既有 `tests/presentation-v2/developer-page.test.ts` 追加「写库流水」套件（同层已有先例）
      —— **6 条用例**：默认空态 / 开关推送与持久化 / 三段式展开 / 不经 AI 显式态 /
      未提供语句显式态 / 导出下载
- [x] 验证：`npx tsc --noEmit` 干净；`tests/presentation-v2/developer-page.test.ts` **18 通过 / 0 失败**

### S5 全量质量门

- [x] S5.1 `npx tsc --noEmit` 干净
- [x] S5.2 `npx vitest run` 全绿，用例数 ≥ 基线（AC6）
      —— **8765 通过 / 0 失败**（基线 8705，**+60**；1 文件/4 用例为既有 skip）
- [x] S5.3 `npm run build` 产物同步到仓库根（`index.js` 变更；`sql-wasm.wasm` 内容未变），
      `npm run smoke` 过（`acuAppV2Mounted: true` / `menuItemInjected: true` / `errorCount: 0`）
- [x] S5.4 **AC5 脱敏**：含假密钥的语句导出后密钥不出现（`write-pipeline-observer.test.ts` 的导出脱敏用例；
      响应正文侧另有 `prompt-observer.test.ts` 的同类用例）
- [x] S5.5 **AC4 关闭零差异**：观测关闭下 `postChatCompletion_ACU` 的 onDelta 恒 undefined、
      返回值不变、不写 response；写库侧关闭时记录数为 0 且提交结果不变
      （`api-call-observer.test.ts` + `table-update-commit.test.ts`）

### S6 真机验收（AC7）

> **2026-09-29 执行完毕**（Dev ST 8001；与 T3.3 合并同一轮）。结论：**部分达成** ——
> 面板/开关/记录/失败留痕/显式态全部真机验证；**一次成功填表的三段式未达成**，
> 因 Dev ST 无任何 API 预设（`getApiPresets()` 为空）且靶子聊天写入被既有缺陷拒绝。
> 详见 `prd.md` 的 AC7 条目与 Notes。

- [x] S6.1 Dev ST **8001**（严禁 8002/8004）打开开发者页 → 「写库流水」开关打开
- [ ] S6.2 触发一次**真实填表**，面板内看到三段：出站提示词 → 响应正文 → SQL 操作
      —— **未达成**：无可用 AI 端点（`presetNames: []`）。改用不耗 AI 的写入路径替代取证：
      `executeSqlMutation` 触发一次真实提交 → 面板记录 `#1 raw_sql_mutation`（失败留痕）✓
- [x] S6.3 截图留证（临时目录 `06-pipeline-record.png`，一张图含两个新面板的全部状态）
      + 面板文本已抄录进 `prd.md` Notes
- [ ] S6.4 观测关闭后重跑一次，确认外部可观察行为一致 —— 未被真机覆盖（同上，无 AI 端点）；
      由 `api-call-observer.test.ts` 与 `table-update-commit.test.ts` 的关闭态用例覆盖

### S7 收口

- [x] S7.1 更新任务 `prd.md` 的 Acceptance Criteria 勾选与进度记录
- [x] S7.2 更新父任务 `09-28-ai-write-transparency/prd.md` 的进度表（T3.2 行）
- [x] S7.3 登记我方差量到 `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`
      （新增 5 行：观测内核 / prompt-observer 增量 / api-call 两出口接线 / 收口点埋点 / UI；
      并补一条「AI 出口数量变化时须同步接线」的追平口径）
- [x] S7.4 规范落 `.trellis/spec/backend/logging-guidelines.md`
      （新增「响应观测（第二段）」「写库流水观测（第三段）」两节，含实测坑与边界）
- [x] S7.5 提交 `3c3a99d`（显式 pathspec，17 文件）+ 推送 origin
- [ ] S7.6 `task.py finish` / `archive`（待 S6 真机验收后）

## 评审门（每道门未过不进下一步）

| 门 | 判据 |
| --- | --- |
| G1（S1 后） | 内核纯函数单测全绿；关闭路径零记录 |
| G2（S2 后） | `tests/service/ai/` 全绿；AC4 对比用例通过 |
| G3（S3 后） | 收口点三 outcome 用例通过；AC1「新增来源无需改观测代码」断言通过 |
| G4（S5 后） | 全量零回退 + tsc + build + smoke |
| G5（S6 后） | 真机三段式截图 + 关闭态一致性 |

## 回滚点

- **R1（G2 前）**：`prompt-observer` 扩展与 `api-call.ts` 接线可整体丢弃，主链零影响
  （新增字段全可选、关闭时 onDelta 恒 undefined）。
- **R2（G4 前）**：收口点三处埋点可整体删除，不影响提交语义。
- **R3（任意时刻）**：UI 可单独回滚（开发者页一行 + 两个新文件 + store 字段）。

## 纪律提醒

- 提交只用显式 pathspec；提交前 `git diff --staged --name-only` 必须恰等于目标文件集（L0-7）。
- 分发产物（根 `index.js` 等）由 `npm run build` 生成，不手改。
- 真机只在 8001。

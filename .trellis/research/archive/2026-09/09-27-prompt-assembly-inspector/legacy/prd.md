# 提示词拼接排查：Developer 页内嵌检查器

## Goal

让任意一次 AI 调用的最终提示词可排查：段级拆解（段名/来源/字符数/token 估算/占位符命中）、与上次调用的 diff、最近 N 次环形缓冲；观测埋点未开启时零行为变化、零额外开销。复用 agent-prompt-drift.ts 内核，UI 落 DeveloperPage。

## 背景（为什么做）

总计划阶段 2。用户原话：插件「设置项多、又不智能、黑盒」——**AI 到底收到了什么提示词，用户看不见**；出问题时只有一条 debug 日志可猜。本阶段把这层打开：可看、可比、可导出。

## 已确证的事实（本次研究取证，全部 file:line）

| # | 事实 |
| --- | --- |
| F1 | **唯一组装漏斗**：`buildCustomApiRequestBody_ACU`（`src/service/ai/api-call.ts:323`）是全插件唯一的请求体组装点，5 个调用方覆盖全部功能域：`:536`（剧情，`sessionNamespace:'plot'`）、`:597`（通用预设，namespace 由调用方传）、`:707`（已解析预设，续写等）、`prompt-builder/prompt-api-call.ts:285`（填表 `'table-fill'`）、`summary/merge-logic.ts:222`（总结 `'summary'`） |
| F2 | **scope 标签现成**：各功能域已在传 `options.sessionNamespace` —— `'table-fill'` / `'summary'` / `'plot'` / `'worldbook-ai'` / `'agent-decision'` / `'agent-skillify'` / `'content-replace'` / `'template-assistant'` / continuation 自建（`internal-ai-call.ts:141`）。**无需新造 scope 体系**，原计划「六类各接一个」由它天然满足 |
| F3 | **现成 drift 内核**：`src/service/continuation/agent/agent-prompt-drift.ts`（165 行）提供 `compareAgentPromptMessages_ACU` / `formatAgentPromptDriftReport_ACU` / `trackAgentPromptDrift_ACU(scope,messages)` / `resetAgentPromptDrift_ACU`（含 scope 记忆 Map）。目前**只有一处调用**：`agent-main-loop.ts:1230`（且仅写 debug 日志） |
| F4 | **现成脱敏与开关纪律**：`buildCustomApiRequestBody_ACU` 在 `isDebugLogEnabled()` 时把最后一份 body 存 `globalThis.__ACU_DEBUG_LAST_API_BODY__`，并对头值与 `api[_-]?key|token|secret` 打码（`redactSensitiveApiHeadersForDebug_ACU` / `redactSensitiveIncludeBodyForDebug_ACU`）。新面板**必须复用同一脱敏**，不得新开未脱敏通道 |
| F5 | **token 估算现成**：`src/service/ai/token-counter.ts` 的 `countTextTokens_ACU(text)`（异步；宿主分词器缺失或抛错时按 `ceil(chars/1.5)` 估算，**绝不抛错**） |
| F6 | **段级只在填表链可行**：`prepareAIInput_ACU`（`prompt-builder/prompt-prepare.ts:239`，返回拼接后的文本）的唯一调用方是 `service/table/update-orchestrator.ts:1368`。其他功能域各自拼 `messages`，没有「段」的概念 |
| F7 | **UI 复用件齐备**：`_lib/AcuStatsList.vue`（`AcuStatsItem{label,value}`）、`AcuDisclosureGroup.vue`（`label/meta/expanded`）、`AcuPromptSegments.vue`（`PromptSegment{role,content}`）、`AcuPanel`/`AcuPanelGrid`（页面骨架；另受 `tests/presentation-v2/panel-grid-conventions.test.ts` 强制） |
| F8 | **缓冲与订阅先例**：`src/shared/log-buffer.ts`（零 DOM、`subscribe`/`getRecentLogs_ACU(limit)`/`clearLogs(caller)`/`_resetForTesting`），以及「flag 状态放低层、由 store 推送」的既有形态（`dev-options-store` 调 `applyWarnLogEnabled`） |

## Requirements

- **R1 单点观测**：埋点只进 `buildCustomApiRequestBody_ACU`（F1），覆盖全部 AI 调用；**不逐个功能域改造**。
- **R2 消息级拆解**：每条记录含 scope（取 `sessionNamespace`）、时间、模型、端点**主机**、stream、消息条数与每条 role/字符数、总字符数、token 估算（异步补齐），以及与**同 scope 上次调用**的 diff（复用 F3 内核语义：共享条数/字符、首个分歧点、摘录）。
- **R3 段级拆解（仅填表链）**：把填表链的拼接结果按段标注（至少：系统骨架 / 表结构 DDL / 世界书 / 历史消息 / 运行时数据），每段给字符数与 token 估算；**非填表记录显式显示「未分段」**，不伪装成空。
- **R4 面板**：Developer 页新增「提示词检查器」面板：最近 N 次列表（有界环形）、可展开明细与 diff、可清空。
- **R5 导出**：面板提供「导出 JSON」（导出当前缓冲，形态沿用本仓既有导出 JSON 先例）。
- **R6 脱敏**：复用 F4 的脱敏函数；展示与导出**都不得**出现 API 密钥、请求头值、proxy 口令；端点只显示主机。
- **R7 零开销**：开关关闭时，埋点只做一次布尔判断即返回（不分配、不哈希、不算 token、不复制字符串）。
- **R8 开关落点**：开关是面板内的「开始记录」，状态存**既有的** `acu_v2_ui_state` 的 dev-options 节（**不新增 localStorage key**），默认关闭；flag 状态由低层持有、store 推送（F8 形态）。
- **R9 不改变既有行为**：开关关闭时系统行为与现状等同；提示词正文**只存内存**（不落 localStorage、不写 console）。
- **R10 纪律**：新增页面/组件遵 spec（相对路径导入、`acu-` 双前缀 + scoped、禁通配与宿主裸类名、复用 `_lib` 组件、不引第三方库）。

## Acceptance Criteria

- [ ] **AC1** 开关关闭时：`buildCustomApiRequestBody_ACU` 的返回值与现状**逐字节一致**（既有用例钉住）；全量测试零回退。
- [ ] **AC2** 开关打开 + 一次真实填表调用（**只允许 Dev 实例 8001**）后，面板出现 1 条记录：scope = `table-fill`、消息条数与字符数与实际一致、diff 显示「基线建立」。
- [ ] **AC3** 第二次调用后 diff 显示「前缀完整保留」或指出首个分歧点，且与 `formatAgentPromptDriftReport_ACU` 的既有输出语义一致。
- [ ] **AC4** 填表记录展开可见分段占比（骨架/DDL/世界书/历史/运行时），各段字符数与 token 估算齐全；同一次会话里的非填表记录（如 `content-replace`）显示「未分段」而非空白。
- [ ] **AC5** 导出 JSON 成功；用一份**含 API 密钥**的配置做断言：导出内容不含密钥/头值（脱敏生效）。
- [ ] **AC6** 记录数达上限后不再增长（环形丢最旧），清空后计数为 0。
- [ ] **AC7** 新面板通过 `tests/presentation-v2/panel-grid-conventions.test.ts`（页面在 `panelGridPages` 列表内、用 `AcuPanelGrid`、无手写加权 `fr`）。
- [ ] **AC8** 质量门全绿：`npx tsc --noEmit -p tsconfig.json` → `npx vitest run` → `npm run build` → `npm run smoke`。

## 范围外（明确不做）

- 响应侧（真流式、写库流水、历史楼层回放）= 总计划**阶段 3**。
- 段级覆盖其他功能域（需先给那些域造「段」概念）。
- 任何形式的「按 token 预算自动裁剪/改写提示词」——本阶段**只看不改**。
- 把观察记录持久化到磁盘或 localStorage。

## Notes

- 真机验证**只允许 Dev 实例**（8001 Dev ST / 8003 Dev Luker）；**严禁 8002 / 8004 Real 实例**（规则 L0-13 与 P-11）。
- 收口时规范条文落 `.trellis/spec/`（本任务目录只作工作副本，规则 L0-17）。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

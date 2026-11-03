# T3.1 · 真流式增量读取

父任务：`09-28-ai-write-transparency`（阶段 3 · AI 写库全透明）

## Goal

把 `parseStreamResponse_ACU` 从 `response.text()` 整段读改为 `response.body.getReader()` **增量读取**，
使其在流**停滞**时可诊断、在流**截断**时可判；逐块回调作为副产品。

**本任务不是「回归上游形态」** —— 上游（`shuiyue-cmyk/shujuku-rebuild@master` 的
`source/src/service/ai/prompt-builder/prompt-api-call.ts:413`）**也是** `response.text()`。
本任务是**新增我方差量**，须按 C7 登记台账。

## Requirements

- **R1** 流式响应改走 `response.body.getReader()` 增量读取，逐块喂给行累加器。
- **R2** **保留整读回退**：`response.body` 不可用（测试桩 / 不支持流体的宿主 / 已消费的 body）时，
  退回现有 `await response.text()` 路径。回退路径行为**必须与现状完全相同**。
- **R3** **逐字节一致**：同一份 SSE 文本，增量路径与整读路径产出的 `result` 必须**完全相等**（含空串 → `null` 的转换）。
- **R4** **截断语义不变**：未见到 `[DONE]`（或 Anthropic `message_stop`）时仍返回 `null`，并保留现有 warn 日志。
- **R5** **abort / 超时必须能 settle**（规则 L1-MR-7）：不得有 promise 永久 pending。
- **R6** 逐块回调为**可选**参数，**绝不 await**、**绝不抛错**；仅作观测副产品，观测关闭时不产生任何分配。
- **R7** 停滞可诊断：读流期间若「连续无数据」超过阈值，产出**诊断级**日志（不改行为、不主动中断 ——
  中断语义由既有 120s `timeoutController` 承担，本任务不动它）。
- **R8** 高频回调若驱动 DOM 必须 rAF 合帧（规则 L1-MR-9）—— 本任务只提供回调，合帧责任在消费方（T3.2）。

### 约束

- **C1** 不改 `handleApiResponse_ACU` 的对外签名语义（第 2 参 `requestWantsStream` 的
  `undefined`/`true`/`false` 三态判定语义不得改变）。
- **C2** 不改 `parseNonStreamResponse_ACU`。
- **C3** 不改 `api-call.ts` 的超时/取消链路（`INTERNAL_AI_FETCH_TIMEOUT_MS_ACU` 120s、
  `attachTimeoutAndExternalAbort_ACU`、两处 `AbortError`/`TimeoutError` 分类）。
- **C4** 不引入新依赖。
- **C5** 顺带更正 `tests/service/ai/prompt-api-call.test.ts:797` 的错误注释
  （「上游为 `body.getReader` 增量」→ 上游也是整读）。

## Acceptance Criteria

- [x] **AC1 逐字节一致**：对同一份 SSE 文本，增量路径与整读路径的返回值**严格相等**
      （用属性测试式用例：把一份标准 SSE 文本按**所有可能切分点**喂给增量路径，结果恒等）。
- [x] **AC2 分块边界**：切点落在 `data:` 行中间、落在 JSON 中间、一次 chunk 含多行、`\r\n` 行尾、
      末行无换行 —— 均与整读同结果。**另加逐字节穷举**（切进多字节字符内部）。
- [x] **AC3 回退**：`response.body` 为 `undefined` / `null` 时走整读，既有用例**零改动通过**。
- [x] **AC4 截断**：无 `[DONE]` → 返回 `null` + warn 日志（与现状一致）；含 Anthropic `message_stop` → 正常返回。
- [x] **AC5 取消可 settle**：流中途 abort → `AbortError` 穿透（不被降级为 `null`），且 promise 在有限时间内 settle。
- [x] **AC6 观测回调**：不传回调时零额外分配；传回调时逐 delta 被调用，回调抛错**不影响**返回值。
- [x] **AC7 零回退**：`npx vitest run` 全绿（8705 通过 / 0 失败，基线 8696 + 新增 9）；`npx tsc --noEmit` 干净。
- [x] **AC8 台账**：新差量已登记 `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`。
- [x] **AC9 真机**：Dev 实例 **8001** 开流式，一次真实调用正常返回、正文完整无乱码。
      **口径说明**：AI 输出非确定 ⇒「与改动前一致」不可能做字面字节比对；
      本任务以「单元级逐字节一致（AC1/AC2）+ 真机级对外结果等价（A/B 配对）」两层证据闭合，详见 `implement.md` 步骤 6。
- [x] **AC10 停滞诊断**（R7）：读流连续无数据超过 `SSE_STALL_DIAG_MS_ACU` 时产出**一次**
      `logDebug_ACU` 诊断（不重复刷屏、**不中断**读流）；该路径默认静默（不破坏 AC4 的日志无差异）。

## Notes

- 落点：`source/src/service/ai/prompt-builder/prompt-api-call.ts:460`（`response.text()` 在 `:462`）。
- 相关既有用例：`source/tests/service/ai/prompt-api-call.test.ts`（流式/非流式解析与 usage 合并）。
- 技术设计见 `design.md`，执行计划见 `implement.md`。

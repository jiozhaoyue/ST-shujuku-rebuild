# 错误处理

> 本仓的错误处理有**三种形态**：跨层数据流走结果对象；参数与前置条件校验走朴素中文 `Error`；
> 需要上层分支/重试的领域失败，定义**领域错误类 `XxxError_ACU`（全仓 22 个）并配判别器**。

---

## 形态一：跨层数据流用结果对象

面向调用方的数据操作返回带 `success` 的结果，而不是用异常做控制流：

- `shared/table-storage-provider.ts:14-49`：`SqlQueryResult` / `SqlMutationResult` / `ApplyEditsResult{ success }`
- 调用方按字段分支，异常只用于「真意外」。

## 形态二：参数与前置条件用 `throw new Error('中文消息')`

- 校验失败**立即抛**，消息是**可直接给用户看的中文**，且尽量指出具体值：
  - `shared/utils.ts:588-598` 的 `assertSafeHttpEndpoint_ACU`：逐条抛具体原因（空地址 / 反斜杠 / 协议相对 URL / 不支持的协议）。
  - `shared/ddl-utils.ts:34-307`：`无效的 SQLite runtime 表名：…`、`row_id 不允许隐藏。`
- 全仓 `throw new Error` 计数 884 处（shared/service/data），是主要形态。

## 形态三：catch → 记日志 → 降级返回安全值

service 层 catch 之后**不 rethrow**，而是记一条日志并返回一个安全默认值：

- `service/table/auto-fill-echo-guard.ts:114-117`：读已处理集合失败 → `logDebug_ACU('[自动填表] …按放行处理:', error)` + `return false`。
- 同文件 `:135-138`：登记失败 → 记日志 + `return null`。

判别口径：**读路径失败可降级**；写路径失败要显式返回 `success: false` 或抛给上层，不要静默吞掉。

## 形态四：领域错误类 + 判别器（调用方需要分支时才用）

当上层必须**按失败种类分支**（重试 / 降级 / 换文案）时，才定义一个领域错误类，**并且同时提供判别器**：

| 判别方式 | 实例 |
| --- | --- |
| 类型守卫函数 | `isVectorEmbeddingError_ACU`（`data/gateways/vector-embedding-gateway.ts:56`）、`isPlotStageError_ACU`（`service/runtime/plot-runtime/plot-runtime-phase.ts:45`）、`isStrictLorebookReadError_ACU`（`service/worldbook/pipeline.ts:954`） |
| 结构化载荷 + 代码 | `ContinuationValidationError_ACU`（`service/continuation/model.ts:85`）带 `.error.code`，上层按 `CONTINUATION_OPERATION_BUSY` / `CONTINUATION_AGENT_BLOCKED` 等分支（`useContinuationRuntime.ts:407`、`agent-main-loop.ts:982`） |
| 重试提示字段 | `VectorEmbeddingError_ACU` 的 `retryable` / `retryAfterMs`，退避逻辑直接读它（`vector-embedding-gateway.ts:286-292`） |

- 命名 `XxxError_ACU`；**放产生它的那一层**（既有先例：`shared/sheet-identity.ts:48`、`data/sqlite/sqlite-engine.ts:64`、`service/table/sql-table-service.ts:647-678`）。
- **判别器是硬要求**：没有判别器的错误类，上层只能靠 `error.message` 文本匹配分支，非常脆。现有 `isMissingExternalVectorFileError_ACU(message: string)` 属历史例外，**不要再添新的**。

---

## 宿主能力不可用时的降级

宿主差异与能力探测集中在 `shared/host-bridge.ts`（规则 L0-9）。宿主桥失败**只 `console.warn`，不阻断插件加载**（规则 L0-11 / L0-12：跨宿主插件禁用 Host Bridge，走可移植子集）。

不装酒馆助手（JS-Slash-Runner）时核心表格功能必须照常工作，世界书类能力给出**可操作提示**而非抛未捕获异常（真机清单见 `source/docs/TESTING.md` 第 1 节）。

## 面向用户的错误说明

不要新增一套「错误码 → 文案」表：`presentation-v2/composables/log-error-hints.ts` 已把运行日志的报错翻成「大概是什么问题 + 可以怎么处理」，规则按**越靠前越具体**排序，最后一条保证兜底，且是纯字符串匹配、不依赖 DOM/Vue（便于单测）。新错误的用户口径应加进该文件的规则表。

---

## 反模式

- 新增领域错误类却**不给判别器**（上层只能靠 `message` 文本匹配分支）。
- 用异常做正常控制流（找不到行不是异常，返回 `null` / `success: false`）。
- catch 之后既不记日志也不返回，导致失败静默（调试时只能靠猜）。
- 把 `any` 抛出去穿透到 UI 而不加任何上下文。

---

## 验证

```bash
cd source
# 领域错误类基线（2026-09-27 = 22）；新增的每个类都应能在同目录找到 isXxx / .code 判别
grep -rn "^export class .*Error_ACU extends Error" src/ | wc -l
npx vitest run tests/service tests/shared
```

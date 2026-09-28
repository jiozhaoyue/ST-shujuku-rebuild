# 日志

> 本仓**不用第三方日志库**。三个函数 + 一个零 DOM 的内存缓冲区，外加「报错 → 用户可照做的处理建议」一层。

---

## 三个函数（唯一入口）

定义在 `shared/utils.ts:172-190`：

| 函数 | console | 写入缓冲区 | 开关 |
| --- | --- | --- | --- |
| `logDebug_ACU(...args)` | `console.log` | 仅开关开启时 | `DEBUG_MODE_ACU`（console）+ `isDebugLogEnabled()`（缓冲） |
| `logWarn_ACU(...args)` | `console.warn` | 仅开关开启时 | `isWarnLogEnabled()`，**关闭时直接 return（console 也不打）** |
| `logError_ACU(...args)` | `console.error` | **始终写入** | 无 |

- 前缀由函数自动加：`[${SCRIPT_ID_PREFIX_ACU}]`；`SCRIPT_ID_PREFIX_ACU = UNIQUE_SCRIPT_ID`（`shared/constants.ts:18`），即 `shujuku_v120`。
- 约定：**首参写 `[模块] 中文说明`**，变量与 error 对象作为后续参数。例：`logDebug_ACU('[自动填表] 读取已处理集合失败，按放行处理:', error)`（`service/table/auto-fill-echo-guard.ts:114`）。
- WebView/真机排障时想看到 warn 与 debug，先确认对应采集开关（`shared/v2-ui-state.ts`）已打开。

## 缓冲区与 UI

`shared/log-buffer.ts`：

- 零 DOM 依赖的内存日志，`LogLevel = 'debug' | 'warn' | 'error'`（`:14`）。
- 每条含自增 `id`、`timestamp`、`level`、以及**从消息里提取的 `[xxx]` 标签**（如 `SQL` / `ORM` / `条件模板`）。
- presentation 层通过 `subscribe` 实时接收新日志渲染（UI 侧消费者见 `presentation-v2` 的运行日志面板）；不要在 UI 里另建日志管道。

## 面向用户的处理建议

`presentation-v2/composables/log-error-hints.ts`：把 error 级日志翻译成「一句话说明 + 可直接照做的步骤」。规则**越靠前越具体**（明确短语、HTTP 状态码），越靠后越宽泛（按功能模块兜底），最后一条通用兜底。纯字符串匹配、可单测。

## 出站提示词观测（`service/ai/prompt-observer.ts`）

「AI 到底收到了什么提示词」的观测面，唯一埋点在 `buildCustomApiRequestBody_ACU`
（`service/ai/api-call.ts`，全插件唯一的请求体组装漏斗 ⇒ 覆盖全部 AI 功能域）。
排查面板见 `presentation-v2/components/PromptInspectionPanel.vue`。

**四条硬约束**（改这块代码时必须保持）：

1. **零开销**：开关关闭时调用方只做一次布尔读取 + 一个分支即返回，不分配、不复制字符串、不算 token。
   观察器内部**再自守一次**开关，使「关闭 ⇒ 不记录」成为模块不变量而非调用方纪律。
2. **绝不弄坏主链**：观察器任何路径都不抛错、不 `await` 调用方；token 估算走独立串行链异步补写。
3. **只存内存**：不落 localStorage、不写 console 正文；上限三重（条数 30 / 单条正文 120k 字符 / 总 2MB）。
4. **密钥在结构上拿不到**：埋点只传 `{model, url, stream}` 三个出站终值，
   **不传 `effectiveApiConfig` 本体**（它含 apiKey / requestHeaders / bodyParams / proxyPassword）。
   端点只存 `new URL(url).host`。这比「先采集再过滤」可靠 —— 拿不到就不会漏。

**坑（实测）**：正文脱敏**不能**先 `JSON.stringify` 再整串过 `maskSensitiveText_ACU` ——
序列化会把内容里的 `"` 转义成 `\"`，而该函数的 JSON 形态规则依赖**未转义**的引号，于是静默漏网
（实测：`{"api_key":"sk-…"}` 能命中，`{\"api_key\":\"sk-…\"}` 命中不了）。
正确做法是**在对象图上、字符串还没被转义时**逐字段脱敏，之后再 stringify。

## 响应观测（第二段，`prompt-observer.ts` 的 `beginPromptStreamObservation_ACU`）

在「出站提示词」之上再记一段 **AI 响应正文**，与所属记录配对。接线点在 `service/ai/api-call.ts`
的**两个** AI 出口：`postChatCompletion_ACU`（主生成，无硬超时）与
`callAIWithResolvedPreset_ACU`（内部调用，带 120s 超时）。
**判据**：`grep -n "handleApiResponse_ACU(" source/src/service/ai/api-call.ts` 的调用点数
应等于已接线数 —— 上游若新增/改名 AI 出口，必须同步接线，否则出现「有提示词、无正文」的半截记录。

**配对机制**：`buildCustomApiRequestBody_ACU` 记录时把**请求体对象引用**存进 `WeakMap<object, number>`；
下游出口收到的是**同一个引用** ⇒ 直接取回记录 id。不做字符串指纹、不做时间窗猜测。
前提是「同一引用」—— 若某调用方重新构造了 body，则取不到、该次不观测正文（**不猜**）。

**坑（实测，极易写错）**：`transport`（取回方式）**不能**由「`onDelta` 是否被调用」推断 ——
`parseStreamResponse_ACU` 的**整读回退分支同样逐行触发 onDelta**
（`service/ai/prompt-builder/prompt-api-call.ts:583` 对 `text.split('\n')` 逐行调
`consumeSseLine_ACU(line, state, onDelta)`）。正确判据是 `resolveStreamTransport_ACU`
（`api-call.ts`）的 `response.body?.getReader` 能力检测，**与 `parseStreamResponse_ACU:557` 同一判据**。
三档语义：`incremental`（真增量）/ `buffered`（SSE 整读回退）/ `json`（未走 SSE）。

**有界收尾**：成功路径调 `finish`、异常路径调 `abort`，两者都必须能 settle（规则 L1-MR-7）。
handle 的三个方法（`onDelta` / `finish` / `abort`）**都不抛错、都不 await**。

## 写库流水观测（第三段，`service/table/write-pipeline-observer.ts`）

「AI 说完了到底要写什么」的观测面。唯一埋点在写库主链的**单一收口点**
`service/table/table-update-commit.ts` 的 `runTableUpdateCommit_ACU`
（填表 / agent 协议 / chat-service / 可视化保存 / 导入全走它）。
观测代码**不识别来源**，只透传 `options.source` —— 新增写入来源**无需**改观测代码（这就是设计判据）。

| 埋点位置 | `outcome` | 说明 |
| --- | --- | --- |
| `saved === true` 之后 | `saved` | 落盘成功；记的是**实际提交给持久化层**的 `operations` |
| `skipChatSave` 的 else 分支 | `runtime_only` | 只改运行时、未落盘 |
| 外层 `catch` 内、`return` 前 | `failed` | 带 `errorCategory` |

**边界（不是缺口）**：函数入口的**前置门禁失败**（provisional bridge 未清理 / legacy 迁移未通过 /
commit scope 已切换 / `stage_only` 分支）是**直接 `return`、不经 `catch`** ⇒ 不产出记录。
这属「提交根本没开始」而非「提交失败」，其诊断信息仍由既有 warn/error 日志承载。

**如实标注优先于好看**：`operations` 取 `persistOptions.operations ?? options.operations`；
两者皆空时置 `operationsUnavailable: true`，UI 显示「未提供语句（由持久化层构建）」
—— **不得**把它显示成「写了 0 条」。

**语句富化**（纯函数 `summarizeMutationOperations_ACU`，可单测、不依赖开关）：覆盖
`service/table/storage-frame-v2-types.ts:273-282` 的全部 9 种 operation kind；
未知/畸形 kind **不得抛错**，降级为 `structured / other` 并保留 kind 名。
裸 SQL 复用 `shared/restricted-sql-dml.ts` 的 `parseRestrictedSqlDml_ACU`（**不自己写 SQL 解析**）；
DSL 按**行**拆分（`insertRow` / `updateRow` / `deleteRow`；首参是**表索引** ⇒ 表名记 `#N`，不猜名）。

**就近关联的诚实边界**：第三段 → 第一段用「来源 → scope 映射 + 10 分钟窗口」取最近一条提示词记录
（提交时请求体引用已不在作用域，无法用 WeakMap）。窗口外或无映射来源 ⇒ **不给关联**，
UI 显示「无关联」，不做超出该口径的推断。

**面板**：`presentation-v2/components/WritePipelinePanel.vue`（Developer 页），
三段在**同一个面板**内呈现：出站提示词摘要 → 响应正文（含 transport 徽章）→ 语句列表。
开关 `writePipelineEnabled` 与 `promptInspectEnabled` 同形态（`stores/dev-options-store.ts`），
默认关闭、关闭零开销。

## 裸 console 的边界

全仓 `shared/service/data` 的裸 `console.*` 只有 **12 处**（2026-09-27 实测），且集中在两类位置：

1. 日志函数自身实现（`shared/utils.ts:173,182`）；
2. **日志设施尚不可用的极早期**——`shared/env.ts:39`（localStorage 不可用）、`shared/runtime-env.ts:108-112`（多实例接管判定）。

**除此之外一律走 `logDebug_ACU` / `logWarn_ACU` / `logError_ACU`。**

## 不要记录的东西

- API 密钥与请求头：端点安全放行时的告警只写**主机名**，不写完整 URL 的凭据部分（见 `shared/utils.ts:578` 附近的按主机去重逻辑）。
- 用户聊天内容整段：需要留证时写**长度/计数/标识**，不写正文。
- 任何写入日志缓冲区的敏感值都会同步出现在 UI 的运行日志面板里（用户可见），按同一标准裁剪。

## 反模式

- `console.log` 直接出现在 service/data 的新代码里。
- 用 `logWarn_ACU` 记「正常路径」信息 —— warn 默认不采集，用户排障时看不到。
- 拼字符串拼出日志（`logDebug_ACU('失败：' + err)`），应把 `err` 作为独立参数传入，保留堆栈与对象结构。

## 验证

```bash
cd source
# 新增的裸 console（期望：只有 utils.ts / env.ts / runtime-env.ts 这几处既有位置）
grep -rn "console\.\(log\|warn\|error\)" src/shared src/service src/data
npx vitest run tests/shared
```

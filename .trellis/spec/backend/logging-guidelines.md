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

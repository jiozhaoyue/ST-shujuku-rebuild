# T3.1 技术设计 · 真流式增量读取

> 需求与验收见 `prd.md`（R1–R8 / C1–C5 / AC1–AC9）。

## 1. 现状与问题

`source/src/service/ai/prompt-builder/prompt-api-call.ts:460` 的 `parseStreamResponse_ACU`：

```ts
const text = await response.text();          // :462 —— 整段读，拿不到任何中间态
let result = ''; let sawDone = false; let capturedUsage = null;
for (const line of text.split('\n')) { ...逐行解析并拼接 delta... }
if (!sawDone) return null;                   // 截断 → null
return result || null;
```

问题（**只有两个，都不改变返回值**）：

1. **停滞不可诊断**。`await response.text()` 在流中途卡住时没有任何进度信号；
   唯一的兜底是 `api-call.ts:748` 的 120s `timeoutController`（该计时器**覆盖正文读取**，`:802` 才清），
   所以**不是无界**，但用户与排查者只能等满 120s 然后看到一个笼统超时。
2. **截断不可判**。`[DONE]` 缺失时只能知道「被截断了」，不知道「收到过多少 delta」。

因此本任务**不改返回值语义**，只把「读」这一步变成可观察的。

## 2. 边界与契约

### 2.1 对外契约（不破坏 C1/C2）

```ts
// 签名：新增第 3 个可选参数，前 2 参语义与现状逐字一致
async function parseStreamResponse_ACU(
  response: any,
  onUsage?: (usage: AiUsageMetadata_ACU) => void,
  onDelta?: (delta: string) => void,      // 新增，可选，观测用
): Promise<string | null>

// handleApiResponse_ACU 同步新增第 3 参并透传；wantsStream 三态判定不动
export async function handleApiResponse_ACU(
  response: any,
  requestWantsStream?: boolean,
  onUsage?: (usage: AiUsageMetadata_ACU) => void,
  onDelta?: (delta: string) => void,
): Promise<string | null>
```

`handleApiResponse_ACU` 现有 **2 个**外部调用点——`source/src/service/ai/api-call.ts:537`
（即 `postChatCompletion_ACU` 自身）与 `:782`（主生成出口）——**全部无需改动**：
新增参数可选，不传即零差异。

> 更正记录（步骤 0.4 实测）：本设计初稿写「3 处」，把 `:537` 与 `postChatCompletion_ACU` 重复计了一次。
> 实测 `grep -rn "handleApiResponse_ACU(" src/ | grep -v prompt-api-call.ts` 只有这 2 条。

### 2.2 内部契约（**本设计的关键**）

把「逐行解析」抽成**唯一**的行消费者，两条路径**共用**它：

```ts
interface SseParseState_ACU {
  result: string;
  sawDone: boolean;
  usage: AiUsageMetadata_ACU | null;
}

/** 处理一行 SSE；行为与现状 :466–:490 的循环体逐字等价 */
function consumeSseLine_ACU(
  line: string,
  state: SseParseState_ACU,
  onDelta?: (delta: string) => void,
): void;
```

**为何这样切**：逐字节一致（R3/AC1）由**构造**保证，而不是由「两处实现写对」保证 ——
两条路径跑的是同一段代码，差异只可能在「怎么把字节切成行」这一件事上，而那件事被下面这个纯函数隔离并可穷举测试。

```ts
/** 把字节流切成行；与 `text.split('\n')` 等价（含末行无换行、`\r\n`、空行） */
function createSseLineSplitter_ACU(onLine: (line: string) => void): {
  push(chunk: string): void;
  flush(): void;
};
```

## 3. 数据流

```
[增量路径]
response.body.getReader()
  → reader.read() 循环 → TextDecoder(stream:true).decode(value)
  → splitter.push(text)                    ─┐
       └─ 每遇 '\n' → onLine(line)          │ 同一段
  → EOF：decode() 冲掉解码器残留 → flush()  │ 消费者
       └─ 末行（无换行）→ onLine(line)       │
                                          ─┘
[回退路径]
response.body 不可用 → await response.text() → text.split('\n') → onLine(line)

                     ▼
        consumeSseLine_ACU(line, state, onDelta)
                     ▼
        state.result / state.sawDone / state.usage
                     ▼
        sawDone ? (result || null) : (warn + null)
```

## 4. 关键决策与理由

### D1 `TextDecoder({stream: true})` 是**必需**，不是优化

正文是中文。一个 UTF-8 汉字 3 字节，**chunk 边界可能切在字符中间**。
用 `new TextDecoder().decode(value)`（不带 `stream`）会把半个字符解成 U+FFFD，
且是**静默错误**（只在特定网络分块下出现）。必须：
- 每次 `decode(value, { stream: true })`；
- EOF 时 `decode()` 无参调用一次，冲掉解码器内部残留的半字符。

→ AC2 必须含「中文内容 + 切在字符中间」的用例。

### D2 回退判据：**用能力检测，不用 try/catch 兜**

```ts
const body = response?.body;
if (body && typeof body.getReader === 'function') { /* 增量路径 */ }
else { /* 整读回退 */ }
```

理由：现有测试桩给的是裸对象（`{ text: async () => ... }`，`body` 为 `undefined`），
`api-call.test.ts` 里大量用例都这样构造。用能力检测 ⇒ **既有用例零改动**（AC3）。
用 try/catch 兜则会掩盖真实读流错误。

### D3 取消：**不新增机制**，复用既有信号链

`reader.read()` 的 promise 由 fetch 的 `signal` 绑定（`api-call.ts:758` 把
`timeoutController.signal` 交给 fetch）。该信号 abort 时，`read()` 以 `AbortError` reject →
穿透到既有 `catch`（`:506`）→`if (e?.name === 'AbortError') throw e` 原样上抛 →
`api-call.ts:786/:793` 按 `signal.aborted` / `timeoutController.signal.aborted` 分类为
「请求已取消」/「超时」两种 `TimeoutError`/`AbortError`。

**因此 R5/C3 天然满足，本任务不引入新的超时或竞速逻辑。**
不再自己加 `readBodyWithAbort_ACU` 式的竞速：那会与既有 120s 计时器**重叠**，制造两套取消语义。

> `source/src/service/continuation/agent/agent-web-client.ts:92` 的 `readBodyWithAbort_ACU` 是
> 该文件私有的、用于「promise 可能永不 settle 且无外部信号绑定」场景的兜底；本任务不属于该场景。

### D4 停滞诊断：**只报，不掐**

```ts
const SSE_STALL_DIAG_MS_ACU = 30_000;   // 具名导出，供测试与后续调优
```

- 每收到一个 chunk 重置计时器；超时则 `logDebug_ACU` 一次（**不重复刷屏**）。
- **不主动 abort**：中断语义归 120s 计时器独有。本任务若也掐，两个阈值会打架，
  且改变既有行为（违反 R2/AC-D）。
- 走 `logDebug_ACU` 而非 `logWarn_ACU`：该函数受 `DEBUG_MODE_ACU` 与
  `isDebugLogEnabled()` **双门控**（`shared/utils.ts:172`），默认**完全静默** ⇒
  不破坏 AC-D 的「观测关闭时日志无差异」。
- `finally` 里 `clearTimeout`：与 `api-call.ts:800` 同样纪律，防计时器随轮数堆积。

### D5 逐块回调只喂**解析后的 delta**，不喂原始字节

`onDelta` 在 `consumeSseLine_ACU` 内、`result += delta` 旁边调用。
理由：观测者关心的是「模型输出了什么」，不是「TCP 分了几个包」。原始分块时序属于 D4 的停滞诊断范畴。

调用纪律（R6/AC6）：

```ts
if (onDelta) { try { onDelta(delta); } catch { /* 观测异常绝不影响主流程 */ } }
```

**绝不 await**（同步调用，不做 promise 化）；不传 `onDelta` 时该分支只是一次布尔判断。

### D6 被否方案

| 方案 | 否决理由 |
| --- | --- |
| 把 `onDelta` 做成 async / 返回 promise | 会把观测拖进主链的关键路径；违反 R6 与阶段 2「绝不 await 调用方」契约 |
| 自己加 idle timeout 主动掐断 | 与既有 120s 计时器语义重叠；改变行为（R2） |
| 用 `for await (const chunk of response.body)` | 需要 body 是 async-iterable；跨宿主的 `Response` polyfill 不保证；`getReader()` 才是标准最小面 |
| 整读路径也改成逐 chunk 走一遍（统一为单路径） | 回退路径的意义就是「救命稻草」，越简单越好；让它继续用 `text()` 最短路径 |

## 5. 兼容性

| 面 | 影响 |
| --- | --- |
| 非流式路径 | **零改动**（C2） |
| `api-call.ts` 超时/取消 | **零改动**（C3） |
| 现有测试桩（`{text: ...}` 裸对象） | 走回退路径，**零改动通过**（AC3） |
| 四宿主（ST / Luker / PureTavern / TauriTavern） | `response` 由宿主 fetch 产出，标准 `Response` 都有 `body`；TT 的 ABI 注入同理。**回退路径保证最坏情形也不退化** |
| 观测（阶段 2 / T3.2） | 新增可选回调，不传即零差异 |
| 上游同步 | **新增差量**，须登记台账（C7/AC8）：下次追平该函数必冲突，口径为「按我方」 |

## 6. 回滚

单文件、单函数。回滚 = 撤 `prompt-api-call.ts` 的改动 + 撤新增用例；
`onDelta` 为可选参数，无外部引用需要连带处理。
产物回滚 = `cd source && npm run build` 重建分发产物。

## 7. 交付物

- `source/src/service/ai/prompt-builder/prompt-api-call.ts`（改）
- `source/tests/service/ai/prompt-api-call.test.ts`（增用例 + 更正 `:797` 错误注释）
- 台账 `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`（登记新差量）
- 分发产物（`index.js` 等，`npm run build` 生成，不手改）

# 设计 — 提示词拼接排查（Developer 页内嵌检查器）

> 上游依据：`prd.md`（需求 R1–R10 / 验收 AC1–AC8）。本文件只写**技术设计**：边界、契约、数据流、权衡、回滚。

---

## 1. 落点与模块划分

**新增 3 个文件**

| 文件 | 职责 | 层 |
| --- | --- | --- |
| `src/service/ai/prompt-observer.ts` | 观察器：开关 flag、有界环形缓冲、订阅、脱敏导出、scope 记忆（转调 drift 内核） | service（可被 presentation 读） |
| `src/presentation-v2/components/PromptInspectionPanel.vue` | 面板：列表 + 明细 + 分段统计 + diff + 清空 + 导出 | presentation-v2 |
| `src/presentation-v2/composables/usePromptInspection.ts` | 面板的数据接缝：订阅观察器、开合状态、导出触发 | presentation-v2 |

**改 3 处（都是小改）**

> **2026-09-28 执行期更正**（实测推翻原 §1 的落点判断，改动面比原设计更小）：
> 1. `prepareAIInput_ACU` **不返回拼接后文本**，而是返回分段对象
>    （`{tableDataText, messagesText, worldbookContent, worldbookDatabaseExcludedContent, manualExtraHint, …}`）。
>    它是「素材准备」，不是「最终组装」。
> 2. 真正的最终组装在 `callCustomOpenAI_ACU`：它把素材按 `$0/$1/$4/$6/$8/$9/$U/$C`
>    **单遍替换**进 `charCardPrompt` 模板。**占位符替换点就是天然的分段边界**，
>    且值经 nonce 保护、出站前原样还原 ⇒ 替换进正文的字符数即该段长度，段级统计**免费**。
> 3. 因此原计划的 3.1 / 3.3（改 `prepareAIInput_ACU` 与 `update-orchestrator`）**均不需要**，
>    段级上报只改 `prompt-api-call.ts` 一处。

| 位置 | 改动 |
| --- | --- |
| `src/service/ai/api-call.ts:323` `buildCustomApiRequestBody_ACU` | 入口取一次布尔；返回前插唯一埋点 `if (observePrompt_ACU) recordPromptAssembly_ACU({...})`；`overrides` 增加可选的 `promptSegments`（填表链传入）。**只传实际出站值** `{model: body.model, url: body.reverse_proxy, streamingEnabled: body.stream}` —— 不传 `effectiveApiConfig` 本体（它含 apiKey / requestHeaders / bodyParams / proxyPassword），使泄露在结构上不可能 |
| `src/service/ai/prompt-builder/prompt-api-call.ts` `callCustomOpenAI_ACU` | 占位符替换回调与表名 token 替换处按段累计字符；「骨架」= 该条消息最终长度 − 被注入字符数；仅观测开启时构造，透传进 `buildCustomApiRequestBody_ACU` 的 `promptSegments` |
| `src/presentation-v2/pages/DeveloperPage.vue` + `stores/dev-options-store.ts` | 挂新面板（沿用 `AcuPanelGrid` 骨架）；store 增 `promptInspectEnabled` 键，变更时调观察器 setter |

**不搬动** `agent-prompt-drift.ts`：它虽在 `service/continuation/agent/` 下，但内容是通用提示词 diff。跨域 import（`service/ai → service/continuation`）在本仓分层里是**允许**的（只有 `shared→上层` 与 `data→service` 被禁）。搬家的收益是更好看的分层，代价是改动既有测试路径与调用点——**不值得**，改为在观察器文件头注明「此处刻意跨域复用，避免同一内核出现两份」。

**但 scope 序列记忆刻意不共用** `trackAgentPromptDrift_ACU` 的 Map：那个 Map 归 agent 主循环所有（`agent-main-loop.ts` 用它打印自己的漂移日志）。若共用，观测器每次记录都会顶掉主循环的「上一次序列」，改变既有 debug 输出 ⇒ 违反 R9。故只转调纯函数 `compareAgentPromptMessages_ACU`，序列记忆由观察器自持。

---

## 2. 契约

```ts
// service/ai/prompt-observer.ts

/** 老规矩：flag 状态由低层持有，store 负责推送（同 shared/log-buffer 的 applyWarnLogEnabled 形态）。 */
export function setPromptObservationEnabled_ACU(enabled: boolean): void;
export function isPromptObservationEnabled_ACU(): boolean;

export interface PromptMessageStat_ACU {
  role: string;
  chars: number;
  /** 异步补齐；未算完时为 undefined（UI 显示 —） */
  tokens?: number;
}

/** 段级报告：只由填表链产出（R3）。 */
export interface PromptSegmentStat_ACU {
  /** 段名，如 '骨架' / '表结构DDL' / '世界书' / '历史消息' / '运行时数据' */
  name: string;
  chars: number;
  tokens?: number;
}

export interface PromptObservationRecord_ACU {
  id: number;
  at: number;                       // epoch ms
  scope: string;                    // 取 sessionNamespace；缺失时为 'unknown'
  model: string;
  endpointHost: string;             // 只存主机，不存完整 URL（R6）
  stream: boolean;
  messageCount: number;
  messages: PromptMessageStat_ACU[];
  totalChars: number;
  totalTokens?: number;
  /** 与同 scope 上一次调用的 diff（复用 F3 内核输出，原样保留结构） */
  drift: AgentPromptDriftReport_ACU;
  /** 仅填表链有；其他域为 undefined → UI 显示「未分段」 */
  segments?: PromptSegmentStat_ACU[];
  /** 正文按上限截断时置位（见 §5 内存上限） */
  truncated?: boolean;
}

export function recordPromptAssembly_ACU(input: {
  messages: ReadonlyArray<{ role: string; content: string }>;
  effectiveApiConfig: any;
  overrides?: { sessionNamespace?: string; segments?: PromptSegmentStat_ACU[] };
}): void;

export function getPromptObservations_ACU(): readonly PromptObservationRecord_ACU[];
export function subscribePromptObservations_ACU(cb: (records: readonly PromptObservationRecord_ACU[]) => void): () => void;
export function clearPromptObservations_ACU(caller?: string): void;
/** 导出：先过既有脱敏，再序列化（R5/R6） */
export function exportPromptObservations_ACU(): string;
export function __resetPromptObservationForTests_ACU(): void;
```

**关键约束**：`recordPromptAssembly_ACU` **不返回值、不抛错**（全文 try/catch + `logDebug_ACU` 降级）——观察器绝不能弄坏主生成链（规则 L0-11 的降级纪律）。

---

## 3. 数据流

```
填表:   prepareAIInput_ACU ──(segmentSink)──┐
                                            ├─→ callCustomOpenAI_ACU ─┐
其他域:  各自拼 messages ────────────────────┼─→ callAIWithPreset_ACU ─┤
                                            │   callAIWithResolved... ┤
                                            │   callApiWithPlotPreset ┤
                                            │   postChatCompletion ───┤
                                            ↓                         ↓
                              buildCustomApiRequestBody_ACU  ←── 唯一埋点
                                            ↓
                     recordPromptAssembly_ACU（scope 从 overrides.sessionNamespace 取）
                                            ↓
                     环形缓冲 ── subscribe ──→ usePromptInspection ──→ PromptInspectionPanel
                                            ↓
                              exportPromptObservations_ACU（脱敏后 JSON）
```

- **为什么埋在 `buildCustomApiRequestBody_ACU` 而不是 fetch 点**：fetch 点只有两处（`api-call.ts:497` 与 `:731`）且**拿不到**「组装时的语义」（namespace、原始 messages）；而 body 组装点同时握有 messages、config 与 namespace，且**是全插件唯一**（F1 的 5 个调用方即全部覆盖）。fetch 点若要覆盖提示词以外的东西（响应、耗时），留给阶段 3。
- **scope 取 `sessionNamespace`**（F2）：已经是事实标准，不新造；缺省 `'unknown'`（仍记录，UI 显示「未标注」）。
- **token 估算异步补齐**：`countTextTokens_ACU` 是异步且可能走宿主分词器（F5），**绝不阻塞发送**——记录先落字符数，估算结果回来后原地补进记录并通知订阅者（拿到前 UI 显示 `—`）。

---

## 4. 段级方案（仅填表链，R3）—— 执行期更正后的实现

`callCustomOpenAI_ACU` 把 `charCardPrompt` 的各段模板按占位符单遍替换成素材。**占位符就是段边界**，
因此段级统计不需要任何额外埋点，只在替换回调里按名累计字符数：

| 占位符 | 段名 | 素材来源 |
| --- | --- | --- |
| `$0` | 表数据与DDL | `dynamicContent.tableDataText` |
| `$1` | 历史消息 | `dynamicContent.messagesText` |
| `$4` | 世界书 | `dynamicContent.worldbookContent` |
| `$6` | 上轮规划 | `getPlotFromHistory_ACU()` |
| `$8` | 运行时数据 | `dynamicContent.manualExtraHint` |
| `$9` | 世界书(排除库) | `dynamicContent.worldbookDatabaseExcludedContent` |
| `$U` | 用户设定 | persona description |
| `$C` | 角色设定 | char description |
| `{{表名}}` | 表名世界书 | `resolveTableWorldbookContent` 解析结果 |
| （残差） | 骨架 | 该条消息最终长度 − 上述注入量之和 |

要点：

- **账要平**：`骨架` 用残差算，保证 `Σ各段 === Σ各消息字符`。宿主侧后续的 role 归一 /
  非预填充改写（给 assistant 消息加「助手：\n」）会让最终总字符略大于分段之和 —— 记为
  `unsegmentedChars` 如实展示，不藏。
- **只在观测开启时统计**：`observePrompt_ACU` 为假时所有 `addSegmentChars_ACU` 调用短路（R7）。
- 段名常量集中在 `prompt-observer.ts` 导出，`prompt-api-call.ts` 引用之，避免两处各写一套字符串。
- 该报告**不参与任何逻辑**，只随记录上行。

---

## 5. 复用清单（不新造）

| 需要 | 复用什么 | 位置 |
| --- | --- | --- |
| 提示词 diff | `compareAgentPromptMessages_ACU` / `formatAgentPromptDriftReport_ACU` + scope 记忆 | `service/continuation/agent/agent-prompt-drift.ts` |
| token 估算 | `countTextTokens_ACU` | `service/ai/token-counter.ts` |
| 脱敏 | `redactSensitiveApiHeadersForDebug_ACU` / `redactSensitiveIncludeBodyForDebug_ACU` | `service/ai/api-call.ts` |
| 环形缓冲 + 订阅形态 | 照 `shared/log-buffer.ts` 的形状（零 DOM、`subscribe` 返回退订、`_resetForTesting`） | `shared/log-buffer.ts` |
| 面板骨架 / 统计条 / 折叠 / 段列表 | `AcuPanelGrid` / `AcuPanel` / `AcuStatsList` / `AcuDisclosureGroup` / `AcuPromptSegments` | `presentation-v2/components/_lib/` |
| 持久化开关 | `readSection` / `writeSection`（`acu_v2_ui_state` 的 dev-options 节） | `presentation-v2/stores/persistence.ts` |
| 导出 JSON 形态 | 既有「Debug 面板导出 JSON」先例 | `source/docs/TESTING.md` 提到的 selfCheck 导出 |

---

## 6. 红线与不变量

1. **开关关闭时零行为变化**：埋点是一次 flag 判断 + 立即返回；`buildCustomApiRequestBody_ACU` 的返回值逐字节不变（AC1 用例钉住）。
2. **不阻塞主链**：观察器任何路径都不抛错、不 await、不改写 `messages`/`body`。
3. **脱敏**：展示与导出都过既有脱敏；端点只留主机（同「按主机去重」告警口径，`shared/utils.ts:578`）。
4. **内存有界**：记录数上限 30 条；单条正文上限 120,000 字符（超出截断并置 `truncated`）；总缓冲超 2MB 时丢最旧。上限常量具名导出，便于测试与后续调参（阶段 4 的「可调项注册表」再决定是否暴露给用户）。
5. **只存内存**：不写 localStorage、不写 console（R9）。
6. **UI 纪律**：新页面用 `AcuPanelGrid` 并加入 `panel-grid-conventions.test.ts` 的 `panelGridPages`；类名 `acu-` 双前缀 + `<style scoped>`；不引第三方库；导入一律相对路径。
7. **分层**：观察器在 service；不得被 `shared/` 或 `data/` 引用；UI 只经 composable 访问。

---

## 7. 权衡记录（备选与否决理由）

| 议题 | 选择 | 否决的备选与理由 |
| --- | --- | --- |
| 观测面 | 单点漏斗 `buildCustomApiRequestBody_ACU` | ① 原计划「六类各埋一个 scope」——研究证明无必要（F1/F2）；② 埋在 fetch 点——拿不到 namespace 与原始 messages |
| scope 键 | 复用 `sessionNamespace` | 新造 `promptScope`——要与 9 处调用点同时改，且与既有标签重复 |
| 段级范围 | 只做填表链 | 六类全做——其他域没有「段」概念，需先造一套（超出本阶段） |
| 段级传参 | `options.segmentSink`（不改编排器返回类型） | 改成返回 `{content, segments}`——会波及既有调用点与可能的测试断言；sink 由构造上就零波及 |
| 开关 | 面板内「开始记录」+ 既存 dev-options 节 | ① 复用 `isDebugLogEnabled()`——会把 console 打开、两个关注点耦合；② 新增 localStorage key——违反 `state-management` spec |
| 正文深度 | 存全文（内存） | 只存摘要——用户已裁定要全文（排查力优先）；隐私面用「只存内存 + 复用脱敏」封住 |
| 记录持久化 | 不留 | 留盘会写入用户聊天内容到浏览器存储，超出本阶段需要 |

---

## 8. 回滚

- **默认姿态即回滚**：开关默认关闭 → 无记录、无 UI 影响。
- 若要整体移除：删 3 个新文件 + 撤 5 处改动（都是小改，`git revert` 单个提交即可）；无数据迁移、无持久化残留。
- 分段 sink 是可选参数，撤回后调用方不需要同步改动。

---

## 9. 测试策略

| 层 | 用例 |
| --- | --- |
| 观察器单测（新） | 开关关闭时不记录（计数 0）；开启后记录条数/字符数正确；环形上限丢最旧；清空；订阅收到通知；导出经脱敏（**含 API 密钥的配置断言不含密钥**）；异步 token 补齐不阻塞（记录先出现） |
| 回归（既有） | `buildCustomApiRequestBody_ACU` 返回值逐字节不变（AC1）；`agent-prompt-drift` 既有用例不动即通过 |
| 分段单测（新） | sink 在场时产出段报告且各段字符之和 ≤ 总字符；sink 缺失时不产生任何统计 |
| UI 测试（新） | 面板渲染记录列表、展开显示分段、非分段记录显示「未分段」、清空按钮生效、`panel-grid-conventions` 通过 |
| 真机（人工） | Dev 实例 8001 上跑一次填表，按 AC2/AC3 观察 |

---

## 10. 实施顺序建议

见 `implement.md`（分 5 步，每步都有独立可验证的出口与回滚点）。

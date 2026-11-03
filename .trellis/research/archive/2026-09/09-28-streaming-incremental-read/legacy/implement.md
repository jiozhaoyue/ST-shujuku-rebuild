# T3.1 实施计划 · 真流式增量读取

> 需求见 `prd.md`（R1–R8 / C1–C5 / AC1–AC9），技术设计见 `design.md`（含 D1–D6 决策与被否方案）。
> **复选框随执行实时勾选，不得事后批量补勾**（规则 L0-2）。
> 每步有「出口判据」与「回滚点」；出口不达标即停在该步，不往下滚。

---

## 步骤 0 · 前置核对（只读，无代码改动）

- [x] 0.1 工作区干净：`git status --short` 输出为空（实测：空）
- [x] 0.2 基线全绿：`cd source && npx vitest run`（阶段 2 收尾态应为 **0 失败**；若有失败，先判定是否既有基线问题）
      —— **实测 424 文件通过 / 1 跳过；8696 用例通过 / 4 跳过；0 失败**（208s）
- [x] 0.3 复核 `design.md` 的行号未漂移：`parseStreamResponse_ACU` 在 `prompt-api-call.ts:460`、`response.text()` 在 `:462`；
      若漂移，只改 `design.md` 的记录，不改设计 —— **实测一致，无漂移**
- [x] 0.4 复核 `handleApiResponse_ACU` 的全部调用点仍是 3 处（`api-call.ts:537`、`:782`、`postChatCompletion_ACU`）；
      有新增调用点时确认为何不受影响
      —— **实测为 2 处**（`:537` 即 `postChatCompletion_ACU` 自身，设计初稿重复计数）。已更正 `design.md` §2.1

**出口判据**：0.2 全绿 + 0.3/0.4 的行号与调用点集合与 `design.md` 一致。
**回滚点**：无（只读）。

---

## 步骤 1 · 抽行消费者与行切分器（纯逻辑，先不接线）

- [x] 1.1 在 `prompt-api-call.ts` 内新增 `consumeSseLine_ACU(line, state, onDelta)`：
      把现状 `:466–:490` 的循环体**原样搬入**（`trim` / `startsWith('data:')` / `::slice(5).trim()` /
      `[DONE]` 置 `sawDone` / `choices[0].delta.content` 拼接 / `extractResponseUsageMetadata_ACU` 合并 /
      Anthropic `content_block_delta` 与 `message_stop` 分支 / JSON 解析失败静默忽略）。
      **逐字搬运，不改任何判定顺序** —— 这是 AC1 的根基
- [x] 1.2 新增 `createSseLineSplitter_ACU(onLine)`：`push(chunk)` 按 `'\n'` 切齐整行，
      末尾残留留在缓冲；`flush()` 把非空残留作为最后一行吐出（空残留不吐）
- [x] 1.3 新增具名常量 `SSE_STALL_DIAG_MS_ACU = 30_000` 并导出（已加进 `prompt-builder/index.ts` 桶）

**出口判据**：`npx tsc --noEmit` 干净（此时尚无调用方，允许仅定义未使用——若 lint 报未使用，
在步骤 2 接线后复查）。**实测：tsc exit 0**
**回滚点**：删这三个新增定义即可。

---

## 步骤 2 · 接线增量路径 + 保留整读回退

- [x] 2.1 `parseStreamResponse_ACU` 增第 3 参 `onDelta?`；函数体改为
      「能力检测 → 增量路径 / 整读回退」二选一，两条路径共用 `consumeSseLine_ACU`
- [x] 2.2 整读回退：保留 `await response.text()` + `text.split('\n')` + 逐行喂 `consumeSseLine_ACU`
- [x] 2.3 增量路径：`getReader()` 循环 + `TextDecoder` **带 `{stream:true}`** + EOF 时
      `decode()` 冲残留 + `splitter.flush()`（**D1 的必需项，别漏**）
- [x] 2.4 停滞诊断：每 chunk 重置计时器，超 `SSE_STALL_DIAG_MS_ACU` 时 `logDebug_ACU` **一次**；
      `finally` 中 `clearTimeout`（D4）
- [x] 2.5 收尾语义保持原样：`sawDone` 为假 → `logWarn_ACU` + `return null`；
      `AbortError` → 原样 `throw`；其余异常 → `logError_ACU` + `return null`
- [x] 2.6 `handleApiResponse_ACU` 增第 3 参 `onDelta?` 并透传（`wantsStream` 三态判定**不动**）

**出口判据**：`npx vitest run tests/service/ai` 全绿，**既有用例零改动通过**（AC3 的证据）。
**实测**：`prompt-api-call.test.ts` 改前 44/44 通过（**既有用例一字未改**）；接完线后 53/53 通过。
**回滚点**：`git checkout -- source/src/service/ai/prompt-builder/prompt-api-call.ts`。

---

## 步骤 3 · 用例（AC1–AC6）

- [x] 3.1 **穷举切分**（AC1/AC2）：取一份含中文的复合 SSE 文本（覆盖 OpenAI `delta.content`、
      多 delta、cached/creation usage、`choices:[]` 的 usage-only 行、Anthropic `content_block_delta`、
      `message_stop`），**对每一个切分点**构造两段 chunk 喂增量路径，断言结果与整读路径**严格相等**
- [x] 3.2 **字符中间切断**（D1）：把中文正文的 UTF-8 字节在**字符中间**切开后分别喂入，断言无 U+FFFD、结果与整读一致
      —— 实为**逐字节**穷举（每个字节位置切一刀，约 400 次）比原计划的「一个样例」更强
- [x] 3.3 **行内切分**：切点落在 `data:` 前缀中间、落在 JSON 花括号中间、一次 chunk 含多行、`\r\n` 行尾、末行无换行
- [x] 3.4 **回退**（AC3）：已有的 `{ text: async () => ... }` 裸对象用例保持通过；
      另加一例显式断言 `body` 为 `undefined` 时走整读
- [x] 3.5 **截断**（AC4）：无 `[DONE]` → `null` + warn；含 `message_stop` → 正常返回
- [x] 3.6 **取消可 settle**（AC5）：构造一个可控 reader，abort 后 `read()` reject `AbortError`，
      断言 `parseStreamResponse_ACU` 以 `AbortError` 上抛（**不被降级为 null**）
- [x] 3.7 **观测回调**（AC6）：不传回调零异常；传回调时逐 delta 被调；回调抛错不影响返回值
- [x] 3.8 更正 `tests/service/ai/prompt-api-call.test.ts:797` 的错误注释（C5）
      —— 另更正 `:168` 的「流式输出开关已剥离，恒非流式」（同一类陈旧注释）
- [x] 3.9 **停滞诊断**（AC10 / R7，计划外补入——原 AC 列表漏了 R7）：假计时器推进超阈值，
      断言诊断**恰好一次**、且读流**未被打断**（喂终态后照常收尾）

**出口判据**：`npx vitest run tests/service/ai/prompt-api-call.test.ts` 全绿，且新增用例**覆盖 AC1–AC6、AC10 每一条**。
**实测：53 / 53 通过**（原 44 + 新增 9）。

### 用例自证会变红（质量门要求：不得是恒真断言）

两次**故意打坏 → 确认变红 → 还原**，证据如下：

| 打坏点 | 结果 |
| --- | --- |
| 去掉 `TextDecoder` 的 `{stream:true}` | 逐字节用例**红**，失败点 **`cut: 101`**（恰在中文字符内部）⇒ D1 是真实约束，用例真的会响 |
| 把切分器改成按 `'\r\n'` 切 | **7 条新用例同时红**（AC1 穷举 / AC2 两种 / AC3 回退 / AC4 正常结束 / AC6 回调 / AC10 停滞 / 3.4 回退）⇒ 用例非恒真 |



---

## 步骤 4 · 质量门

- [x] 4.1 `npx tsc --noEmit -p tsconfig.json` 干净 —— **实测 exit 0**
- [x] 4.2 `npx vitest run` **零回退**（阶段 2 收尾态为全绿；本步不得引入任何新的失败）
      —— **实测 424 文件通过 / 1 跳过；8705 用例通过 / 4 跳过；0 失败**（191s）。
      基线 8696 → 8705，**增量恰为新增的 9 条**，零回退
- [x] 4.3 `npm run build` 成功，产物同步到仓库根 —— **实测成功**（18.1s，`dist/extension/index.js`）
- [x] 4.4 `npm run smoke` 通过 —— **实测 `acuAppV2Mounted: true` / `menuItemInjected: true` / `errorCount: 0`**

**出口判据**：4.1–4.4 全过。
**回滚点**：产物可用 `git checkout -- index.js` 等回滚（或重新 build 覆盖）。

**产物核对**：`index.js` diff 仅 **+138/−46**（与源码改动成比例）。
⚠️ 本轮**未**复现记忆中那条「本地 Windows 构建比 CI 多约 1058 个 CR 字节」的 EOL 漂移 ——
因为上一次产物也是本机构建，EOL 状态已一致。该已登记问题的**根治仍待独立任务**，勿据此认为已解决。

### 步骤 4.5 · 规范更新（工作流 3.3）

- [x] 4.5.1 `.trellis/spec/backend/error-handling.md` 新增「响应体读取：增量与整读并存」一节
      （共用消费者 / `TextDecoder({stream:true})` / 能力检测 / 不新增第二套取消语义 / 停滞只报不掐），
      并在「反模式」补两条；**两条结论都附了实测变红证据**
- [x] 4.5.2 `.trellis/spec/backend/quality-guidelines.md` 更正已过期的规模基线（421/8661 → 425/8709）

### 步骤 2.2 · 代码质量自检（单会话内联执行）

> 用户 2026-09-28 明确指定「不开子代理，直接实施」，故 `trellis-check` 的检查项由主会话内联执行。

- [x] 宿主裸判断：新增代码无 `__TAURITAVERN__` / `window.Luker` 等（grep 无输出）
- [x] 裸 `console.*`：无（grep 无输出；只用 `logDebug_ACU` / `logWarn_ACU` / `logError_ACU`）
- [x] 新增 import：无（单层自包含，未扩大 app 图依赖面）
- [x] 跨层：改动只落 `service/ai/prompt-builder/` 一层，未向上污染 presentation、未向 data 扩散
- [x] 恒真断言：无（并经两次「打坏→变红→还原」自证）
- [x] 既有调用点零改动：`api-call.ts:537` / `:782` 两处**一字未改**（新增参数可选）

---

## 步骤 5 · 台账与文档

- [x] 5.1 登记我方差量（C7/AC8）：在 `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md` 的
      「F. 调试与运维」新增条目，写明：文件、规模、上游是否已实现（**否**，上游同为 `text()`）、
      下次追平的冲突口径（**按我方**）
- [x] 5.2 在台账「1. 复跑取证」节如实记录本次改动前后的差量规模变化（若该节有基线数字）
      —— 该节无逐次基线，改为在新增的「后续增量」表下**显式声明** §2 总览数字已不含本次增量 + 刷新方式

**出口判据**：台账条目含「上游是否已实现 / 能否回归上游 / 下次冲突口径」三要素。**已满足。**
**顺带发现的既有缺口**：阶段 2 的 `prompt-observer.ts` 此前**未登记**进台账（§2 总览数字亦未含）。
本步一并补登（同一张表，各自标注引入任务），使台账的「`git diff upstream/master HEAD` 即完整差量」契约重新成立。

---

## 步骤 6 · 真机验收（**Dev 实例 8001；严禁 8002/8004**，见 P-11）—— **已完成**

- [x] 6.1 在 Dev ST 8001 上开「流式输出」，做一次真实 AI 调用（填表或世界书 Agent 均可）
- [x] 6.2 正文与改动前一致（同一预设/提示词下逐字比对，或用阶段 2 的「复制排查报告」留证）
- [x] 6.3 日志无新增 error/异常；`acu-shots/` 留证截图
- [x] 6.4 （可选，若 T3.2 已在途）确认 `onDelta` 回调被真实调用

### 环境准备（本次实测）

- Dev ST 位于 `Instance/Dev/SillyTavern`（**不是** `Dev/ST`），端口 8001（`config.yaml`）。
- `config.yaml` 是**被 git 跟踪的宿主源码**，按 L0-1 **禁改** ⇒ 关浏览器自启用命令行参数：
  `NODE_ENV=production node server.js --no-browserLaunchEnabled`（该目录 `node_modules` 已就绪）。
- 插件落点在 `public/scripts/extensions/third-party/shujuku-rebuild/`，**是个 git 克隆且 `origin` 指上游**（P-12 同类）。
  其 `manifest.json` 与我方**逐字节一致**（同 hash），故只需覆盖 `index.js`。
- 覆盖前快照：旧 `index.js` sha256 = `920d700777e0bf21a58acecca16a839f143fec137ed212a86dfaa6716269de9f`。
  **复原口径已验证可精确重现**：该 hash 恰等于 `git show 24604ec:index.js`（产物已入库，无需另存副本）。验毕已复原并核对同 hash。
- 探针：`source/scripts/host-compat-probe.mjs` 跑 `--only st` 时未按预期过滤，实际全跑四个目标 ——
  **ST / Luker / TT(ABI 注入) 三项 PASS，PureTavern FAIL 仅因其 8899 未启动**（非缺陷）。

### 核心证据：A/B 配对实验（同一脚本、同一提示词、同一会话）

用「装饰 `ReadableStream.prototype.getReader` 计数 + 抓请求体 `stream` 字段」做判别探针；
**关键前提**：调用前必须等 `ctx.chat` 就绪（否则调用在 fetch 之前失败，见下「踩坑」）。

| 指标 | 旧构建 `24604ec`（两轮） | 新构建 `59a6180`（两轮） |
| --- | --- | --- |
| 真实调用结果 | `收到` ×2 | `收到` ×2 |
| 含 U+FFFD | 无 | 无 |
| 请求体 `stream` 字段 | `true` | `true` |
| **`getReader` 被调次数** | **0** | **1** |
| **读到的 chunk 数** | 0 | **3**（多块流） |
| 服务端 bundle 含 `getReader` | 否（静态 grep 亦为 0 次） | 是 |
| 插件自身可归因报错 | 0 | 0 |

**结论**：① 流式开关确实是开的（`stream=true` ⇒ 必走 `parseStreamResponse_ACU`）；
② 增量路径在真机上**确实执行**（`getReader` 1 次、读到 3 块）；
③ 旧构建的 `getReader` 恒为 0 ⇒ 证明该计数是「我方新代码」的**特异信号**，宿主的 `response.text()` 不会触发它；
④ 两者对外可观察结果等价（同一提示词下均返回完整 `收到`、无乱码、无报错）。

**关于 AC9「正文与改动前一致」的口径说明**：AI 输出非确定，**无法**做字面字节比对。
本任务按两层证据闭合：**(a) 单元级**「两条路径逐字节一致」由穷举切分用例证明（含自证会变红）；
**(b) 真机级**「对外可观察结果等价」由本表 A/B 给出。此口径已在 `prd.md` AC9 处标注。

### 踩坑（记录以免重演）

**我自己的驱动脚本漏了一条已知前提**：记忆里写明「调用前必须等 `Array.isArray(ctx.chat)`」，
我最初的两版脚本没等 ⇒ 调用在 `api-call.ts:615`（`!url || !model` 检查）**于 fetch 之前**失败，
表现为「旧构建失败、新构建成功」的**假相关**，害我一度怀疑构建差异。
加上「等 `ctx.chat` 就绪」后，旧构建立刻成功（209 层会话就绪后调用）。
**教训**：A/B 出现「完美相关」时，先怀疑自己的测量装置，再怀疑被测对象。

---

## 步骤 7 · 提交

- [ ] 7.1 显式 pathspec 提交（**禁止** `git add -A/-u/.`，规则 L0-7）；
      提交前 `git diff --staged --name-only` 必须**恰等于**预期集合
- [ ] 7.2 推 `origin`（不推 upstream）
- [ ] 7.3 更新父任务 `09-28-ai-write-transparency` 的进度记录

**出口判据**：`git status --short` 输出为空；`git log --oneline -1` 可见；远端已更新。

---

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 增量路径与整读路径结果漂移 | **构造性保证**：共用 `consumeSseLine_ACU`；AC1 穷举切分用例 |
| 中文/多字节被 chunk 边界撕裂 | `TextDecoder({stream:true})` + EOF 冲残留；AC2 专测（D1） |
| 取消语义被改坏 | 不新增取消机制，复用既有信号链；AC5 钉住 `AbortError` 穿透 |
| 新增停滞日志破坏「观测关闭时无差异」 | 走 `logDebug_ACU`（双门控，默认静默，D4） |
| 上游同步时该处冲突 | 台账登记（C7/AC8），口径「按我方」 |
| 最坏情形下新路径不可用 | 回退路径是能力检测触发的**救命稻草**，非异常兜底（D2） |

---

## 评审门（`task.py start` 前）

- [ ] 用户已过目 `prd.md` / `design.md` / `implement.md`
- [ ] `implement.jsonl` 与 `check.jsonl` 已含真实条目（≥1 条，非种子）—— 已通过 `task.py validate`（6 / 5 条）

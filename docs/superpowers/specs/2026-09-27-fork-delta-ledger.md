# 我方差量台账 —— fork 相对于上游 shuiyue-cmyk/shujuku-rebuild

日期：2026-09-27
状态：阶段 0 交付物（配套「追平上游」合并提交 `85d9405`）
上游基线：`shuiyue-cmyk/shujuku-rebuild@6859302`（v9.7.2）
我方基线：`jiozhaoyue/ST-shujuku-rebuild@85d9405`（master）

## 0. 本台账解决什么问题

「我们相对上游改了什么」以前只能靠翻历史推断（我方历史自 fork 点重建，与上游不同源，肉眼比对不可行）。
**追平上游之后，这个问题有了确定答案**：`git diff upstream/master HEAD` 就是完整差量 ——
因为上游的全部提交都已并入，剩下的每一条差异必然是我方有意为之。

本台账把该差量按**意图**分类，并为每条标注「上游是否已自行实现 / 能否回归上游」，
使下一次追平时能快速判断某个冲突该按谁解决。

## 1. 复跑取证（每次追平后重跑这三条）

```bash
# 1) 我方还落后上游多少（应为 0；不为 0 说明同步又断了）
git rev-list --count HEAD..upstream/master

# 2) 我方差量的规模与清单（追平后此即完整差量）
git diff --shortstat upstream/master HEAD -- source/
git diff --numstat upstream/master HEAD -- source/ | sort -k1 -rn

# 3) 下一次追平的冲突面（只读试合并，不动工作区）
git merge-tree --write-tree --name-only HEAD upstream/master
```

> 采集方法：以上命令在 `85d9405` 上实跑取得，输出见下节。

## 2. 差量总览（实测，`git diff upstream/master HEAD`）

- `source/` 下：**35 个文件，+2757 / −26**
- 根层（非 `source/`）：`index.js`（分发产物，+39454/−49721，构建生成）、`AGENTS.md`（+725，规则块同步器生成）、
  `docs/**`（我方设计文档）、`.github/workflows/*`（我方 CI）、`README.md`（+23/−13，品牌）、
  `.gitignore`（+19）、`manifest.json`（3/3，身份）、`sql-wasm.wasm`（二进制，构建生成）

## 3. 差量分类

### A. 身份与品牌分离（永久保留，上游不可能自行实现）

| 文件 | 规模 | 说明 |
|---|---|---|
| `manifest.json` | 3/3 | `author` / `homePage` 指向本仓 |
| `source/tests/shared/manifest-identity.test.ts` | +33 | 身份分离不变式：`homePage` 必须是本仓，否则宿主 `auto_update` 会把插件拉回上游产物 |
| `README.md` | +23/−13 | 品牌 |
| `source/src/presentation-v2/bootstrap/menu-button.ts` | 3/3 | 入口品牌 |
| `source/src/presentation/bootstrap/install-build-badge.ts`（+测试） | 1/1 | 构建徽标 |
| `source/src/shared/runtime-env.ts` | 2/2 | 运行环境标识 |
| `source/src/presentation/triggers/settings-ui-sync/settings-ui-api.ts` | 2/2 | 设置 API 标识 |
| `source/src/presentation-v2/App.vue`、`components/Sidebar.vue` | 1/1 各 | 界面品牌 |

**追平口径**：这几处**永远按我方**（CI 里 `manifest.json`/`README.md` 已在自动解决名单内）。

### B. 宿主适配（Luker / TT 三态，上游是 TT-only）

| 文件 | 规模 | 说明 |
|---|---|---|
| `source/src/shared/host-bridge.ts` | +5 | 三态 profile 探测（宿主差异只许进桥，见 L0-9） |
| `source/tests/shared/host-compat/host-bridge-kind.test.ts` | +41 | 宿主判定 |
| `source/tests/shared/host-compat/native-st-backend.luker.test.ts` | +90 | Luker 世界书后端形状校准 |
| `source/tests/shared/host-bridge-version.test.ts` | 上游新增，我方无差量 | 上游自行演进版本门禁 |

**追平口径**：上游若已自行实现同类适配（如上游的 TT 版本门禁），按「先取上游、再补我方 Luker 分支」处理；
本类是我方与上游最可能长期分叉的面，冲突优先看 `host-bridge.ts`。

### C. 差量注入（我方独有功能，候选回归上游）

| 文件 | 规模 |
|---|---|
| `source/src/service/ai/prompt-builder/table-injection-scope.ts` | +136 |
| `source/tests/service/ai/table-injection-scope.test.ts` | +119 |
| `source/src/service/ai/prompt-builder/prompt-prepare.ts` | +39/−2（SQL 分支接线） |
| `source/src/presentation-v2/composables/useDifferentialInjectionSettings.ts` | +37 |
| `source/src/presentation-v2/components/FormFillUpdateSettingsPanel.vue` | +32 |
| `source/src/presentation-v2/copy/dashboard-copy.ts`、`composables/useDashboardPage.ts` | +5 / +10（开关入口） |
| `source/tests/service/ai/prompt-prepare-sql-mode.test.ts` | +59 |

设计依据：`docs/superpowers/plans/2026-09-05-differential-injection.md`。
热表带全量行、冷表只带 DDL + 行数，开关默认关闭（关闭时与上游行为一致）。

### D. 楼层级调度（我方独有功能，候选回归上游）

| 文件 | 规模 |
|---|---|
| `source/src/service/table/floor-level-catch-up.ts` | +112 |
| `source/tests/service/table/floor-level-catch-up.test.ts` | +110 |
| `source/src/service/table/update-orchestrator.ts` | +25/−3（`batchSizeOverride` 透传） |
| `source/src/service/table/runtime-only-pending-state.ts` | +10 |
| `source/src/service/runtime/state-manager.ts` | +5 |

设计依据：`docs/superpowers/plans/2026-09-05-differential-injection.md` 同批。追平分批粒度可按楼层覆盖。

### E. 表格自检（我方独有）

| 文件 | 规模 |
|---|---|
| `source/src/service/table/self-check.ts` | +49 |

### F. 调试与运维（我方独有）

| 文件 | 规模 | 说明 |
|---|---|---|
| `source/src/service/continuation/agent/agent-prompt-drift.ts`（现存于双方） | 无差量 | 提示词前缀漂移诊断（本次未被改动） |
| `source/src/presentation-v2/composables/useDebugPanel.ts` | +4/−2 | 调试面板 |
| `source/scripts/rescue/replay-chat.mjs` | +305 | 会话数据库救援：离线回放 |
| `source/scripts/rescue/extract-template.mjs` | +132 | 救援：模板抽取 |
| `source/scripts/rescue/extracted-template-v3.3.0.json` | +1360 | 救援：抽取产物 |
| `docs/lessons-chat-db-rescue.md` | +74 | 救援实战经验 |

设计依据：`docs/superpowers/specs/2026-09-07-chat-db-rescue-and-template-migration-design.md`。

**后续增量（本台账补记，基线 `6859302` 之后我方新增的差量）**：

| 文件 | 规模（vs `upstream/master`，含既有差量） | 引入任务 | 说明 | 上游是否已实现 | 下次追平冲突口径 |
|---|---|---|---|---|---|
| `source/src/service/ai/prompt-observer.ts` (+449/−0) / `prompt-inspection-report.ts` / `presentation-v2` 的 `PromptInspectionPanel.vue`、`usePromptInspection.ts` | 新增文件为主 | 阶段 2 `09-27-prompt-assembly-inspector` | 出站提示词的段级观测、diff、导出（我方差量） | **否** | **按我方** |
| `source/src/service/ai/prompt-builder/prompt-api-call.ts` | +187/−41（**含该文件既有差量**：SSRF 守卫 / 120s 超时 / 租约复检；本次新增为其中的 `parseStreamResponse_ACU` 真流式增量读取 + `onDelta` 回调 + 停滞诊断约 +130 行） | 阶段 3 `09-28-streaming-incremental-read` | 正文由整读改为 `body.getReader()` 增量读取；**保留整读回退**（能力检测）。逐字节一致由「两条路径共用 `consumeSseLine_ACU`」在构造上保证 | **否** —— 上游 `prompt-api-call.ts:413` **也是** `response.text()` 整读 | **按我方**。注意：`3f6f534` 曾在追平上游时**刻意保留**上游当时的 `parseStreamResponse` 形态，本次方向与该次相反 —— 追平时若上游仍未改此处则冲突按我方；若上游自行改成 `getReader`，则逐行比对后**取上游实现 + 只叠加我方的 `onDelta`/停滞诊断**（最小改动优先） |
| `source/src/service/table/write-pipeline-observer.ts`（新） | 新增文件（约 400 行） | 阶段 3 `09-28-write-pipeline-observer` | 写库流水观测内核：把**提交给持久化层的** `operations` 归一成「方言 + 操作类型 + 表 + 原文」；三重上限（30 条 / 单条 8k 字符 / 总 2 MiB）；导出逐字段脱敏 | **否** | **按我方** |
| `source/src/service/ai/prompt-observer.ts` | 在既有我方文件上增量（约 +150 行） | 同上 | 新增 `linkBody`（`WeakMap` 按**请求体对象引用**精确配对响应）、`beginPromptStreamObservation_ACU`、`getLatestObservationIdForScope_ACU`、`PromptResponseStat_ACU`（含 `transport` 三档），响应正文纳入导出脱敏 | **否** | **按我方** |
| `source/src/service/ai/api-call.ts` | 约 +30/−3 | 同上 | 两个 AI 出口（`postChatCompletion_ACU`、`callAIWithResolvedPreset_ACU`）接线响应观测；`resolveStreamTransport_ACU` 与 `parseStreamResponse_ACU` 共用同一能力检测判据 | **否** | **按我方** |
| `source/src/service/table/table-update-commit.ts` | 约 +45 | 同上 | 写库**单一收口点**三处埋点（`saved` / `runtime_only` / `failed`）；观测代码只透传 `options.source`，**不识别来源**（新增来源无需改观测代码） | **否** | **按我方** |
| `source/src/presentation-v2/` 的 `WritePipelinePanel.vue`、`useWritePipeline.ts`（新增）+ `dev-options-store.ts`、`useDevOptions.ts`、`DeveloperPage.vue`（增量） | 新增 + 增量 | 同上 | Developer 页三段式面板（出站提示词 → 响应正文 → 语句）；观测默认关闭；关闭时不产出任何记录（写库侧提前 return；响应侧句柄恒为 null，仅多一次无副作用的 transport 判定） | **否** | **按我方** |
| `source/src/service/table/historical-frame-replay.ts`（新，约 300 行） | 新增文件 | 阶段 3 `09-28-historical-frame-replay` | 历史帧**只读**视图：四种形态判定（full_checkpoint / delta / empty / invalid）+ 坏帧诊断 + 列出语句（富化**复用** T3.2 的 `summarizeMutationOperations_ACU`）。**不建库、不重放求值**（与 `scripts/rescue/replay-chat.mjs` 只对齐帧模型口径，不共享其回放期职责） | **否** | **按我方** |
| `source/src/presentation-v2/` 的 `FrameReplayPanel.vue`、`useFrameReplay.ts`、`write-statement-display.ts`（新增）+ `DeveloperPage.vue`、`WritePipelinePanel.vue`（增量） | 新增 + 增量 | 同上 | 历史回放面板（自动列出含帧楼层供点选）；并把「方言/操作」的文案与徽章配色抽成 `write-statement-display.ts` 作为**两面板共享的单一事实源** | **否** | **按我方** |

> **口径提示（阶段 3）**：上表按引入任务分行 —— 第 1 行是**阶段 2** 的差量，第 2 行是 **T3.1**，
> 第 3–7 行是 **T3.2**，第 8–9 行是 **T3.3**（T3.3 的两行中有一行落在 T3.2 改过的同一批我方文件上，
> 属增量而非新差量）。三者的**共同前提**是
> 「本方注册的 AI 出口只有两个」—— 若上游新增/改名 AI 出口，追平时必须同步在**新出口**上接线响应观测，
> 否则会出现「有出站提示词、无响应正文」的半截记录（面板会如实显示为「未补写」，但不该长期如此）。
> 判据：`grep -n "handleApiResponse_ACU(" source/src/service/ai/api-call.ts` 的调用点数应等于已接线数。

> 上述各行是在基线 `6859302` 之后新增的，故本文件「2. 差量总览」的规模数字（`35 个文件 / +2757 / −26`）
> **已不含它们**。刷新方式：重跑 §1 的三条命令。

### G. 分发产物与 CI（按我方，构建/运维生成）

| 文件 | 说明 |
|---|---|
| `index.js`、`sql-wasm.wasm` | **不手改**，由 `cd source && npm run build` 生成并同步到仓库根 |
| `.github/workflows/upstream-sync.yml` | 上游定时同步（我方独有） |
| `.github/workflows/release-gate.yml` | 发布门禁（我方独有） |
| `AGENTS.md` 的规则块 | 由 `tavern-harness` 真源同步器生成，**勿手改**（手改会在下次重建时被抹掉；本仓特例写「项目覆盖」节） |

### H. 设计文档（我方独有）

`docs/superpowers/specs/2026-09-05-luker-shujuku-design.md`、
`docs/superpowers/specs/2026-09-07-chat-db-rescue-and-template-migration-design.md`、
`docs/superpowers/plans/2026-09-05-luker-host-adapt.md`、
`docs/superpowers/plans/2026-09-05-differential-injection.md`。

## 4. 本次追平实况（`85d9405`）

上游落后 36 提交（v9.4.10 → v9.7.2）。**冲突仅 4 个文件**：

| 文件 | 解决 |
|---|---|
| `index.js` | 按我方，随后 `npm run build` 重建 |
| `manifest.json` | `author`/`homePage` 按我方；`version` 取上游 9.7.2 |
| `source/src/presentation-v2/composables/useDashboardPage.ts` | **并集**：上游 `withRenderFallback` 渲染兜底包装 + 我方 `differentialInjectionEnabled` 开关 |
| `source/src/service/table/update-orchestrator.ts` | **并集**：上游扩充的 `executionSnapshot`（`chatIdentity`/`isolationKey`）+ 我方 `batchSizeOverride` |

上游删除 3 个文件（`source/src/service/loop/loop-controller.ts` 与两个测试），已核实**无悬挂引用**
（仅两处注释提及）。依赖声明未变动（`source/package.json` 仅版本号 9.4.10 → 9.7.2），故无需重装依赖。

**顺带修正的既有不一致**：追平前 `manifest.json` 为 `9.4.0` 而 `source/package.json` 为 `9.4.10`，
违反 AGENTS.md「两者 version 需一致」。本次统一为 `9.7.2`，并确立口径：**追平后 version 跟随上游**。

## 5. 同步纪律（每次追平照此执行）

1. 先跑 §1 第 1 条确认落后量；为 0 说明同步正常，无需动作。
2. 落后时用 `git merge-tree --write-tree --name-only`（只读）先量出冲突面，再决定是否人工介入。
3. 冲突按本节分类口径解决：A/G 按我方；B 先取上游再补 Luker 分支；C/D/E/F 优先保我方（候选回归上游）。
4. 合并后**必须**重建分发产物并跑满质量门（`tsc --noEmit` → `vitest run` → `npm run build` → `npm run smoke`）。
5. 提交只用显式 pathspec；推送只推 `origin`，绝不推 `upstream`（P-12）。
6. 本台账随每次追平更新 §4（实况）与 §3（差量分类）。

## 6. 已知坑：上游同步曾静默失败 5 天（2026-09-22 ~ 09-26）

`.github/workflows/upstream-sync.yml` 的冲突分支里，Markdown 围栏被写成**裸引用词**
（三个反引号被单引号包裹），shell 会把它当命令执行：`command not found`、退出码 127，
整段冲突处理随之崩溃。两个后果叠加：

1. `status=conflict` 从未写出；
2. 「开/更新人工处置 issue」步骤的条件依赖该 status → 条件不成立被跳过。

于是**真冲突被静默吞掉**：连续 5 次运行全红、无 issue、无人收到通知，我方停滞在上游 v9.4.10，
落后 36 提交直到本次手工追平。证据：运行 `36203002429` 日志 `line 18: ```: command not found`
/ `Process completed with exit code 127`。

修复（提交 `bb57a20`）：围栏改为 `echo`；issue 步骤条件补 `steps.merge.outcome == 'failure'`，
覆盖「合并步骤自身崩溃」这一路；issue 正文增加「合并中断时仍未解决的文件」抓取
（原先先 `git merge --abort` 再组装正文，崩溃路径下列不出冲突清单）。

**修复的验证（含负例自检，2026-09-27）**：

- 线上：手动触发 `Upstream Sync`（运行 `36288579123`）**全绿跑通** —— 合并上游 → 质量门
  （tsc / vitest / build / smoke 在 runner 上）→ 推送 master 全部 success，issue 步骤按预期跳过。
  同一次运行自动并入了上游 v9.7.4 / v9.7.5 共 4 笔提交，**同步管道已恢复**。
- 本地仿真：把该步骤的脚本原样抽出，在带真冲突的仿真仓库上跑 ——
  修复后退出码 `0`、`status=conflict` 正确写出、冲突清单完整；修复前退出码 `127`、
  `status` 未写出、冲突清单只写了标题就被截断。
- 注意：`bash -n` 对修复前后**都通过** —— 这是运行时错误，语法检查抓不到，
  只有真冲突路径能暴露。所以该步骤的正确性只能靠「带真冲突的仿真」或等上游再次冲突来验证。

## 7. 自动同步会重新制造版本不一致（2026-09-27 二次修复，同一根因的第二面）

首次追平后手动触发的一次同步虽然全绿，却暴露了另一个设计缺口：
合并步骤的 `RESOLVE` 名单把 `manifest.json` **整体**按我方解决（为保住 `author`/`homePage` 身份字段），
于是 `version` 也被一起留在旧值 —— 实测该次同步后 `manifest.json = 9.7.2` 而
`source/package.json = 9.7.5`，处置 4 节刚修好的版本一致性**被一次自动同步打回**。

修复（三处）：

1. 工作流质量门步骤在提交前把 `manifest.json` 的 `version` 改写为 `source/package.json` 的版本，身份字段不动。
   实现上**只做「版本值」的定点替换**，不用整文件 `JSON.stringify` 重写 —— 后者会把 committed blob 的
   CRLF 换成 LF（blob 是 CRLF），在 Linux runner 上产生整文件改动；定点替换天然幂等（值已一致时不写盘）。
   已用**脚本原文**在 CRLF 副本上三向验证：版本正确改写（9.7.2 → 9.7.5）、裸 LF 数为 0（换行符保真）、
   重复运行输出「已一致，未写盘」且文件哈希不变、结果与仓库文件归一换行后**逐字节相同**；
2. `manifest.json` 立即修正为 `9.7.5`；
3. `source/tests/shared/manifest-identity.test.ts` 新增守卫用例「version 与 source/package.json 一致」，
   把这类漂移从静默变成质量门失败。负例自检：故意把 manifest 写成 `9.7.2` 时该用例失败，
   报 `expected '9.7.2' to be '9.7.5'`，其余 4 条不受影响。

**教训**：「按我方解决」的名单**颗粒度不能停在文件级**。同一个文件里既有必须留我方的字段（身份），
也有必须跟随上游的字段（版本）；文件级 ours 把两类字段绑死，会制造「修好又回退」的循环。
新增此类自动同步规则时应逐字段判断，而不是逐文件。
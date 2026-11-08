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

### C2. 孤儿身份列复位：帧回放路径（缺陷 ② 修复，候选回归上游）（2026-09-29 新增）

**新增我方差量**（`canonical-row-normalizer.ts` 与 `storage-frame-v2-replay.ts` 在本任务前与上游**零差量**，
本任务首次令其分叉 ⇒ 上游同步时这两处会进冲突面）：

| 文件 | 规模（vs 上游，含既有） | 本任务增量 |
|---|---|---|
| `source/src/shared/canonical-row-normalizer.ts` | +67/−40 | 全部：抽出**按单表**复位入口 `repairOrphanIdentityColumnOnSheet_ACU`（数据级函数改为委托，规则永不漂移） |
| `source/src/service/table/storage-frame-v2-replay.ts` | +62/−1 | 全部：`repairOrphanIdentityColumnsForReplay_ACU` 助手 + 在**回放基底构造**（`normalizeLegacyDuplicateCheckpointState_ACU` 函数首）与 `applySheetCheckpointsForReplay_ACU` 前置复位 |
| `source/src/service/table/update-orchestrator.ts` | +108/−4 | +78/−1：`preflightManualRefillResolution_ACU`（D-A 破坏性清理前 fail-closed 预演）+ 接线 |
| `source/tests/service/table/storage-frame-v2-orphan-identity-column.test.ts` | 新增文件 | 5 条：(a) 列身份解析、(b) 真实 persist 写入、基底复位、空表头不掩盖成 `col_N`、有 DDL 零变化 |
| `source/tests/service/table/canonical-row-normalizer.test.ts` | +70 | 6 条孤儿列复位单测 |
| `source/tests/service/table/update-orchestrator.test.ts` | +53 | 1 条 D-A 预演用例 |

**根因**（真机 + 离线取证：`.trellis/tasks/09-29-no-ddl-legacy-chat-write-failure/research/S3.2b-base-repair-gap.md`）：
旧版本误插 `row_id` 后固化的畸形表头 `["row_id", null, 业务列…]`，对行标识校验与 upgrade audit
**都不可见**，故「顺路」复位不可靠 —— `normalizeLegacyDuplicateCheckpointState_ACU` 在 `audit==='clean'`
时**提前返回**，而 hydrate 以 `strict:true` 在**克隆**上修复 ⇒ 回放状态本身仍畸形 ⇒
`sql_sheet_batch` 的列重绑在 `generateFallbackDDL` 抛
`fallback DDL 表头不合法：第 2 列「」empty_column_name`。

**回归上游建议**：这是不依赖我方任何 fork 特性的通用缺陷修复（上游同样受影响），
建议单独提 upstream PR；若上游自行修复，本 C2 条目按「我方不再需要」撤除。

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
| `source/src/service/diagnostics/diagnostic-bundle.ts`（新）+ `useDiagnosticBundle.ts`、`DiagnosticBundlePanel.vue`（新）+ `DeveloperPage.vue`、`developer-copy.ts`（增量） | 新增为主 | 2026-10-26「一键诊断包」 | 四观测面聚合导出（环境/API/自检/提示词/写库/帧回放），纯聚合不新增事实源，各节失败隔离，下载与复制双出口 | **否** | **按我方** |
| `source/tests/setup/warm-app-graph.ts`（重写） | 增量改写 | 2026-10-26 B1 预热根治 | beforeAll 预热 → setup 顶层 TLA + resetModules 清实例；窄 mock 免疫（判据与 Pinia 泄漏教训见 quality-guidelines「冷启动预热」节） | **否**（上游无此 setup 文件则新增即我方；有则按我方） | **按我方** |
| `source/src/presentation-v2/composables/download.ts`（新）+ 三个 composable 增量 | 新增 + 增量 | 2026-10-26 B5 下载助手去重 | downloadTextFile_ACU 三处逐字副本收敛为单一事实源（行为契约：宿主文档取 DOM、延迟 revoke） | **否** | **按我方** |
| `source/tests/service/ai/api-call-response-observation-wiring.test.ts`（新） | 新增 | 2026-10-26 B7 接线守卫 | 「出口数 == handleApiResponse_ACU 接线点数」判据固化为结构守卫，防上游新增 AI 出口后半截记录 | **否** | **按我方** |
| `source/src/service/table/oversized-write-warning.ts`（新）+ `table-update-commit.ts`、`diagnostic-bundle.ts`、`shared/defaults.ts`、`data/models/settings-model.ts`、`settings-service.ts`、`presentation/bootstrap/init.ts`、`presentation-v2` 的 `useDataManagement.ts`/`DataMgmtPage.vue`（增量） | 新增 + 增量 | 2026-10-26 超大字段写入软警告 | 写库提交边界测量「单单元格字符数 / 单次载荷字节」；超阈值只发一次警告（toast + 结构化日志 + 诊断包新段），**不拦截、不截断、不改存储格式**；阈值三项可配置（默认 10000 字符 / 512 KiB），关闭时连测量都不做 | **否** | **按我方** |
| `source/src/presentation/bootstrap/api-groups/table-crud-api.ts`（增量） | 约 +35/−1 | 2026-10-28 手动 CRUD sheetKey 定位修复（`ad39b79`） | `findTargetSheetInData_ACU` 新增**路径 0：sheetKey 精确匹配**。真机实证：运行时 canonical 视图的 `sheet.name` 是 SyncBridge 导出的运行时显示名（如「主角信息」），与模板显示名（「主角信息表」）、sheetKey 三者互不相同，原四条路径（显示名/物理名反查/物理名/DDL 别名）在该类聊天上全部落空 → 手动 CRUD API 整体报「Table not found」；另全路径未命中时输出一次性诊断（键名+显示名样本）。Dev 8001 真机复测 `insertRow('sheet_protagonist')` 由 -1 → 成功 | **否** | **按我方** |
| `source/src/presentation/**`、`presentation-v2/**`（25 文件文案）+ 7 测试文件 | 约 +180/−110 | 2026-10-31 toast 文案三口径统一（`5ca59da`） | 用户可见 toast/UI 文案统一：失败指引「详情见运行日志」（v1 ×5 对齐 v2）、失败冒号全角、进度省略号「…」；只改文案不动触发逻辑；`tests/shared/threshold-registry-guard.test.ts` 另守阈值注册表（值快照/重声明/特征字面量散落三段）并根治 `summaryIndexArchiveMaxInputChars` 的 `|| 24000` 兜底漂移 ×6 | **否** | **按我方**（纯文案，上游重写同文件时逐条比对措辞口径） |
| `source/scripts/rescue/replay-chat.mjs`（重写解析 + CLI/模块双形态）+ `tests/scripts/rescue-replay-parse.test.ts`（新，19 用例） | 约 +250/−35 | 2026-10-31 救援回放解析根治（`711167c`） | 真机取证：romance_diary 的 `CHECK(... IN ('a','b',...))` 内逗号让旧逐行正则**整列丢失** → INSERT 缺列 → NOT NULL 全行跳过。parseDdl 重写为顶层逗号+括号深度+字符串感知（行尾逗号+注释=列边界）；`buildHeaderToCol` 三级匹配（精确→归一化→子串互含）+ used 集防同抢；真实样本 A/B：原始人 62→**75 行**（romance_diary 18 行复活）、Bocchi 三分支 +6/+7/+6 行，全部零回归 | **否** | **按我方**（scripts/ 我方独有域） |
| `source/scripts/rescue/replay-chat.mjs`（增量：`matchTableByColumnSignature`） | 约 +90 | 2026-10-31 回放 v2 列签名匹配重绑（`9e3b2e3`） | 旧代拼音物理名（lianaiduixiangbiao）vs 新代 DDL 名（romance_targets）失配：INSERT 列清单 / UPDATE（SET 左值 + WHERE 首阶列，字符串感知）作签名集，**唯一候选**才改绑（歧义/无候选不猜），命中入 aliasToPhys 快路径 | **否** | **按我方** |
| `source/scripts/rescue/replay-chat.mjs`（增量二段）+ 测试（26 用例） | 约 +150 | 2026-10-31 签名/残余改绑增强（`28d26b3`） | ① 前导注释剥离：真实 logEntries 语句常带「-- 说明」行，剥离后头部提取/签名匹配不再被挡；② FROM/JOIN 锚定的残余别名替换（子查询等非头部位置）。**实证教训**：键形式别名可能恰为常见列名（sheet_summary 的键形式=`summary`，romance_diary 也有列 `summary`）——无锚定全词替换会把列名改写成表名（当晚首版即踩中并当日修复）。最终真实样本：B#5 跳过 **239→1**（剩余 1 跳=旧列名无候选，不猜）；B#8 余 53 跳=NOT NULL 源数据空值（设计内）；其余样本零劣化 | **否** | **按我方** |
| `source/src/presentation-v2/pages/TablePage.vue`（增量）+ table-page.test.ts | 约 +25 | 2026-10-31 填表提示词面板空态说明（`55c6953`） | 面板主体默认态除按钮外空白 → 补一行状态说明（默认/自定义模式文案 + 主插槽 A/B 就绪状态）；双前缀类、主题变量取自文件既有口径 | **否** | **按我方** |
| `source/src/presentation-v2/composables/sql-result-export.ts`（新）+ `useSqlConsole.ts`、`AdvancedToolsPage.vue`（增量）+ 页测 | 约 +230 | 2026-11-07 SQL 结果导出三件套（`12b8d28`） | 复制 CSV / 导出 CSV（UTF-8 BOM + CRLF + RFC4180 引号感知）/ 导出 JSON（行对象）；BLOB→base64；下载走 host-document + 延迟 revoke（与 useLogViewer 同口径），复制走唯一剪贴板助手；页面只依赖 composable 的分层不变 | **否** | **按我方** |
| `source/src/presentation-v2/composables/useSqlConsole.ts`、`AdvancedToolsPage.vue`（增量）+ 页测 | 约 +120 | 2026-11-07 结果渲染窗口化（`a504b81`） | engine.query 全量物化不截断 → 控制台只渲染前 200 行（`SQL_CONSOLE_VIEW_WINDOW`）+「显示更多」逐窗追加；复制/导出仍取全量（与日志查看器同口径）；新查询/清空/换聊天复位窗口。真机实证 256 行笛卡尔积 | **否** | **按我方** |
| `source/src/presentation-v2/composables/useSqlConsole.ts`、`sql-result-export.ts`、`AdvancedToolsPage.vue`（增量）+ 页测 | 约 +120 | 2026-11-07 单元格复制 SQL 字面量（`db6a510`） | 点单元格复制可直接粘进 WHERE/SET 的 SQLite 字面量：字符串单引号双写、BLOB→`X'hex'`、数字原样、NULL→NULL；有文本选区时不抢 | **否** | **按我方** |
| `source/src/presentation-v2/composables/useSqlConsole.ts`（增量）+ 页测 | 约 +70 | 2026-11-07 编辑器草稿持久化（`5df5e22`） | 走新 UI 统一持久化层（`acu_v2_ui_state::sqlConsoleDraft`），300ms 防抖、超 10 万字符不入库；草稿仅是缓冲不自动执行（执行时本就有聊天上下文校验） | **否** | **按我方** |
| `source/src/presentation-v2/composables/useSqlConsole.ts`、`AdvancedToolsPage.vue`（增量）+ 页测 | 约 +180 | 2026-11-07 常用语句片段库（`a1e4382`） | 跨聊天片段库（`sqlConsoleSnippets`，20 条 × 5000 字符，去重置顶）；点击 chip **仅填入编辑器、绝不自动执行**（跨聊天执行守卫不动，填入等价手敲） | **否** | **按我方** |
| `source/src/presentation-v2/composables/sql-statement-count.ts`（新）+ `useSqlConsole.ts`、`AdvancedToolsPage.vue`（增量）+ 页测 | 约 +150 | 2026-11-07 多语句诚实提示（`ff0cc06`） | 零依赖纯函数 countTopLevelSqlStatements（字符串/双写转义/行/块注释感知）；**当晚实证口径**：只读校验对多语句 fail-closed（multiple_statements）→ 多语句永远走批量提交、不会逐条展示结果；提示放结果区顶层、覆盖 mutation/error 形态 | **否** | **按我方** |
| `source/src/presentation-v2/composables/sql-result-export.ts`（增量：compareSqlCells/sortSqlRows）+ `useSqlConsole.ts`、`AdvancedToolsPage.vue`（增量）+ 页测 | 约 +130 | 2026-11-07 结果列点击排序（`2190f50`） | 全序比较器（NULL 最大、数字<字符串<BLOB、字符串 numeric:true）+ 表头三态循环（asc/desc/取消，aria-sort 同步）；排序在渲染窗口之前作用于全量行；新查询/清空复位 | **否** | **按我方** |
| `source/src/presentation-v2/` 的 `FrameReplayPanel.vue`、`DashboardPage.vue`、`ApiConfigPanel.vue`、`DataMgmtPage.vue`、`BasicConfigPage.vue`（增量） | 约 +90/−20 | 2026-11-07 空态/留白治理四修（`51be043`/`c516859`/`2379655`） | ① 帧回放空态吃满面板并居中（图标+文案+跳转填表工作台）；② 仪表盘/数据管理/基础模式三处「网格/栈拉伸 + .acu-panel height:100%」造成的卡内空腔 → 页面级自然高度（**注意：单改 align-items:start 不生效**，百分比高度对 grid area 取值，必须一并覆盖 height:auto）；③ API 预设空态横幅去重（顶部与表单区 v-else 重复同句） | **否** | **按我方** |
| `source/scripts/` 的 `e2e-sql-console-check.mjs`（增量）+ `e2e-screenshot-tour.mjs`、`e2e-devpage-check.mjs`、`e2e-oversized-write-check.mjs`（增量） | 约 +70 | 2026-11-07 e2e 邻接扩展噪声清理（`12b8d28`/`bff62a7`） | Dev 实例同装 st-acu-visualizer 弹 EOL 浮层 + 含 splash loader 的 ST popup，**拦截指针事件**让 fill/click 全部落空（2026-10-26 后环境变化根源，当晚定位）；四个交互型 e2e 统一清理口径（只清浮层不动数据） | **否** | **按我方**（scripts/ 我方独有域） |

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

> **2026-11-07 第二次追平（`4622f960`，上游 `26e453e` = Unbirth A.D. 6386，落后 145 提交）见本节末尾追加记录。**

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

## 4b. 第二次追平实况（2026-11-07，`4622f960`，上游 `26e453e` = Unbirth A.D. 6386）

落后 145 提交（9.7.5 → Unbirth A.D. 6386；上游版本号体系已切换为叙事版本，我方 manifest `version` 跟随为 `Unbirth A.D. 6386`，身份字段仍按我方）。**冲突 68 个文件**，其中 25 个是「上游删 v2 页面层（新版界面转正 presentation-v3）× 我方在旧页面上做过的差量」的 delete/modify 冲突。

**按台账口径的解决**：

| 类别 | 处置 |
|---|---|
| A 身份（manifest/README/品牌串/toast/defaults/runtime-env/menu-button/badge） | 按我方；`version` 跟随上游；badge 样式取上游改进（安全区 + 默认隐藏）；v3 壳层的 `UnbirthDB` 品牌串（App/关闭标题/ApiPresetEditor/ContentReplace/Table/VectorIndex）批量替换为 `Luker·数据库` |
| G 产物（index.js） | 按我方后重建（`b45442fd`） |
| B/C/D/E/F（服务层 13 文件 + 测试 10 文件） | 逐 hunk union：上游修复取上游 + 我方差量保我方。要点：Debug 导出取上游 `buildDebugExportPayload_ACU` 单一事实源并补回我方 `selfCheck` 段；流式解析取上游单遍多协议实现 + 叠加我方 onDelta（按行尾 result 增量触发）与停滞诊断（移入 `readStreamBodyText_ACU`）；`handleApiResponse_ACU` 第 4 参改为 `options{onProgress,onDelta}`；vector 三文件 import 并集（我方 SSRF 守卫 + 上游 undo-log/generation）；`settings-service` import/defaults 并集 |
| 上游删 v2 页面 × 我方页面差量 | 按上游删除，功能移植进 v3（`f6b1c6ec`）：品牌、SQL 控制台全增强（导出四件套/排序/窗口化/字面量复制/片段库/多语句提示）、开发者四面板、差量注入（仪表盘开关经 `useDashboardPage` 自动生效 + 填表高级参数三项）、数据管理写入体积提示三阈值。v2 `_lib` 组件套件（26 文件）与 `host-env` 两个宿主封装因仍被我方面板依赖而恢复（C 类口径） |

**质量门状态（追平当日，`b45442fd`）**：`tsc --noEmit` ✅ 0；构建 ✅；冒烟 ✅（jsdom 宿主挂载/菜单注入/0 错误）；全量 vitest 初测 **8348 绿 / 41 红（12 文件）**。当日已修 4 文件（four-host-matrix 基线 2.4.0 / host-download 约定统一 / capture-scope 品牌锚点 / update-orchestrator 新签名 `(targetKeys, refreshData, options)`——上游删除了注入式 AI 回调参数，`sql-result-export` 改走统一下载入口、`download.ts` 降级为委托薄壳），修复后均为全绿。**剩余 37 红**：developer-page 23（我方四面板测试挂 v3 DOM，选择器待迁移）+ 向量镜像 8（`review-block5` 7 / `manifest-reuse` 1，上游 FRESH_READ 直读语义）+ v2 页面零散 6——全部定性为「旧 v2 页面测试文件的 DOM 断言待迁移到 v3」与上游语义变化，**不是行为回归**：同域断言已由上游重写进 `tests/presentation-v3/`（全绿），我方 SQL 控制台测试已自行迁移完（6/6 绿）。**下一任务**：迁移剩余 v2 页面测试到 v3 选择器（口径照 `sql-console-page.test.ts` 的迁移），并核对两个向量镜像用例的新语义期望。

**自动同步停用（2026-11-07 用户裁定）**：`upstream-sync.yml` 移除 `schedule` 触发器，仅保留 `workflow_dispatch` 手动档——过渡期内自动合并会把半成品状态合入 master 或反复开冲突 issue。README「上游同步」段同步改写。

**静态前端验证（真浏览器，零酒馆运行时）**：以冒烟宿主的同一套最小 ST 桩搭静态页（仓库外临时目录，不入库），加载构建产物——v3 界面挂载成功（品牌 `Luker·数据库`、`#acu-app-v2`、菜单项注入、0 启动错误），SQL 控制台真执行 `SELECT name FROM sqlite_master`（5 行 · 22.3ms），开发者四面板、差量注入开关、写入体积提示全部渲染正常，已截图留证（会话内）。

**AlbusKen/shujuku（龙血玄黄 1.3.6）核对**：shuiyue 已在其 145 提交内跟进 1.3.6（19438d7/26e453e 等）；三仓（shujuku / shujuku-rebuild / newshujuku=SP·数据库 V）共用 `shujuku_v120` / `TavernDB_ACU_*` 命名空间，数据面天然同构。未跟的差异只有 AlbusKen PR #66/#67 两个公开 API 便利项（只读历史来源身份 / 写入可选前端回读等待）——属「不重要的不兼容」，无数据面影响。AlbusKen/newshujuku 经查是同血统的 messy 开发仓（SP·数据库 V v2.0.0，非模板仓），参考价值主要在其外部 API 文档形态。

## 4c. 第三次追平实况（2026-11-08，`aa1c490e`，上游 `8f1fb759`）+ AlbusKen 差量处置 + 36 红清账

**上游侧**：`8f1fb759`（模板切换去冗余——每类风险只留一道关卡，修复回滚时可能把旧聊天模板配置写进新聊天）。`git merge-tree` 预检仅 `index.js` 1 个冲突，按 G 类取我方后重建；其余 12 文件（storage-frame-v2-persist / template-preset-service / template-switch-mode-resolver / v2 composables 等）全部自动合并，零人工 hunk。

**AlbusKen/shujuku 差量处置（口径升级：有价值的未跟差异「化为功能写进去」）**：

| albus 差量 | 处置 | 证据 |
| --- | --- | --- |
| PR #66 公开历史来源身份 | **移植**（`4b3053ec`）：`table-history-api.ts` 新增 `getTableHistoryContext()` + `PublicTableHistoryContext_ACU` | 真浏览器实测通过 |
| PR #67 写入接口可选前端回读等待 | **移植**（`4b3053ec`）：sql/table-crud/core-data 三 API 组公开 `awaitFrontendReadback`；内部选项由我方 `skipReadbackWait` **统一更名为上游同款 `awaitFrontendReadback`**（极性对齐：默认 true=等待，消除后续合并摩擦） | 真浏览器实测 `executeSqlMutation(…, { awaitFrontendReadback: false })` 通过 |
| PR #70 存盘节流+尾随补存 | **已在我方树内**：shuiyue `26e453e6`（11-07 已并入）即其实现（`chat-save-coalescer` 两仓同构，shuiyue 口径「一轮填表只在结束时存一次」更激进） | `source/tests/data/gateways/chat-save-coalescer.test.ts` 在树 |
| `597ef6ea` 回退 PR#65（格林推演恢复原执行链） | **零影响**：PR#65 因果链文件（plot-causal-delivery-bridge / ordinary-plot-causal-context / plot-internal-causal-result / zero-layer-world-delivery-session）在 albus 回退后、shuiyue、我方三树终态**均为零**——回退把 albus 拉回我方已有状态 | `git ls-tree` 三树比对 |
| albus 自有子系统（simulation 世界模拟/桌宠/notice-hub/zero-layer/fill-mode 等，test 分支整模块缺失 284 个） | **不在范围**：shuiyue 是 albus 的筛选吸收层（其 `UPSTREAM-DRIFT.md` 自述 + `npm run drift` 终态比对工具），这些是 shuiyue 层的取舍；我方跟随 shuiyue | drift 工具两轮比对（albus/test 与 albus/main） |

**36 红清账（`ac976efc`）**：§4b 遗留 37 红 → 本班清至 0（分类处置）：developer-page 23 = 我方「环境与能力总览」面板**补移植进 v3**（11-07 四面板批漏项）+ 定位器 `.acu-v2-developer-page` → `[data-ub-main] .acu-panel`；向量镜像 8 = mock 补 `settings_ACU`（上游 FRESH_READ 直读路径读取 `dataIsolationEnabled`）；v2 页面零散 5 = 品牌串关闭按钮 title（`UnbirthDB`→`Luker·数据库`，连带修出 `tauri-version-gate.ts` 一处 A 类漏网的用户可见品牌串）+ 省略号「…」口径 + data-mgmt 四节期望（写入体积提示）+ table-page 空态改 v3 契约断言。**波及源码 2 处、测试 8 文件，单文件级全部复跑绿；全量 vitest 复跑被「绝对禁止任何 node 进程」打断——全量零红认证与产物重建待 node 解禁后补（产物 `c6c0ed0e` 对应 `4b3053ec` 源码，`ac976efc` 的两处源码修正未入产物）。**

**静态前端验证（chatfilesys 式，零酒馆运行时）**：Dev ST 实例真静态文件（jQuery 3.5.1）+ 真实扩展路径形态 `scripts/extensions/third-party/ST-shujuku-rebuild/` + `http-server :3060 -c-1 --cors` + 真浏览器——验证序列全绿（v3 挂载 / 菜单注入 / 0 错误 / `getTableHistoryContext` ✓ / `awaitFrontendReadback` 写入 ✓），仪表盘/SQL 控制台/数据管理/开发者选项四页截图留证（临时目录，不入库）。

**公开 API 文档**：`source/docs/public-api.md`（命名空间总览 + 两个新能力语义 + 跨仓兼容性说明）；README 功能清单与上游同步段同步更新。

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
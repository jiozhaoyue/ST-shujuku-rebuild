# 实施清单（随执行实时勾选，L0-2）

> 验证基线：source/ 下 `npm run typecheck`、`npx vitest run`（8846 基线，零回退）、`npm run build` + `npm run smoke`（动产物时）。
> 提交纪律：显式 pathspec；只推 origin；每完成一个阶段即提交推送。

## 1. 盘点（产出附录 A/B/C）

- [x] 1.1 Toast 全量清单：`inventory-toasts.mjs` 扫描得 120 处 `showToastr_ACU`（error 37 / warning 31 / success 30 / info 22），v2 侧另有 toast.* 调用；措辞归类见附录 A
- [x] 1.2 阈值清单：shared/defaults.ts 全量默认阈值枚举 + 各自的合法引用位（附录 B）
- [ ] 1.3 功能增量候选盘点：prd Notes / TESTING.md / 台账 / UI 走查发现，选定 1 项（附录 C）

## 2. C1 Toast 短语统一

- [x] 2.1 按附录 A 批量替换文案（只改文案，不动触发逻辑）：v1+v2 共 25 源文件、约 70 处
- [x] 2.2 同步 6 个测试文件的断言（tt-surface / summary-vector-index-ui / content-optimization / form-fill-page ×3 / use-form-fill-injection-target ×2 / update-process ×1）；受影响测试文件全绿
- [x] 2.3 grep 审计：presentation 层 CJK「...」残留 0、「，请检查控制台获取详情」残留 0；剩余半角冒号均在 logDebug/logWarn/logError 内部日志（按边界保留）

## 3. C2 阈值注册表 CI 守卫

- [x] 3.1 新增 `tests/shared/threshold-registry-guard.test.ts`（三段：值快照防静默改默认 / 标识符重声明守卫 / 特征字面量散落守卫（白名单冻结制，泛化值 2000/0.35 明确剔除并注明原因））
- [x] 3.2 有效性自测：临时植入 `24000` 散落文件 → 守卫红（点名 offender）→ 还原 → 绿（6/6）
- [x] 3.2b 顺手根治真实漂移 7 处：`summaryIndexArchiveMaxInputChars` 的 `|| 24000` 兜底字面量（vector-memory-config ×2、mirror-rebuild、archive-service、mirror-writer、useVectorIndexConfig、settings-service）→ 改引 `defaultVectorMemoryConfig_ACU.summaryIndexArchiveMaxInputChars`
- [ ] 3.3 全量 vitest 零回退（后台复跑中；首跑唯一失败=agent-control 断言未同步，已修 35/35）

## 4. C3 救援回放 headerToCol 回退修复

- [x] 4.1 根因定位（真机取证）：romance_diary 的 event_type 列带 `CHECK(... IN ('a','b',...))`，旧版 parseDdl 逐行逗号正则把**整列**撕碎丢弃（不是表头失配）→ INSERT 缺列 → NOT NULL 全行跳过
- [x] 4.2 修复：parseDdl 重写为「顶层逗号 + 括号深度 + 字符串感知」切分（行尾逗号+注释=列边界，注释归本列）；extractLineComment 引号感知；headerToCol 升级为 `buildHeaderToCol` 三级匹配（精确→归一化→子串互含）+ used 集防同抢
- [x] 4.2b 脚本改 CLI/模块双形态（main() 包裹 + exports），测试可 import
- [x] 4.3 真实样本 A/B 复验（新旧脚本同输入对比）：原始人 Branch#1（Dev ST）261 语句持平、跳过 0 持平、**62→75 行**（romance_diary 18 行整表复活）；孤独摇滚3 B#5（Dev Luker）246 语句/239 跳过持平、38→45 行；B#1 193 语句/0 跳过持平、54→60 行；B#8 101 语句/53 跳过持平、154→160 行——全部零回归、纯增益
- [x] 4.4 新增 `tests/scripts/rescue-replay-parse.test.ts`（12 用例：romance_diary 回归/多行 CHECK/字符串内 `--`/表级约束/buildHeaderToCol 四态/keyForm/rebind）全绿

## 5. C4 UI 走查 + 功能增量

- [ ] 5.1 presentation-v2 截图走查（改前基线截图）
- [ ] 5.2 落地 ≥1 项 UI 可见改进（双前缀 CSS、主题变量回退）
- [x] 5.3 功能增量落地（附录 C 选定项）：回放 v2 列签名匹配重绑——INSERT 列清单 + UPDATE（SET 左值+WHERE 首阶列，字符串感知）作签名集，**唯一候选**才改绑（歧义/无候选不猜）；命中后入 aliasToPhys 快路径。真实数据：B#5 跳过 **239→10**（行 45→58）；B#1/B#8/原始人 零回退（B#8 余 53 跳=NOT NULL 源数据空值，设计内）。用例 19/19（新增 7：INSERT/UPDATE/歧义/无候选/引号归一化/字面量干扰）
- [ ] 5.4 改动后截图对比留档 e2e-shots/

## 6. D1 Dev 实例巡游（错峰：先 8001 后 8003）

- [ ] 6.1 build 产物同步仓库根 → 两 Dev 实例插件更新（核 junction 防写穿）→ sha 校验
- [ ] 6.2 8001 探针 + 截图巡游（含 C4 改动点验证）
- [ ] 6.3 8003 探针 + 截图巡游（含 C4 改动点验证）

## 7. D2 四酒馆错峰测试

- [ ] 7.1 8001（Dev，读写验证）
- [ ] 7.2 8003（Dev，读写验证）
- [ ] 7.3 8002（Real，只读探针+截图，零写入）
- [ ] 7.4 8004（Real，只读探针+截图，零写入）
- [ ] 7.5 结果登记 journal（含每实例端口、版本、探针结论）

## 8. E1 终验与推送

- [ ] 8.1 typecheck + 全量 vitest（8846+ 零回退）+ build + smoke
- [ ] 8.2 显式 pathspec 提交全部改动并推 origin；工作区干净

## 9. F1 收尾（仅当本地时间 ≥ 09:00）

- [ ] 9.1 journal 更新 + .zcode/handoff-1031.md + handoff-1028.md 后记补齐
- [ ] 9.2 goal-state.json 置 complete=true；CronPauseSelf automation-4cdb8619

---

## 附录 A：Toast 措辞盘点（已回填 2026-10-31 01:35）

**盘点数据**：`~/.zcode/tmp/inventory-toasts.mjs` 扫描 `showToastr_ACU` 120 处（error 37 / warning 31 / success 30 / info 22）；v2 侧 `toast.*`（useToastStore）另有 ~30 处。可疑「占位文案」（warning/purge/null 等 14 处）经逐一核验均为提取器误报（实参为变量），无占位 bug。

**统一口径（四类）**：
1. **失败指引**：一律「<动作>失败，详情见运行日志。」——v1 的 5 处「请检查控制台获取详情」对齐 v2 既有「详情见运行日志」（useDataManagement ×9）。
2. **失败原因冒号**：用户可见 toast / 返回 message 用全角「：」；logDebug/logWarn/logError 内部日志保留半角（工程惯例，不属用户可见面）。
3. **省略号**：进度/加载/占位文案统一字符「…」（原「...」）。
4. **句末标点**：维持现状（v2 已成体系带句号；v1 混用但改动断言成本 > 收益，记录不动）。

**改动文件（25 源 + 6 测试）**：update-trigger / data-admin-ui（冒号×2+指引×4）/ core-data-api / settings-ui-connect（冒号+状态行×3+省略号）/ optimization-ui-exec（冒号×3+省略号×8）/ update-process（进度块+稍候×3+终止×4+冒号）/ settings-ui-trigger（进度块+稍候+终止×2）/ optimization-ui-overlay（×2）/ optimization-ui-diff（按钮×5+截断×3）/ summary-vector-index-ui（×2）/ plot-planning-ui / template-preset-api / plot-preset-api（冒号×4）/ v2：ContinuationChat / WorldbookEntryList / WorldbookSelector / WorldbookSourcePicker / WorldbookEntryToolbar / AcuPromptSegments / ApiConfigPanel / useSqlConsole / useVectorIndexConfig ×3 / useFormFillInjectionTarget ×2 / useManualUpdate ×3 / usePlotWorldbookAgentControl ×2 / form-fill-copy / VectorIndexPage / FormFillPage ×2 / VisualizerSurface ×2 / content-replace-store。

**边界与后续候选**：service 层错误串（update-orchestrator「填表在 N 次尝试后仍失败: 」等 ~60 处）会进 toast 但属内部契约且测试耦合深，本轮不动——列为后续候选「服务层错误串用户可见化统一」。

## 附录 B：阈值清单（已回填 2026-10-31 01:45）

**注册表**：`src/shared/defaults.ts`。守卫用例 `tests/shared/threshold-registry-guard.test.ts`。

| 域 | 常量/字段 | 默认值 |
| --- | --- | --- |
| 自动更新 | DEFAULT_AUTO_UPDATE_THRESHOLD_ACU / FREQUENCY / TOKEN_THRESHOLD / FLOOR_INCREASE_DELAY | 3 / 1 / 500 / 2000 |
| 超大字段软警告 | OVERSIZED_CELL_WARN_CHARS（DEFAULT/MIN/MAX） | 10_000 / 1_000 / 10_000_000 |
| 超大字段软警告 | OVERSIZED_PAYLOAD_WARN_BYTES（DEFAULT/MIN/MAX） | 512KiB / 32KiB / 64MiB |
| 交火索引 | threshold / archiveTriggerCount / archiveBatchSize / archiveMaxConcurrency | 50 / 9 / 3 / 3 |
| 交火索引归档 | summaryIndexArchiveMaxConcurrency / MaxInputChars / EmbeddingConcurrency | 30 / 24_000 / 3 |
| 交火召回 | topK / minScore / rerankBatchSize / bm25CandidateLimit / rrfK / recallCandidateLimit | 200 / 0.35 / 300 / 1000 / 60 / 1000 |
| 交火召回 | summaryIndexKeywordMinRows / summaryChunkSentenceCount / recentFixedInjectCount / rollingDeltaFoldThreshold | 200 / 2 / 50 / 15 |
| Agent | decisionRecentContextCharLimit / skillifyMaxEntries / plotWorldbookScanMessageLimit / agentAiMaxRetries | 2 / 100 / 3 / 2 |
| Agent | greenlightMinTkBudget / greenlightMaxTkBudget | 20_000 / 80_000 |

**守卫口径**：① 值快照——默认值变更必须显式改本用例（= 数据兼容变更走迁移与公告）；② 重声明守卫——15 个注册表标识符只在 defaults.ts 定义；③ 散落守卫——特征值（24000/80000/20000/10000/512\*1024 表达式）全仓扫描 + 文件级白名单冻结；泛化值（2000/0.35）不进散落表（全文件白名单会失守，由①②覆盖）。**本轮修复的真实漂移**：`summaryIndexArchiveMaxInputChars` 的 `|| 24000` 兜底 ×7 处改引注册表常量。

## 附录 C：功能增量候选与选型（已回填 2026-10-31 02:05）

**候选盘点**：
1. 【选定】救援回放 v2——旧代拼音物理名 → DDL 名的列签名匹配重绑：真实痛点（孤独摇滚3 B#5 有 **239/246** 条语句因 `no such table: lianaiduixiangbiao` 等「旧代拼音物理名 vs 新代 DDL 名」失配被跳过；上会话的别名重绑只覆盖 sheetKey 键形式，不覆盖旧代拼音名）。方案：INSERT 失败 no-such-table 时，按语句列清单与已建表 DDL 列做归一化签名匹配，**唯一候选**才改绑（歧义/无候选保持跳过+诊断，与宽容模型一致）。
2. （备选）37 处短语 toast 统一 → 已在 C1 完成。
3. （备选）真实模板入库夹具回归 → L1-MR-14 红线不做，以真机 E2E 替代（沿用上会话口径）。
4. （备选）UI 空态/加载态统一 → 归入 C4 UI 走查项，D1 截图时定点。

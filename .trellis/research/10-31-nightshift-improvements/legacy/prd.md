# 夜班持续改进：toast 统一 / CI 守卫 / 回放修复 / UI 优化 / 四酒馆错峰测试

## Goal

2026-10-31 夜班（00:30→09:00）：落地 prd Notes 既有改进候选（toast 短语统一、阈值注册表 CI 守卫、救援回放 headerToCol 回退修复）、presentation-v2 UI 走查优化至少 1 项可见改进、功能增量 1 项；截图验证 + Dev 实例 E2E 巡游 + 四酒馆错峰测试（Real 只读）；全程零回退，数据兼容红线不破

## Requirements

- **R1 Toast 短语统一**：盘点 `presentation/`、`presentation-v2/` 全部用户可见 toast 文案，按「成功 / 失败 / 警告 / 信息」四类统一措辞模板与风格（中文、句式一致）；只改文案不改触发时机与逻辑语义。
- **R2 阈值注册表 CI 守卫**：默认阈值单点在 `shared/defaults.ts`，新增守卫用例防「散落魔法数回潮」：枚举受守卫阈值清单，断言源码其他位置不再出现同值硬编码（白名单机制允许测试/注释内出现）。
- **R3 救援回放 headerToCol 回退修复**：`source/scripts/rescue/replay-chat.mjs` 的中文表头→物理列映射在个别模板（已知 romance_diary.event_type）失配，产生 NOT NULL 跳过。修回退策略（DDL 列序/类型/命名相似度线索兜底）；真实样本基线不劣化。
- **R4 UI 走查优化**：presentation-v2 界面截图走查，至少落地 1 项用户可见改进（主题变量回退 / 空态 / 布局 / 可读性）；严格遵守 CSS 双前缀铁律（L0-10 / L1-MR-3），配色继承 `--SmartTheme*` 提供回退值。
- **R5 功能增量**：从候选盘点（prd Notes / TESTING.md / 台账 / 走查发现）中选定 1 项落地，含用例；如动数据层须同步 spec。
- **R6 截图验证 + Dev E2E 巡游**：Dev ST 8001 / Dev Luker 8003 更新至最新产物后跑兼容探针 + 界面截图巡游，产物落 `source/test-results/e2e-shots/`。
- **R7 四酒馆错峰测试**（用户点名）：8001 → 8003 → 8002 → 8004 串行、一次一个实例；**Real（8002/8004）只读**：探针 + 截图 + 插件版本/文件校验，绝不写真实数据，遇疑即停。
- **R8 工程纪律**：`npm run typecheck` + 全量 vitest 零回退；动产品代码/产物须 `npm run build` + `npm run smoke`；提交只用显式 pathspec、只推 origin；本地时间 < 09:00 严禁收尾。

## Constraints

- **数据兼容红线**：不改 `TavernDB_ACU_*` 结构、`UNIQUE_SCRIPT_ID`（shujuku_v120）、回放链（sync-bridge）。
- **开源安全基线（L1-MR-14）**：第三方真实模板文本不入库夹具。
- **实例边界（L0-1 / P-11 / P-19）**：写入实例前核 junction；Real 实例零写入；E2E 目标先验证端口白名单。
- **评审态不动工**：模板表达式 `new Function` 收口（任务 10-28-template-expr-containment-review）需用户裁定，本任务不得实施。
- 宿主 CSS 作用域、有界等待（L1-MR-7）、Worker 置空（L1-MR-8）等仓群铁律继续适用。

## Acceptance Criteria

- [ ] AC1 Toast 短语统一落地：四类措辞模板成文（登记于 implement.md 附录 A），受影响用例全绿，grep 审计无遗漏的旧式措辞。
- [ ] AC2 阈值 CI 守卫用例入 vitest 且通过；临时植入一处散落阈值时用例变红（守卫有效性自测后还原）。
- [ ] AC3 headerToCol 修复后：真实样本复验孤独摇滚（15 表 86 行）/ 原始人（261 语句 62 行）不劣化；romance_diary.event_type 类 NOT NULL 跳过显著减少，或留有映射失败原因的明确诊断说明。
- [ ] AC4 UI 改进 ≥1 项：改动前后截图对比留档 `e2e-shots/`；`grep` 自查无裸选择器泄漏。
- [ ] AC5 功能增量 1 项落地，含用例；动数据层则 spec 已同步。
- [ ] AC6 Dev 8001/8003 探针 PASS + 截图巡游完成，产物入库。
- [ ] AC7 四酒馆错峰测试完成：8001/8003 结果 PASS；8002/8004 只读探针与截图完成且零写操作；结果登记 journal。
- [ ] AC8 全量质量门零回退（typecheck / vitest / build / smoke），全部提交已推 origin，工作区干净。

## Notes

- 时间盒：≥09:00 才允许执行收尾（journal / handoff-1031 / goal-state complete / cron 暂停）。
- 真实样本救援回放复验只读源聊天数据、输出到救援产物目录，不写实例。
- 上一会话（10-28）遗留的 handoff 后记、goal-state complete 由本夜班收尾流程统一补齐。

# 超大字段写入软警告（仅警告不拦截）

## Goal

当一次写库操作准备把**异常大**的数据写进聊天消息的 `TavernDB_ACU_IsolatedData` 时，
向用户发出**可理解、可处置**的警告——但**绝不拦截、绝不截断、绝不改写**。

阈值可配置、可关闭；默认开启。

## 背景与定位

现状（2026-10-26 审计实测）：

- checkpoint 的体积阈值被**显式废除**：`maxOperationBytesAfterCheckpoint = Number.MAX_SAFE_INTEGER`
  （`source/src/service/table/storage-frame-v2-persist.ts:294-305`）。
- 唯一的 2 MiB 上限只存在于**写库流水观测器**，作用是截断日志，**不参与写入判定**
  （`source/src/service/table/write-pipeline-observer.ts:31-35`）。
- 导入侧只拦「行宽超过表头」，不拦「单元格过大」（`template-data-preflight.ts:230`）。
- 结果是：一条超大字段可以直接落进聊天消息，把存档与存储配额撑大；爆掉之后只能靠
  `log-error-hints` 的 `storage-quota` 事后建议收拾，**写入前没有任何提示**。

本任务只补「事前预警」这一层，不做压缩、不做清理、不做拦截。

## Requirements

- **R1 覆盖主写入链**：填表、Agent 协议、导入、可视化保存、手动重填——统一收口于
  `runTableUpdateCommit_ACU`（`source/src/service/table/table-update-commit.ts:300`）；
  另需覆盖直接走 checkpoint / 初始帧的路径（`writeInitFullCheckpointFrameV2_ACU`、
  `persistTableSheetCheckpointV2_ACU`）。
- **R2 两个测量维度**：
  1. **单单元格字符数**（写入内容里最长的单个字符串值，按字符计，便于用户理解）；
  2. **单次写入载荷字节数**（本次提交的 operations / checkpoint 负载 UTF-8 字节）。
- **R3 只警告**：warning toast（去重）+ 结构化日志 + 诊断包字段。
  不改变函数返回值、不抛错、不阻塞、不修改任何被写数据。
- **R4 可配置可关闭**：开关 + 两个阈值；默认开启，阈值有默认值与上下界；非法输入回落默认。
- **R5 去重**：同一聊天、同一维度、同一数量级只提示一次；数值回落到阈值以下后重置。
- **R6 文案可解**：说明「是什么 / 多大 / 可能后果 / 去哪里调整或清理」，
  文案风格与 `log-error-hints.ts` 一致（摘要 + 步骤）。
- **R7 不引入全库常驻扫描**：只测量本次写入的增量载荷与本次触及的表。
- **R8 诊断包**：新增 `oversizedWrite` 段（是否启用、阈值、最近 N 条告警摘要），
  **不含任何单元格原文**。
- **R9 不改持久化格式**：不 bump 存储 schema，不改变 `TavernDB_ACU_*` 结构，不影响上游同构。

## 约束

- **C1** 警告路径任何异常都必须被吞掉，绝不影响主写入流程。
- **C2** 日志/诊断只记录长度、表名/列名、时间；**禁止**记录单元格内容、API key、正文。
- **C3** 默认阈值不得裸写在业务逻辑里，统一进常量/默认值注册表。
- **C4** 设置项走既有链路：`Settings_ACU` → `buildDefaultSettings_ACU` → 读取归一化 → UI。
- **C5** 真机验证只允许 Dev 实例（8001 / 8003 / 8899），严禁 8002 / 8004（P-11）。
- **C6** 新增我方差量须登记 `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`。
- **C7** 中文文案、测试零回退、显式 pathspec 提交、只推 origin。

## Acceptance Criteria

- [x] **AC1** 单单元格超阈值：**写入照常成功**（返回值与未超阈值时一致）、出现**一次** warning toast、
      日志含结构化字段（kind / value / threshold / sheetKey / column）。
- [x] **AC2** 单次载荷超阈值：同上。
- [x] **AC3** 开关关闭：零 toast、零新增日志、零诊断记录；写入与改动前**逐字节一致**。
- [x] **AC4** 同聊天连续多次超阈值只提示一次；数值回落后再次超标可重新提示。
- [x] **AC5** 未超阈值：零新增日志 / toast（不得产生噪音）。
- [x] **AC6** 设置项可读写、持久化、上下界校验（非法输入回落默认并有测试）。
- [x] **AC7** 诊断包脱敏扫描通过：新段不含单元格原文 / 密钥。
- [x] **AC8** `npm run typecheck` + `npx vitest run` 全绿零回退；`npm run build` + `npm run smoke` 通过。
- [x] **AC9** 真机（Dev ST 8001）以合成超大字段（5 万字符）复现一次警告，且数据未被拦截、未被截断。
      2026-10-28 实测通过：importTableAsJson persist 提交链触发，toast 恰好一次、回读完整（5 万字符 + END）；
      关开关零提示、恢复后重现。留证：`source/scripts/e2e-oversized-write-check.mjs`（9 断言两连 PASS）。

## Non-goals

- 不做拦截、截断、压缩、自动清理或分片。
- 不做全库体积报表 / 历史趋势。
- 不改 `TavernDB_ACU_*` 结构与存储帧格式。
- 不为该警告新增独立页面。

## Notes

- 审计结论与证据：本次会话（2026-10-26）对硬编码 / 错误可解性 / 安全面 / 模板实测四维度的取证。
- 后续候选（不在本任务）：阈值注册表 + CI 守卫、37 处短语 toast 统一、`new Function` 收口、真实模板回归。

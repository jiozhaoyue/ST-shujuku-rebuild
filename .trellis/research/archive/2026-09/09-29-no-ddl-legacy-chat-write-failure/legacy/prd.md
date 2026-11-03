# 修复「无 DDL 旧聊天」手动填表恒失败：表身份重绑定不采信 runtime fallback

## Goal

让「无 DDL 的旧聊天」不再以「破坏性清理后失败」的方式卡死：写入要么成功，要么在**任何不可逆动作之前**
fail-closed 并给出可操作原因。争取进一步让手动重填在该类聊天上真正完成。

## 现状与已定位链路（2026-09-28 真机诊断 + 2026-09-29 静态定位）

真机靶子：Dev ST 8001，聊天 `Branch #206 - 2026-04-11@01h39m54s486ms`（209 层，源自旧版本，**无 DDL**）。

加载期：`[SyncBridge][runtime-ddl-fallback]` ×9 —— `resolveEffectiveDDL`（`data/sqlite/schema-mapper.ts:95`）
在 `sourceData.ddl` 缺失时走 `buildRuntimeFallbackDDL_ACU`（`:131`），以 `runtimeTableName || uid || sheetKey`
为物理表名生成全 TEXT 的 fallback schema。该步**成功**，故 runtime 可用、表也在。

失败发生在写入侧，有两条独立可见的路径：

- **(a) 手动重填**：报 `表身份重绑定失败：别名「sheet_dCudvUnH」无法证明其在当前基底中的对应表。`
  —— `shared/sql-read-resolver.ts:258` 的 `rebindSheetKeysThroughTableAliases_ACU`（`targetCandidates.size === 0` 分支）。
  调用点：`service/table/update-orchestrator.ts:2402`（模板范围过滤前）与 `:3730`（合并基底上）。
  真机表现为「破坏性清理已发生（`clearManualRefillSheetDataInRange_ACU`）→ 零提交 → 走
  `failManualRefillSession` 回滚」（`update-orchestrator.ts:5575`、`:5817` 的注释即描述该时序）。
  **即失败点在破坏性清理之后**，回滚句柄存在但非「无损」保证。
- **(b) V2 写入**：`V2 写入被拒绝：… fallback DDL 表头不合法：第 2 列「」empty_column_name`
  —— `data/sqlite/schema-mapper.ts:195` 的 `generateFallbackDDL`：表头行第 2 列为空 ⇒ `empty_column_name`
  诊断 ⇒ 抛错。即该聊天的表**表头本身含空列名**，fallback DDL 无法据此建表。

两路共因（待复现确认）：runtime fallback 提供了「物理表名 + fallback schema」，但
**身份解析（表别名注册）没有把 fallback 的 effective 表名当作证据**，于是调度快照里的
旧 sheetKey 无法映射到当前基底。

## 风险背景（为什么上次被搁置）

`shared/sql-read-resolver.ts` 与 `shared/sql-mutation-table-rebind.ts` 是**读 / 写 / replay 三路共用**的
身份与别名内核（`sql-table-service.ts`、`storage-frame-v2-replay.ts`、`prompt-prepare.ts` 都 import）。
2026-09-28 的结论是「改全局别名解析风险高于收益，本轮刻意未动」。本任务必须显式处理这个边界。

## Requirements

- **R1 复现与断点取证（先做）**：在 Dev 8001 上以该聊天复现，钉死 (a)(b) 各自**确切**触发点与数据前提
  （哪条语句 / 哪张表 / 哪份基底 / 表头第几列为空），带 file:line 与可复核的真机证据。
  静态定位已给出候选点（上节），但「共同根因」尚未证实 —— 不得据未证实的假设直接改共享内核。
- **R2 安全失败（硬要求，无论修到哪一步都要有）**：破坏性清理必须发生在「已证明不会因身份解析失败而中断」
  之后；若不能证明，则在 `clearManualRefillSheetDataInRange_ACU` **之前** fail-closed 并给出可操作原因。
  判据：构造「身份解析必失败」的输入，断言**清理未发生**（持久化字段字节不变）。
- **R3 采信 runtime fallback（争取达成，视 R1 结论）**：表身份解析须把 runtime fallback 的 effective 表名
  纳入别名证据，使无 DDL 旧聊天的重填能完成。改动必须证明读 / 写 / replay 三路语义不变（见 C2）。
- **R4 fallback 表头空列名**：明确「表头含空列名」是**数据前提**还是**生成缺陷**。
  若是数据前提 ⇒ fail-closed 且诊断须点名「哪张表、第几列、原值」；
  **绝不允许**把空表头掩盖成 `col_N` 物理列（与 `generateFallbackDDL` 既有契约一致）。
- **R5 回归**：为每条修复补确定性用例，覆盖「无 DDL + 含空表头」这一组合形态；既有 ~8800 用例零回退。

### 约束

- **C1** 宿主差异只进 `shared/host-bridge.ts`（L0-9）。
- **C2** 改动 `shared/sql-read-resolver.ts` / `shared/sql-mutation-table-rebind.ts` 时，必须给出
  「读 / 写 / replay 三路可观察行为不变」的对照证据（用例或逐项论证），不得只靠调用点少来推断安全性。
- **C3** 真机只在 Dev **8001**（严禁 8002/8004，P-11）；复现涉及破坏性清理，必须先备份该聊天。
- **C4** 任何写路径改动不得在失败时留下净损失（数据安全红线）。
- **C5** 不新增相似度 / 编辑距离 / 模糊拼音 / 列序号兜底 —— 既有身份契约明确禁止，本任务不得放宽。

## Acceptance Criteria

- [x] **AC1 真机（Dev 8001）**：本聊天上写路径不再因本缺陷失败 —— 同一操作 A/B：
      旧构建 `insertRow('背包物品表',…)` 返回 `-1`（表定位不到）/ 新构建返回 `3`（成功）；
      该操作正是失败 (b) 的 `sql_sheet_batch` 形态。证据 `research/S5-real-machine-verification.md`。
      ⚠️ **残留**：UI 全流程「手动重填」未跑通（全新 Playwright 上下文 `getApiPresets()` 为空、
      角色列表为空，且用户明令禁止配置本地代理充当 AI 端点）⇒ 留待用户在已登录浏览器复跑。
- [x] **AC2 安全失败单元证**：`update-orchestrator.test.ts`「D-A 解析预演」——
      构造解析必失败输入，断言 `clearManualRefillSheetDataInRange_ACU` **未被调用**、聊天**字节不变**；
      已验证判别性（停用预演即失败）。
- [x] **AC3 形态用例**：`storage-frame-v2-orphan-identity-column.test.ts`（5 条）+ 原 6 条，
      覆盖 `fallback_missing` + 空表头组合的 (a) 列身份解析与 (b) 真实 persist 写入路径；
      「空表头**不被**掩盖成 `col_N`」由前提用例钉住（断言只出 `empty_column_name`）。
- [x] **AC4 零回退**：`npx vitest run` **8800 passed / 4 skipped**（基线 8788，+12 为新增）；
      `npx tsc --noEmit` 干净；`npm run build` + `npm run smoke` 通过（`errorCount: 0`）。
- [x] **AC5 无回归（有 DDL 正常路径）**：新增「有 DDL 的正常路径不受影响」用例 + 全量 8800 用例零回退。

## 已裁定（2026-09-29，见 `design.md` §6）

- **主目标**：先复现取证（已完成，改走**离线**取证）→ 裁定 **D-C′ 复位版 + D-A**。
- **根因（证据确证）**：帧内容携带历史畸形 `["row_id", null, 业务列…]`（既有复位器未接到
  `resolveEffectiveDDL` 的多数调用点）⇒ `generateFallbackDDL` 抛 `empty_column_name`。
  详见 `research/S2-diagnosis.md`。**D-B 因证据不支持而排除。**
- **复现方式**：本轮未启真机（离线解析备份即取得决定性证据）；S5 真机复验仍按计划做。

## Notes

- 登记来源：总台账「已登记的后续任务 ②」（`~/.claude/plans/eager-whistling-lovelace.md` 之外的会话记录），
  真机诊断见 `09-28-historical-frame-replay` 与 `09-28-write-pipeline-observer` 的 prd Notes（同一轮真机）。
- 本缺陷同时是父任务 `09-28-ai-write-transparency` 的 AC-B 唯一阻塞项。
- 相关既有测试：`source/tests/shared/sql-read-resolver.test.ts`、`sql-mutation-table-rebind.test.ts`、
  `sheet-identity.test.ts`、`sheet-identity-merge.test.ts`。
- 复杂任务：`task.py start` 前须补 `design.md` + `implement.md`。

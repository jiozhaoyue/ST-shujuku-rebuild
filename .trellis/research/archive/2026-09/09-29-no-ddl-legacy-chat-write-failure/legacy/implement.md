# 实施计划 · 无 DDL 旧聊天写入失败（先复现取证，再定向修复）

设计见同目录 `design.md`。全程在 `source/` 下执行产品代码；**复选框随执行实时勾选**（L0-2 / L0-17）。
**当前状态：尚未开始执行 —— 下列复选框全部未勾选，本文件只是待执行计划。**

## 执行前门禁

- [ ] `prd.md` 无 TBD（已填实）
- [ ] `design.md` 存在（已完成）
- [ ] 基线测试绿：`npx vitest run`（记录基线用例数，作为 AC4 对比基准）
- [ ] 工作区干净：`git status --short`（`master` 已与 origin 同步）

## S1 备份与冻结（先于一切动作）

- [x] S1.1 备份目标聊天的 `.jsonl` + 旁挂 `luker-state.*` 到仓外临时目录，记 `sha256` / `mtime`
      —— 落点 `Instance/Dev/_acu-defect2-backup-20260929-194138/`；主文件 sha256 `ec84c38b…`（与源逐字节一致）
- [x] S1.2 端口快照：**8001 未运行**；**8002=Real ST / 8003=Dev Luker 在监听**（未触碰）
- [x] S1.3 基线：`npx vitest run` → **8788 passed / 4 skipped**（427 文件 passed + 1 skipped）

## S2 复现与取证（不改产品代码）

> **执行偏差（如实记录，见 `research/S2-diagnosis.md` 抬头）**：S2.1 未执行 —— 未启动任何实例。
> 改为**离线解析备份副本**即取得决定性证据（对真实数据零写入、零风险）。S2.2–S2.7 均以离线方式完成。

- [ ] S2.1 启动 Dev ST **8001**；按 `dev-st-ui-driving-recipe` 达成就绪 —— **未执行（改走离线解析）**
- [x] S2.2 加载期 fallback 证据：9 张表**全部缺 `sourceData.ddl`** ⇒ `fallback_missing` 路径
- [x] S2.3 dump 表头：**checkpoint 的 `content[0]` 每张表 index 1 均为 `null`**（形态 `["row_id", null, 业务列…]`），
      与 guide 的 `[null, 业务列…]` 不同；数据行尾部多一个 `null`
- [x] S2.4 失败链：`generateFallbackDDL`（`schema-mapper.ts:195`）读到 index 1 空占位 ⇒
      `empty_column_name` ⇒ 文案与真机「第 2 列「」empty_column_name」**逐字一致**
- [x] S2.5 只读性：全程只读备份，未触碰源文件（sha 未变）；未发生任何破坏性清理
- [x] S2.6 V2 拒绝：定位到 `storage-frame-v2-replay.ts:258` 的守卫前缀；完整拼接仍待真机（U3）
- [x] S2.7 诊断报告落 `research/S2-diagnosis.md`（F1–F11 + 因果链 + U1–U3 + 方向修正，结论指向 **D-C′**）

## G1 决策门（需用户裁定）

- [x] 呈现证据 + 候选对照 → 用户裁定：**D-C′ 复位版**（把既有孤儿列复位器接到尚未受保护的
      `resolveEffectiveDDL` 调用点；共享重绑内核不动）+ **同时加 D-A**（破坏性清理前 fail-closed）。
      —— 2026-09-29 用户选定。证据见 `research/S2-diagnosis.md`；**D-B 因证据不支持而排除**。

## S3 实施（按 G1 裁定 = D-C′ + D-A）—— **进行中**

- [x] S3.1 抽出**按单表**复位器 `repairOrphanIdentityColumnOnSheet_ACU`（单一规则源；数据级函数改为委托），
      并定位最小落点（U1 精化：replay 路径的修复钩子 `table-data-repair.ts` 不覆盖孤儿列，与
      hydrate/merge 的「成对复位」口径不一致）
- [x] S3.2a **D-C′ 主落点**：`storage-frame-v2-replay.ts` 的 `normalizeHistoricalReplayState_ACU` 前置孤儿列复位
      —— 排在 `restoreLegacyRowIdentity_ACU`（自带 `row_tail_padded`）**之前**，理由见代码注释与
      `helpers-data-merge.ts:501-503` 记载的 2025-12 事故成因（padding 先行使错位固化）
- [x] S3.3 补确定性用例：`tests/service/table/canonical-row-normalizer.test.ts` 新增 6 条
      （数据级对齐 / 单表同一规则 / splice 分支 / 歧义放弃+warning / 幂等 / 健康表头不误伤）
      —— **原先该形态零覆盖**，是本缺陷击穿的原因之一
- [x] S3.4 未动共享重绑内核（`sql-read-resolver.ts` / `sql-mutation-table-rebind.ts` 本体未改）；C2 由「未改」保证
- [x] S3.2b **D-C′ 次落点 —— 经取证后改为「基底复位」+ 次落点全部不动**：
      **决定性发现（`research/S3.2b-base-repair-gap.md`）**：S3.2a 的落点**不够早**
      —— `normalizeLegacyDuplicateCheckpointState_ACU` 在 `audit==='clean'` 时**提前返回**，
      根本不经过 `normalizeHistoricalReplayState_ACU`；畸形表头对 row_id 校验与 upgrade audit
      都不可见 ⇒ 真机聊天恰好走提前返回 ⇒ 复位形同虚设（离线探针实测：严格回放成功返回，
      输出表头仍畸形）。
      改法：把复位提到**回放基底构造处**（`normalizeLegacyDuplicateCheckpointState_ACU` 函数首，
      先于 `restoreLegacyRowIdentity_ACU`），并抽 `repairOrphanIdentityColumnsForReplay_ACU` 统一口径；
      `applySheetCheckpointsForReplay_ACU` 按单表复位（同缺陷类）；保留 `normalizeHistoricalReplayState`
      内一处（幂等）。
      **五处 `resolveEffectiveDDL` 次落点判定：全部不动**（逐条理由）——
      `sql-read-resolver.ts:622` 消费的是已复位基底，复发点唯一在基底未复位；
      `sql-table-service.ts:2512` 操作只读 before 快照，复位会污染比对基准；
      `name-mapper.ts:208` 是 presentation 透传只读访问器；
      `template-import-validator.ts:106` 是自带 try/catch 的 best-effort 探测器（注释明令不得升级为导入失败）；
      `prompt-prepare.ts:774` 只在无 runtime descriptor 时兜底，消费者拿到的仍是已复位基底。
      —— 结论：**消费侧复位既冗余又会改写只读快照/投影副本**，与 design §6.1.2「复位必须作用于下游真正使用的数据」一致。
- [x] S3.2c **D-A**：破坏性清理前加**只读预演** `preflightManualRefillResolution_ACU`
      （`update-orchestrator.ts`，置于最终复检之后、`clearManualRefillSheetDataInRange_ACU` 之前）：
      ① 有界严格回放（`compatibilityMode:'disabled'` + `updateRuntimeState:false` + `backgroundFixation:'skip'`）；
      ② 在回放基底上对**本次目标表**做 `buildSheetColumnAliasMap_ACU` 列/身份解析预演。
      失败即 `{success:false}` 并给出可操作原因，**不调用 failManualRefillSession**（未清理，无需回滚）。
      注：**不按 `isSqlActiveTemplateSheet_ACU` 跳休眠表** —— 该判据会把孤儿表头也算作休眠，
      用它过滤会把要查的表全排除（已在代码注释写明）。
      用例：`update-orchestrator.test.ts`「D-A 解析预演」（断言清理未发生 + 聊天字节不变）。
- [x] S3.5 中间验证：`npx tsc --noEmit` 干净 + 目标套件绿（**已完成一轮**：9 套件 545 用例全绿；
      本轮新增 S3.2b/S3.2c 后重跑：orphan 套件 5/5、orchestrator D-A 用例 1/1）
- [x] S3.6 新增确定性用例：`tests/service/table/storage-frame-v2-orphan-identity-column.test.ts`（5 条）
      —— 覆盖 (a) 列身份解析、(b) 真实 persist 写入路径、基底复位、空表头不掩盖成 col_N、有 DDL 零变化；
      并已验证**判别性**（临时停用基底复位即报真机同款 `empty_column_name`）

## S4 质量门

- [x] S4.1 `npx tsc --noEmit` 干净
- [x] S4.2 `npx vitest run` 全绿且 ≥ 基线（AC4）：**8800 passed / 4 skipped**（428 文件 passed + 1 skipped）
      —— 基线 8788 → **+12**（新增用例 6+5+1），零回退
- [x] S4.3 `npm run build` + `npm run smoke`（AC4）—— smoke `errorCount: 0`、`acuAppV2Mounted: true`

## S5 真机复验（AC1）

- [x] S5.1 在备份兜底的前提下复验 —— 见 `research/S5-real-machine-verification.md`
- [x] S5.2 证据留档：同一无 DDL 旧聊天上，`insertRow('背包物品表', …)`（触发 `sql_sheet_batch`
      写路径，即失败 (b) 的真实形态）**旧构建返回 `-1`（表定位不到）/ 新构建返回 `3`（成功）**
- [x] S5.3 实例复原：聊天 `.jsonl` + 两个 `.luker-state.*` 与插件 `index.js` 均按 `sha256` 复原为
      复验前状态；自己起的 8001 服务已停
- [ ] S5.4 **UI 全流程手动重填未跑通**（全新 Playwright 上下文无 API 预设、角色列表为空，
      且用户明令禁止配置本地代理充当 AI 端点）—— 如实记录，留待用户在已登录浏览器复跑。
      故 AC1 以「写路径核心在真机 A/B」达成，UI 全流程待补。

## S6 收口

- [x] S6.1 更新本任务 `prd.md` 的 AC 勾选
- [x] S6.2 登记我方差量（若产生）到 `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`
- [x] S6.3 规范落 `.trellis/spec/`
- [ ] S6.4 提交（显式 pathspec）+ 推送 origin
- [ ] S6.5 `task.py finish` / `archive`
- [ ] S6.6 父任务 `09-28-ai-write-transparency` 的 AC-B 一并复评（本缺陷即其唯一阻塞）

## 评审门

| 门 | 判据 |
| --- | --- |
| G1（S2 后） | 有确切断点证据（file:line + 数据前提）或如实记录「未复现」；用户已裁定修哪层 |
| G2（S3 后） | 改动最小面；AC3 用例证明空表头不被掩盖；共享内核未被误改 |
| G3（S4 后） | 全量零回退 + tsc + build + smoke |
| G4（S5 后） | 真机：清理未发生 / 失败前置于清理 / 数据字节不变 |

## 回滚点

- **R1**：若走 D-C，改点集中在 `sql-identifier-mapper.ts` 诊断与 `schema-mapper.ts` 调用侧，删除即净。
- **R2**：用例可与实现分开回滚（用例是纯增量）。
- 无存储变更 ⇒ 无数据回滚需求。

## 纪律提醒

- 复现是**只读取证**；任何可能触发破坏性清理的步骤，必须先确认备份 `sha256` 已记录。
- 绝不触碰 8002（Real ST）/ 8004（Real Luker）。
- 提交只用显式 pathspec；提交前 `git diff --staged --name-only` 必须恰等于目标文件集（L0-7）。
- 「顺手修共享内核」是禁区 —— 除非 G1 明确选定 D-B。

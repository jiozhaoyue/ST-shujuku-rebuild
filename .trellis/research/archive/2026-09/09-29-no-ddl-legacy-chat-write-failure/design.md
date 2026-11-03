# 设计 · 无 DDL 旧聊天的写入失败（复现取证 → 定向修复）

父级：本任务 `09-29-no-ddl-legacy-chat-write-failure`。需求见同目录 `prd.md`。
**口径（用户 2026-09-29 裁定）**：先复现取证，再定修哪一层；复现任地前**先备份**该聊天。

## 1. 边界

- 只动**写入侧**的准入与身份解析；不改存储格式、不改 `TavernDB_ACU_*` 结构（AGENTS.md 硬约束）。
- **不新增**相似度 / 编辑距离 / 模糊拼音 / 列序号兜底（C5；既有契约明确禁止）。
- 复现阶段**不改任何产品代码**，只产出证据与诊断。
- 决策门之前不做任何共享内核（`shared/sql-read-resolver.ts`、`shared/sql-mutation-table-rebind.ts`）修改。

## 2. 复现方案（安全前置）

### 2.1 备份（先于一切动作）

| 项 | 值 |
| --- | --- |
| 目标聊天 | `Instance/Dev/SillyTavern/data/default-user/chats/孤独摇滚/Branch #206 - 2026-04-11@01h39m54s486ms.jsonl`（约 4.39 MB） |
| 旁挂状态 | 同目录 `*.luker-state.chat_sync.json`、`*.luker-state.memory_graph.json` |
| 备份落点 | 仓外临时目录 `<实例同级>/_acu-defect2-backup-<ts>/`（**不进 git**） |
| 留证 | 每个文件记 `sha256` 与 `mtime` |

该文件 `mtime` 已为 `2026-09-29 13:05`（**非本任务所改**，来源未知）——备份同时是「复现前后原聊天是否被改动」的判据基线。

### 2.2 启动与就绪

- 启动 **Dev ST 8001**。**严禁** 8002（Real ST）/ 8004（Real Luker）；实测 2026-09-29 有 **8002 在监听**（非本任务启动）。
- 就绪与驱动踩坑沿用 `dev-st-ui-driving-recipe` 记忆：角色列表不自动加载（须显式 `getCharacters()`）、
  切角色点 `.ch_name` 文本、开面板用 `AutoCardUpdaterAPI.openSettings()`、`#acu-app-v2` 高度为 0 故判「存在」不判「可见」。

### 2.3 探针（要抓的证据，逐条）

1. **加载期**：`[SyncBridge][runtime-ddl-fallback]` 的**条数**与每条 `{sheetKey, effectiveTableName, reason, phase}`。
2. **表头数组**：每张表的 `content[0]`（尤其第 2 列的**空值形态**是 `''` / `null` / `undefined`）——直接决定 (b) 的成因归属。
3. **手动重填的完整失败链**：触发点（`update-orchestrator.ts:2402` 还是 `:3730`）、失败 `selector`、
   `sourceRegistry` 命中的 `physicalName`、`targetRegistry` 是否含该 physicalName 的任何别名、`targetCandidates.size`。
4. **破坏性清理是否已发生**：清理前后持久化字段对比 + 与 2.1 备份的 `sha256` 对比。
5. **(b) 的完整包装信息**：哪张表、第几列、原值（`generateFallbackDDL` 的诊断原文）。

### 2.4 复现成功判据

- 在**清理发生之后**拿到 (a) 的失败，且能指出 `targetCandidates` 为空的**具体别名与两侧注册表内容**；**或**
- 证明 (b) 先于 (a) 触发（写入在更早阶段被拒）。
- 二者取其一即算复现成功；**都不成立**则如实记录「未复现」，并在决策门改走「只加安全闸（D-A）」路径。

## 3. 候选修复设计（决策门后选定）

### D-A 安全失败（清理前 fail-closed）

- **落点**：手动重填的准入段（`update-orchestrator.ts:5200` 附近的复检区），在
  `clearManualRefillSheetDataInRange_ACU` **之前**加一次**只读预演**：对本次目标 sheetKeys 先跑一遍
  `rebindSheetKeysThroughTableAliases_ACU`；失败即中止并给出可操作原因。
- **边界**：不改共享内核语义，只把一次校验提前。
- **风险**：低。**回滚**：删掉准入段即净。**判据**：AC2。

### D-B 采信 runtime fallback（让填表真正成功）

- **落点**：别名注册的**来源证据**侧（`shared/sql-read-resolver.ts`，`buildSheetTableAliasMap_ACU` /
  `resolvePhysicalTableNames_ACU` 的调用侧），把 runtime fallback 的 effective 表名作为**附加来源**注入。
- **边界**：只增证据，**不改**冲突判定、不改 fail-closed 规则、不改变既有别名去重语义。
- **风险**：高（读 / 写 / replay 三路共用）。**回滚**：注入点单独可逆。**判据**：AC3 + AC5 对照。

### D-C 修 fallback 生成（表头空列名）

- **落点**：`data/sqlite/schema-mapper.ts`（`generateFallbackDDL`）与 `shared/sql-identifier-mapper.ts`。
- 若空列名是**数据前提** ⇒ 保持 fail-closed，但把诊断升级为「表名 + 列序 + 原值」，并确保它发生在清理**之前**。
- 若是**生成缺陷**（如 `null` 首列占位被误算进中间列） ⇒ 修生成 + 补用例。
- **风险**：中。**判据**：AC3（空表头**不得**被掩盖成 `col_N`）。

## 4. 决策门（G1）

复现证据出来后，向用户呈现：**确切断点**（含 file:line 与两侧注册表内容）+ 三候选的**成本/风险对照**，
由用户裁定实施哪一条或哪几条组合（例如 D-A + D-C 先上，D-B 另行评估）。

## 6. G1 裁定与落地设计（2026-09-29 用户选定）

**裁定**：**D-C′ 复位版 + D-A**。D-B 因证据不支持而排除（见 `research/S2-diagnosis.md` §二 方向修正）。

### 6.1 D-C′：把孤儿列复位接到未受保护的路径

**根因**（S2 确证）：帧内容携带历史畸形 `header = ["row_id", null, 业务列…]`、`row = [id, 值…, null]`；
既有复位器 `repairLegacyOrphanIdentityColumn_ACU`（`shared/canonical-row-normalizer.ts:115`）只接在
SQLite hydrate 入口（`sync-bridge.ts:134`），而 `resolveEffectiveDDL` 的其余调用点未接 ⇒
`generateFallbackDDL`（`data/sqlite/schema-mapper.ts:195`）抛 `empty_column_name`。

**落地原则**：

1. **单一规则源**：把「按单表复位」的逻辑抽成**导出**的按表函数（同一份规则，不复制实现）；
   既有的按数据对象函数改为委托它，保证两条入口的判据**永不漂移**。
2. **复位必须作用于下游真正使用的数据**（不能只修副本）：复位会删格，只改副本会让 DDL 列数与
   行宽错配，`createSheetInsertPlan` 会写错列。故复位点是**调用点**（数据即将被使用处），
   不是 `resolveEffectiveDDL` 内部。
3. **落点（2026-09-29 实现前精化，取代原候选清单的优先级）**：
   - **主落点 = V2 replay 路径**：`storage-frame-v2-replay.ts:1355` 已调 `repairTableDataFromAudit_ACU`
     作为修复钩子，但 `service/table/table-data-repair.ts` 只处理「表头改名 / 插 row_id 列 / 行 id 归一 /
     pad / overflow」，**不覆盖孤儿列形态**。而其它两处 hydrate/merge 都是**成对**调用
     （`sync-bridge.ts:130`+`:134`、`helpers-data-merge.ts:505`+`:509`）—— replay 这一处漏了第二半。
     故：按同一成对口径，在 replay 的修复点补上孤儿列复位；另 `:1610`（introduction/rebase/reveal
     整表取自 `checkpoint.data`）同样需前置复位。
   - **次落点**：`shared/sql-read-resolver.ts:622`（`resolveSheetColumns_ACU` 的 descriptor 缺失回落；
     U1 指向此处导致 V2 守卫报错）、`service/table/sql-table-service.ts:2512`、
     `service/ai/prompt-builder/prompt-prepare.ts:774`（AI 填表）、
     `runtime/template-vars/name-mapper.ts:208`、`service/template/template-import-validator.ts:106`。
     ⚠️ 后四处各自带「禁止重新 resolve fallback」一类契约注释（`prompt-prepare.ts:763-765`、
     `sql-read-resolver.ts:594-596`），**改动前必须逐个确认不违反该契约**；不确定就不动。
4. **不得放宽既有安全语义**：保留「歧义行即整表放弃 + warning」；不得为修好而加入相似度/序号兜底（C5）。
5. **失败可见**：复位发生时记 `logWarn_ACU`（沿用既有 `[SyncBridge] 已复位孤儿身份列错位` 口径）。

### 6.2 D-A：破坏性清理前 fail-closed

- 在手动重填进入 `clearManualRefillSheetDataInRange_ACU` **之前**加一次**只读预演**：
  对本次目标 sheetKeys 先跑一遍身份解析/DDL 解析，失败即中止并给出可操作原因。
- 只加校验、不改既有回滚句柄语义；与 D-C′ 正交（即使将来出现别的失败形态也兜住）。
- 判据：构造「解析必失败」输入，断言**清理未发生**（持久化字段字节不变）。

## 5. 兼容与回滚

- **无存储格式变更** ⇒ 无数据迁移、无回滚需求。
- 三候选的改点各自集中、可独立回滚。
- 复现期间对真实聊天的唯一风险是**破坏性清理**；由 2.1 备份 + 清理前后 sha 对比兜底。

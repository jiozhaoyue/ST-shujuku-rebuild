# 数据与持久化

> 本仓**没有服务端数据库**。运行时是 **sql.js 内存 SQLite**；持久化靠把「存储帧」写进聊天消息字段。
> 改数据层之前先读 `docs/superpowers/specs/` 下相关设计文档。

---

## 三层结构

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 引擎 | `data/sqlite/sqlite-engine.ts`、`schema-mapper.ts`、`sql-normalizer.ts` | 建表、DDL 生成、SQL 归一 |
| 同步桥 | `data/sqlite/sync-bridge.ts`（`export class SyncBridge`，`:58`） | 内存表 ↔ 持久化帧 的导出与回放 |
| 边界适配 | `data/repositories/*-repo.ts`（会话字段读写）、`data/gateways/*-gateway.ts`（宿主 I/O）、`data/storage/*.ts`（字段常量） | 与宿主/聊天的接缝 |

---

## 持久化模型（改数据层前必须理解）

- **数据落在聊天消息字段**，前缀 `TavernDB_ACU_`。常量示例：`data/storage/chat-history.ts:16` 的 `CHAT_SCOPED_CONFIG_FIELD_ACU = 'TavernDB_ACU_ScopedConfig'`；其余字段在 `data/repositories/chat-message-data-repo.ts` 中读写（`TavernDB_ACU_IsolatedData`、`_Data`、`_SummaryData`、`_HotSnapshot`、`_ModifiedKeys`、`_Identity`…）。
- **帧 = checkpoint + SQL 操作日志（`logEntries`）**。核心链路是「回放日志 → 重建表」。改这条链**必须**补往返用例，参照 `tests/integration/table-checkpoint-roundtrip.test.ts` 的形态（导出 → 回放 → 重建后逐表比对）。
- **单文件标识不可改**：`shared/constants.ts:15` 的 `UNIQUE_SCRIPT_ID = 'shujuku_v120'` 是存储命名空间根（如 `shujuku_v120__userscript_settings_v1`）。改它 = 换存储身份 = 现有用户数据全部"丢失"。**只有做独立副本时才改**。

---

## 空表与坏表头

导出空表时若写成只有 `['row_id']` 的表头，会污染后续 checkpoint 与可视化编辑器（`data/sqlite/sync-bridge.ts:403` 有明确注释）。
**规则**：表结构校验统一走 `shared/canonical-checkpoint-validator.ts` 的 `validateCanonicalCheckpointSheet_ACU`，不要另写一套判空/判表头逻辑。

---

## 隔离槽位：空串是合法值

`shared/isolation-policy.ts:1-9` 写明：标签隔离（`dataIsolationEnabled` / `dataIsolationCode`）**已退役**，未开启隔离时槽位键固定为 `''`。

- 只拒绝 `null` / `undefined` —— `isUsableIsolationSlotKey_ACU(key)` 的实现就是 `typeof key === 'string'`。
- **禁止用 `if (!key)` / `if (!isolationKey)` 当读写门禁**：空串会被当 falsy，9.0 出现过「交火索引指针写不进、删不掉」的回归。
- 存量 `IsolatedData['']` 与历史隔离码槽位按原键读写，**不要删旧数据路径**。

---

## 查询与写入

- **AI 产出的写操作走受限结构**：`shared/restricted-sql-dml.ts` 的 `RestrictedSqlStatement_ACU`（`insert` / `update` / `delete` 三态，值域仅 `string | number | null`）。不要让模型直接产出裸 SQL 字符串再执行。
- **跨层返回结果对象，不抛异常**：`shared/table-storage-provider.ts:14-49` 的 `SqlQueryResult` / `SqlMutationResult` / `ApplyEditsResult{ success }` 是本仓既有信封形态。
- **命名**：表名与列名由模板 JSON 决定（`sheet_*` 前缀，见 `shared/table-defaults/`）；SQL 标识符映射走 `shared/sql-identifier-mapper.ts`，不要手拼。

---

## 反模式

- 手拼 SQL 字符串绕过受限 DML 类型。
- **私改 `TavernDB_ACU_*` 字段结构或新增字段**：上游（`shuiyue-cmyk/shujuku-rebuild`）按同构性对齐，私改会变成持续冲突（差量台账见 `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`）。
- 用 `if (!key)` 判隔离槽。
- 改完同步桥不跑往返用例。

---

## 验证

```bash
cd source
npx vitest run tests/integration/table-checkpoint-roundtrip.test.ts
npx vitest run tests/data          # 数据层全量
```

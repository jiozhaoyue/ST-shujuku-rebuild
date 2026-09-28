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

## 只读读取历史帧（列出语句，不重放）

「这一层当时写了什么」的只读视图在 `service/table/historical-frame-replay.ts`，
面板是 `presentation-v2/components/FrameReplayPanel.vue`（Developer 页）。

**读取通道只有一个**：`data/repositories/chat-message-data-repo.ts:1113` 的
`readIsolatedTagData_ACU(msg, isolationKey)` → `.storageFrame`。
**不得**自己去解析 `TavernDB_ACU_IsolatedData` 的 string / object 两种格式（那是仓储的契约）。

**活引用陷阱（最关键）**：`readIsolatedDataContainer_ACU` 返回的是**活引用的同一个对象**，
其底层 `parseIsolatedDataField`（`:56`）还带**按消息的解析缓存**。因此只读回放**绝不可以**
原地改写 frame 或其 `operations` —— 那会直接污染运行中的持久化数据。判据：调用前后同一
`isolationKey` 的 `TavernDB_ACU_IsolatedData` 经 `JSON.stringify` **逐字节相等**；
且回放模块**不 import 任何写接口**（有静态检查用例固定这一点）。

**形状判定**（`classifyStorageFrame_ACU`，宽容、不抛错）：帧非对象 / `logEntries` 非数组 ⇒ `invalid`；
`checkpoint.kind === 'full'` 或 `perSheetCheckpoints` 非空 ⇒ `full_checkpoint`；
否则 `logEntries` 非空 ⇒ `delta`，为空 ⇒ `empty`。
注意 **checkpoint 与 logEntries 可以共存**（一轮填表后同一帧既有 checkpoint 又有本次 delta）：
形状按 checkpoint 判，但条目**照常列全** —— 不因「有 checkpoint」就丢掉 delta。
坏帧降级为诊断态并给出原因，**不静默跳过**。

**与救援脚本的关系**：帧模型口径与 `scripts/rescue/replay-chat.mjs` **逐项对齐**
（帧位置 / string-object 容忍 / checkpoint 判据 / entries 来源 / 坏帧宽容 / sheetKey→表名的 key 形式
—— 回放侧的复刻是 `tableNameFromSheetKey_ACU`）。
**差异**：本模块**不建库、不重放求值、不改写冲突**（那些是救援脚本的**回放期**职责）；
本模块只**列出**语句。判据：本模块内不出现任何 SQL 执行调用。

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

## 持久化面（四类落点）与纯数据库模式兼容

本插件的全部状态只落在**四类**通道，改动持久化前必须先归类（未归类的新通道 = 审查不通过）：

| 通道 | 内容 | 在 chatfilesys 纯数据库模式下 |
| --- | --- | --- |
| **消息字段** | `TavernDB_ACU_IsolatedData` / `IndependentData` / `Data` / `SummaryData` / `Identity` / `LocalMessageAnchor` / `ModifiedKeys` / `UpdateGroupKeys`（清单：`MESSAGE_TABLE_FIELDS_ACU`） | 随消息进库：拦截层把整份内容拆回「第几层 / 第几个变体」，读回时按酒馆原格式组装 ⇒ **无感可用** |
| **chat[0] 镜像 + chatMetadata** | `TavernDB_ACU_ScopedConfig` / `InternalSheetGuide` / `TableHeaderGuide`（清单：`FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU`）；chatMetadata 侧同名两键为**权威源** | 只被**转发**、不被接管（纯数据库模式有意不碰别人的聊天状态）⇒ 走原生通道 |
| **浏览器本地** | IndexedDB：`TavernDB_ACU_VectorHotCache` / `VectorTempCache`；localStorage：`acu_v2_ui_state`、`TavernDB_ACU_vector_orphan_sweep_last_run` | 与宿主存储无关，不受影响 |
| **服务端向量文件** | `TavernDB_ACU_vector_registry` 及其路径族 | 不经 `/api/chats/*`，不在接管范围；**按聊天定键的东西在「一个家族多分支」下要自己保证键仍稳定** |

**契约常量的落点**：这四类通道的**字段名清单**放在 `shared/persisted-surface.ts`（单一事实源），
数据层与向量层从它取常量并 re-export，UI 与守卫用例也读它。放 `shared/` 的理由不只是分层好看：
UI 若为读一份清单而 import `data/**` 或 `service/vector/**`，会把整张依赖图拽进 app 图 ——
实测（2026-09-28）那会与若干测试文件的窄 mock 冲突，使 `tests/setup/warm-app-graph.ts` 的预热抛错，
**预热失效 → 重型套件退回冷转译 → 首条用例超时**（表现是「莫名其妙的超时」，与真实改动毫无关联）。

**两条硬前提**（守卫用例 `tests/integration/pure-db-mode-compat.test.ts` 会钉住，破了就变红）：

1. **不绕过宿主聊天通道**：源码里**不得**直连 `/api/chats/*`、**不得**读写文件系统。
   聊天持久化只有单一漏斗 `data/gateways/chat-gateway.ts`（`saveChat()`）。
   理由：拦截层装在宿主网络出口上，绕过出口就等于绕过拦截层 —— 纯数据库模式下会写进空气。
2. **持久化面显式可审查**：源码用到的 `TavernDB_ACU_*` 名字集合必须与上表逐字相等
   （多一个 = 新增未归类；少一个 = 清单过期，两种情况都会失败）。

**为什么值得记**：姊妹插件 `ST-chatfilesys-rebuild`（仓群 `My-repo`）的纯数据库模式会
接管 `/api/chats/*`；本插件之所以**结构性兼容**，正是因为上面两条从一开始就成立 ——
它不是「适配出来的」，而是**没做错事**。契约详情见该仓 `docs/pure-db-mode-explained.md`。

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

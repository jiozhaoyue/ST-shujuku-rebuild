# 会话数据库损坏救援与模板迁移

日期：2026-09-07
状态：已批准（方案 A：离线宽容回放重建 + 插件官方 API 写回）

## 背景

Luker 实例（`https://127.0.0.1:8004/`，数据目录 `D:\Repo\Tavern-repo\Instance\Real\Luker`）中，会话「孤独摇滚3 / 孤独摇滚 - 2026-07-19@23h05m21s834ms imported - Branch #8」（434 楼，28.9MB）加载即报错。

约束：**不修改实例文件**。所有修复通过浏览器操作插件自身的 API 完成。

## 根因（实采控制台日志 + 离线解析聊天文件确认）

每次 `CHAT_CHANGED` 加载时重演同一失败链：

1. `[V2 Replay] 应用日志失败: messageIndex=430, seq=1`
   第 430 楼的 V2 存储帧 `logEntries` 中 seq=1 的操作第 2 条 SQL 为
   `INSERT INTO jiyaobiao (row_id, ...) VALUES (45, 'AM0045', ...)`，
   回放时 `UNIQUE constraint failed: jiyaobiao.row_id` —— AI 重复插入了已存在的 row_id=45。
2. `[V2 Compat Replay] Tier-1 兼容回放也失败`：兼容路径因
   `SPv7.9 旧语义 SQL 回放缺少首列 row_id INTEGER PRIMARY KEY`（旧语义 DDL 校验与新模板不匹配）无法兜底。
3. `表格合并失败，已保留可用数据并降级` → `CHAT_CHANGED 延迟重建 失败` → `轻量恢复失败（不再重试）`。

数据未丢：聊天内有 43 个 `TavernDB_ACU_IsolatedData` 存储帧（约每 10 楼一个检查点+增量），全聊天共 1088 条回放 SQL（834 UPDATE / 196 INSERT / 30 DELETE），坏点只卡住"严格回放"这一条路径。

## 存储模型（救援工具依赖的事实）

- 运行时：sql.js 内存 SQLite；持久化 = 把"检查点 + SQL 操作日志（`storageFrame.logEntries`）"写进聊天消息的 `TavernDB_ACU_IsolatedData` 字段（隔离键 `""`）。
- 热状态快照：`chat_metadata.TavernDB_ACU_HotSnapshot`（仅作加速缓存，本次会话中 rows 全空，真实数据全靠回放）。
- 模板：`chat_metadata.TavernDB_ACU_ScopedConfig.templateArchives`（当前生效 `瑟瑟灵感数据库模板V2.41`，15 表）；`TavernDB_ACU_InternalSheetGuide` 为表头注入指引。
- 配置：`settings.json` → `extension_settings.__userscripts.shujuku_v120__userscript_settings_v1`。
- 插件对外 API：`window.AutoCardUpdaterAPI`（`api-registry.ts` 挂载），本次用到 `exportTableAsJson` / `importTableAsJson(json, {persist:true})` / `restoreTableAsJson` / `importTemplateFromData(data, {scope:'chat'})`。

## 方案对比与取舍

- **A（采用）离线重建 + API 写回**：Node 离线宽容回放 1088 条 SQL 重建完整数据 → 浏览器调官方 `importTableAsJson` 写回持久化。新检查点落盘后坏操作日志不再被回放，根因自然消除。不改实例文件、走官方持久化链。
- B 全在线重放（浏览器逐条 `executeSql`）：慢、每条触发持久化/UI、中途出错难续。否。
- C 升级插件修回放（fork 加宽容回放让实例升级）：需写实例文件，违反约束。仅作为后续内置化路线。

## 交付物

### 1. 离线救援工具（沉淀进仓库，`source/scripts/rescue/`）

- `replay-chat.mjs`：输入聊天 `.jsonl` 路径（可选 `--isolation` 隔离键、`--from` 起始楼）+ 输出目录。解析存储帧 → sql.js 按楼层顺序回放全部 `logEntries`。
  - **宽容回放规则**：`INSERT` 主键/UNIQUE 冲突自动改写为 `INSERT OR IGNORE` 重试一次；仍失败的单条语句跳过并记录；其余错误照常上抛。诊断记录：楼层/seq/operationIndex/改写方式/失败语句/原因。
  - 输出：`finalState.json`（重建后的表格数据，`importTableAsJson` 可直接导回的格式）、`diagnostics.json`（跳过与改写明细）、`summary.md`（表×行数×诊断统计）。
- `extract-template.mjs`：从酒馆助手脚本 JSON（内嵌内容）提取数据库模板（V3.3.0，19 表建表语句+列定义+注入配置），产出插件可导入的模板 JSON。
- 纯 Node + 仓库已有 sql.js 依赖；输入/输出都在仓库目录，绝不读写实例文件。

### 2. 在线修复（浏览器操作插件 API，一次性步骤）

1. `exportTableAsJson` 留在线现状存档（保底回滚点）。
2. `importTableAsJson(<finalState.json>)` 持久化写回 → 新检查点取代坏日志。
3. 刷新重载验证：控制台零 `shujuku_v120` 报错；导出行数与重建一致。

### 3. 模板切换 V2.41 → V3.3.0（数据进新库）

- `importTemplateFromData(<V3.3.0 模板 JSON>, {scope:'chat'})` 导入并切换当前聊天生效。
- 迁移映射：旧 15 表 → 新 19 表按中文名同名对应；列按**同名同义列迁移**（同名列直接迁、同义列核对映射后迁、新表置空、迁不走的列记入报告）。
- 迁移后再次 `importTableAsJson` 写入，验证同上。

### 4. 经验文档

`docs/` 下《会话数据库损坏救援与模板迁移》（本文档）：存储帧/回放模型、根因、宽容回放设计取舍、**内置化路线**——后续版本把宽容回放+诊断采集收进 `sync-bridge.ts` 作为插件内置纠错功能（损坏时自动降级回放并在 UI 提示跳过数，诊断可一键导出）；本次不实现，仅立此存照。

## 验收

- 刷新会话后插件加载零报错（重点：无 `V2 Replay` / `Compat Replay` / `表格合并失败`）。
- 重建数据行数 ≥ 离线回放统计且表齐全；诊断文件列出全部被宽容处理的语句（预期含 row_id=45 那条）。
- 模板切换后 19 表生效，旧数据落在对应新表，报告列出每表迁移行数与未迁列。

# 会话数据库损坏救援经验总结

日期：2026-09-07
关联设计：[2026-09-07-chat-db-rescue-and-template-migration-design.md](../superpowers/specs/2026-09-07-chat-db-rescue-and-template-migration-design.md)

本次实战完成了一次完整的会话数据库救援（433 楼、28.9MB、160 行表格数据）与模板迁移（V2.41 → V3.3.0，15 表 → 19 表）。本文沉淀可复用的结论与工具。

## 一、事故画像（本次根因）

**表象**：打开会话即报错，`[V2 Replay] 应用日志失败` → `[V2 Compat Replay] Tier-1 兼容回放也失败` → `表格合并失败，已保留可用数据并降级`。

**根因链**（两层，第一层是触发器，第二层是兼容路径失效的原因）：

1. **AI 重复 INSERT 已存在的 row_id**：第 430 楼的 V2 操作日志含 `INSERT INTO jiyaobiao ... VALUES (45, ...)`，而 row_id=45 已存在 → `UNIQUE constraint failed`，严格回放在此处中断。
2. **Tier-1 兼容回放被旧 DDL 卡住**：兼容回放要求把首列降级为无主键旧语义，但该会话的表 DDL 不满足降级前置校验（`SPv7.9 旧语义 SQL 回放缺少首列 row_id INTEGER PRIMARY KEY`），兼容路径同样失败 → 只能降级到不可用的合并结果。

**关键事实：数据从未丢失。** 全部数据都在存储帧的操作日志里（本例 1088 条 SQL：834 UPDATE / 196 INSERT / 30 DELETE），只是"严格回放"这条读路径被单条坏语句卡死。

## 二、存储模型速查（救援必备）

| 位置 | 内容 |
|---|---|
| 聊天消息 `TavernDB_ACU_IsolatedData[隔离键]` | V2 存储帧：`checkpoint`（kind=full 全量快照）+ `logEntries`（增量 SQL 日志） |
| `chat_metadata.TavernDB_ACU_HotSnapshot` | 运行时热缓存（可能过期/为空，**不可作为数据真相**） |
| `chat_metadata.TavernDB_ACU_ScopedConfig` | 当前聊天生效模板（templateArchives） |
| `chat_metadata.TavernDB_ACU_InternalSheetGuide` | 表头注入指引 |
| `settings.json → extension_settings.__userscripts.shujuku_v120__userscript_settings_v1` | 插件配置 |

回放语义：从最后一个 `kind=full` 的 checkpoint 建库，其后各帧 `logEntries[].operations[].statements` 按楼层/seq 顺序重放。物理表名 = `sheetKey` 去掉 `sheet_` 前缀并去掉下划线（`sheet_ji_yao_biao` → `jiyaobiao`）。

## 三、救援方法论（可复用流程）

1. **取证**：浏览器打开实例 → `console.error/warn` 打钩子 → reload → 采集完整失败链。服务端日志目录通常为空，浏览器控制台才是主要证据源。
2. **离线重建**（不碰实例文件）：解析聊天 `.jsonl` 的存储帧，从 checkpoint 建库 + 宽容回放全部 SQL。工具：`source/scripts/rescue/replay-chat.mjs`。
   - 宽容规则：INSERT 主键/UNIQUE 冲突自动转 `INSERT OR IGNORE` 重试一次；仍失败单条跳过并记录诊断；其他错误上抛。
   - 本例结果：1088 条语句全部成功重放（那条重复 INSERT 正是唯一坏点，跳过后数据完整）。
3. **在线写回**（只走插件 API，不改实例文件）：
   - `importTableAsJson` 会做 preflight 审计（表头校验 + SQLite hydrate 预检），且写入门闸要求"写前 provisional replay 必须成功"——**旧坏帧不先清除，任何导入都会被拒**。
   - 正确路径是 `initGameSession(null, { injectTemplate:true, templateData, resetExistingTableData:true, persist:false })`：走 `resetCurrentChatTableStateFromTemplate` 原子提交，先删除全部旧存储帧再写 `reason:'init'` 的全新 full checkpoint，然后 `ctx.saveChat()` 持久化。
4. **验证闭环**：页面刷新 → 重开会话 → 控制台零插件报错 → `exportTableAsJson` 行数与离线重建一致。

### 导入预检的三个坑（重放工具输出必须满足）

1. **首列表头必须是 `row_id`**（全等）。审计只认 `row_id`/`id`/`行号` 三种写法，DDL 注释整段（如「行号，仅允许为 1」）会被判 `upgrade_invalid_header` 且无法自动修复。
2. **表头必须覆盖 DDL 全部列**。checkpoint 的 content 表头可能与自身 DDL 漂移（缺 CHECK 尾列），缺列会触发 `upgrade_required_mapping_ambiguous`。回放工具以 DDL 为准重建表头、补宽行数据。
3. **NOT NULL 无默认列不能为空串**。若历史数据本身缺值，需按该列 CHECK IN 枚举填入中性合法值（本例 `event_type→'初次相遇'`、`completion_status→'未完成'`），并在诊断中记录。

## 四、模板迁移（V2.41 → V3.3.0）

- 新模板内嵌在状态栏脚本（`JSON.parse('...')`，双层转义），用 `source/scripts/rescue/extract-template.mjs` 提取：定位调用点 → 逐层 JS 反转义 → `JSON.parse` 校验。
- **迁移语义**（同名同义列）：表按中文名对应；列按物理名精确匹配迁移；新增列置中性默认（受 CHECK 约束的取合法枚举）；移除列丢弃并记录；4 张全新表空表就位。逐表迁移报告已生成（160 行、约 950 个列值全部落位）。
- 迁移动作同样走 `initGameSession` 原子路径，天然完成"换模板 + 换数据"一步到位。

## 五、内置化路线（给这个 fork 的后续版本）

1. **宽容回放内置**：把 `replay-chat.mjs` 的宽容规则下沉到 `sync-bridge.ts` / V2 replay 的 Tier-1 路径：`UNIQUE constraint failed` 自动 `OR IGNORE` 重试 + 跳过计数进 `toleranceReport`，UI 显示"本次跳过 N 条冲突操作"，提供诊断导出按钮。
2. **兼容回放的 DDL 降级前置校验**要给出可行动的报错（当前只说"缺少首列 row_id"，应指出是哪张表哪个 DDL 形态不满足）。
3. **一键救援命令**：CLI（`replay-chat.mjs` 已具备）+ 插件面板"导出救援包"（storageFrame + HotSnapshot + 模板 + 配置打包）。
4. **pre-flight 对账**：`initGameSession` 路径的 header/DDL 对账逻辑值得从救援工具反哺回 `table-data-upgrade-audit`，把"不可自动修复"的黑名单进一步缩短。

## 六、工程杂项经验

- **后台标签页会让酒馆启动卡死**：`yieldToBrowser` 依赖 `requestAnimationFrame`，后台/遮挡页签 rAF 永不触发，启动停在 `[init] loader hidden` 之后，表现为角色列表空白、插件不加载。把浏览器面板切到前台即可。自动化浏览器做酒馆调试时务必保持页面可见。
- **IAB 面板可能中途重启**：长流程要假设页面状态随时丢失，每步都从头 bootstrap（extensions → characters → selectCharacterById → openCharacterChat），用 fire-and-poll 模式绕开工具超时。
- **插件 API 全集在 `window.AutoCardUpdaterAPI`**（`api-registry.ts` 挂载）：`exportTableAsJson` / `importTableAsJson` / `initGameSession` / `importTemplateFromData` / `getTemplatePresetNames` / `switchTemplatePreset` 等，覆盖导出、导入、模板切换、游戏初始化全链路。
- **必须 `selectCharacterById` 再 `openCharacterChat`**：后者内部校验模块态 `characters[chid]`，只设 `window.this_chid` 无效。
- 酒馆 `.jsonl` 聊天文件第 1 楼（index 0）通常是系统楼，`chat_metadata` 挂在它上面。

## 七、本次产物清单

- `source/scripts/rescue/replay-chat.mjs`：聊天文件 → 宽容回放重建 → `finalState.json` / `diagnostics.json` / `summary.md`
- `source/scripts/rescue/extract-template.mjs`：状态栏脚本 → 内嵌 V3.3.0 模板 JSON（19 表）
- 设计文档：`docs/superpowers/specs/2026-09-07-chat-db-rescue-and-template-migration-design.md`
- 实例修复结果：会话「孤独摇滚3/Branch #8」加载零报错，V3.3.0 模板 19 表 161 行（160 行迁���数据 + 模板自带杂表示例行）完整可用

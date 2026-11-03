# S5 真机复验 · Dev ST 8001（2026-09-29）

靶子：`Instance/Dev/SillyTavern`（HTTP，8001），聊天
`孤独摇滚/Branch #206 - 2026-04-11@01h39m54s486ms`（209 行，源自旧版、**无 DDL**、9 张表）。
复验前后对聊天与该实例插件产物均按 `sha256` 快照**复原**。

## 一、起服与部署

- 起服：`NODE_ENV=production node server.js --no-browserLaunchEnabled`（`config.yaml` 是被跟踪的宿主源码，L0-1 禁改）。
- 部署我方构建：只覆盖插件落点 `public/scripts/extensions/third-party/shujuku-rebuild/index.js`
  （`manifest.json` 两侧本就逐字节一致 `7ecfa469…`，未动）。

| 时点 | index.js sha256 |
| --- | --- |
| 复验前（= 构建于 `51806a4`） | `0cf25c7dfaa7c589b42a6a8a5b299c940fd058fc1aab9640e2e9dcc49791b465` |
| 我方新构建 | `f11daac333b20c2e81354e36670c74416770fe1d3cd4a49c2418188f351c737a` |
| 复验后（已复原） | `0cf25c7d…` ✓ |

聊天文件：复验前 `ec84c38b15d9747a53d023a53fefac89080dd910d7f5eab66c27f1807aa39534`
（与 S1 备份逐字节相同）→ 复验后已复原为同一 sha ✓。

## 二、决定性 A/B：同一操作、同一聊天、只换构建

**判据选择过程（重要，避免用不特异的观测量）**：

- `exportTableAsJson` 与 `queryTableRows` 在**新旧两构建下表现完全一致**（9 张表表头均对齐 / 表均可见）
  ⇒ 二者走的是**模板/guide 派生数据**，不是帧回放产物，**对本缺陷不特异**，不可作判据。
- 真正的失败面在**帧回放**：`sql_sheet_batch` 重放时
  `buildSheetColumnAliasMap_ACU(state)` → `resolveEffectiveDDL` → `generateFallbackDDL`。
  旧构建下 `normalizeHistoricalReplayState_ACU`（`ensureSqlReplayRuntime_ACU` 于 hydrate 前调用）
  **没有孤儿列复位**，而 hydrate 以 `strict:true` 在**克隆**上修，`state` 本身仍是畸形
  ⇒ 列重绑读到 `header[1] === null` ⇒ 抛 `empty_column_name`。
  这正是真机文案「… fallback DDL 表头不合法：第 2 列「」empty_column_name」的来源。

**A/B 操作**（经插件公开 API，触发 `sql_sheet_batch` 写入路径，即 (b) 的真实形态）：

```js
AutoCardUpdaterAPI.insertRow('背包物品表', { 物品名称:'ACU探针物品', 数量:'1', '描述/效果':'缺陷②真机探针', 类别:'探针' },
                             { skipChatSave: true, skipNotify: true })
```

| 构建 | 结果 | 控制台 |
| --- | --- | --- |
| 旧（`51806a4`） | **返回 `-1`** | `[shujuku_v120] insertRow: Table "背包物品表" not found.` |
| 新（本次修复） | **返回 `3`**（成功） | 无本插件相关错误 |

⇒ 同一无 DDL 旧聊天上，旧构建连表都定位不到、写入不可用；新构建写入成功。

**落盘形态旁证**（新构建那次，`skipChatSave` 实际未阻止落盘，已复原）：
落进楼层 208 的帧是 `{"source":"manual_crud","operations":[{"kind":"sql_sheet_batch",
"sheetKey":"sheet_in05z9vz","statements":["INSERT INTO `beibaowupinbiao` (`wu_pin_ming_cheng`,…)"]]}`
—— 物理表名 `beibaowupinbiao` 印证「无 DDL 走 fallback 拼音表名」，且操作类型正是 `sql_sheet_batch`。

## 三、未能完成的部分（如实记录）

- **完整的手动重填（UI 全流程）未跑通**：Playwright 全新浏览器上下文里
  `getApiPresets()` 返回 `[]`（预设存浏览器本地存储，全新 context 无历史），
  角色列表亦为空（`ctx.characters` 为空）⇒ 既无可用 AI 端点、也点不到角色卡；
  用户此前明令**禁止搜索/配置任何本地代理**充当 AI 端点，故**不配预设**。
  确认框（`.acu-dialog__actions`「确认并继续」）因此从未出现。
- 故 AC1 的「手动重填」以其**写路径核心**（`sql_sheet_batch` 写入）在真机上 A/B 验证，
  而非 UI 全流程。UI 全流程留待用户在已登录（带预设）的浏览器里复跑。
- 干扰项排除：控制台里的 `[统一状态栏] 逻辑表查询失败 … unknown column cur_time`
  与 `PAGEERR: $(...) is not a function` / `SD WebUI returned an error` 等均**非本插件**来源
  （`cur_time` 不在本插仓库源码内，是外部扩展按其自有配置调用本插件 SQL API 所致）。

## 四、实例复原与遗留

已复原：聊天 `.jsonl` + 两个 `.luker-state.*`、插件 `index.js`（sha 逐一核对）。
服务已停（8001 释放）。

**遗留（未擅自删除，按 L0-6 待用户裁定）**：本次探针触发了宿主 ST 自身的聊天备份机制，
在 `data/default-user/backups/` 新建 6 个文件：

- `chat______ca8a6660_20260929-210709.jsonl`（4,394,064 B，pristine）
- `chat______ca8a6660_20260929-210755.jsonl`（同上）
- `chat______ca8a6660_20260929-210805.jsonl`（同上）
- `chat______ca8a6660_20260929-210927.jsonl`（同上）
- `chat______ca8a6660_20260929-212000.jsonl`（4,394,903 B，**含探针写入**）
- `settings_default-user_20260929-211653.json`（22,993,718 B）

均为宿主原生机制产物、位于 `.gitignore` 覆盖的数据区；删除属「删已有文件」，故不擅自处理。

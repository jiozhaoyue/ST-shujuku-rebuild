# AGENTS.md — ST-shujuku-rebuild（Luker·数据库）

Luker / TauriTavern 宿主的数据库插件，基于上游 [shuiyue-cmyk/shujuku-rebuild](https://github.com/shuiyue-cmyk/shujuku-rebuild) v9.1.9 的适配 fork。以标准浏览器扩展形式安装（无需酒馆助手），SQL 表格持久化到聊天消息的 `TavernDB_ACU_*` 字段中。

## 仓库结构

- 仓库根：**分发产物**（`index.js` 单文件约 10MB、`manifest.json`、`sql-wasm.wasm`）——由构建生成并提交，不手改。
- `source/`：真正的工程（TypeScript + rollup + vitest），所有开发在这里进行。
  - `src/`：源码。分层：`data/`（sqlite 引擎、sync-bridge、仓储、网关）→ `service/`（业务）→ `presentation/`、`presentation-v2/`（UI，后者为 Vue SFC）→ `shared/`（工具/常量/host-bridge）→ `entry-extension.ts`（入口）。
  - `tests/`：vitest 测试（`data/ service/ shared/ presentation/ integration/ performance/ fixtures/`）。
  - `scripts/`：构建辅助（sql-wasm 资产内联、冒烟）。
- `docs/superpowers/specs/`（设计文档）、`docs/superpowers/plans/`（实施计划）。
- `source/docs/TESTING.md`：真机测试清单。

## 构建与测试

全部在 `source/` 下执行：

```bash
cd source
npm run build        # rollup：产物自动同步到仓库根（dist/extension → 根 index.js 等）
npm run typecheck    # tsc --noEmit
npx vitest run       # 全量测试（发版前必须零回退；当前规模 ~7700 用例）
npm run smoke        # 产物冒烟
```

## 关键约定与陷阱

- **单文件标识 `shujuku_v120`**：`UNIQUE_SCRIPT_ID` 常量（`src/shared/constants.ts`）是存储命名空间根（`shujuku_v120__userscript_settings_v1`、`TavernDB_ACU_*` 聊天字段前缀与之配套）。改它 = 换存储身份，会"丢"所有现有数据；独立副本才改。
- **数据持久化模型**：运行时是 sql.js 内存 SQLite；持久化靠"存储帧"（checkpoint + SQL 操作日志 `logEntries`）写进聊天消息的 `TavernDB_ACU_IsolatedData`，热状态快照在 chat_metadata 的 `TavernDB_ACU_HotSnapshot`，模板在 `TavernDB_ACU_ScopedConfig` / `TavernDB_ACU_InternalSheetGuide`。修数据层必须理解"回放日志 → 重建表"这条链（`data/sqlite/sync-bridge.ts`）。
- **宿主适配**：TT / Luker / 通用 ST 三态 profile 在 `src/shared/host-bridge.ts`，探测失败自动降级 generic。宿主差异只许进桥，不许散落业务层。
- **上游同步**：CI 每日自动合并上游 master；冲突按"我方差量"解决（host-bridge、分发产物重建）。上游的数据格式与模板 JSON 必须保持同构，不要私自改 `TavernDB_ACU_*` 结构。
- **构建开关**：SQLite 引擎（wasm 默认 / asm 回滚）由 rollup replace 注入（`ACU_SQLITE_ENGINE`）；wasm 以 base64 内联进产物，无外部 fetch。
- **版本**：source `package.json` 与根 `manifest.json` 的 `version` 需一致；`auto_update: true`，用户从 GitHub 地址安装。
- vitest 里宿主模块（`./script.js`、`./scripts/extensions.js`）由 `vitest.config.ts` 的 stub 占位，新增依赖宿主全局时注意补 stub。

## 文档

改数据层 / 存储格式前先读 `docs/superpowers/specs/` 下相关设计文档；测试要求见 `source/docs/TESTING.md`。

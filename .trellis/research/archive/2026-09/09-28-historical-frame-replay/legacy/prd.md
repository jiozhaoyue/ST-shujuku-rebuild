# T3.3 · 历史楼层只读回放

父任务：`09-28-ai-write-transparency`（阶段 3 · AI 写库全透明）
前置：`09-28-write-pipeline-observer`（T3.2，复用其展示设施；**未闭环前内核可独立完成**）

## Goal

让历史楼层「当时到底写了什么」可回看：从聊天消息的持久化帧读出该帧**执行了哪些 SQL**，只读呈现。

## 范围边界（2026-09-28 用户裁剪，务必遵守）

- **只读列出帧内 SQL**：读出 `logEntries[].operations[].statements` 并富化展示。
- **不重执行 SQL、不写回**（「重建当时执行了哪些 SQL」= 列出语句，不需要重放求值）。
- 因此**不引入** sql.js 重放、**不修改**任何存储/持久化路径。

## Requirements

- **R1** 从一个**指定聊天消息**的 `TavernDB_ACU_IsolatedData` 取出 `TableStorageFrameV2_ACU`，只读解析。
- **R2** 呈现帧内每条日志条目及其语句，富化维度：`seq`、`source`（`TableMutationSourceV2_ACU`）、
  `aiFloor` / `targetMessageIndex`、`commitRevision`、语句的**方言**（DSL vs 裸 SQL）与**操作类型**（insert/update/delete）。
- **R3** 区分帧的三种形态并**显式呈现**而非静默跳过：
  **full checkpoint**（`checkpoint` / `perSheetCheckpoints` 有值）、**纯 logEntries（delta）**、**空帧**。
- **R4** 纯只读保证：回放路径**不得**触发任何写操作 —— 以「调用前后提交计数 / 帧字节不变」为判据。
- **R5** 复用而非重写：帧结构与回放模型**已有先例**——
  `source/scripts/rescue/replay-chat.mjs` 文件头完整记录了帧模型（checkpoint 建库 + `logEntries` 按 `seq` 重放
  `operations[].statements`），且注明「与插件 `data/sqlite/sync-bridge.ts` 一致」。**先读它，再决定复用哪一层**。
- **R6** UI 落点与 T3.2 一致（`AdvancedToolsPage` 内），复用其展示/过滤设施，**不得再造一套**。

### 约束

- **C1** 主机差异只许进 `shared/host-bridge.ts`（规则 L0-9）。
- **C2** 读帧必须走既有仓储层（`data/repositories/chat-message-data-repo.ts`），**不得**自己重新解析聊天字段格式。
- **C3** UI 不得 import 副作用模块；读清单类常量进 `shared/`（阶段 2 两条硬教训）。
- **C4** 坏帧/半截帧不得抛错到 UI：降级为「诊断态」（与救援脚本的「宽容回放」精神一致），并如实标注该帧不可解析。

## Acceptance Criteria

- [x] **AC1** 对**真实**聊天中一个含 `logEntries` 的楼层，面板能列出该帧的全部语句，条目数与该帧 `operations` 展开一致。
      证据：`historical-frame-replay.test.ts`「delta 帧：列出条目与语句」；面板用例「列出含帧楼层…点选后列出条目与语句」。
      真机进一步确认见 AC7。
- [x] **AC2** 帧的三种形态（full checkpoint / delta / 空帧）各有一条用例，UI 显式区分、不误报为「无数据」。
      证据：内核用例四形态齐备（含「仅 perSheetCheckpoints 判 full」与「checkpoint 与 delta 共存时 entries 列全」）；
      面板用例「空帧与整帧检查点显式区分」。另新增第四种 `invalid`（坏帧，见 AC4）。
- [x] **AC3 只读**：回放前后该消息的 `TavernDB_ACU_IsolatedData` **字节不变**，且无任何提交发生。
      证据：`JSON.stringify` 逐字节比对用例；**静态检查用例**断言模块源码不含
      `persistTablesToChatMessage_ACU` / `writeIsolatedTagData_ACU` / `runTableUpdateCommit_ACU` / `saveChatToHost_ACU`。
- [x] **AC4 坏帧**：截断/非法帧不抛错，降级为诊断态并给出原因。
      证据：五例覆盖（`logEntries` 非数组 / 帧非对象 / 字符串坏 JSON / 楼层不存在 / 楼层无帧）；
      面板用例「坏帧降级为『不可解析』并给出原因」。
- [x] **AC5 复用**：与 `source/scripts/rescue/replay-chat.mjs` 的帧模型口径**逐项对齐**（差异已在 design 写明）。
      证据：帧位置 / string-object 容忍 / checkpoint 判据 / entries 来源 / 坏帧宽容 / `keyFormOf` 表名
      均有对应用例；差异（不建库、无冲突改写、不读 chat_metadata、覆盖面含 DSL 与结构化 kind、
      只列语句不重放）已写入 design §3.2 与 `backend/database-guidelines.md`。
      富化**复用** T3.2 的 `summarizeMutationOperations_ACU`（不另造一套）。
- [x] **AC6 零回退**：`npx vitest run` 全绿；`npx tsc --noEmit` 干净。
      证据：**8788 通过 / 0 失败**（T3.2 收口时 8765，+23）；tsc 干净；build + smoke 通过。
- [x] **AC7 真机**：Dev 实例 **8001**（严禁 8002/8004）上对历史楼层回放并留证截图。
      **已达成**（2026-09-29，Dev ST 8001）。证据：切到角色「孤独摇滚」→ 打开聊天
      `Branch #206 - 2026-04-11@01h39m54s486ms`（209 层）→ 开发者页「历史楼层回放」列出
      **1 个含帧楼层**：`#207 · AI 楼层 25 整帧检查点 0 条 · 0 个操作（检查点原因：migration）`；
      点选后详情显示 `帧内容（楼层 #207）… 覆盖表 sheet_dCudvUnH、sheet_DpKcVGqg、sheet_NcBlYRH5、
      sheet_lEARaBa8、sheet_in05z9vz、sheet_etak47Ve、sheet_3NoMc1wI、sheet_PzcX5v2、sheet_OptionsNew`
      —— 与帧内 checkpoint.data 的 9 张表一致；**只读自比：点选前后该聊天全部
      `TavernDB_ACU_IsolatedData` 序列化结果逐字节一致**。截图见任务 notes。
      **未覆盖**：带 `logEntries` 的 delta 帧真机样本 —— 该聊天的写入被既有缺陷挡住（见下），
      故没能产生新的 delta 帧；三形态中的 delta/invalid 由单元与面板用例覆盖。

## Notes（真机验收记录，2026-09-29）

- 靶子：Dev ST 8001，角色「孤独摇滚」，聊天 `Branch #206 - 2026-04-11@01h39m54s486ms`（209 层，1 个含帧消息）。
- 部署：Dev ST 此前未运行，由本次验收启动；实例插件产物 `index.js` 覆盖为我方 `51806a4` 的构建
  （覆盖前 sha256 `920d7007…` 已记录，`manifest.json` 与我方**逐字节一致**故未动）。
- 真机踩到的环境事实（**供后人省时间**）：
  1. Dev ST 前端启动**不会自己加载角色列表**（`ctx.characters` 恒为空）。必须先显式调
     `SillyTavern.getContext().getCharacters()`，`#rm_print_characters_block` 才会渲染角色卡。
  2. 切角色的有效方式是点 `.ch_name` 文本匹配的元素（`ctx.selectCharacterById` 不生效）。
  3. 打开插件 UI 用 `await AutoCardUpdaterAPI.openSettings()`；`#acu-app-v2` 存在但**高度为 0**，
     故就绪判据要用「存在（attached）」而不是「可见」。
  4. 酒馆的 preloader 遮罩在写入失败触发 runtime reload 后仍会短暂显示 —— 截图前需等面板内
     真的出现记录再截。
- 该聊天上有**既存缺陷**（不属本任务）：任何写入都被 V2 守卫拒绝 ——
  `V2 写入被拒绝：… fallback DDL 表头不合法：第 2 列「」empty_column_name`。
  即「无 DDL 旧聊天」的写入问题（与总台账「已登记的后续任务 ②」同源）。写入被拒 ⇒ **数据未被改动**。

## Notes

- 帧类型：`source/src/service/table/storage-frame-v2-types.ts:674` 的 `TableStorageFrameV2_ACU`
  （`checkpoint?` / `perSheetCheckpoints?` / `logEntries: TableMutationLogEntryV2_ACU[]`）；
  日志条目见 `:499`（`seq` / `entryId` / `createdAt` / `source` / `targetMessageIndex` / `aiFloor` / `operations[]` / `commitRevision`）。
- 既有帧读取点：`source/src/data/repositories/chat-message-data-repo.ts:227`、`:609`、`:820` 等
  （**均用 `Array.isArray(frame?.logEntries)` 做形状守卫** —— 沿用该宽容风格）。
- 既有回归素材：`docs/superpowers/specs/2026-09-07-chat-db-rescue-and-template-migration-design.md`（损坏会话案例）。
- 复杂任务：`task.py start` 前须补 `design.md` + `implement.md`。

# T3.3 实施计划 · 历史楼层只读回放

父任务：`09-28-ai-write-transparency`。设计见同目录 `design.md`。
**前置**：T3.2（`09-28-write-pipeline-observer`）已闭环 —— 本任务复用其
`summarizeMutationOperations_ACU` 与语句渲染。若 T3.2 尚未收口，先等其他内核，不重复实现富化。
全程在 `source/` 下执行。**复选框随执行实时勾选**。

## 执行前门禁

- [ ] T3.2 已闭环（`service/table/write-pipeline-observer.ts` 存在且 `summarizeMutationOperations_ACU` 可 import）
- [ ] `prd.md` 无 TBD（已填实）
- [ ] `design.md` 存在（已完成）
- [ ] 基线测试绿：`npx vitest run`（记录基线数以对比 AC6）

## 步骤

### S1 内核：帧形状判定与只读回放

- [x] S1.1 新建 `src/service/table/historical-frame-replay.ts`
  - [x] 类型：`FrameShape_ACU` / `FrameFloorEntry_ACU` / `FrameReplayEntry_ACU` / `FrameReplayView_ACU`
  - [x] `classifyStorageFrame_ACU(frame)`：按 design §4.1 的表判定四种形状，全程不抛错
  - [x] `listFrameBearingFloors_ACU()`：`getChatArray_ACU()` → 逐楼
        `readIsolatedTagData_ACU(msg, getCurrentIsolationKey_ACU())` → `.storageFrame`；
        `aiFloor` 用 `isAiFloor_ACU` **累积计数**（不用 `chat.slice()` —— 那是 O(n²)，长聊天白白吃掉一次刷新）
  - [x] `buildFrameReplayView_ACU(messageIndex)`：宽容解析 + 富化（调
        `summarizeMutationOperations_ACU`）；坏帧返回 `invalid` + `invalidReason`
  - [x] **只读纪律**：模块内**不 import 任何写接口**；只读字段、从不赋值写回
  - [x] 表名显示用 `tableNameFromSheetKey_ACU`（`sheet_ji_yao_biao` → `jiyaobiao`），
        **仅显示不建表**；与 replay-chat.mjs 的 `keyFormOf` 同源并在注释里写明
  - [x] 实现取舍：列表用轻量 `operationCount`（不富化）、详情给精确 `statementCount`
        —— 避免为算列表而全量富化整个聊天（已回写 design）
- [x] S1.2 新建 `tests/service/table/historical-frame-replay.test.ts`
  - [x] **AC2** 四形态：`full_checkpoint`（checkpoint）/ `full_checkpoint`（仅 perSheet）/ `delta` / `empty`
  - [x] checkpoint 与 logEntries 共存时：形状判 full，**但 entries 仍列全**
  - [x] **AC4** 坏帧五例：logEntries 非数组 / 帧非对象 / 字符串坏 JSON / 楼层不存在 / 楼层无帧
  - [x] **AC3 只读**：`JSON.stringify` 逐字节相等；且**静态检查**模块源码不含任何写接口符号
  - [x] **AC5 对齐**：A1–A7 覆盖（帧位置 / string-object 容忍 / checkpoint 判据 / entries 来源 /
        坏帧诊断 / keyFormOf）；D4（DSL 与旧 patches 也被识别/标注）显式断言
  - [x] 旧帧只含 `patches` 时：标注 `legacyPatchesOnly`，不误报为「无数据」
- [x] S1.3 验证：`npx vitest run tests/service/table/historical-frame-replay.test.ts` —— **19 通过 / 0 失败**

### S2 UI：回放面板

- [x] S2.1 新建 `composables/useFrameReplay.ts`（楼层列表 / 选择 / 视图 / 刷新 / 换聊天清空）
- [x] S2.2 新建 `components/FrameReplayPanel.vue`；语句渲染复用共享映射
- [x] S2.2b **抽出共享展示映射** `composables/write-statement-display.ts`
      （方言/操作的文案与徽章配色单一事实源），`WritePipelinePanel` 改为消费它
      —— 两面板渲染同一份 `WriteStatementStat_ACU`，不得各写一套文案
- [x] S2.3 `pages/DeveloperPage.vue` 挂 `<FrameReplayPanel />`（紧随 `WritePipelinePanel`）
- [x] S2.4 在 `tests/presentation-v2/developer-page.test.ts` 追加「历史楼层回放」套件 —— **4 条用例**：
      空态 / 列出并可点选看语句 / 空帧与检查点显式区分 / 坏帧降级
- [x] 验证：`npx tsc --noEmit` 干净；`developer-page.test.ts` **22 通过 / 0 失败**

### S3 全量质量门

- [x] S3.1 `npx tsc --noEmit` 干净
- [x] S3.2 `npx vitest run` 全绿，用例数 ≥ 基线（AC6）
      —— **8788 通过 / 0 失败**（T3.2 收口时 8765，**+23**：内核 19 + 面板 4）
- [x] S3.3 `npm run build` + `npm run smoke`（`acuAppV2Mounted: true` / `menuItemInjected: true` / `errorCount: 0`）

### S4 真机验收（AC7）

> **2026-09-29 执行完毕**（Dev ST 8001，与 T3.2 合并同一轮）：**已达成**。

- [x] S4.1 Dev ST **8001**（严禁 8002/8004）开发者页 → 历史楼层回放 → 选真实含帧楼层
      —— `Branch #206 - 2026-04-11@01h39m54s486ms`（209 层）的 `#207 · AI 楼层 25`
- [x] S4.2 条目数与该帧一致：该帧为 `migration` 产生的整帧检查点（9 张表、0 条 logEntries），
      面板如实显示「0 条 · 0 个操作」+ 检查点原因 + 覆盖表清单 —— 与帧内 `checkpoint.data` 的 9 张表一致
- [x] S4.3 只读留证：点选前后该聊天全部 `TavernDB_ACU_IsolatedData` 序列化结果**逐字节一致**
- [x] S4.4 截图留证（临时目录 `03-frame-replay-detail.png`；`06-pipeline-record.png` 同帧含回放面板）
- **未覆盖**：带 `logEntries` 的 delta 帧真机样本 —— 该聊天写入被既有缺陷拒绝，无法产生新 delta 帧；
  delta/invalid 两形态由 `historical-frame-replay.test.ts` 与面板用例覆盖

### S5 收口

- [x] S5.1 更新本任务 `prd.md` 的 AC 勾选（AC1–AC7 全 [x]，含真机证据与未覆盖项说明）
- [x] S5.2 更新父任务 `prd.md` 进度表（T3.3 行 → 代码已交付 · 回放侧真机已验）+ 集成验收：
      **AC-C 达成**（同页回放面板 + 共用 `write-statement-display.ts`，零写入字节自比）；
      **AC-B 未达成（环境阻塞）**：Dev ST 无 API 预设 + 靶子聊天写入被既存缺陷拒绝，两因均不属阶段 3；
      **AC-D 真机未覆盖**，由关闭态用例覆盖。父任务 AC-A/AC-B/AC-D 如实留空并注明原因。
- [x] S5.3 登记我方差量到 `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`
      （提交 `51806a4` 落 2 行 T3.3 差量；`3f8961c` 细化任务归属与「观测关闭」措辞）
- [x] S5.4 规范落 `.trellis/spec/backend/database-guidelines.md`
      （新增「只读读取历史帧」节：唯一读取通道 / 活引用陷阱 / 形状判定 / 与救援脚本的差异口径）
- [x] S5.5 提交（显式 pathspec，11 文件 `51806a4` + 1 文件 `3f8961c`）+ 推送 origin（`origin/master` 已同步）
- [x] S5.6 `task.py finish` / `archive`（父任务在三个子任务全归档后收口）

## 评审门

| 门 | 判据 |
| --- | --- |
| G1（S1 后） | 三形态 + 坏帧 + 只读字节比对全绿；模块内无写接口 import |
| G2（S2 后） | tsc 干净；面板能在无数据/坏帧/正常三种态下正常渲染 |
| G3（S3 后） | 全量零回退 + build + smoke |
| G4（S4 后） | 真机条目数一致 + 只读留证 + 截图 |

## 回滚点

- **R1**：`historical-frame-replay.ts` 是纯函数 + 只读取数，删除即净。
- **R2**：UI 三个文件（两个新组件/composable + 开发者页一行）可单独回滚。
- 无存储变更 ⇒ 无数据回滚需求。

## 纪律提醒

- 只读是硬约束：任何「顺手修复帧」的念头都必须拒绝（那是救援脚本的职责，且必须有备份 + 显式授权）。
- 真机只在 8001；提交只用显式 pathspec。

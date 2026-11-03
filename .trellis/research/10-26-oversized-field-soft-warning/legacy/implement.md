# 实施清单 · 超大字段写入软警告

> 约定：每完成一项**立即勾选**；每步先写测试再接线（纯函数优先）。
> 所有命令在 `source/` 下执行，命令前先 `export PATH="/c/nvm4w/nodejs:$PATH"`。

## 阶段 0 · 前置核实

- [x] **0.1** 复核 `runTableUpdateCommit_ACU` 的 `applied.persist?.operations` 与 `options.operations`
      实际形态（`TableMutationOperationV2_ACU[]`），确认测量输入不丢数据。
- [x] **0.2** 复核 `persistTableSheetCheckpointV2_ACU` / `writeInitFullCheckpointFrameV2_ACU` 是否存在
      `runTableUpdateCommit_ACU` 之外的直调路径；有则纳入接入点，无则从清单删除。
- [x] **0.3** 复核 `safeJsonByteLength_ACU` 可复用性与可见性（现为模块内私有，必要时上提为导出）。

**验证**：`git status --short` 干净；结论写进本文件「前置核实结论」段。

## 阶段 1 · 内核（不接线）

- [x] **1.1** 新建 `source/src/service/table/oversized-write-warning.ts`：
      常量、`measureOversizedWrite_ACU`、`evaluateOversizedWriteWarnings_ACU`、
      `probeOversizedWrite_ACU`、去重表与重置逻辑、诊断环形缓冲。
- [x] **1.2** 新建 `source/tests/service/table/oversized-write-warning.test.ts`：
      测量（表头跳过 / 非字符串跳过 / 多表过滤 / UTF-8 字节口径）、
      边界（等于 / 略超 / 远低 / 双维度）、出口（开关关闭零调用、去重、升档重提、回落重置、异常不抛）。

**验证**：`npx vitest run tests/service/table/oversized-write-warning.test.ts` 全绿（18/18）。

## 阶段 2 · 设置

- [x] **2.1** `settings-model.ts` 增加三个可选键；`buildDefaultSettings_ACU` 写入默认值。
- [x] **2.2** 新增 `normalizeOversizedWriteSettings_ACU`（上下界裁剪 + 非法回落），接入读取侧。
- [x] **2.3** 单测：默认值、边界值、非法输入（`''` / `NaN` / 负数 / 超上限）。

**验证**：相关单文件 vitest 全绿；`npm run typecheck` 通过。

## 阶段 3 · 接入主写入链

- [x] **3.1** `table-update-commit.ts` 的 `runTableUpdateCommit_ACU` apply 成功后调用探针
      （整体 `try/catch`），不改变返回值。
- [x] **3.2** `tests/service/table/table-update-commit.test.ts` 追加：
      超阈值写入仍成功且返回值一致；关闭开关时零 toast/日志。
- [x] **3.3** 若有 checkpoint 直调路径，按 `design.md` §4 接入并补对应测试。
      实测：`persistTableSheetCheckpointV2_ACU` 无外部直调；`writeInitFullCheckpointFrameV2_ACU`
      被 `template-state-reset.ts` 直调，已接入（以 `[checkpoint]` 作为载荷测量）。

**验证**：`npx vitest run tests/service/table/` 全绿（零回退）。

## 阶段 4 · 诊断包

- [x] **4.1** `diagnostic-bundle.ts` 新增 `oversizedWrite` 段（enabled / thresholds / recent ≤10）。
- [x] **4.2** 追加测试：字段存在、条数上限、脱敏扫描（不得出现单元格原文）。

**验证**：`npx vitest run tests/service/diagnostics/` 全绿。

## 阶段 5 · UI

- [x] **5.1** `DataMgmtPage.vue` 新增「写入体积提示」分组：开关 + 单元格字符阈值 +
      载荷阈值（MB 显示 / 字节存储）+ hint（强调「只提示、不拦截」）。
- [x] **5.2** 页面测试：读写、非法输入回落、关闭后保存生效。

**验证**：`npx vitest run tests/presentation-v2/` 全绿；`npm run build` 成功。

## 阶段 6 · 全量质量门

- [x] **6.1** `npm run typecheck`
- [x] **6.2** `npx vitest run`：**431 文件 / 8843 通过 / 4 skip / 0 失败**（+24 新用例，零回退）
- [x] **6.3** `npm run build`（已同步仓库根 `index.js`；wasm sha 未变）
- [x] **6.4** `npm run smoke`（acuAppV2Mounted: true, errorCount: 0）

**验收**：四项全绿，记录通过/失败数到本文件。

## 阶段 7 · 真机（Dev 8001）

- [x] **7.1** Dev ST（8001）合成超大字段（5 万字符进「作者要求」列，经 importTableAsJson persist 提交）：
      toast **恰好一次**（文案含数值/阈值/「不拦截」/调整入口）、数据**未被拦截/截断**
      （回读 maxRun=50000 + END 标记完整）。
- [x] **7.2** 关闭「写入体积提示」开关（数据管理页，UI 实操）后回落→再超标：**零 toast**、写入照常成功、
      数据完整；重新开启后提示**重现**（行为级证明开关生效）。
- [x] **7.3** 环境阻塞已解除并实测。自动化留证：`source/scripts/e2e-oversized-write-check.mjs`
      （9 项行为断言，PASS 两连）+ `source/test-results/e2e-shots/oversized-*.png` + oversized-report.json。

## 阶段 8 · 收尾

- [x] **8.1** 台账登记：`docs/superpowers/specs/2026-09-27-fork-delta-ledger.md` §3 补一行
      （新增文件 + 默认开关 + 上游是否已有同类能力）。
- [x] **8.2** 如规范有新契约，更新 `.trellis/spec/`（已补 `backend/safety-and-isolation.md`「数据体积软警告」节）。
- [x] **8.3** 显式 pathspec 提交（19 文件，校验暂存区恰为目标集合）并推送 `origin/master`：`85a0b26`。

## 回滚点

| 位置 | 回滚动作 |
| --- | --- |
| 阶段 2 之后 | 删除三个设置键 + 归一化，回到阶段 1 |
| 阶段 3 之后 | 移除接入调用（探针模块可保留但无人调用，等于关闭） |
| 阶段 5 之后 | UI 分组删除；设置键保留（默认值仍生效，无 UI 可改） |
| 任意阶段 | 开关置 false 即回到旧行为，无数据迁移 |

## 前置核实结论

（执行阶段 0 后回填）


## 验证记录（2026-10-26）

| 门 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（多轮） |
| `npx vitest run` | **431 文件 / 8843 通过 / 4 skip / 0 失败**（较基线 +24） |
| `npm run build` | 通过（`index.js` 已同步；`sql-wasm.wasm` sha 未变） |
| `npm run smoke` | 通过（`acuAppV2Mounted: true`, `errorCount: 0`） |
| 真机（Dev 8001） | **阻塞**：验证时实例未运行；替代证据见 7.3 |
| 提交 | `85a0b26`（已推 origin/master） |

# 设计 · 超大字段写入软警告

## 1. 总体思路

测量放在**提交边界**（数据已定稿、尚未落盘），出口只有一个模块。
写入路径本身**一行不改语义**：探针只读、只记、只提示。

```
apply() 成功
   │
   ├─ 新增：measure（只测本次增量）─ evaluate（比阈值）─ emit（去重/出口）
   │                                                        ├─ logWarn_ACU（结构化）
   │                                                        ├─ showToastr_ACU('warning')（一次性）
   │                                                        └─ 诊断环形缓冲（最近 N 条）
   │
   └─ 原 persist（顺序、返回值、数据均不变）
```

## 2. 新增模块

`source/src/service/table/oversized-write-warning.ts`（单一出口，纯函数 + 一个模块级去重表）

### 2.1 常量与默认值（进默认值注册表，不裸写）

| 名称 | 默认 | 上下界 | 说明 |
| --- | --- | --- | --- |
| `OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU` | `10_000` | `1_000` – `10_000_000` | 单单元格字符数阈值（用户 2026-10-26 指定：1 万字符左右） |
| `OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU` | `512 * 1024` | `32 * 1024` – `64 * 1024 * 1024` | 单次写入载荷 UTF-8 字节阈值（按 1 万字符口径相应下调） |
| `OVERSIZED_WRITE_WARNING_ENABLED_DEFAULT_ACU` | `true` | — | 总开关 |

### 2.2 测量

```ts
interface OversizedWriteMetrics_ACU {
  maxCell?: { chars: number; sheetKey: string; rowIndex: number; columnIndex: number };
  payloadBytes: number;
}

measureOversizedWrite_ACU(input: {
  tableData?: TableDataObject_ACU;   // 本次提交后的表数据（增量扫描用）
  sheetKeys?: string[];              // 只扫这些表；缺省则不扫单元格
  operations?: unknown[];            // 本次要持久化的操作载荷
}): OversizedWriteMetrics_ACU
```

- **单元格**：只遍历 `sheetKeys` 命中的表，且**跳过第 0 行（表头）**——表头是模板作者写的固定文本，
  不是本次写入的风险源。只对 `string` 值计长度（数字/布尔不算）。
- **载荷**：`TextEncoder().encode(JSON.stringify(operations)).length`。
  persist 层已有同语义的 `safeJsonByteLength_ACU`（`storage-frame-v2-persist.ts:268`），
  若可直接复用则复用，避免两套字节口径。

### 2.3 判定与出口

```ts
evaluateOversizedWriteWarnings_ACU(metrics, settings) → OversizedWriteWarning_ACU[]
emitOversizedWriteWarnings_ACU(warnings, ctx): void   // 内部整体 try/catch，永不抛
```

`OversizedWriteWarning_ACU` 字段：`kind: 'cell' | 'payload'`、`value`、`threshold`、`unit`、
`sheetKey?`、`columnIndex?`、`rowIndex?`（**不含任何单元格原文**）。

出口顺序：
1. 去重（见 §3）→ 未通过则直接返回；
2. `logWarn_ACU('[数据体积] …')`，结构化 JSON 单行（kind/value/threshold/sheetKey/column）；
3. `showToastr_ACU('warning', 摘要 + 步骤, '数据体积提示')`；
4. 写入诊断环形缓冲（模块级，最多 10 条，供诊断包读取）。

### 2.4 文案（可解，与 log-error-hints 同风格）

- 单元格：
  摘要「这次写入有一个单元格长达 N 字符（阈值 M），会让聊天存档明显变大。」
  步骤「① 如果这是有意的长文本（如纪要、设定），可以忽略；② 如果不需要这么长，缩短该列内容后重填；
  ③ 到『数据管理 → 写入体积提示』调整阈值或关闭本提示。」
- 载荷：
  摘要「这次写入的数据量约 N MB（阈值 M MB），聊天存档与存储配额会被显著占用。」
  步骤「① 检查是否一次填入了整张表或超长正文；② 分批更新或清理不再需要的历史数据；
  ③ 到『数据管理 → 写入体积提示』调整阈值或关闭本提示。」

## 3. 去重与重置

模块级 `Map<string, { cellBand?: number; payloadBand?: number }>`，键为
`${chatKey || '(default)'}｜${isolationKey || ''}`。

- `band = value >= threshold ? Math.floor(Math.log2(value / threshold)) : -1`。
- `band === -1` ⇒ 删除该维度记录（下次再超标会重新提示）。
- `band` 与上次相同 ⇒ 静默；变大一个数量级 ⇒ 重新提示一次（避免「变了 10 倍还只在第一次说过」）。
- 不改聊天数据、不入设置，纯会话内状态。

## 4. 接入点

| 位置 | 覆盖路径 | 测量输入 |
| --- | --- | --- |
| `runTableUpdateCommit_ACU`（`table-update-commit.ts:300`）apply 成功之后 | 填表 / Agent 协议 / 导入 / 可视化保存 / 手动重填 | `applied.tableData` + `options.writeSet` 的 sheetKeys + `applied.persist?.operations ?? options.operations` |
| `writeInitFullCheckpointFrameV2_ACU`（`storage-frame-v2-persist.ts:915`） | 初始帧 / 模板重置 / 导入恢复 | checkpoint 内的表数据 + 该帧对象 |
| `persistTableSheetCheckpointV2_ACU`（`:4378`）若存在直调路径 | 单表 checkpoint | checkpoint 内表数据 + 该帧对象 |

接入约定：
- 调用点整体包 `try { … } catch {}`，不向主流程冒泡（C1）。
- 探针在 **persist 之前**或 **persist 之后**均可；选 persist 之前，保证「要写什么」与「提示什么」同源。
- 不改变 `runTableUpdateCommit_ACU` 的返回结构。

## 5. 设置项

`Settings_ACU` 新增（`source/src/data/models/settings-model.ts:41`）：

```ts
oversizedWriteWarningEnabled?: boolean;   // 默认 true
oversizedCellWarnChars?: number;          // 默认 10000
oversizedWriteWarnBytes?: number;         // 默认 512 KiB
```

- 默认值构造：`buildDefaultSettings_ACU`（`settings-service.ts:1078`）。
- 归一化：新增 `normalizeOversizedWriteSettings_ACU`，做上下界裁剪与非法回落；
  读取侧统一走它，避免各处重复判断。
- UI：`DataMgmtPage.vue` 新增可折叠分组「写入体积提示」——开关 + 两个数值输入
  （载荷按 MB 显示，内部存字节）+ hint 文案（说明「只提示、不拦截」）。
- 不做一次性迁移覆盖：用户没设置过就用默认值（新增键不进入 `*_FORCE_OVERRIDE` 列表）。

## 6. 诊断包

`source/src/service/diagnostics/diagnostic-bundle.ts` 新增：

```ts
oversizedWrite: {
  enabled: boolean;
  thresholds: { cellChars: number; payloadBytes: number };
  recent: Array<{ at: number; kind: 'cell' | 'payload'; value: number; threshold: number;
                  sheetKey?: string; columnIndex?: number }>;   // ≤ 10
}
```

- schema 保持 `acu-diagnostic-bundle-v1`（**只新增可选字段**，不改既有字段语义）。
- 脱敏：新段只含数字与表键/列序号，**不含单元格原文**；现有敏感键扫描用例须覆盖到它。

## 7. 性能

- 单元格扫描只覆盖本次 `writeSet` 命中的表与**字符串值**，与写入量同阶，不扫全库。
- 载荷测量是对本次 operations 的一次 stringify——这些数据本来就要被持久化，
  额外代价与写入量同阶；且只在开关开启时执行。
- 写库不是高频路径，不需要 rAF 合帧（L1-MR-9 不适用）；toast 去重已由 §3 保证。

## 8. 兼容与回滚

- **零存储格式变更**：不碰 `TavernDB_ACU_*` 结构、不 bump 帧版本。
- **关闭开关 = 完全回到旧行为**：探针入口先判开关，关闭时直接 return（连测量都不做）。
- 回滚方式：把三个新设置键删掉或开关置 false；无数据迁移、无残留状态。

## 9. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 长文本表（纪要/设定）正常内容就很大，造成噪音 | 默认阈值取高值；同一数量级只提示一次；可关闭 |
| 大表扫描拖慢写入 | 只扫 writeSet 命中的表；只测增量载荷 |
| 探针自己抛错 | 入口与出口双层 `try/catch`，出口内部不抛 |
| 诊断包泄露单元格原文 | 结构化字段只放长度与位置；沿用既有敏感键扫描测试 |

## 10. 测试设计

- `tests/service/table/oversized-write-warning.test.ts`
  - 测量：单元格（含表头跳过/非字符串跳过/多表只扫命中表）、载荷（UTF-8 中文字节口径）。
  - 判定：恰好等于阈值 / 略超 / 远低；两个维度同时超。
  - 出口：开关关闭零调用；去重（同档静默、升档重提、回落重置）；异常不抛。
  - 设置归一化：非法字符串、负数、超上下界。
- `tests/service/table/table-update-commit.test.ts`（追加用例）
  - 超阈值写入**仍然成功**，返回值与未超阈值一致；关闭开关时零 toast/日志。
- `tests/service/diagnostics/diagnostic-bundle.test.ts`（追加用例）
  - 新段存在、条数上限、脱敏扫描。
- `tests/presentation-v2/*`（如既有设置页测试形态适用）
  - 设置项读写与非法输入回落。

## 11. 交付顺序

1. 常量 + 测量/判定/出口模块 + 单测（纯函数先行，不接线）。
2. 设置键、默认值、归一化 + 单测。
3. 接入 `runTableUpdateCommit_ACU` + 集成测试。
4. 接入 checkpoint 入口（如有直调路径）。
5. 诊断包新段 + 测试。
6. UI 分组 + 页面测试。
7. typecheck / 全量 vitest / build / smoke；Dev 8001 真机复现一次警告。
8. 台账登记 + 提交推送。

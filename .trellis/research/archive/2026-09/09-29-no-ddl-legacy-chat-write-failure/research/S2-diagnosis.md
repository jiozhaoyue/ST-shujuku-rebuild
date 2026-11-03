# S2 诊断 · 「无 DDL 旧聊天」写入失败的根因（2026-09-29）

**证据来源**：**离线解析备份副本**（不启服务、不驱动浏览器、对真实数据零写入）。
脚本：临时目录 `acu-defect2/probe-chat.mjs`、`probe-shape.mjs`、`probe3.mjs`、`probe4.mjs`、`probe5.mjs`、`probe6.mjs`（一次性，未入库）。
被测文件：`_acu-defect2-backup-20260929-194138/Branch #206 - 2026-04-11@01h39m54s486ms.jsonl`
（sha256 `ec84c38b15d9747a53d023a53fefac89080dd910d7f5eab66c27f1807aa39534`，210 行消息）。

> **与计划的偏差（如实记录）**：`implement.md` 的 S2.1–S2.6 原定「启动 Dev ST 8001 并驱动浏览器」。
> 实际**未启动任何实例**：离线把聊天文件解析出来即取得了决定性证据，故省去真机驱动这一步（风险更低）。
> 因此 S2 未产生真机截图；S5 的复验仍按计划待做。

## 一、确证事实（逐条带证据）

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | 该聊天 9 张表**全部缺 `sourceData.ddl`** | `InternalSheetGuide.tags[""]` 下 9 个 `sheet_*`，`sourceData` 只有 `note`（无 `ddl`）；`ScopedConfig.template[""].templateStr` 同构 |
| F2 | guide 里的表头形态是 `[null, <业务列名…>]`（首列 `null` 占位 = row_id 身份） | 例：`["null","主角当前所在地点","当前时间","上轮场景时间","经过的时间"]` |
| F3 | **帧 checkpoint 里的表头形态是 `["row_id", null, <业务列名…>]`** —— 比 guide 多出一个 `null` | `storageFrame.checkpoint.data.<sheet>.content[0]`，9 张表**无一例外** index 1 均为 `null` |
| F4 | checkpoint 的**数据行**为 `[<id>, <值…>, null]` —— **尾部多一个 `null`，值相对表头名整体左移一列** | 例 `sheet_in05z9vz`：header `[row_id, null, 物品名称, 数量, 描述/效果, 类别]`，row1 `[1, 手机, 1, 通讯与网购工具, 杂物, null]` |
| F5 | 该形态**正是已知的历史事故形态**，且有**专用修复器** | `shared/canonical-row-normalizer.ts:104-107` 注释原文：误插 `row_id` 后固化为 `["row_id", null, 业务列…]` —— 表头多出一个空标签孤儿列，行值相对标签整体左移一列；**触发指纹：`header[0]==='row_id'` 且 `header[1]` 为空占位** |
| F6 | 修复器逐行规则与实测数据**完全吻合**（本样本全走「错位老行」分支） | `canonical-row-normalizer.ts:152-158`：`row[1]` 非空且尾格为空 ⇒ `pop()`；本样本 `row[1]="手机"` 非空、尾格 `null` ⇒ `pop()`。歧义行判据（`:143`）不命中 |
| F7 | 判定侧会把 `header[1]=null` 判成 `empty_column_name`（**非首列**不得为空） | `shared/sql-identifier-mapper.ts:52-57`：`isRowId` 仅认 `index===0`；`:56` `if (!canonicalName && !isRowId)` ⇒ 诊断。首列 `null` 合法（`:39`）、非首列 `null` 不合法 |
| F8 | 该诊断在 `generateFallbackDDL` 处**升级为抛错**，错误文案与真机**逐字一致** | `data/sqlite/schema-mapper.ts:195-197`：`fallback DDL 表头不合法：第 ${index+1} 列「${originalName}」${code}` ⇒ 本样本 index 1、原名空 ⇒ **「第 2 列「」empty_column_name」** |
| F9 | 修复器**已接进** SQLite hydrate 入口 | `sync-bridge.ts:130`（auto_merged 复位）、`:134`（`repairLegacyOrphanIdentityColumn_ACU`）；`:161-173` 另有「非首列空业务表头视为休眠表、跳过建表」的兜底注释，明确写着「避免坏表头在 resolveEffectiveDDL 触发 fallback DDL 错误导致整个 hydrate 失败」 |
| F10 | 但 `resolveEffectiveDDL` 有**多个调用点**，修复器只覆盖了 hydrate 那一条 | 调用点：`sync-bridge.ts:306`（已受 F9 保护）、**`sql-table-service.ts:2512`**、**`prompt-builder/prompt-prepare.ts:774`**、`sql-read-resolver.ts:622`、`runtime/template-vars/name-mapper.ts:208`、`template-import-validator.ts:106` —— 后五处**未见**先跑孤儿列复位 |
| F11 | 基线测试：**8788 passed / 4 skipped**（427 文件 passed + 1 skipped） | `npx vitest run`（2026-09-29，274s） |

## 二、因果链（据以上事实）

```
旧版本把「身份列占位」误插 row_id
  ⇒ 固化为 header ["row_id", null, 业务列…]、行 [id, 值…, null]（F3/F4/F5）
  ⇒ 该聊天 9 张表无 DDL（F1）⇒ 只能走 fallback DDL
  ⇒ 凡是在「未复位该形态」的数据上解析 DDL 的路径：
        generateFallbackDDL 读到 header[1]=null（F7）
        ⇒ 抛「fallback DDL 表头不合法：第 2 列「」empty_column_name」（F8）
  ⇒ 表现为写入被拒 / 手动重填中止
```

**注意方向修正**：缺陷 ② 原先（2026-09-28）的推断是
「runtime fallback 已提供 effective 表名，但表身份重绑定没采信它」。
**本次证据不支持该推断**：`rebindSheetKeysThroughTableAliases_ACU` 的失败（别名「sheet_dCudvUnH」无法证明对应表）
更可能是**同一根因的下游症状**（帧内容畸形 ⇒ 两侧基底表结构/标识都对不齐），
而非一个独立缺陷。**故候选 D-B（动共享重绑内核）在证据上缺乏必要性。**

## 三、待确认（未证实，不得当结论用）

- **U1**：真机上实际触发的是哪一个 `resolveEffectiveDDL` 调用点（F10 后五处之一，还是 V2 写入守卫内部）？
  静态证据只能说明「有多处未受保护」，不能确定真机走的是哪一处。
  —— 但这**不影响**修复方向的选择；只影响回归用例该钉哪几个入口。
- **U2**：这份畸形 content 的**产地**是哪个版本/哪条迁移路径（迁移器 or 旧版序列化）？本任务不必修产地，
  但影响「是否需要对存量聊天做一次性修复」的判断。
- **U3**：真机那条「V2 写入被拒绝：」前缀（`storage-frame-v2-replay.ts:258`）与 F8 错误如何拼接，
  尚未在真机上抓到完整原文（T3.2/T3.3 的 `prd.md` 转述可能经过简写）。

## 四、证据指向的修复方向（供 G1 裁定，不由本报告决定）

- **D-C′（新增，证据最指向此路）**：把**已存在**的孤儿列复位（`repairLegacyOrphanIdentityColumn_ACU`）
  接到 F10 里**尚未受保护**的 `resolveEffectiveDDL` 调用点（至少 V2 写入守卫路径与 SQL/填表路径），
  使畸形表头在解析 DDL 之前被复位。改动只在**调用点**，共享重绑内核不动 ⇒ 风险低于 D-B。
  - 关键约束：复位器**会原地改写** content 并删格 —— 需明确「在哪一层写入是允许的」，
    且必须保留其既有的「歧义即放弃 + warning」语义（不得为了修好而放宽）。
  - 另一条更保守的等价路线：把「非首列空占位表头」在**生成 fallback DDL 时**按**只读**方式跳过该孤儿列
    （不改写数据，只在建表时忽略），代价是把错位带进物理表。
- **D-A（安全失败）**：与上述正交，可叠加 —— 保证任何失败都发生在破坏性清理之前。
- **D-B**：证据不支持其必要性（见 §二 的方向修正）。

## 五、影响面（记录用）

- 该形态一旦命中，**该聊天完全不可写**（不是偶发），且**存量数据仍在**（备份 sha 未变，F2/F3 两份内容都完整）。
- 受影响的不止「手动填表」：`prompt-prepare.ts:774` 也在 F10 名单里 ⇒ **AI 填表路径可能同样会失败**。

# ST-shujuku-rebuild（Luker·数据库）设计文档

日期：2026-09-05
状态：已评审通过（用户批准方向 A + 关键决策三项）
基线：shuiyue-cmyk/shujuku-rebuild @ 9.1.9（760ba68）；公开库历史自 fork 点重建，适配过程记录保留在私有工作库

## 1. 背景与目标

shujuku-rebuild 自 v9.0.6 起仅适配 TauriTavern（TT），不再保证 SillyTavern（ST）兼容。Luker 是 ST 兼容分支（实测 本机 Luker 实测环境 为 Luker 2.7.0，stCompatVersion 1.18.0），用户主力环境之一。本项目要做一个积极兼容 Luker 的数据库前端插件，同时：

- 替代原版（AlbusKen/shujuku）的酒馆助手脚本形态：标准扩展直装、运行时零依赖酒馆助手（继承 rebuild 已有架构）。
- 完全兼容上游对应版本的数据面与生态：聊天内 V2 存储帧（`TavernDB_ACU_*`）、模板 JSON、剧情推进预设、st-acu-visualizer 契约（`#acu-app-v2` / `V2API` / `AutoCardUpdaterAPI` / `registerTableUpdateCallback` / `registerTableFillStartCallback`）。
- 小限制、易排错、不易阻塞（升级 9.1.9 后实测 Luker 全链零阻塞，本项目把该纪律固化并增强）。
- 细粒度增量，防止 AI 全量重跑（三个靶子：prompt 全量注入、追平整批重跑、变更放大重填）。
- 不破坏生态：所有增强可选、缺失即降级；导入的模板/预设没有增强字段时不报错。

### 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 产品形态 | 新插件，fork rebuild 9.1.9 为基座 |
| 细粒度靶子 | ①②③ 全做；硬约束：必须兼容现有填表预设/自定义提示词（增强只重排注入策略，不要求用户换预设） |
| Luker 首发范围 | 核心链优先：SQLite 表格 / 填表 / V2 面板 / SQL 控制台 / 日志全量可用；世界书桥接、剧情推进等增强链降级可用 |
| TT 兼容 | 保留（profile 化宿主适配，TT 路径零改动） |
| 回 PR 底线 | 只向 rebuild/上游回宿主适配层 + 可选增强模块；核心路径改动留在本仓库 |

### 非目标（本期不做）

- 不替代 st-acu-visualizer（保持其契约兼容即可）。
- 不做自动移植上游提交的 CI（只做差集发现 + issue，人工甄别移植，保留 TT 红线评审纪律）。
- 不做上游 AlbusKen 酒馆助手脚本形态的分发。

## 2. 架构：宿主适配层

### 2.1 宿主 profile

`source/src/shared/runtime-env.ts` 增加 `HostKind` 探测（纯特征检测，不做网络探测）：

- `tt`：存在 `__TAURITAVERN__` 特征（现有判定收敛于此）。
- `luker`：`SillyTavern.getContext()` 存在且宿主版本串 agent 为 `Luker:*`（`/version` 与前端全局均可取，探测实现需容错降级为 generic）。
- `generic-st`：其余有 `SillyTavern.getContext()` 的宿主（保底，核心链仍可用）。

探测失败一律降级 `generic-st`，绝不阻塞启动。

### 2.2 luker-backend

新增 `source/src/shared/host-compat/luker-backend.ts`，与 `native-st-backend.ts` 同模式：用 `SillyTavern.getContext()` 原生接口实现旧版扁平 API 面。以 Luker 2.7.0（stCompat 1.18.0）实测校准以下差异点（探测清单来自 native-st-backend 现有注释与 9.1.9 实测）：

- 世界书读写：`ctx.loadWorldInfo` / `ctx.saveWorldInfo` / `getWorldInfoNames`。
- 角色附加书（charLore）：POST `/api/settings/get`（带 TTL 缓存）。
- `host-bridge.ts` 中 9 处 TT 硬判定（`__TAURITAVERN__` 分支）收敛为 profile 驱动：`hostProfile.isTT` → `hostProfile.kind === 'tt'`，行为对 TT 保持逐字节等价。
- `waitForAcuHostReady` 探针：TT 专属的 `__TAURITAVERN__?.ready` 等待仅在 `kind === 'tt'` 生效；Luker/generic 走 getContext 就绪探针（15s 超时纪律不变）。

### 2.3 首发能力矩阵

| 能力 | Luker 首发 | TT |
|---|---|---|
| SQLite 表格 / 填表 / V2 面板 / SQL 控制台 / 运行日志 | 全量 | 全量（不变） |
| 世界书桥接、剧情推进、续写/交火、向量索引 | 降级可用（门控不报错），二期对齐 | 全量（不变） |
| st-acu-visualizer 绑定 | 可用（契约不变） | 可用 |

## 3. 细粒度填表（三个增强模块）

全部实现为**可选模块**，各挂独立开关（开发者选项区，首发默认关闭）；全部关闭时行为与 9.1.9 逐字节一致（验收基线）。硬约束：**用户自定义填表提示词/预设原样使用**——增强只重排注入组装与调度，不改动、不要求改写预设文本。

### 3.1 ① 差量注入（表级订阅）

- 现状：每轮填表把所有表的 DDL+全部行注入 `<当前表格数据>`。
- 目标：注入器按表订阅本轮变化信号（复用 update-orchestrator 既有 staging/delta 机制），prompt 只携带"本轮可能变化的表"的完整 DDL+行，其余表仅带表名与行数占位说明。
- 兼容底线：组装层只改 `<当前表格数据>` 段的**内容选择**；检测到用户预设定制了该段结构（占位符缺失/结构漂移）→ 自动回退全量注入并记 warn 一次。

### 3.2 ② 楼层级追平调度器

- 现状：追平/补填按批次重跑。
- 目标：追平改为逐楼任务队列——每楼独立任务（可中断、可续跑、失败只重试该楼），断点持久化到运行日志 + 内存队列；复用 `batchSize` 语义但调度粒度默认 1 楼（batchSize>1 时按批打包任务，仍可中断续跑）。
- 兼容底线：手动追平/一键追平入口 UI 不变，内部调度器替换；`skipFloors` 语义保持。

### 3.3 ③ 列级增量提交

- 现状：`<tableEdit>` 的 UPDATE 常重写整行。
- 目标：解析后按列 diff（复用 canonical-row-normalizer 规范化），只提交变化列；重填反馈提示 AI"只输出变化列"。
- 兼容底线：不改 SQL 白名单与事务纪律；AI 若仍输出整行，按现状处理（diff 只影响提交面与回执文案）。

## 4. 防阻塞与易排错

继承 9.1.9 全部纪律（实例互斥接管/释放、持锁清账、探活 15s 超时、mainInitialize 幂等）。新增：

1. **启动自检面板**（V2 面板新增页）：宿主 profile、宿主就绪耗时、探活结果、flush 队列深度、SQLite 引擎状态、存储帧回放统计——一页可视化。
2. **卡死自诊断**：持锁等待超过阈值 → 自动 dump 锁持有者/等待者到日志缓冲 + toast 可操作提示（含"打开运行日志"引导）。
3. **失败不阻断聊天**：填表/追平失败维持"toast + 日志"语义，永不阻断消息流（回归断言固化）。

## 5. CI 与版本留存

### 5.1 上游同步（发现，不自动移植）

每日定时 GitHub Actions：

1. 拉取 AlbusKen/shujuku（main）与 shuiyue-cmyk/shujuku-rebuild（master）提交清单。
2. 用 commit message 短哈希正则（现有移植批消息格式，如"上游 5f1e96f1 大移植批"）提取已移植哈希集合，与上游增量求差集。
3. 差集非空 → 自动开/更新 issue，附逐笔 diff 摘要与风险标注；**不自动移植**。

### 5.2 版本留存

- 每次发版：打 `vX.Y.Z` tag + 开 `release/vX.Y.Z` 分支（用户要求的版本号分支形态）。
- 发版 job 跑全量测试 + jsdom 产物冒烟（基建已存在：scripts 下的构建产物宿主冒烟测试）。
- 版本号策略：主版本跟随基座序列（自 9.2.0 起），后缀批次递增；manifest `display_name` 更名（名待定）、`auto_update: true` 保持直装自更新。

## 6. 测试与验收

- 基线：9.1.9 全量 7580 passed / 28 skipped 零回退。
- 新增行为断言：
  - luker-backend：mock Luker ctx 形状（1.18.0 面），世界书读写/charLore 缓存路径逐条验红再验绿。
  - 宿主探测矩阵：tt / luker / generic-st / 探测异常降级。
  - 差量注入：快照断言（全量 vs 差量 vs 自定义预设回退三态）。
  - 追平调度器：中断/续跑/单楼失败重试，负向控制验红。
  - 列级 diff：规范化后等值行零提交、部分列变化只提交变化列。
  - 阻塞回归：增强全关 → 与 9.1.9 行为 diff 为零；持锁超阈值 → 自诊断 dump 触发。
- 真机双轨：本机 Luker 实测环境（Luker 2.7.0）+ TT 设备（TESTING.md 清单扩展 Luker 节）。

## 7. 兼容底线汇总（回归红线）

1. 模板/预设缺增强字段 → 缺省回填，不报错（沿用 9.1.9 合并语义 + 模板碰撞 fail-closed）。
2. 增强开关全关 → 行为与 9.1.9 一致。
3. Luker 探测失败 → generic-st 保底，核心链可用。
4. 数据面契约不变：V2 帧、`TavernDB_ACU_*`、visualizer 契约、模板 JSON。
5. TT 路径零改动。

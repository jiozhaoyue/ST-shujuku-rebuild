# 2026-11-19 两上游对齐 + 全面迭代开发 + 全面测试（总计划）

> 执行者：ZCode 主代理（派发制，开发全部走子代理并行）
> 截止：2026-11-20 07:30 收尾交接
> 断线续跑：本文件实时勾选；续跑者从最近未勾项继续。

## 时间检查点（实际时钟，过期即勾选并记录偏移原因）

- [ ] 00:30 阶段一（基线核查）完成
- [ ] 01:30 阶段二（追平与合并）完成
- [ ] 05:30 阶段三开发冻结
- [ ] 06:45 阶段四测试完成
- [ ] 07:30 阶段五收尾交接完成

## 阶段一：基线核查

- [x] fetch 全部远端（upstream/master 8f1fb759→76ffdc81；albus/main dd9127ac→c45d50ee）
- [x] 对上游 A 落后 20 提交（最新 2026-11-18 03:58），领先 103 提交
- [x] 上游 B（albus/main）活跃：c45d50ee 2026-11-14，v1.3.7
- [x] 版本号两侧一致：Unbirth A.D. 6386（manifest + source/package.json）
- [x] CI 判明：upstream-sync 的 schedule 已于 95e7d8a8 有意移除（仅手动触发），11-07 后无运行**非故障**；本次追平走手动 merge
- [ ] scout 代理 1：上游 A 20 提交功能面深挖（进行中）
- [ ] scout 代理 2：albus 功能面比对清单（进行中）
- [ ] 追平前基线测试全绿确认（typecheck + vitest 后台进行中）

### 已知 20 提交主题（初步）
1. DeepSeek 填表专项第三轮复审多批修复（删楼/切聊天/新开聊天写错楼层、旧结果污染、按表级预设拆组、AI 不得改 row_id、上下文层数、删除当前聊天补删、两处身份误判）
2. 执行边界提示词 →「提示词额外要求」+「安全审查提示词」（feat/scope-guard-prompt 并入）
3. 决策召回附加世界书条目（与填表同管线、按角色卡保存）
4. 表格状态「就绪」口径统一、静默提示框只管浮窗
5. OpenCode Go 用量查询（进度条、https 守卫、跨域修复）

## 阶段二：追平与合并

### 上游 A 追平
- [ ] merge upstream/master（76ffdc81）到 master
- [ ] 冲突按差量台账口径逐类解决（台账：docs/superpowers/specs/2026-09-27-fork-delta-ledger.md）
  - host-bridge.ts：先取上游、再补我方 Luker 分支
  - prompt-api-call.ts：上游若改 parseStreamResponse 则逐行比对，取上游 + 叠加我方 onDelta/停滞诊断
  - presentation 文案：按我方三口径
  - canonical-row-normalizer.ts / storage-frame-v2-replay.ts：按我方（C2 孤儿身份列复位）
  - AI 出口：上游新增/改名出口必须同步接线响应观测
- [ ] 追平后 `git rev-list --count HEAD..upstream/master` = 0
- [ ] 追平后 typecheck + vitest 全绿
- [ ] version 跟随上游且两侧一致

### 上游 B 功能移植
- [ ] 从代理 2 清单筛选本轮移植项（价值/难度评估）
- [ ] 每项移植适配 host-bridge 三态 profile

**验收标准**：追平计数=0；基线用例零回退；新增用例覆盖移植功能；硬红线未破。

### 硬红线（全程有效）
- 不改 UNIQUE_SCRIPT_ID（shujuku_v120，source/src/shared/constants.ts）
- 不改 TavernDB_ACU_* 存储结构与模板 JSON 同构性
- 宿主差异只进 host-bridge，业务层禁宿主判断
- 改数据层前先读 docs/superpowers/specs/ 相关设计文档

## 阶段三：全面迭代开发（子代理高并发）

- [ ] 任务清单细化（依赖代理 1/2 结果 + 基线测试暴露的问题）
- [ ] 子代理并发执行（免费模型档：hy4-flash-free / deepseek-v4.1-flash-free / glm-5.3-flash-free）
- [ ] 并行任务不得写同一文件；交叠改动串行化

**验收标准**：每个 bug 修复带回归用例；每个功能改动带测试；任务书自包含可审计。

## 阶段四：全面测试（发版门禁）

- [ ] `npm run typecheck` 零错误
- [ ] `npx vitest run` 全量零回退（基线约 7700 用例，以基线实测数为准）
- [ ] `npm run build` + `npm run smoke` 通过，产物同步仓库根
- [ ] 真机项按 source/docs/TESTING.md 标注「待真机验证」，未验证不写已验证

## 阶段五：收尾

- [ ] 改动登记进差量台账（新增差量条目）与 README / TESTING
- [ ] 显式 pathspec 分批提交，推 origin
- [ ] 交接文档（docs/superpowers/plans/ 下本文件追加交接节）

## 进度日志

- 23:43 启动。fetch 完成，判明落后 20 提交。
- 23:47 CI 停用判明（95e7d8a8 有意移除 schedule，非故障）。
- 23:48 两个 scout 调研代理后台发出；基线 typecheck+vitest 后台启动；本计划落盘。

# 2026-11-19 两上游对齐 + 全面迭代开发 + 全面测试（总计划）

> 执行者：ZCode 主代理（派发制，开发全部走子代理并行）
> 截止：2026-11-20 07:30 收尾交接
> 断线续跑：本文件实时勾选；续跑者从最近未勾项继续。

## 时间检查点（实际时钟，过期即勾选并记录偏移原因）

- [x] 00:30 阶段一（基线核查）完成（实际 ~00:10）
- [x] 01:30 阶段二（追平与合并）完成（实际 00:40 merge 8c295ed3 已推 origin，质量门三绿 vitest 2 红已定性派修）
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
- [x] 追平前基线测试：typecheck 0 错误；vitest **8436 绿 / 1 红**（plot-page.test.ts:323 单跑绿/全量红 = 跨文件状态污染，基线既有，非本次引入）

### 已知 20 提交主题（初步）
1. DeepSeek 填表专项第三轮复审多批修复（删楼/切聊天/新开聊天写错楼层、旧结果污染、按表级预设拆组、AI 不得改 row_id、上下文层数、删除当前聊天补删、两处身份误判）
2. 执行边界提示词 →「提示词额外要求」+「安全审查提示词」（feat/scope-guard-prompt 并入）
3. 决策召回附加世界书条目（与填表同管线、按角色卡保存）
4. 表格状态「就绪」口径统一、静默提示框只管浮窗
5. OpenCode Go 用量查询（进度条、https 守卫、跨域修复）

## 阶段二：追平与合并

### 上游 A 追平
- [x] merge upstream/master（76ffdc81）到 master → **merge 提交 8c295ed3，落后计数=0**
- [x] 冲突 7 文件按台账口径逐类解决：
  - index.js：按 G 类取我方（待 build 重建）
  - api-call.ts：import 并集；核查接线齐全（scope-guard ✓ 观测 5 处 ✓ SSRF allowUnsafe ✓ 流式 ✓ 出口 2=2 ✓）
  - table-update-commit.ts：上游 commitScopeIsCurrent 复检 + 我方三埋点/超大写入探测并集，旧名零残留
  - dev-options-store.ts（8 块）/useDevOptions.ts（2 块）/DeveloperPage.vue（1 块）：我方 2 观测开关 + 上游 3 新开关全并集
  - useManualUpdate.ts：取上游 D03-05 口径（失败路径不重复回滚说明），保留我方 failureText 结构
- [x] C2 复位函数复核在位（replay ×3 / normalizer ×2）；host-bridge/canonical-row-normalizer/prompt-api-call 上游零触碰
- [x] 追平后 `git rev-list --count HEAD..upstream/master` = 0
- [x] typecheck 零错误
- [ ] vitest 全量（后台进行中）
- [x] version 跟随上游且两侧一致（Unbirth A.D. 6386）

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

### 任务池（登记区，边跑边补）
1. ~~[bug] plot-page.test.ts:323 全量红~~ **✓ 修复（任务B）**：scratch 实验否定跨文件污染，真根因 = 固定 2 tick 不及跨 macrotask FileReader 异步链（时序竞态）；断言原文不动包进 `vi.waitFor` 轮询；429 文件 7791 用例压测 ×2 全绿。
2. ~~[移植#1] SQLite exec 栈泄漏~~ **✓ 完成（任务C）**：query（含 readOnly 分支）+ loadFromBinary 双处配对，覆盖比 albus 原修复更全；sqlite 域 156 绿。
3. ~~[移植#2] JSON 清洗保留字符串正文~~ **✓ 完成（任务D）**：函数级合并 albus 3 hunk，我方原型污染守卫保留；98+525 绿。
4. ~~[移植#3] 配置防丢三件套~~ **✓ 完成（任务E，数据面）**：rescue/save-confirm(默认关)/namespace-backup + service 门面 + host-bridge 2 探测；265 绿；**裁定**：globalMeta 恢复不暂停写入（本仓 UI 已删）；UI 恢复面板登记后续任务。
5. ~~[移植#4] SSE 规范事件解析器~~ **✓ 能力就位不接入（任务F + 主代理裁定）**：解析器+39 用例；现有语料非标准形态直接接入会破坏 onDelta 契约（实测证据），待原生工具通道。
6. ~~[清理] CSS 注释品牌串 ×3~~ **✓ 完成（任务G）**：源码树 UnbirthDB 清零；默认标题常量本就正确。
7. ~~[复核·scout2存疑] #11 greenlight 注入~~ **✓ 已解除**：数据面+消费面齐全。getTableHistoryContext 在位 ✓。
8. **[bug] chat-gateway 直连 /api/chats/delete（merge 回归）** **✓ 修复（任务A）**：postHostChatApi_ACU 单一出口（CSRF 头），URL 逐字不变；守卫 6 绿+网关 148 绿+补删 7 绿。
9. ~~[后续任务·登记] 配置防丢 UI 恢复面板~~ **✓ 完成（任务H）**：`presentation-v3/parts/SettingsRescueSection.vue` 落数据管理页（「备份与恢复」之后，页内导航「配置副本恢复」）；三态面板走 rescue-service 门面零越层；双前缀+宿主变量；v3 域 122 绿含新增 4 条页测；**裁定逐条恢复/忽略粒度**（与数据面单条签名一致，「全部恢复最新」列为后续可选）；截图待真机（Dev 实例未起）。
（#5 回放快照续放：价值高但触及 replay 核心，独立排期本轮不做；政策外子系统不移植。）

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
- 00:15 merge 8c295ed3（追平 76ffdc81，落后归零），7 冲突并集解决。
- 00:40 质量门：typecheck/build/smoke 绿；全量 8536 用例 2 红定性（直连回归+时序竞态）。
- 00:45 7 任务并发派工（A/B/C/D/E/F/G）。
- 00:50 TESTING.md 遗留冲突标记补修 4fc36bc1；台账 §4d 落盘 4ec0e6ff。
- 01:00-02:10 任务逐个回收验收（全部通过，主代理裁定 4 条）。
- 02:10 终轮全门禁启动；README/台账 §4d-2/任务池登记完成。
- **02:25 终验全绿收官**：typecheck 0；vitest **8684/8684 全绿（520 文件，基线 8437 → +247）**；build ✓；smoke ✓（挂载/菜单注入/0 错误）。进入分批提交。
- 02:30 分批提交 4 笔并推 origin（0f35e37b fix / 9c8b1975 移植三件 / c668f31b 防丢三件套 / ddaa0507 docs+产物），工作区清零。
- 02:32 第二批派工：任务 H（恢复面板 UI 层，数据面已就位）+ 任务 J（Dev 实例 compat:probe + e2e:shots 真机探测）。裁定：#5 回放续放与 API 全量日志不做（前者高风险、后者与我方观测体系冗余）。

## 交接节（2026-11-20 07:30 收尾时补全）

### 本班成果
- 追平上游 A 20 提交（merge 8c295ed3）+ albus 移植四件 + bug 修复两件 + 注释清理（详见台账 §4d / §4d-2）。
- 提交历史：86fd92b1（计划）→ 8c295ed3（merge）→ 4fc36bc1（TESTING 补修）→ 4ec0e6ff（台账 §4d）→（待：终验后功能提交批 + 收尾批）
- 终验结果：（待回填）

### 移交后续任务（按优先级）
1. **真机验证**（source/docs/TESTING.md 手工节）：本轮 albus 移植四件均需真机确认——尤其配置防丢三件套（TT extension.store / SETTINGS_UPDATED 事件语义）与 SQLite 栈修复（长会话不崩）。**e2e 探测本夜未跑成**：Dev 8001/8003 实例未起（连接拒绝，非本班改动问题）；实例起后复跑：
   ```bash
   cd source && curl -s -o /dev/null -w "%{http_code}\n" --max-time 8 http://127.0.0.1:8003
   NODE_PATH="C:/nvm4w/nodejs/node_modules" ACU_PROBE_TARGET_TIMEOUT_MS=600000 npm run compat:probe -- --only=luker,st
   NODE_PATH="C:/nvm4w/nodejs/node_modules" ACU_PROBE_TARGET_TIMEOUT_MS=600000 npm run e2e:shots
   ```
   产物构建戳 `20261119-1736`（UTC 口径 = 北京 11-20 01:36 终态重建）静态核验吻合；TESTING.md:44 的旧版本记录 9.7.5 已滞后（现 Unbirth A.D. 6386），下次顺手更新。
2. ~~配置防丢 UI 恢复面板~~ **本夜已完成**（任务H，数据管理页「配置副本恢复」分区）；可选后续：加「全部恢复最新」一键操作。
3. **albus 移植#5 回放快照续放**（`fd9ba783`，中-高价值/中难度）：触及 replay 核心，需整套回放回归，独立排期。
4. **SSE 解析器接入**：待 albus #9 原生工具通道决策一并做（需同时定「非标准连续 data 流」兜底口径）。
5. **albus 移植评估余量**：#6 接管暂停总开关 / #10 API 全量日志（低-中价值）；#7 安全审查网关、#8 HTML 渲染重建依赖 albus agent 架构，暂缓。
6. **plot-page 用例观察**：`vi.waitFor` 修复后若全量终验仍红在 323 行（binding 断言，非 322 预设入库），指向另一机制（`currentChatFileIdentifier_ACU` 被改），见 state-manager.ts:479/581。

### 断点续跑指引
- 全部状态以本文件 + 台账 §4d/§4d-2 为准；提交历史见 `git log --oneline -8`。
- 若工作区有未提交改动：按台账 §4d-2 清单核对应提交文件，显式 pathspec 分批提交。

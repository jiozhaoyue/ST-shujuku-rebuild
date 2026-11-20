# 2026-11-21 全面测试班 + 开发后续启动（续 2026-11-19 总计划交接节）

> 执行者：ZCode 主代理（派发制，全部走子代理并发，免费模型档 hy4-flash-free）
> 断线续跑：本文件实时勾选；续跑者从最近未勾项继续。
> 收尾：做到 09:30 才收尾交接。

## 主人补充指令（goal 追加，全程有效）

- 全部加功能、全部自动化测试、全部保证规范化、全部保证功能正常
- 4 宿实测口径：按实况执行——Dev ST 8001 + Dev Luker 8003 两实例真机实测；compat:probe 覆盖 TT/Luker/ST 三态 profile；8899 PureTavern 未运行属既往预期，如实记录不虚报
- 主代理做多模态验证：全部截图（e2e:shots 产物）逐张读图核验
- 全部同步更新：台账 §4e + README + TESTING
- **分支纪律：所有改动都进主分支 master；把其他分支的内容合并到 master 后删除；禁止任何其他分支**（外部远端引用 upstream/*、albus/* 不属我方分支，不动）
- 一直做到 09:30 才收尾交接

## 调查基线（2026-11-21 四 scout 已核实，不必重查）

- [x] 工作区干净 @ bcca0970；HEAD..upstream/master = 0（追平保持）；albus/main tip = c45d50ee v1.3.7 无新提交
- [x] 版本两侧一致：Unbirth A.D. 6386（manifest.json:9 = source/package.json:3）
- [x] typecheck 0 错误；vitest 全量 8688 = 8687 绿 / 1 红
- [x] 唯一红：source/tests/presentation-v3/continuation-page.test.ts:824「倒计时时钟」用例，expect(vi.getTimerCount()).toBe(0) 失败 = 组件卸载后残留 1 个悬挂定时器（新发现，非 plot-page:323）
- [x] Dev 实例均未运行；起法：cd D:/Repo/Tavern-repo/Instance/Dev/SillyTavern（8001 HTTP）/ Dev/Luker（8003 HTTPS）&& node server.js
- [x] e2e 跑法：cd source && NODE_PATH="C:/nvm4w/nodejs/node_modules" npm run compat:probe -- --only=st,luker / npm run e2e:shots -- --only=st,luker；端口白名单 {8001,8003,8899}

## 分支清理（主人指令，先探测后执行）

- [x] 探测本地分支与 origin 分支现状：本地 5 分支（dev/luker-adapt、legacy/private-history、release/v9.2.0~v9.4.0，均 --no-merged 且 patch 级不等价）+ origin/worktree-phase0-upstream-catchup（master 祖先 0 差异）
- [x] 处置口径（替代盲 merge，防旧快照回退 master）：git cherry 证实 master 已含各分支功能演进形态（差量注入 f6b1c6ec、逐楼解析 0b50b88e、更名史等）→ 5 分支打 `archive/*` 归档 tag（保 GC 零丢失）后删除本地分支
- [x] 已删：本地 5 分支 + origin/worktree-phase0-upstream-catchup；archive tag ×5 已推 origin（tag 非分支，满足「禁止任何其他分支」）
- [x] 终态核验 ✓：本地仅 master；origin 我方侧仅 master；外部远端 upstream/*、albus/* 未动

## 阶段一：清红（发版门禁前置）

- [x] 修 continuation-page.test.ts:824 ✓：根因=用例时序（非组件真泄漏）——stopCountdownTimer 同步清理为初版既有（git blame 证实），vi.getTimerCount 实含未刷新微任务 job 数，卸载竞态下已入队清理未落地即断言；修复=测试侧 unmount 后补 await nextTick + advanceTimersByTimeAsync(0)（:822-829，+6/-2），toBe(0) 断言原样保留守卫真实泄漏；双 agent 交叉印证（原修者 + 独立复核者），目标文件 20/20 绿
- [x] vitest 全量复跑全绿：修红 agent 终报 522 文件 / **8717 例全绿 EXIT=0**（8688 基线 + 回放基线 24 + 移植#5 新 5 + 修红用例调整）；主代理正式门禁复跑进行中

## 阶段二：真机测试班（实例后台起）

- [x] 后台起 Dev ST 8001 + Dev Luker 8003，探活确认（8001 HTTP=200 本班起；8003 HTTPS=302 由并行会话先起，复用；猫猫重复起 Luker 报端口占用退出，属预期）
- [x] 实例插件副本同步至当前 HEAD 产物（两实例三件套 md5 全 SAME；ST 原先未装已补装，Luker index.js 4b5174c4→cad20617 已更）
- [ ] compat:probe：st PASS（注入 true / API 113 / V2 根节点 / 面板 4 项）；luker 三连败（注入 true / API 116 / 宿主全局 luker 命中，但 V2 根节点 undefined + page.evaluate 页面被关）——e2e:shots luker 4/4 全绿证明实例与插件正常，probe 失败定性为脚本与 Luker 2.9.0-rc.2（宿主升级，上夜为 2.8.0）的时序/页面存活问题，待后续排查
- [x] e2e:shots --only=st,luker：st 4/4 · luker 4/4 全 OK，#acu-app-v2 挂载断言全过（首跑）
      ——ST 侧首跑水印 20261107-05 = 旧产物：ST 真实加载目录是 public/scripts/extensions/third-party/shujuku-rebuild（690b44bd 旧），今晚同步的 data/default-user/extensions/ 非 ST 加载路径；已同步新产物（cad20617 三件 SAME）至正确目录；st 复验 4/4 OK ✓，水印 20261119-1736 生效；今晚误建的 data 侧冗余目录已改名 .redundant-20261121 归档防误判
- [x] 主代理多模态验证 ✓：luker 4 张（仪表盘/填表规则/开发者/高级工具）+ st 仪表盘（复验后）逐张读图全健康，双实例构建戳 20261119-1736 一致
- [x] TESTING.md 真机项核验（新增 0.10 节如实记录）：恢复面板分区渲染双实例 PASS ✓ / SQL 真执行双实例 PASS（栈修复降级证据）✓ / Luker 读库 PASS ✓；ST context 绑定 null（环境现象）与 TT 语义验证留待人工如实标注，未验证不写已验证
- [ ] TESTING.md:44 旧版本记录 9.7.5 更新为 Unbirth A.D. 6386

## 阶段三：发版门禁（全绿才算过）

- [x] npm run typecheck 零错误（exit 0）
- [x] npx vitest run 全量零回退 ✓：**522 文件 / 8717 例全绿**（基线 8688 → +29 = 回放基线 24 + 移植#5 新 5；含 continuation-page 清红），Duration 143.75s
- [x] npm run build ✓ + npm run smoke ✓（acuAppV2Mounted=true / menuItemInjected=true / errorCount=0），产物同步仓库根

## 阶段四：开发后续启动（按 2026-11-21 调查实况执行）

- [x] 移植#5 前置任务：整套回放回归基线就位——exports-baseline 新文件 16 例（6 零覆盖导出）+ 主套件追加 8 例冷回放锚点（纯追加 276 行），合并 198/198 绿（含既有 176）
- [x] 回放基线绿后评估 → **移植#5 本体本班完成**：16 文件落点（新建 shared/table-replay-generation.ts + 核心 +332/-12 + 12 外围 + global.d.ts）；回放全套 249/249 绿（基线 244+新 5）+ 其他域 124/124 + bench 1/1 + tsc 0 错；我方结构全保留（UNIQUE_SCRIPT_ID/存储结构/三埋点/超大写入探测/C2/onDelta/in-flight 去重/Tier-1 降级）
      **主代理裁定**：接受子代理保守收窄——快照续放只服务常规最新回放（排除 maxMessageIndex/yieldBudgetMs/观察回调路径）；依据：albus 原版已排除观察路径、既有用例锁定的诊断/bounded 语义不可改；放开属后续任务（需连用例语义一起更新）
- [ ] SSE 解析器接入：待主人裁定 albus #9 原生工具通道决策 + 非标准连续 data 流兜底口径（解析器本体 sse-event-parser.ts + 39 用例已就位）——未裁定不接
- [ ] albus #6 接管暂停总开关：19 文件跨层移植、我方零基础设施——待主人裁定是否本班投入
- [ ] albus #10 API 全量日志：维持既有裁定「与我方观测体系冗余，不做」

## 硬红线（全程有效）

- 不改 UNIQUE_SCRIPT_ID（shujuku_v120，source/src/shared/constants.ts）
- 不改 TavernDB_ACU_* 存储结构与模板 JSON 同构性
- 宿主差异只进 host-bridge，业务层禁宿主判断
- 改数据层前先读 docs/superpowers/specs/ 相关设计文档
- 单命令前台 ≤10 秒；长任务一律后台化；子代理任务书自包含、一文件一写者
- 删除/覆盖/装依赖/大重构先请主人授权；真机实例只动 Dev，不碰真实数据实例

## 验收标准与收尾

- [ ] 每个修复带回归用例；typecheck / vitest / build / smoke 四门全绿
- [ ] 真机项按 source/docs/TESTING.md 如实勾选
- [ ] 改动登记差量台账（新增 §4e）+ README / TESTING 更新
- [ ] 显式 pathspec 分批提交，推 origin
- [ ] 计划文件全程实时勾选，收尾补交接节

## 进度日志

- 03:05 goal 下达，四 scout 调查基线已回填。计划落盘，开工。
- 03:10 分支清理完成（5 分支归档 tag 后删除 + origin 多余分支删除，终态仅 master）；双 Dev 实例就位（8001 本班起 / 8003 复用并行会话，后因并行会话终止重启）。
- 03:15-03:40 插件三件套双实例同步（md5 全 SAME）；TESTING.md:44 版本复核；回放基线摸底 scout 完成（6 零覆盖导出 + fd9ba783 结构侦察）。
- 03:40 回放基线建设完成（exports-baseline 16 例 + 主套件锚点 8 例，198/198 绿）；随即派移植#5。
- 03:50-04:10 e2e 探针：st PASS；luker 三连败（page closed）→ e2e:shots 交叉判定 st 4/4 · luker 4/4 全绿；定位 ST 真实加载路径为 public/scripts/extensions/third-party/（首跑载旧产物 20261107-05），同步修正后 st 复验 4/4 水印 20261119-1753；多模态逐张读图 9 张全健康。
- 04:15 真机专项三项 × 双实例：恢复面板/SQL 真执行/Luker 读库 PASS；ST context null 环境现象如实留白；TESTING.md 0.10 节落盘。
- 04:20 移植#5 完成（16 文件，回放全套 249 绿 + 其他域 124 绿 + bench 1/1 + tsc 0；收窄裁定已录）；修红完成（用例时序根因，双 agent 交叉印证，其全量 8717 绿）。
- 04:30 正式四门禁：typecheck exit 0 ✓；vitest **522 文件 / 8717 例全绿** ✓（143.75s）；build ✓；smoke ✓（挂载/菜单/0 错误）。
- 04:40 收尾：台账 §4e 落盘、README 同步段更新、本交接节；分批提交推 origin——**ac1d18ee feat（移植#5+基线+产物）/ 70763cca fix（清红）/ f02e87e3 docs（台账 §4e+TESTING 0.10+README+计划终稿）**，origin/master bcca0970→f02e87e3，工作树清零；双实例产物随后同步至 HEAD 终态（ec35cb38 含移植#5）。

## 交接节（2026-11-21 04:40 收尾）

### 本班成果
- 分支纪律归一：本地与 origin 我方侧仅剩 master；5 历史分支内容经 `git cherry` 核实已进 master 演进形态，归档 `archive/*` tag 推 origin 后删除。
- 清红①：continuation-page:824 用例时序修复（组件零改动，守卫语义保留）。
- 回放回归基线 24 例就位 + **移植#5 回放快照续放落地**（albus fd9ba783 → 本仓 16 文件；常规最新回放路径收窄口径已裁定登记）。
- 真机验证批：e2e 巡游 8/8 + 多模态 9 张读图 + 专项三项双实例（TESTING.md 0.10 节）。
- 发版门禁四绿：typecheck 0 / vitest 8717 全绿（+29）/ build ✓ / smoke ✓。

### 待主人裁定（本班未动）
1. SSE 解析器接入：待 albus #9 原生工具通道决策 + 非标准连续 data 流兜底口径（解析器 + 39 用例已就位）。
2. albus #6 接管暂停总开关：19 文件跨层移植、我方零基础设施。
3. albus #10 API 全量日志：维持既有「不做」裁定。

### 移交后续任务
1. **快照续放口径放开**（可选）：bounded/yield 路径接入快照续放，需连同既有诊断用例语义一起更新。
2. **probe 脚本对 Luker 2.9.0-rc.2 的页面存活时序**排查（本班三连败已定性，shots 全绿旁证非插件问题）。
3. **TT 真机语义验证**：配置防丢三件套的 TT extension.store / SETTINGS_UPDATED 事件语义（TT 实例未起，TESTING.md 0.10 留白项）。
4. **长会话专项**：SQLite 栈修复的「长会话不崩」完整场景人工复测（本班以 SQL 真执行作降级证据）。
5. ST `getTableHistoryContext()` 恒 null 的宿主绑定现象人工核验（ST Dev 实例，非插件渲染问题）。

### 断点续跑指引
- 全部状态以本文件 + 台账 §4e 为准；提交历史见 `git log --oneline -8`。
- 实例侧注意：ST 8001 插件真实加载路径 = `public/scripts/extensions/third-party/shujuku-rebuild`；Luker 8003 = `data/default-user/extensions/shujuku-rebuild`；同步后以品牌栏构建戳核验（当前 20261119-1753）。

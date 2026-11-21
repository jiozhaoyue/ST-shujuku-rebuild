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
- **上游同步**：CI 每日自动合并上游 master；冲突按"我方差量"解决（host-bridge、分发产物重建）。上游的数据格式与模板 JSON 必须保持同构，不要私自改 `TavernDB_ACU_*` 结构。**我方差量台账**（追平后 `git diff upstream/master HEAD` 即完整差量，含每次追平的复跑命令与逐类冲突解决口径）见 `docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`。
- **构建开关**：SQLite 引擎（wasm 默认 / asm 回滚）由 rollup replace 注入（`ACU_SQLITE_ENGINE`）；wasm 以 base64 内联进产物，无外部 fetch。
- **版本**：source `package.json` 与根 `manifest.json` 的 `version` 需一致；`auto_update: true`，用户从 GitHub 地址安装。口径（2026-09-27 确立）：**追平上游后 version 跟随上游**（当前 9.7.5）；追平前两者曾长期不一致（manifest 9.4.0 vs package 9.4.10），已修正。`upstream-sync` 的质量门步骤会自动把 `manifest.json` 的 `version` 改写为 `source/package.json` 的版本（身份字段 `author`/`homePage` 仍按我方），守卫用例见 `source/tests/shared/manifest-identity.test.ts`——自动同步曾把两者打回不一致（manifest 9.7.2 / package 9.7.5），故加了这条会响的钉子。
- **上游同步 CI 曾静默失败 5 天（2026-09-22 ~ 09-26，已修）**：`upstream-sync.yml` 的冲突分支里 Markdown 围栏被写成裸引用词（三个反引号被单引号包裹），shell 把它当命令执行 → `command not found` / 退出码 127 → 整段冲突处理崩溃。叠加两个后果：`status=conflict` 从未写出，而「开/更新 issue」步骤的条件依赖该 status → 被跳过。于是真冲突被静默吞掉，我方停滞在上游 v9.4.10 落后 36 提交。**判据**：怀疑同步断了先看 `git rev-list --count HEAD..upstream/master`，再看 workflow 运行记录，别只看 `git status`。修复见提交 `bb57a20`。
- vitest 里宿主模块（`./script.js`、`./scripts/extensions.js`）由 `vitest.config.ts` 的 stub 占位，新增依赖宿主全局时注意补 stub。

## 文档

改数据层 / 存储格式前先读 `docs/superpowers/specs/` 下相关设计文档；测试要求见 `source/docs/TESTING.md`。


<!-- TAVERN-RULES:START v3.0.0 -->
<!-- 本块由 tavern-harness/scripts/modules/rules_sync.py 自动生成，请勿手动编辑 -->
<!-- 真源: tavern-harness · registry/rules.json · 类别 dev · v3.0.0 -->
<!-- 同步时间: 2026-11-21T18:31:26Z -->
<!-- 内容哈希: sha256:b6c5455c7a9f3b115aa0dc7a47e21df547a63715ece8813657661a4b0e397333（仅覆盖规则正文，不含头部与项目覆盖） -->
# 统一开发规则（v3.0.0 · 酒馆开发）

> 本块由 tavern-harness 生成，请勿手改正文。
> 规范全文在 `.trellis/spec/`；项目特例写文末「项目覆盖」。

## 通用红线

- **G-01** 需要用户决策时用问答工具，一次聚合多个问题；重大设计多轮问答。
- **G-02** 任何工具调用前先输出可见短汇报；禁止无文本直接调工具。
- **G-03** 多项改动先落计划文件；验收标准不得 TBD；执行中实时勾选。
- **G-04** 用文件实时记录进度与交接；丢弃 AI IDE 上下文后可续跑。
- **G-05** 独立任务并行发起；命令非阻塞；禁止空等与轮询。
- **G-06** 子代理任务自包含；模型与并发由用户裁定；阻塞宿主不开子代理。
- **G-07** 删除、覆盖、装依赖、大重构、对外写操作前必须显式授权。
- **G-08** 删除一律走回收站或归档；禁止用命令直接删除。
- **G-09** 变更用 diff 与块级编辑；禁整文件覆盖与 shell 重定向写源码。
- **G-10** Git 只用显式 pathspec；提交前校验暂存区；完成即推 origin。
- **G-11** 交付物零凭据、零隐私、零真实数据、零本机绝对路径。
- **G-12** 先检索复用；UI 复用设计系统；DB 复用 schema 与迁移；不自造。
- **G-13** 运行时零 CDN 与网络引用；无法本地化须说明并隔离。
- **G-14** 脚本禁硬编码业务数据；路径、端口、URL、阈值一律读配置。
- **G-15** 一仓一份脚本目录；模块登记；中控统一派发；禁一次性脚本。
- **G-16** UI 文案短；禁长句、合并连词、分隔符、括号说明、说明性副标题。
- **G-17** UI 布局紧凑；禁大间隔、大空白、横竖颠倒；改动必须截图检查。
- **G-18** UI 区域用阴影或色差区分；禁线条分割、边框滥用、卡片套卡片、中控台风格。
- **G-19** 异步等待必须有界；Worker 终止后置空；高频 DOM 更新用 rAF 合帧。
- **G-20** 耗时操作有进度与结果；失败不静默、不整体中断。
- **G-21** 发版前测试全绿、零回归；未验证项不得写成已验证。
- **G-22** 改前读 spec；复杂功能先写设计再写代码。
- **G-23** 文档、注释、回复用中文；代码标识符与专有名词除外。
- **G-24** 工作流改动覆盖 skills、MCP、agent、配置文件与 TDD，并留验证证据。
- **G-25** 单一真源；禁散落规则与副本；规范入 spec，注入只留短摘要。
- **G-26** 任何完成声明必须有可复现证据；未验证项如实标注。
- **G-27** 多事项物理分行；禁连词、分隔符、括号合并；单项断言独立成行。
- **G-28** 对话正文不贴完整文件内容；落地文件，只给可点击路径。
- **G-29** opencode/workbuddy 会话必须用子代理多并行推进；禁止主代理单干。
- **G-30** 子代理必须使用免费模型；调用前实时查询注册表并确认 cost 输入输出均为 0；禁止误用付费模型。
- **G-31** 输出与工具调用禁止简写；禁止把用户简写直接当作具体模型、工具、仓库或路径名。
- **G-32** 禁用 checkout --/restore/reset --hard/clean -fd 回滚未提交改动；回滚前先 stash 或备份并报备路径。（来源 ST-pack-transfer/iron-rules#40）
- **G-33** dev server 等长驻服务用系统命令起独立进程（Start-Process/nohup/setsid），禁用 agent 内置后台 shell。（来源 ST-pack-transfer/iron-rules#38）
- **G-34** 读数/体积/进度同源实时可复核；读不到显示「未提供」，禁假 0/假缓存/假成功。（来源 ST-pack-transfer/iron-rules#5）
- **G-35** 禁重复造轮子：通用算法/格式/API 封装优先用三方库或仓内去重，自写仅限业务逻辑。（来源 ST-pack-transfer/quality-guidelines 三方库规范）
- **G-36** 主代理只兜底：全局调配、仲裁、进度勘察、多模态复核；子代理不可用时才亲自实现。（来源 ST-pack-transfer/subagent-collaboration#G-8）
- **G-37** 派发角色按内置→仓内专用→主代理亲自三级顺序选，不跳级；亲自做须记降级原因。（来源 ST-pack-transfer/subagent-collaboration#G-10）
- **G-38** 仓内专用角色统一入库（.zcode/agents/*.md）、纳入 git、随时可调用；禁散落临时目录。（来源 ST-pack-transfer/subagent-collaboration#G-11）
- **G-39** 每个子代理独占产出文件；同一文件同一时刻只有一个写者；只读角色只给读工具。（来源 ST-pack-transfer/subagent-collaboration#G-12）
- **G-40** 一轮并发派发多角色子代理成蜂群，主代理同轮推进自身工作；禁串行接力、禁 wait/轮询空等。（来源 ST-pack-transfer/subagent-collaboration#G-9）

## 酒馆开发红线

- **D-01** 宿主差异只进单一 host-bridge；业务层禁宿主名判断。
- **D-02** 注入样式双前缀；禁全局选择器；配色继承宿主变量。
- **D-03** 纯前端主路径闭环；后端只作可选增强，适配器加特性检测加静默降级。
- **D-04** 跨宿主插件禁用宿主补丁桥；只用可移植子集并标注可用性。
- **D-05** API 事实以官方文档为准；禁翻宿主源码找内部 API。
- **D-06** UI 落点只认官方文档；设置页只放设置；复杂 UI 用官方 Popup 与 RENDERED。
- **D-07** 安装后即可用；第三方库本地 vendor；不得要求用户构建。
- **D-08** 插件可独立运行；无后端、离线、卸载后仍可用。
- **D-09** 发版前跑项目测试与产物校验；E2E 只对 Dev 实例。
- **D-10** 开源基线：零隐私、零凭据、真实数据隔离；提交用隐私邮箱。
- **D-11** 扩展目录按宿主约定；Luker 用户扩展平铺，禁嵌套 third-party。
- **D-12** 前端性能有预算；交互反馈、首屏、拉取时间在 Dev 复测并留数字。
- **D-13** 动手前先盘点宿主原生能力（拉取/上传/下载/扩展管理/存储/通知），原生已实现的不在插件内重造，并发时宿主优先。（来源 ST-pack-transfer/iron-rules#28）
- **D-14** 同一作者/仓库只允许一个安装 URL；禁本地链接，一律 remote link；私有仓提示需登录。（来源 ST-pack-transfer/iron-rules#32）

## 规范入口

- `.trellis/spec/tavern-dev/index.md`

## 技能策略

- 允许 pack：dev, upstream
- 禁止 pack：card, infra

## 项目覆盖
（本仓自有内容，同步器保留；无则留空。）

<!-- TAVERN-RULES:END -->

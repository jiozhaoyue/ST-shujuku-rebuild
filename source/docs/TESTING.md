# 运行时测试清单（另一台设备的 TauriTavern / SillyTavern）

本清单覆盖**只有真机运行才能暴露**的问题。本地已完成：类型检查、单元/集成测试（`npx vitest run`，随发版增量更新）、构建验证。以下步骤请按顺序执行，遇到问题记录控制台报错信息反馈。

> **先跑自动化，再人工补差**：本清单的前四条（四个宿主上都该成立的那几条）已被
> `npm run compat:probe` 自动化覆盖 —— 见 `scripts/host-compat-probe.mjs`：
> 一次命令验四个宿主的「插件脚本是否注入 / 公开 API 是否挂载 / V2 界面是否起来 / 有无插件自身报错」。
> ```bash
> cd source
> NODE_PATH="C:/nvm4w/nodejs/node_modules" npm run compat:probe        # 四个目标全跑
> NODE_PATH="C:/nvm4w/nodejs/node_modules" npm run compat:probe -- --only=st,luker
> NODE_PATH="C:/nvm4w/nodejs/node_modules" npm run e2e:shots           # 四目标 V2 界面截图巡游（留证）
> ```
> 四个目标：`st`(8001) / `luker`(8003) / `puretavern`(8899) / `ttavern`（TT 是桌面壳起不动，
> 改为在真机 ST 页注入 `__TAURITAVERN__` ABI 走通其分支）。
> `e2e:shots`（2026-10-26 新增）对每个目标巡游 仪表盘/填表规则/高级工具/开发者页 四页截图，
> 落 `test-results/e2e-shots/`（gitignore 管理）；只连 Dev 白名单端口（8001/8003/8899），
> 启动断言失败即退出 —— 见 `scripts/e2e-screenshot-tour.mjs` 头注释。
> **注意**：`puretavern` 目标每次新会话都要经它原生的 `/api/extensions/install` 从 GitHub 现装
> 扩展（其扩展注册表按浏览器会话存），**冷装实测 2~5 分钟** —— 默认 300s 单目标时限可能吃紧，
> 超时把时限放宽即可：`ACU_PROBE_TARGET_TIMEOUT_MS=600000`（2026-10-26 实测记录）。
> **判据口径**：报 `SKIP` 表示该实例没装本插件（不是兼容结论）；「不可归因的 `Script error.`」
> 不计失败（跨源错误浏览器不给堆栈，把无从修的东西判成失败只会让探测器恒红）。
> **注意**：自动化只覆盖「起得来」；下面各节的手工步骤仍是发版前必须过的。

## 0. 安装

1. 扩展面板 → Install extension → 粘贴本仓库地址（`manifest.json` 中 `homePage` 指向本仓库）
2. 确认扩展列表出现「Luker·数据库」，`manifest.json` 中 `auto_update: true`
3. 刷新页面后，确认右上/侧边出现数据库入口（V2 面板 `#acu-app-v2`）

## 0.5 Luker 真机（Luker 2.7.0 / stCompat 1.18.0）

- [ ] 扩展启用后刷新：右下角出现 `Luker·<构建戳>` 构建水印（`#acu-build-stamp-badge`）
- [ ] 控制台无「等待 SillyTavern 就绪超时」；调试面板 host 字段为 `luker`（`window.Luker.getContext` 特征命中）
- [ ] V2 面板挂载：表格 / 填表 / SQL 控制台 / 运行日志全量可用
- [ ] 聊天含旧 TT/上游数据（Branch 陈旧 HotSnapshot / 上游 `TavernDB_ACU_HotSnapshot` 等）时：owner 守卫忽略，无报错、无阻塞
- [x] 世界书桥接降级（2026-10-31 Dev ST 8001 ttavern ABI 注入环境=无酒馆助手，自动化实证）：
      `scripts/e2e-worldbook-degrade-check.mjs` 3/3 PASS——worldbook-ai 读向方法
      （listWorldbookSkillMetas → []、getWorldbookEntrySkillMeta → null、cancelContentOptimization → true）
      全部优雅返回结构化结果，无未捕获异常（pageerror clean）。**公开 API 是扁平对象**（组名只是
      开发者页自描述索引），自动化时不要按 `api['worldbook-ai'].xxx` 寻址。
- [ ] auto_update 安全：manifest `homePage` 指向本仓库，宿主自动更新不会拉回上游 rebuild 产物
      （2026-10-31 静态核对：homePage=`https://github.com/jiozhaoyue/ST-shujuku-rebuild`、version=9.7.5、auto_update=true ✓）

## 0.6 开发者页的两个新面（2026-09-28）

> 都在「开发者选项」页；都需要先在仪表盘打开「开发者选项」总开关才看得到该页。

- [ ] **提示词检查器**：打开「开始记录」→ 触发一次 AI 调用（任意功能域，最快是高级工具里的
      「调用测试」或一次手动填表）→ 回到本页应出现一条记录；展开可见 模型 / 端点主机 / 流式 /
      消息数 / 总字符 / 估算 token、与上次调用的 diff（基线 / 一致 / 前缀分歧）、逐条消息明细。
      非填表功能域应显示「**未分段**」并说明原因（只有填表链按占位符分段）。
- [x] **导出 JSON / 复制诊断包文本（2026-10-31 Dev 双实例自动化实证）**：
      `scripts/e2e-devpage-check.mjs`（--target=st/luker）在 Dev ST 8001 与 Dev Luker 8003 各 **17/17 PASS**
      ——环境与能力总览六要素齐全、8 个 API 域分组在列、复制诊断包文本为脱敏 Markdown
      （无 apikey/authorization 字段名）、导出诊断包 JSON 下载成功且脱敏扫描 clean
      （schema/environment/capabilities/selfCheck/promptObservations）。
      产物：`test-results/e2e-shots/devpage-*` 与 `devpage-luker-*`。注：新会话默认基础模式，需先切高手模式并在仪表盘
      打开「启用开发者选项」总开关（自动化已覆盖该前置链）。
- [x] **环境与能力总览（同上实证）**：构建戳 / 存储模式 / 当前聊天标识 / 数据隔离 / 可调用的公开 API
      （按域分组可展开）/ 状态持久化面（四通道）全部渲染。

## 0.7 超大字段软警告 + 手动 CRUD + 救援回放（2026-10-28 真机记录）

- [x] **超大字段软警告（Dev ST 8001）**：5 万字符经 `importTableAsJson(persist)` 提交 → 恰好一次
      warning toast（含数值/阈值/「不拦截」/调整入口）、数据不截断（回读逐字符一致）、同量级去重、
      关开关零提示且写入不受影响、恢复后重现。自动化：`source/scripts/e2e-oversized-write-check.mjs`
      （9 项行为断言，两连 PASS；截图与 report 在 `source/test-results/e2e-shots/`）。
- [x] **手动 CRUD sheetKey 定位**：运行时显示名（如「主角信息」）与模板显示名（「主角信息表」）不一致的
      聊天上，`insertRow('sheet_protagonist', …)` 修复前恒 -1、修复后成功（`ad39b79`，真机探针随上 E2E）。
- [x] **救援回放（真实数据双样本）**：`scripts/rescue/replay-chat.mjs` 修复物理表名推定（直接采用
      DDL 声明名 + 语句头部键形式别名重绑）后——「孤独摇滚」188 批 320 语句：313 改绑回放、仅 7 宽容跳过、
      救回 15 表 86 行；「原始人？」123 批 261 语句：**0 跳过**、62 行。修复前该脚本对这类真实聊天
      要么崩溃（数字开头键形式）要么静默丢掉全部回放数据行。
- [x] **救援回放解析根治 + 列签名重绑（2026-10-31 真机 A/B 复验，`711167c`/`9e3b2e3`）**：
      真实模板 romance_diary 的 `event_type` 带 `CHECK(... IN ('a','b',…))`，旧解析逐行逗号正则把整列
      撕碎丢弃 → INSERT 缺列 → NOT NULL 全行跳过。解析重写（顶层逗号+括号深度+字符串感知；行尾逗号+注释=列
      边界）+ 表头三级匹配（精确→归一化→子串互含）+ 旧代拼音物理名按**唯一列签名**改绑（INSERT 列清单 /
      UPDATE SET+WHERE，歧义不猜）+ 前导注释剥离 + FROM/JOIN 锚定的残余别名替换（实证教训：键形式别名
      可能恰为常见列名——`summary`——无锚定全词替换会改写列名，当晚踩中当日修复）。A/B 复验（新旧脚本
      同输入）：原始人 Branch#1 语句/跳过持平、行 **62→75**（romance_diary 18 行复活）；孤独摇滚3 B#5
      跳过 **239→1**（忠实回放含其自身 DELETE 维护语句）；B#1 行 54→60；B#8 行 154→160（余 53 跳为
      NOT NULL 源数据空值，设计内）。单测：`tests/scripts/rescue-replay-parse.test.ts` 26 用例
      （`711167c`/`9e3b2e3`/`28d26b3`）。
- [ ] **复制排查报告**：点一下应提示已复制；粘出来是一份带分段/diff/消息明细的脱敏文本，
      可直接贴进酒馆让 AI 排查。
- [ ] **环境与能力总览**：应显示 宿主 / 插件版本 / 构建戳 / 存储模式 / 当前聊天标识 / 数据隔离；
      公开 API 按域分组可展开；状态持久化面列出四类通道与字段清单；
      徽章里「可调用 N 个方法」与「M 个当前被门禁隐藏」两者相加应等于静态定义总数
      （SQLite runtime 未就绪时 SQL 同步读取方法会被摘掉，故可调用数可能小于定义数——这是预期）。
- [ ] 「复制总览给 AI」：粘出来是脱敏文本，含环境、API 清单、持久化面三节。
- [ ] **一键诊断包**（2026-10-26 新增）：点「导出诊断包 JSON」应下载 `acu-diagnostic-bundle-*.json`，
      内含 `schema: acu-diagnostic-bundle-v1` 与 环境/公开 API/自检/提示词观测/写库流水/历史楼层回放 六节；
      点「复制诊断包文本」粘出来是分节 Markdown，末行注明脱敏。**两份产物都不得出现 API 密钥或请求头值**。

## 1. 启动与核心（不依赖酒馆助手）

- [ ] 不安装酒馆助手（JS-Slash-Runner）的情况下，扩展能正常启动，控制台无「等待 TavernHelper 超时」类报错
- [ ] 打开 V2 仪表盘：基础配置 / 高级设置可见，无「存储模式」展示区域
- [ ] 高级设置开关列表：剧情推进 / 正文替换 / 交火模式 / 开发者选项（无「智能续写」、无「外部导入」）
- [ ] 已安装酒馆助手时：部分能力（世界书读写等）走酒馆助手桥接；未安装时：核心表格功能正常，AI 调用统一走「自定义 API」（需在 API 页配置端点与模型）

## 2. SQL 表格（核心回归）

- [ ] 新聊天首次填表：默认 8 张模板表（全局/主角信息/重要角色/主角技能/背包/任务事件/纪要/选项）自动建表
- [ ] 表格数据在 AI 生成后正确更新并持久化（聊天消息里出现 V2 帧 `storageFrame` / `TavernDB_ACU_*` 字段）
- [ ] 切换聊天/换卡后表格数据正确加载（SQLite provider hydrate）
- [ ] SQL 控制台可执行 SELECT/INSERT/UPDATE/DELETE
- [ ] 旧聊天（V1 数据）加载时自动迁移为 V2，无数据丢失

## 3. 剧情推进预设

- [ ] 导入现有剧情推进预设 JSON（如 Cirno_BATTLE_Turn_*.json）成功
- [ ] 启用剧情推进后，发送消息触发规划（观察是否改写用户输入/注入提示）
- [ ] 预设切换、全局/当前聊天预设绑定正常
- [ ] 默认剧情推进为「时间召回」预设（新装/重置后剧情推进页默认选中时间召回）

## 4. skill 化

- [ ] 在世界书条目上触发 skill 化（AI 生成 description/triggerWhen/tk 并写回 comment）

## 5. 数据库可视化前端（st-acu-visualizer）兼容

- [ ] 安装可视化前端（酒馆助手脚本）后，`#acu-app-v2` 与按钮可被前端定位
- [ ] 前端「全选」「一键追平所选表未填楼层」「切换到高手模式」按钮可点击
- [ ] 前端表格编辑（乐观写 content + insertRow 兜底 push）后，数据正确同步回数据库
- [ ] `registerTableUpdateCallback` 回调在表格更新后触发（前端自动刷新）

## 6. 已删除功能确认

- [ ] 侧边栏/旧弹窗均无「智能续写」入口；旧弹窗剧情推进页无循环提示词列表/开始循环按钮
- [ ] 设置页无「原生 JSON 存储」选项
- [ ] 开发者选项无「严格 JSON 填表响应」开关；填表响应统一走 `<tableEdit>` 协议
- [ ] API 页无「酒馆主 API / 酒馆预设」连接方式；开发者选项无「旧 UI 入口」开关

## 7. 已知限制（非 bug）

- 不装酒馆助手时：部分世界书写入能力不可用，属预期降级
- ~~性能基准测试在并行负载下偶发超时~~（2026-10-26 校准：该文件已有 60s 整文件超时；同日全量 8800 用例 8 并行两轮全绿含 perf，未再复现偶发超时。若复现，判据见 `.trellis/spec/backend/quality-guidelines.md`「测试本身的纪律」）
- 测试冷启动预热已于 2026-10-26 根治（setup 顶层 + resetModules），「重型套件首条用例超时」不再应出现；复现时按 quality-guidelines「冷启动预热」节的判据排查

## 8. 差量注入 / 楼层级追平 / 自检（v9.3.0+ 新功能，默认关闭不影响既有行为）

- [ ] 仪表盘高级设置出现「填表差量注入（实验）」开关，默认关闭；关闭时填表行为与旧版一致（prompt 中每表仍带全部行数据）
- [ ] 开启后（填表更新设置 → 高级参数）：热表名单填表名（如 `纪要`），下次填表 prompt 中热表仍带全量行；未列名且近期未改动的表只出现 DDL 与「未列为热表」注释，不再带行数据
- [ ] 冷表名单中的表永远只带 DDL（压过热表与近期改动）
- [ ] 差量开启后发起一轮真实填表：`<tableEdit>` 正常执行入库、可视化前端照常刷新；AI 对冷表不出 UPDATE（出了解析照常执行，只是数据可能不准——预期内）
- [ ] 一键追平：选择「每 1 层合并」后执行，逐楼推进；中途终止提示已保留 N 个 bucket；再次追平自动从断点续跑（已提交楼层不重复调用 AI）
- [ ] Debug 面板/导出 JSON 出现 `selfCheck` 字段：host / storage / differentialInjection（含账本 batchCount）/ pendingFlush 四个探针均 ok:true

## 反馈格式

问题反馈请附：步骤、期望/实际、TT 控制台（F12）报错截图或文本、扩展版本。

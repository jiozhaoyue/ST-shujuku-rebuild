# Luker·数据库

Luker / TauriTavern 数据库插件「Luker·数据库」，基于 [`shuiyue-cmyk/shujuku-rebuild`](https://github.com/shuiyue-cmyk/shujuku-rebuild)（UnbirthDB / TTonly·数据库）的宿主适配版，积极兼容 Luker 前端，同时保持 TT（TauriTavern）兼容。

> **上游关系**：数据面与模板格式与上游完全同构（聊天内 `TavernDB_ACU_*` 存储帧、模板 JSON、剧情推进预设、st-acu-visualizer 契约）。宿主差异集中在 `shared/host-bridge.ts` 适配桥（TT / Luker / 通用 ST 三态 profile，探测失败自动降级 generic，不阻塞启动）。

**运行时零依赖酒馆助手**，以标准扩展形式通过 GitHub 地址直接安装、自带更新。

持续更新中，详见提交历史：https://github.com/jiozhaoyue/ST-shujuku-rebuild/commits/master

## 功能

- **SQL 表格**：默认 8 张表（可自定义增删列），SQLite 持久化，支持 `INSERT/UPDATE/DELETE`，模板预设一键切换
- **新版界面（v3）**：上游「新版界面转正」后的全页面重构——基础模式一页上手、高手模式全功能、Claude 风格外壳可选；本仓的全部自有功能已移植进 v3
- **填表**：正文接收 / 跟随角色卡 / 手动选择三种世界书来源，支持按表分组自动/手动填表与一键追平；差量注入（实验）可只带热表全量、冷表仅供建表语句
- **剧情推进 / 决策召回 / 智能续写 / 正文替换**：随上游 Unbirth A.D. 6386 全量并入——剧情推进预设、决策模型给纪要打分挑相关记忆（可附加世界书条目参与打分）、多任务续写工作流、替换前判定、开发者选项「提示词额外要求」（执行边界 / 安全审查提示词按功能附加）、API 页 OpenCode Go 用量进度条
- **世界书与 Skill 化**：支持常量/关键词触发，Skill 化条目可由 Agent 接管并受正文放行控制
- **可视化前端**：表格查看、剧情推进、世界书管理均在新版面板内完成（兼容 [st-acu-visualizer](https://github.com/shuiyue-cmyk/st-acu-visualizer)）
- **API 预设**：每个预设独立保存 `stream` / `reasoning_effort`（含 `xhigh`）/ 温度等，填表/剧情/追踪可分别指定预设；支持经酒馆转接与数据库直接发送两种通道
- **高级工具**：SQL 控制台、运行日志查看与导出、Debug 一键采集（默认关闭，停止时自动导出）
  - SQL 控制台：结果一键导出 CSV（带 BOM，Excel 直开）/ JSON / 复制为 Markdown 表格（贴进聊天）、
    大结果只渲染前 200 行（「显示更多」逐窗追加，复制/导出仍取全量）、单元格点击复制为 SQL 字面量、
    列头点击排序、编辑器草稿与常用语句跨重开持久化（常用语句点击仅填入、绝不自动执行）
- **开发者诊断**：环境与能力总览、出站提示词观测、写库流水观测、历史帧回放、一键诊断包五面板（默认关闭）
- **对外 JavaScript API**：`window.AutoCardUpdaterAPI` 向聊天内其它脚本暴露 SQL / CRUD / 导入导出 / 只读历史等能力；
  支持历史来源身份读取（`getTableHistoryContext`）与写入接口的前端回读等待选项（`awaitFrontendReadback`），
  选项语义与 AlbusKen/shujuku 公开文档同名同义——详见 [`source/docs/public-api.md`](source/docs/public-api.md)
- **宿主适配**：TT / Luker / 通用 ST 三态宿主 profile（`shared/host-bridge.ts`），探测失败自动降级 generic，不阻塞启动
- **稳定性增强（移植自 AlbusKen/shujuku）**：SQLite exec 栈指针配对（修复长会话约 33 万次查询后 wasm 越界崩溃）、JSON 清洗保留字符串正文（「」『』定界符模式，只改写字符串外的区域，提升填表成功率）、配置防丢三件套（未落盘副本自动回收 / 宿主写入确认 / 命名空间备份，静默生效，写确认默认关闭）、SSE 规范事件解析器（WHATWG 语义就位，供后续原生工具通道使用）

## 安装

在 Luker / TauriTavern 的扩展面板粘贴本仓库地址安装：

```
https://github.com/jiozhaoyue/ST-shujuku-rebuild
```

后续更新走扩展面板（`auto_update: true`），开箱即用，无需额外导入脚本。

## 问题反馈

遇到问题欢迎[提交 issue](https://github.com/jiozhaoyue/ST-shujuku-rebuild/issues/new)。不需要懂技术，只要帮我们做到下面两点，问题就能修得快很多：

1. **说说怎么出现的**：你做了什么、本来以为会怎样、实际发生了什么。如果再操作一次还会出现，就更好了。
2. **附上 Debug 日志**：这一步最重要，有了日志我们才能看到插件当时在做什么。只需要点几个按钮：
   1. 打开插件「高级工具 → Debug 问题上报」，点「开始 Debug」；
   2. 把出问题的操作再做一次；
   3. 点「导出 Debug 数据」，会下载一个文件（里面的密钥已经自动隐藏，可以放心发）；
   4. 把这个文件拖进 issue。传不上的话，传到你常用的网盘，把分享链接贴进来就行。

没有日志、问题又复现不出来的话，我们很可能查不到原因，只能先挂起，还请理解。

## 上游同步

- 本仓库基于上游 fork 点 v9.1.9（`760ba68`）构建；2026-11-07 追平上游 `Unbirth A.D. 6386`（145 提交并入，我方功能全部移植进新版界面 v3），2026-11-08 再追平 `8f1fb759`（模板切换去冗余），2026-11-20 追平 `76ffdc81`（DeepSeek 填表专项第三轮复审 8 提交、提示词额外要求、决策召回世界书、Go 用量，冲突 7 文件按台账口径并集解决）
- **AlbusKen/shujuku（更上游）差量处置**：由上游 shuiyue 作筛选吸收层；未被吸收且对我方有价值的差量按「化为功能写进去」口径移植——已移植 PR #66/#67（历史来源身份 / 写入回读等待），PR #70 已随上游 `26e453e6` 同主题实现进树，PR #65 回退（`597ef6ea`）三树终态一致零影响；2026-11-20 依功能面比对移植四件：SQLite exec 栈泄漏修复（`5518792c`）、JSON 清洗保留字符串正文（`c45d50ee`）、配置防丢三件套（`5518792c`，含 host-bridge 探测收口）、SSE 规范事件解析器（`c45d50ee`）；albus 自有子系统（世界模拟/桌宠/零层世界等）系 shuiyue 层的取舍，不在本仓范围
- **2026-11-21 班**：移植 albus `fd9ba783` 回放快照续放（代次/指纹/前缀三重校验 + 冷回放兜底，常规最新回放路径，16 文件；整套回放回归基线 24 例先行就位）；分支纪律归一（全部历史分支归档为 `archive/*` tag 后删除，仓库仅 master）；真机双实例验证批（e2e 巡游 8/8 + 恢复面板/SQL 真执行/Luker 读库 PASS，TESTING.md 0.10 节）；全量 8717 例零回退
- **2026-11-21 下午班（调查 + 文档同步，无源码/产物改动）**：十路 scout 并发调查实况——框架现状（Vue3+Pinia 已内联）、转移报告 364 条按本仓形态重筛（守卫族在本仓不存在，采纳即新建）、测试/CI 与 UI 合规盘点、上游差距（落后 upstream=0）、e2e 基建与参照仓守卫族扫描；结论与五个候选立项方向固化到差量台账 §4f。文档同步：总计划 L46/L74-78 据证据回勾；TESTING.md 0.10 留白项补下午班复核（未实测不写已验证）；台账新增 §4f 与版本口径偏离待裁定项。版本口径：manifest 与 package 均为 `Unbirth A.D. 6386`，AGENTS.md:34「当前 9.7.5」为历史快照，如实登记待主人裁定，未改任何版本值。
- **自动同步已停用（2026-11-07 裁定）**：每日定时拉取与自动开 issue 的 CI 已关闭，同步改为手动触发（`Upstream Sync` workflow 仅 `workflow_dispatch`），追平前按差量台账（`docs/superpowers/specs/2026-09-27-fork-delta-ledger.md`）人工评估
- 上游仓库：https://github.com/shuiyue-cmyk/shujuku-rebuild （更上游：https://github.com/AlbusKen/shujuku ，本仓数据面与两者保持同构）

## 开发

- 设计文档：`docs/superpowers/specs/`
- 实施计划：`docs/superpowers/plans/`
- 真机清单：`source/docs/TESTING.md`
- 测试：`cd source && npx vitest run`（发版前全量零回退）
- 发版：打 `vX.Y.Z` tag 触发 Release Gate（类型检查 + 全量测试 + 构建 + 冒烟 + 产物一致性校验）

# Luker·数据库

Luker / TauriTavern 数据库插件「Luker·数据库」，基于 [`shuiyue-cmyk/shujuku-rebuild`](https://github.com/shuiyue-cmyk/shujuku-rebuild)（TTonly·数据库）v9.1.9 的宿主适配版，积极兼容 Luker 前端，同时保持 TT（TauriTavern）兼容。

> **上游关系**：数据面与模板格式与上游完全同构（聊天内 `TavernDB_ACU_*` 存储帧、模板 JSON、剧情推进预设、st-acu-visualizer 契约）。宿主差异集中在 `shared/host-bridge.ts` 适配桥（TT / Luker / 通用 ST 三态 profile，探测失败自动降级 generic，不阻塞启动）。

**运行时零依赖酒馆助手**，以标准扩展形式通过 GitHub 地址直接安装、自带更新。

持续更新中，详见提交历史：https://github.com/jiozhaoyue/ST-shujuku-rebuild/commits/master

## 功能

- **SQL 表格**：默认 8 张表（可自定义增删列），SQLite 持久化，支持 `INSERT/UPDATE/DELETE`，模板预设一键切换
- **填表**：正文接收 / 跟随角色卡 / 手动选择三种世界书来源，支持按表分组自动/手动填表与一键追平
- **剧情推进**：内置"时间召回"预设，支持自定义预设导入与速率设置
- **世界书与 Skill 化**：支持常量/关键词触发，Skill 化条目可由 Agent 接管并受正文放行控制
- **可视化前端**：表格查看、剧情推进、世界书管理均在 V2 面板内完成（兼容 [st-acu-visualizer](https://github.com/shuiyue-cmyk/st-acu-visualizer)）
- **API 预设**：每个预设独立保存 `stream` / `reasoning_effort`（含 `xhigh`）/ 温度等，填表/剧情/追踪可分别指定预设
- **高级工具**：SQL 控制台、运行日志查看与导出、Debug 一键采集（默认关闭，停止时自动导出）
- **宿主适配**：TT / Luker / 通用 ST 三态宿主 profile（`shared/host-bridge.ts`），探测失败自动降级 generic，不阻塞启动

## 安装

在 Luker / TauriTavern 的扩展面板粘贴本仓库地址安装：

```
https://github.com/jiozhaoyue/ST-shujuku-rebuild
```

后续更新走扩展面板（`auto_update: true`），开箱即用，无需额外导入脚本。

## 上游同步

- 本仓库基于上游 fork 点 v9.1.9（`760ba68`）构建，CI 每日定时拉取上游 master 自动合并
- 干净合并且质量门（类型检查 / 全量测试 / 构建 / 产物冒烟）通过 → 自动合入 master 并重建分发产物
- 冲突或门禁失败 → 自动开 issue 列出待甄别提交与冲突文件，人工处置
- 上游仓库：https://github.com/shuiyue-cmyk/shujuku-rebuild

## 开发

- 设计文档：`docs/superpowers/specs/`
- 实施计划：`docs/superpowers/plans/`
- 真机清单：`source/docs/TESTING.md`
- 测试：`cd source && npx vitest run`（发版前全量零回退）
- 发版：打 `vX.Y.Z` tag 触发 Release Gate（类型检查 + 全量测试 + 构建 + 冒烟 + 产物一致性校验）

# Luker·数据库

Luker / TauriTavern 数据库插件，基于 [`shuiyue-cmyk/shujuku-rebuild`](https://github.com/shuiyue-cmyk/shujuku-rebuild) v9.1.9 fork，积极兼容 [Luker](https://github.com/) 前端，同时保持 TT（TauriTavern）兼容。

> **上游关系**：数据面与模板格式与 rebuild / 上游 [`AlbusKen/shujuku`](https://github.com/AlbusKen/shujuku) 完全同构（聊天内 `TavernDB_ACU_*` 存储帧、模板 JSON、剧情推进预设、st-acu-visualizer 契约）。宿主差异集中在 `shared/host-bridge.ts` 适配桥，上游更新按批次甄别移植。

**运行时零依赖酒馆助手**，以标准扩展形式通过 GitHub 地址直接安装、自带更新。

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
https://github.com/jiozhaoyue/luker-shujuku
```

安装后自动更新（`auto_update: true`），无需再通过酒馆助手导入脚本。

## 开发

- 设计文档：`docs/superpowers/specs/2026-09-05-luker-shujuku-design.md`
- 实施计划：`docs/superpowers/plans/`
- 真机清单：`source/docs/TESTING.md`（含 Luker 2.7.0 节）
- 测试：`cd source && npx vitest run`（基线 7580+ 用例，发版前零回退）
- 版本留存：每版打 `vX.Y.Z` tag + `release/vX.Y.Z` 分支

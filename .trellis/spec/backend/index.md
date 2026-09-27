# 核心层开发规范

> 本仓是**浏览器扩展**，没有服务端。本目录的「backend」指**不依赖 DOM 的核心层**：`src/shared/`、`src/data/`、`src/service/`（分层与依赖方向见下表第一项）。
> UI 规范见 [`../frontend/`](../frontend/index.md)；酒馆仓群跨仓约定见 [`../tavern/`](../tavern/host-compat.md)。

---

## 规范索引

| 规范 | 内容 | 关键实证 |
| --- | --- | --- |
| [目录结构与分层落点](./directory-structure.md) | 仓库两级结构、`src/` 分层与实测依赖方向、落点与命名 | `service→data` 176 处、反向 0 处；别名 rollup 未注册 |
| [数据与持久化](./database-guidelines.md) | sql.js 内存库、存储帧与回放链、隔离槽位、受限 DML | `sync-bridge.ts`、`isolation-policy.ts`、`UNIQUE_SCRIPT_ID` |
| [宿主适配](./host-adaptation.md) | ST / Luker / TT 三态判定、就绪与版本门禁、降级 | `host-bridge.ts:14-157`、H1 每轮重估教训 |
| [错误处理](./error-handling.md) | 结果对象 / 中文 `Error` / catch 降级三条形态 | `ddl-utils.ts:249-307`、`auto-fill-echo-guard.ts:114` |
| [日志](./logging-guidelines.md) | `logDebug/Warn/Error_ACU` + 日志缓冲 + 用户提示 | `utils.ts:172-190`、`log-buffer.ts`、`log-error-hints.ts` |
| [安全门禁与隔离](./safety-and-isolation.md) | 端点 SSRF 门禁（含永久封禁段）、SQL 受限写入、数据身份 | `utils.ts:588-660`、`restricted-sql-dml.ts` |
| [质量门](./quality-guidelines.md) | 门槛命令、vitest 配置要点、身份守卫、真机清单 | `vitest.config.ts`、`manifest-identity.test.ts` |

---

## 使用方式

- **动手前**：按你要改的层读对应页；改数据层先读 `docs/superpowers/specs/` 下的相关设计文档。
- **收尾时**：规范条文落本目录，**任务目录只作工作副本**（规则 L0-17）。
- 本目录页面**自包含**（内联 file:line 证据），不要写「详见某任务目录」。
- 页面只**指向**规则条目号与 skill 名，**不复制规则正文**（复制即制造第二处同源内容 → 必然漂移）。

---

**语言**：本仓规范一律**中文**（有意覆盖 Trellis 模板默认的 English only，见规则 L0-15）。

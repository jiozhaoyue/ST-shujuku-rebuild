# UI 层开发规范

> 本目录的「frontend」指**现行 UI**：`src/presentation-v2/`（Vue 3 SFC + Pinia）。旧层 `src/presentation/` 只做兼容维护，新功能不进。
> 核心层（`shared/` / `data/` / `service/`）规范见 [`../backend/`](../backend/index.md)。

---

## 规范索引

| 规范 | 内容 | 关键实证 |
| --- | --- | --- |
| [目录结构](./directory-structure.md) | `presentation-v2/` 布局、挂载与生命周期、页面注册表 | `bootstrap/mount.ts:1-20`、`router/page-registry.ts` |
| [组件规范](./component-guidelines.md) | `_lib` 组件库优先、SFC 标准结构、样式作用域铁律 | `components/_lib/AcuButton.vue`、`theme/theme-injector.ts:1-13` |
| [Composable 规范](./hook-guidelines.md) | 何时抽 composable、订阅成对、与 store 分工 | `useChatChangedListener.ts:1-17` |
| [状态管理](./state-management.md) | Pinia store、`acu_v2_ui_state` 分节持久化、刷新链 | `stores/persistence.ts:1-13`、`router-store.ts:1-10` |
| [类型与校验](./type-safety.md) | tsconfig 实况、`any` 边界、不引校验库、相对路径 | `tsconfig.json`、`@types/`、`shared/models/` |
| [质量门](./quality-guidelines.md) | UI 测试、样式隔离自查、宿主共享文档三约束 | `tests/presentation-v2/`（91 文件）、`panel-grid-conventions.test.ts` |

---

## 使用方式

- **动手前**：先看 `components/_lib/` 有没有现成组件；动样式前读「组件规范」的样式铁律（本仓群有样式污染真实事故，规则 L0-10 / L1-MR-3）。
- **新增页面**：`pages/XxxPage.vue` + 在 `router/page-registry.ts` **追加**注册项 + 把文件名加进 `tests/presentation-v2/panel-grid-conventions.test.ts` 的列表。
- **收尾时**：规范条文落 `.trellis/spec/`；页面自包含（内联 file:line），只指向规则条目号与 skill 名，不复制规则正文。

---

**语言**：本仓规范一律**中文**（有意覆盖 Trellis 模板默认的 English only，见规则 L0-15）。

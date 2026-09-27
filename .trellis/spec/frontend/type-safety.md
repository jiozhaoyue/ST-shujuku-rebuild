# 类型与校验

> TypeScript 5.7。**写实况，不写理想**：本仓 `strict` 未开、`any` 用得很广，这一页告诉你边界在哪里。

---

## tsconfig 实况（`source/tsconfig.json`）

| 项 | 值 |
| --- | --- |
| `strict` | **`false`**（未开严格模式） |
| `noImplicitAny` | `true` |
| `target` / `module` | `ES2020` / `ESNext` |
| `moduleResolution` | `bundler` |
| `skipLibCheck` | `true` |
| `include` | `src/**/*.ts`、`src/**/*.js`、`src/**/*.vue`、`@types/**/*.d.ts` |

## `any` 的实况与边界

实测（2026-09-27）：`: any` **1901 处**、`as any` **790 处**、`@ts-ignore` / `@ts-expect-error` 合计 **1 处**。

**这是既成事实，规范不假装它不存在**；但边界是：

- **跨层公共契约必须给类型**：`shared/` 的导出、service 暴露给 UI 的接口、store 的公开 API、gateway / repository 的出入参。
- 新增 `any` 只允许出现在**紧贴宿主 ABI 的桥**里（`shared/host-bridge.ts`、`shared/host-api.ts`），并注释说明为什么（宿主 ABI 未类型化）。
- 业务判断逻辑里不要用 `any` 传值——那会把类型错误推到运行时，而运行时错误只能靠真机发现。

## 运行时校验：不引库

实测 `zod` / `yup` **0 处**。本仓形态是：

- **显式校验函数 + 抛中文 `Error`**：`shared/ddl-utils.ts:249-307`（`hiddenPhysicalColumns 必须是 physical column 字符串数组。`、`row_id 不允许隐藏。`）。
- **结果对象**：`ApplyEditsResult{ success }` 一类（见 `shared/table-storage-provider.ts:14-49`）。

新增校验**不要引校验库**——违背「零外部依赖 + 装完即用」（用户从 Git URL 装扩展，不能要求再跑构建或装依赖）。

## 类型落点

| 类型 | 放哪 |
| --- | --- |
| 就近使用的模块私有类型 | 该模块文件内（`type Variant = …`，见 `components/_lib/AcuButton.vue`） |
| 跨层共享模型 | `src/shared/models/*.ts`（`table-data.ts`、`flight-mode-model.ts`、`agent-worldbook-model.ts`） |
| 宿主 / 全局 / 第三方声明 | `@types/{function,iframe,sql-js,vue-shim}/`（tsconfig 已 include） |
| 公共契约命名 | 允许 `_ACU` 后缀（`RestrictedSqlStatement_ACU`、`AutoFillFloor_ACU`、`AcuHostKind`） |

## 导入路径

**一律用相对路径**。`@shared` / `@data` 等别名只在 `tsconfig.json` 与 `vitest.config.ts` 注册，**`rollup.config.js` 没有注册**，源码里 0 处使用——用别名会让 `npm run build` 失败而 tsc/vitest 通过（最难查的一类断法）。详见核心层目录结构规范。

---

## 反模式

- 在公共签名上把参数/返回值放宽成 `any`。
- 用 `as` 断言掩盖宿主差异（差异应进 `host-bridge` 并用类型守卫收窄）。
- 新增 `@ts-expect-error` 却不写原因。
- 为了让 `tsc` 过而改 `tsconfig.json` 的开关。
- 引校验库来省事。

---

## 验证

```bash
cd source
npx tsc --noEmit -p tsconfig.json
grep -rn "@ts-expect-error\|@ts-ignore" src/ | wc -l   # 期望仍是 1
```

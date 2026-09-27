# 目录结构与分层落点（核心层）

> 适用于**不依赖 DOM** 的核心层：`shared/` / `data/` / `service/`。UI 见 `../frontend/`。
> 本仓是**浏览器扩展**（单文件装进 SillyTavern / Luker / TauriTavern），**没有服务端**。

---

## 仓库两级结构

- **仓库根 = 分发产物**：`index.js`（约 10MB）、`manifest.json`、`sql-wasm.wasm`。
  只由 `npm run build` 生成（`rollup.config.js:118-121` 输出 `dist/extension/`，同文件 `:148` 附近同步回仓库根）——**禁止手改**。
- **`source/` = 工程本体**：`src/` 源码、`tests/` vitest（419 个 `*.test.ts`）、`scripts/` 构建辅助、`docs/TESTING.md` 真机测试清单。

---

## 目录布局与实测依赖方向

| 目录 | 文件数（2026-09-27） | 职责 |
| --- | --- | --- |
| `src/shared/` | 68 | 零 DOM 的工具、常量、数据模型、宿主桥 |
| `src/data/` | 27 | SQLite 引擎、同步桥、仓储、网关、存储适配 |
| `src/service/` | 225 | 业务域（19 个子目录：`ai/ table/ continuation/ plot/ vector/ worldbook/ …`） |
| `src/presentation/` | 43 | 旧 UI（V1 面板 / 弹窗 / theme / triggers） |
| `src/presentation-v2/` | 167 | 现行 UI（Vue 3 SFC + Pinia） |
| `src/entry-extension.ts` | — | 唯一入口（rollup `input`） |

实测 import 计数（`grep -rn` 统计，2026-09-27）：

- `service/ → data/`：**176 处** —— 主方向，正常。
- `data/ → service/`：**0 处**；`service/ → presentation*/`：**0 处** —— 反向依赖当前不存在，**保持它**。
- `presentation/`（旧 UI）`→ data/`：**0 处**。
- `presentation-v2/ → data/`：**8 处，全部落在 `composables/`**（`useDataManagement`、`useAgentWorldbookEntries`、`useContinuationMaterials`、`visualizer/useVisualizerData`、`visualizer/useVisualizerSave`、`stores/content-replace-store`）；`pages/` 与 `components/` 均为 **0 处**。
  → **可执行规则：页面与组件不得直连 `data/`，需要数据时抽 `composables/useXxx.ts`。**
- `shared/ → data/`：**1 处例外** —— `shared/sql-read-resolver.ts:4` 引 `../data/sqlite/schema-mapper` 的 `resolveEffectiveDDL`。属历史遗留，**新代码不要复制**。

---

## 导入路径：一律用相对路径

- **实测（2026-09-27）**：源码里 `from '../…'` 相对导入 **1984 处**；`@shared` / `@data` / `@service` / `@presentation` / `@presentation-v2` **0 处**。
- 别名只在 `tsconfig.json` 的 `paths` 与 `vitest.config.ts` 的 `resolve.alias` 里注册过；**`rollup.config.js` 没有注册别名，也没装 alias 插件**。
- → **规则：新代码一律用相对路径**。想在源码里用 `@xxx` 别名，必须**先在 `rollup.config.js` 补解析**，否则 `npm run build` 会直接解析失败（tsconfig/vitest 过得去、只有构建炸，最难查）。

---

## 落点规则

- **业务逻辑进 `service/<域>/`**，不写进 Vue 组件；组件只做展示与事件转发。
- **宿主 I/O 进 `data/gateways/*-gateway.ts`**（`ai-gateway` / `chat-gateway` / `worldbook-gateway` …），**持久化进 `data/repositories/*-repo.ts`**，两者不混写。
- **跨层纯函数放 `shared/`**，文件首行写职责注释（本仓惯例：`shared/log-buffer.ts:1-6`、`shared/isolation-policy.ts:1-9`）。
- **公开符号后缀 `_ACU`**（`logWarn_ACU`、`getLorebookEntries_ACU`），与宿主符号区分；新代码沿用。
- **命名**：文件名 kebab-case（`chat-message-data-repo.ts`）、Vue 组件 PascalCase（`ApiConfigPanel.vue`）、composable 一律 `useXxx.ts`。

---

## 反模式

- 在 `pages/` / `components/` 里 import `data/**`。
- 把宿主差异判断（`__TAURITAVERN__`、`window.Luker`）散落到业务层 —— 只许进 `shared/host-bridge.ts`（规则 L0-9）。
- `shared/` 反向引用上层（`data/` / `service/`）。
- 手改仓库根产物（`index.js` / `sql-wasm.wasm`）。

---

## 验证

```bash
cd source && npx tsc --noEmit -p tsconfig.json

# 页面/组件不得直连 data（期望无输出）
grep -rn "^import .*from '\(\.\./\)*data/\|^import .*from '@data" \
  src/presentation-v2/pages src/presentation-v2/components
```

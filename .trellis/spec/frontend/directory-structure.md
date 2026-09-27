# 目录结构（UI 层）

> 本仓有**两套 UI 并存**：`presentation/`（旧 V1，43 文件）与 `presentation-v2/`（现行 Vue 3 SFC + Pinia，167 文件）。
> **新功能一律进 `presentation-v2/`**；旧层只做兼容维护。

---

## `src/presentation-v2/` 布局

| 目录 | 内容 |
| --- | --- |
| `App.vue` | 根组件 |
| `bootstrap/` | 挂载与生命周期（`mount.ts`、`host-document.ts`、菜单按钮） |
| `build/` | 构建期支撑（SFC `<style>` 宿主注入等） |
| `components/` | 业务组件（`ApiConfigPanel.vue`、`Sidebar.vue`、`ContinuationChat.vue` …） |
| `components/_lib/` | **自建组件库**：24 个 `AcuXxx.vue` + `useAcuHeightTransition.ts` |
| `composables/` | 41 个 `useXxx.ts`（含 `visualizer/` 子目录） |
| `pages/` | 13 个一级页（`XxxPage.vue`） |
| `router/` | `page-registry.ts`（静态注册表）、`page-types.ts` |
| `stores/` | 15 个 Pinia store（`xxx-store.ts`）+ `persistence.ts` |
| `continuation/` | 续写域的 UI |
| `copy/` | 文案集中管理（如 `dashboard-copy.ts`） |
| `surfaces/` | 挂到宿主界面的表面 |
| `theme/` | 主题与外观注入（`theme-injector.ts`、`appearance-injector.ts`） |

---

## 挂载与生命周期（`bootstrap/mount.ts:1-20`）

- 根容器 id **`#acu-app-v2`**，**物理隔离**于旧 popup（不复用 `#popup`）。
- 首次打开**惰性创建 + mount**；之后打开/关闭**只切 `display`**——根 Vue app 与 Pinia 实例保留。
- 当前页面组件在重开时由 `MainArea` 用 `key` remount。
- 移动端 safe-area / IME 适配集中在 `shared/tt-mobile-surface.ts`，不要散落。

## 路由：不引 vue-router

`router/page-registry.ts` 是**静态注册表**（`markRaw` + `Object.freeze`）：

- **注册项一旦合并进表就不可变；新增页直接追加**。
- 可见性不用隐式判断，用注册项上的 `requiresSqlite` / `featureGate` / `visibleWhen` 表达，由 router store 在取 `visiblePages` 时计算。
- `activePageId` 直接驱动主区的 `<component :is>`；无 URL 路由。
- 新增页面的落点：`pages/XxxPage.vue` + 在 `page-registry.ts` 追一条 + （如需要）`page-types.ts` 的分组。

---

## 命名

| 对象 | 规则 | 例 |
| --- | --- | --- |
| 页面 | `XxxPage.vue` | `ApiPage.vue`、`AdvancedToolsPage.vue` |
| 组件库 | `AcuXxx.vue` | `AcuButton.vue`、`AcuDisclosureGroup.vue` |
| 业务组件 | `Xxx.vue`（PascalCase） | `WorldbookEntryPickerBody.vue` |
| composable | `useXxx.ts` | `useChatChangedListener.ts` |
| store | `xxx-store.ts` | `router-store.ts` |

---

## 反模式

- 往 `presentation/`（旧层）加新功能。
- 在 `pages/` / `components/` 里直接 import `data/**` —— 抽 `composables/useXxx.ts`（核心层规范里有 grep 自查）。
- 改 `page-registry.ts` 里已合并的注册项（应当**追加**）。
- 自建第二个路由/页面可见性机制。
- **UI import 副作用模块**（典型：`presentation/bootstrap/api-registry.ts`）。

### 为什么「UI 不得 import 副作用模块」是硬规则（2026-09-28 实测回归）

`presentation/bootstrap/api-registry.ts` 是**安装全局 API** 的模块——它没有任何业务模块 import，
由入口挂载；它的模块初始化体里会直接改写 `topLevelWindow_ACU.AutoCardUpdaterAPI`。

实测教训：Developer 页的「环境与能力总览」一开始直接 import 该模块读分组索引，把它拽进了
app 依赖图 → `tests/setup/warm-app-graph.ts` 预热 app 图时会执行它 → 它把**测试里被 mock 的**
`topLevelWindow_ACU` 对象上的 `AutoCardUpdaterAPI` 整个替换掉 → 无关用例
（`tests/presentation/bootstrap/init.test.ts` 的 `_notifyTableUpdate` 间谍）连带转红。
**表现极具迷惑性**：报错点与被改的文件毫无关系。

**正确做法**：需要这类「全局安装面」的数据时，让它**把数据挂到宿主全局**（如
`__ACU_API_GROUP_INDEX__` 与 `AutoCardUpdaterAPI` 同处），UI 从全局读——与 UI 读 API 本身同路。
**判据**：动手前 grep 一下「谁 import 它」，若答案里没有业务模块，那就是副作用模块，UI 不许 import。

---

## 验证

```bash
cd source
grep -c "AcuV2Page\[\]" src/presentation-v2/router/page-registry.ts   # 注册表为冻结数组
npx vitest run tests/presentation-v2
```

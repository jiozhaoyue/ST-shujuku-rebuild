# Composable 规范（`presentation-v2/composables/`）

> 41 个 `useXxx.ts` + 4 个纯模块。这里是**页面与 `data/` 层之间唯一的合法通道**（页面/组件禁止直连 `data/**`，见核心层的目录结构规范）。

---

## 什么时候抽 composable

出现下面任一情况就抽，不要写在页面里：

- 需要访问 `data/**`（网关 / 仓储 / 存储）——`useDataManagement`、`useAgentWorldbookEntries`、`useContinuationMaterials` 都是这个用途。
- 需要订阅宿主事件并影响 Vue 状态——`useChatChangedListener`。
- 需要在多个页面/组件间复用同一段有状态逻辑——`useApiPresetManagement`、`useApiPresetStaleness`。
- 纯逻辑但想单独测——可直接放本目录的**非 hook 纯模块**（见下）。

**放纯模块也合规**：本目录既有 `log-error-hints.ts`（纯字符串匹配、不依赖 DOM/Vue，文件头注释明说「方便单测」）、`client-header-presets.ts`、`templateFollowGlobalFlow.ts`、`worldbook-entry-display.ts`。判据是「是否被 UI 复用」，不是「是否用了 Vue API」。

---

## 命名与返回形态

- 文件名与导出函数同名 `useXxx`；**状态类返回对象而非数组**（`return { value, setter }`，见 `useApiEndpointSecuritySettings.ts:23-34`），便于调用方解构时有名字。
- `ref` / `computed` 是本目录的主力形态（`ref(` 出现在 26 个文件、`computed(` 18 个；`watchEffect` 0 个——**别引入 watchEffect 式隐式依赖**）。

---

## 生命周期与订阅：必须成对

范本 `useChatChangedListener.ts:1-17`（文件头把「为什么这么设计」写清楚了，值得照抄结构）：

- 订阅走 `SillyTavern_API_ACU.eventSource`（`shared/host-api.ts` 的引用），**不直接摸宿主全局**。
- **`onBeforeUnmount` 时取消订阅**——订阅不成对会随页面重挂泄漏。
- 有延迟需求就写明理由（该文件延迟 1500ms，因为旧 `init.ts` 的 `CHAT_CHANGED` 回调里还有 1200ms `setTimeout`，要等它完成后再读状态）。
- 需要让**非 Pinia 的页面级 composable** 感知变化时，用**模块级 `ref` 计数器**（`chatChangedTick`）让它们 `watch`，而不是把状态塞进 store。

---

## 与 store 的分工

- **跨页面共享、需要持久化的状态 → Pinia store**（见 `state-management.md`）。
- **只在某页/某组件存在的派生逻辑 → composable**。
- 两者都可读全局设置，但读取侧统一走 `service/settings/settings-readers.ts` 的 reader 函数（例：`allowUnsafeApiEndpointsEnabled_ACU()`），**不要各自去摸 `settings_ACU` 字段**。

---

## 反模式

- composable 里直接 `document.querySelector` 改 DOM（有 ref 就用 ref；确实需要操作宿主文档时走 `bootstrap/host-document.ts`）。
- 订阅宿主事件不取消（`onBeforeUnmount` 缺失）。
- 把「跨页面共享」的状态藏在 composable 的模块级变量里而不进 store（`chatChangedTick` 这种纯计数值是例外，它只做通知不做数据）。
- 页面里又写一遍 composable 已有逻辑。

---

## 验证

```bash
cd source
# 订阅宿主事件的文件应同时出现取消订阅（期望两侧计数接近）
grep -rln "eventSource" src/presentation-v2/composables
grep -rln "onBeforeUnmount\|onUnmounted" src/presentation-v2/composables
npx vitest run tests/presentation-v2
```

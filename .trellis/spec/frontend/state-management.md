# 状态管理（Pinia）

> UI 状态用 **Pinia**（`bootstrap/mount.ts` 里 `createPinia()`，实例在应用生命周期内保留）。
> 15 个 store，命名 `xxx-store.ts`：`api-preset` / `appearance` / `content-replace` / `content-replace-gate` / `continuation` / `dev-options` / `dialog` / `plot-preset` / `root-shell` / `router` / `theme` / `toast` / `ui-mode` / `visualizer`（+ `persistence.ts` 工具）。

---

## 本地态 vs 全局态怎么分

| 状态 | 放哪 | 依据 |
| --- | --- | --- |
| 跨页面共享、需在重开后保留 | Pinia store + 持久化 section | `router-store` 的 `activePageId` |
| 页面内部（抽屉开关、滚动位置） | 组件本地 `ref` | `router-store.ts:1-10` 明确：抽屉/滚动**不在路由层处理、不持久化** |
| 只在某页存在的派生逻辑 | composable | 见 `hook-guidelines.md` |
| 全局设置（`settings_ACU`） | **不是 UI 状态**，只读 | 读取走 `service/settings/settings-readers.ts` 的 reader |

---

## 持久化：单一根 key + section 分节

`stores/persistence.ts:1-13` 是本仓的定规：

- **不复用旧的 `settings_ACU` + `saveSettingsAndNotify_ACU`**；新 UI 状态走独立 key。
- **单一根 key `acu_v2_ui_state`**（常量 `ACU_V2_STORAGE_KEY`，来自 `shared/v2-ui-state`），值是 JSON；各 store 通过 `sectionKey` 用 `readSection` / `writeSection` 读写自己的子节。
- **localStorage 不可用时静默降级到内存**，只 `logWarn_ACU` 一次（`warned` 标志去重）——不得因此抛错或阻断 UI。
- 新增 store 要持久化 → **加一个 section，不要新增 localStorage key**。

## 生命周期

- 根 Vue app 与 Pinia **不随面板开合销毁**；关闭只切 `display`。
- 页面切换由 `MainArea` 用 `key` remount，页面组件因此可以放心用 `onMounted` 做事。
- 宿主侧状态变化（切聊天、swipe）不会自动进 Vue：由 `useChatChangedListener` 在 `CHAT_CHANGED` 后调用各 store 的 **`refreshFromSettings()`** 拉最新值（`useChatChangedListener.ts:1-17`）。**新增依赖 `settings_ACU` / `currentChatFileIdentifier_ACU` 的 store，要实现 `refreshFromSettings()` 并挂进该刷新链**。

## 门控型 store

`content-replace-gate.ts` 是「能力可用性门控」的既有形态（`setContentReplaceEnabledBySettings` / `syncContentReplaceAvailability`），被 `router-store` 用来算页面可见性。新增需要「由设置项 + 运行时条件共同决定是否可用」的功能时，**复用这个形态**，不要在每个页面各写一遍判断。

---

## 反模式

- 新 UI 状态写回旧 `settings_ACU`（会与旧层互相覆盖）。
- 每个 store 自建 localStorage key（绕过 `acu_v2_ui_state`）。
- 把页面内部状态（抽屉开合）持久化——重开时会出现「上灰状态」。
- 直接读 `settings_ACU.foo` 而不走 reader，且不实现 `refreshFromSettings()`（切聊天后页面显示旧值）。
- localStorage 不可用时抛错或中断挂载。

---

## 验证

```bash
cd source
grep -rn "localStorage" src/presentation-v2 | grep -v "stores/persistence.ts"   # 期望：只有极少数既有例外
npx vitest run tests/presentation-v2
```

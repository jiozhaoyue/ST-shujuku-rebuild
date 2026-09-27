# 宿主适配（ST / Luker / TauriTavern）

> **铁律：宿主差异只许进桥**（规则 L0-9）。业务层不得出现 `__TAURITAVERN__`、`window.Luker` 之类的裸判断。

---

## 两个桥文件，分工不同

| 文件 | 承担 | 谁可以 import |
| --- | --- | --- |
| `shared/host-bridge.ts` | **宿主判定与能力探测**（谁是宿主、就绪了没有、版本够不够） | 任意层 |
| `shared/host-api.ts` | **宿主平台 API 引用**（SillyTavern、TavernHelper、jQuery、toastr 的运行时引用与类型） | 任意层（shared 层，文件头注释明说） |

---

## 宿主三态判定

`shared/host-bridge.ts:14-35`：

```ts
export type AcuHostKind = 'tauritavern' | 'luker' | 'sillytavern';
```

- `getAcuHostKind()`（`:21`）顺时针检测：`window.__TAURITAVERN__` → `tauritavern`；`window.Luker?.getContext` → `luker`；否则 `sillytavern`。
- `isAcuTauriRuntime()` / `isAcuLukerRuntime()` 是它的两个薄包装（`:29` / `:34`）——**不要在别处重写这两条探测**。
- 探测不到就按 `sillytavern` 走，即**自动降级为通用 ST**。

## TT 特有：异步就绪与版本门禁

- `getAcuTauriReady()`（`:43`）：TT 是 Tauri 壳 + ST 1.18 前端，`window.APP_READY` **不代表** TT 内部 ABI 就绪，还要等 `__TAURITAVERN__?.ready` 或 `__TAURITAVERN_MAIN_READY__`。
- **`host-bridge.ts:75-76` 的 H1 教训**：宿主判定必须**每轮重估**——TT 的 `__TAURITAVERN__` ABI 可能晚于扩展注入，循环外只读一次会把 `tauri` 固化为 `false`，导致 TT 下跳过 ready 等待。
- 版本门禁：`ACU_REQUIRED_TAURITAVERN_VERSION = '2.3.0'`（`:112`）+ `parseAcuVersionParts` / `compareAcuVersions` / `isAcuTauriVersionOutdated`（`:115-157`）。版本号走宿主文档化 ABI 读取（`:135-141` 用 `__TAURITAVERN__.invoke.safeInvoke('get_client_version')`），**不要读宿主内部字段**（规则 L1-MR-5）。

## 能力不可用时的降级（规则 L0-11）

- 后端/宿主能力不可用时**静默降级或 `console.warn`**，不得阻断插件加载；纯前端路径必须保持全功能。
- 跨宿主插件**禁用 Authority Host Bridge**（逐宿主打补丁、按版本号门禁），只使用其**可移植子集**，并在代码里标注所依赖能力的宿主可用性（规则 L0-12）。
- TT 真机补充：移动端 safe-area / IME 相关适配集中在 `shared/tt-mobile-surface.ts`，不要散落。

## 多实例接管

`shared/runtime-env.ts:108-112`：检测到「历史实例标记但 `#acu-app-v2` 已不在文档中」→ 判定旧实例已卸载，允许本实例接管；检测到另一实例仍在运行 → 跳过初始化并 `console.warn`（提示不要同时装油猴脚本与酒馆插件）。**新增挂载/卸载逻辑时不要绕开这段判定。**

---

## 反模式

- 在 `service/` 或 Vue 组件里直接写 `if (window.__TAURITAVERN__)`。
- 按宿主版本号硬编码分支去补丁宿主内部结构（Host Bridge 式做法）。
- 把宿主差异做成「三份平行实现」——差异应集中为桥里的少量分支 + 上层同一套逻辑。

## 验证

```bash
cd source
# 宿主裸判断只应出现在 host-bridge / runtime-env 等桥与引导文件（期望：其余文件无输出）
grep -rn "__TAURITAVERN__\|window\.Luker" src/service src/data src/shared \
  | grep -v "src/shared/host-bridge.ts"
npx vitest run tests/shared
```

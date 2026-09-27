# 质量门（UI 层）

> 与核心层同一套门槛命令，UI 额外承担**样式隔离**与**宿主界面不被污染**的责任（本仓群有真实事故）。

---

## 门槛命令（全在 `source/` 下）

```bash
cd source
npx tsc --noEmit -p tsconfig.json
npx vitest run                     # 全量；UI 部分在 tests/presentation-v2/ 与 tests/presentation/
npm run build                      # 产物由 SFC 编译进根 index.js
npm run smoke                      # jsdom 加载产物，验 V2 UI 挂载、零运行时错误
```

---

## UI 测试

- 落在 `tests/presentation-v2/`（按域分子目录：`agent/`、`api/`、`basic-config/`、`bootstrap/`、`components/`、`theme/` …）与 `tests/presentation/`。
- 用 **jsdom**（devDep 已装）；断言 DOM 结构与行为，不依赖真实浏览器。
- **UI 验证优先代码化提取**（DOM 结构 / 计算样式 / 布局盒模型），少依赖截图：可重复回归用 Playwright，一次性交互诊断用 chrome-devtools —— 走 `tavern-browser-automation` 与 `fe-ui-inspect` 两个 skill 的既有流程，别自建一套。
- 复杂组件调试先读源码 + 提取计算样式，再考虑截图。

---

## 样式隔离自查（每次动样式都跑）

```bash
cd source
# ① 全局/通配选择器：本仓 CSS 选择器一律顶格写，故按行首判定（期望无输出）
grep -rnE "^(body|:root|\*)[[:space:]]*[,{]" src/presentation-v2 --include="*.vue" --include="*.ts"
# ② 宿主裸类名（期望无输出）
grep -rn "\.menu_button\|\.inline-drawer\|\.text_pole\|\.checkbox_label" \
  src/presentation-v2 --include="*.vue" --include="*.ts"
# ③ 非 scoped 的 <style>（期望 0；本仓 76 个 <style> 全部 scoped）
grep -rn "^<style>" src/presentation-v2 --include="*.vue"
```

判据说明（实测得出，别照搬通用写法）：

- ① 用 `^\s*\*` 会把 JSDoc 注释行 ` *   { … }` 误判成通配选择器（实测假阳性）。本仓样式规则**一律顶格**，所以按行首判定才可靠；**若将来改成缩进写法，这条自查要同步换判据**。
- 通配选择器作为**后代选择器**出现（`.acu-x * {`）时 ① 抓不到 —— 这种形态靠 code review 拦。
- 主题 CSS 不在 `<style>` 块里，而是 `theme/theme-injector.ts` 以字符串拼好注入单一 `<style id="acu-v2-theme">`，作用域 `#acu-app-v2`。

---

## 与宿主共享文档的三条硬约束

1. **高频回调必须 rAF 合帧**（规则 L1-MR-9）：流式/进度类回调直接驱动 DOM 会造成宿主整页卡顿（实测曾累积 14 个 80–107ms 长任务）。
2. **任何 await 都必须能 settle**（规则 L1-MR-7）：DOM 媒体事件、跨源 fetch、渲染/挂载 promise 必须有超时或 destroy 信号兜底，**禁止让渲染 promise 永远 pending**。
3. **Worker terminate 后必须置空引用**（规则 L1-MR-8）：被 terminate 的 Worker 会静默忽略后续 `postMessage`。本仓既有实现见 `service/workers/worker-pool.ts:255` 的 `resetWorkerForTests_ACU()`（terminate 后立刻 `workerInstance = null`），新写 Worker 生命周期照此。

## 零外部依赖（nocdn）

- 不引 CDN 样式/脚本；图标用宿主已有的 Font Awesome。
- 第三方库必须以**本地封装副本**进仓（本仓已有先例：`sql.js` 以 base64 wasm 内联进产物，`rollup.config.js:61-73`），用户装完即可用，**不需要跑构建**。

---

## 真机确认（只有真机能暴露）

按 `source/docs/TESTING.md` 走，其中与 UI 直接相关的：

- 刷新后出现 V2 面板 `#acu-app-v2` 与构建水印 `#acu-build-stamp-badge`；
- 调试面板 host 字段与当前宿主一致（Luker 下应为 `luker`）；
- 移动端（TT）safe-area / IME 布局正常。

**E2E / 自动化只许对 Dev 实例**（8001 / 8003），严禁 8002 / 8004 Real 实例。

---

## 反模式

- 用截图当作唯一证据（看不出计算样式差异，也无法进 CI）。
- 把 `#acu-app-v2` 与旧 `#popup` 混用或复用旧容器。
- 在组件里写非 scoped 样式、或用宿主裸类名。
- 新增 UI 后不更新 `source/docs/TESTING.md` 的真机清单条目。


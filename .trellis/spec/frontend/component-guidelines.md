# 组件规范（presentation-v2）

> Vue 3 **SFC + `<script setup lang="ts">`**。写任何新组件前先看 `components/_lib/` 有没有现成的 —— 那里是自建组件库，重复造按钮/开关/抽屉是本仓最常见的浪费。

---

## 组件库优先（`components/_lib/`）

已具备：`AcuButton` / `AcuInput` / `AcuTextarea` / `AcuSelect` / `AcuToggle` / `AcuCheckbox` / `AcuSegmentedControl` / `AcuDrawer` / `AcuDialogHost` / `AcuPanel` / `AcuPanelGrid` / `AcuDisclosureGroup` / `AcuStatsList` / `AcuPromptSegments` / `AcuBadge` / `AcuFormRow` / `AcuInfoBanner` / `AcuMessage` / `AcuToastViewport` / `AcuPresetDropdown` / `AcuRulePairList` / `AcuIconButton` / `AcuFileButton` / `AcuMobilePanelNav` / `AcuText`。

缺什么 → **先加进 `_lib/` 再使用**，不要在页面里就地造。

---

## 组件文件标准结构（规范范本：`components/_lib/AcuButton.vue`）

```vue
<template>
  <button
    :type="nativeType"
    :disabled="disabled || loading"
    class="acu-btn"
    :class="[`acu-btn--${variant}`, sizeClass, { 'acu-btn--icon-only': iconOnly }]"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type Variant = 'default' | 'primary' | 'danger';
type Size = 'sm' | 'md';

const props = withDefaults(defineProps<{
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
}>(), {
  variant: 'default',
  size: 'md',
  disabled: false,
});

defineEmits<{
  (e: 'click', event: MouseEvent): void;
}>();
</script>

<style scoped>
.acu-btn { background: var(--acu-bg-2); color: var(--acu-text-1); }
</style>
```

要点（照抄这些，别发明新写法）：

- **props 用类型化 `defineProps<{...}>()` + `withDefaults(..., {...})`** 给默认值；不要用运行时对象式 `props: {}` 写法。
- **emits 用类型化 `defineEmits<{ (e: 'x', payload: T): void }>()`**。
- **变体走 class 修饰符**：`acu-<block>--<variant>` / 元素 `acu-<block>__<element>`（BEM 变体），不要用行内 style 切样式。
- **优先原生元素**（`<button>`、`<input>`），不要用 `<div>` 造按钮。

---

## 样式铁律（规则 L0-10 / L1-MR-3）

- **只写 `<style scoped>`**，类名一律 `acu-` 前缀。
- **禁止**：`*`、`body`、`:root`、以及宿主裸类名（`.menu_button`、`.inline-drawer`、`.text_pole`、`.checkbox_label` 等）。**本仓 `presentation-v2/` 实测为 0 处（2026-09-27）——保持它。**
- **配色只消费语义 token**：`var(--acu-bg-2)`、`var(--acu-text-1)`、`var(--acu-radius-sm)`、`var(--acu-space-150, 6px)`…（token 名与映射见 `theme/theme-types.ts` 的 `TOKEN_VAR_MAP`）。不要硬编码颜色值。
- **零外部依赖**：不引 CDN、不引 Tailwind 或其它 CSS 框架（规则：`nocdn`）；图标用宿主已有的 Font Awesome（如 `fa-solid fa-spinner`）。

## 主题注入的位置（改样式作用域前必读）

`theme/theme-injector.ts:1-13`：

- 单一 `<style id="acu-v2-theme">`；**切主题 = 替换 `textContent`**，不增删节点。
- 作用域是 `#acu-app-v2`（`APP_ROOT_ID`），与旧主题节点物理隔离。
- 文件里刻意**不用通配后代选择器**——那个选择器会让每次 UI 状态变化都扩大样式重算，移动 WebView 上尤其贵（源码注释原话）。

---

## 页面骨架：分栏必须用 `AcuPanelGrid`（有机械化用例钉住）

`tests/presentation-v2/panel-grid-conventions.test.ts` 逐条断言 11 个功能页：

- 页面必须含 **`AcuPanelGrid`**（统一左右分栏骨架）；
- 单主面板页（如 `ApiPage.vue`）要保留右列空占位 `aria-hidden="true"`；
- 页面样式**不得手写加权 `fr` 分栏**（正则禁 `grid-template-columns: … 1.4fr / 2fr…`）。

→ **新增功能页必须同时把文件名加进该用例的 `panelGridPages` 列表**，否则这套约定会漏掉新页。

## 无障碍

- 交互元素用**原生标签**（`button` / `input` / `select`）以获得键盘与读屏默认行为。
- 图标按钮必须传 `title`（`AcuIconButton` / `AcuButton` 已有 `title` prop）。
- 弹层用 `AcuDialogHost` / `AcuDrawer`，不要自造浮层（规则 L1-MR-4：复杂 UI 用宿主官方 popup / 组件）。

---

## 反模式

- 在页面里复制一段已在 `_lib/` 存在的按钮/开关实现。
- 用 `<div @click>` 造按钮。
- 写全局选择器或宿主题类名（**会污染整个酒馆 UI**，是本仓群有真实事故的坑）。
- 硬编码十六进制颜色、写死字号绕过 token。
- 在 `<style>` 非 scoped 块里写业务样式。

---

## 验证

```bash
cd source
# ① 全局/通配选择器（本仓规则顶格写，故按行首判定；期望无输出）
grep -rnE "^(body|:root|\*)[[:space:]]*[,{]" src/presentation-v2 --include="*.vue" --include="*.ts"
# ② 宿主裸类名（期望无输出）
grep -rn "\.menu_button\|\.inline-drawer\|\.text_pole\|\.checkbox_label" \
  src/presentation-v2 --include="*.vue" --include="*.ts"
npx vitest run tests/presentation-v2
```

> 别用 `^\s*\*` 之类带前导空白的判据：JSDoc 注释行 ` *   { … }` 会被误判成通配选择器（实测假阳性）。

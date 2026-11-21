/**
 * theme-injector — 把 theme tokens 翻成 CSS 文本注入 host document（D14）
 *
 * - 单一 <style id="acu-v2-theme">；切主题 = 替换 textContent，不增删节点
 * - 作用域 #acu-app-v2，与旧主题节点物理隔离
 * - 面板外的宿主浮层（插件提示框、确认框、正文替换遮罩/对话框）挂 HOST_SURFACE_CLASS，
 *   同样拿到主题 token：它们挂在酒馆页面上，不在面板根节点之内
 * - 同时把 colorScheme 写到根容器的 style.colorScheme，让浏览器原生表单跟随
 */
import type { AcuV2Theme } from './theme-types';
import { TOKEN_VAR_MAP } from './theme-types';
import { isClaudeStyleTheme_ACU } from './effective-theme';
import { getAcuHostDocument } from '../bootstrap/host-document';
import { ACU_HOST_SURFACE_CLASS_ACU } from '../../shared/constants';

/**
 * 宿主主题变量继承映射（D-02「配色继承宿主变量」）。
 *
 * 只收录酒馆官方已确证的 5 个 --SmartTheme* 变量作为锚点（见 public/style.css 用法）：
 *   --SmartThemeChatTintColor → 聊天区底色（bg0）
 *   --SmartThemeBlurTintColor → 面板 / 蒙层底色（sidebarBg）
 *   --SmartThemeBodyColor     → 正文文字色（text1）
 *   --SmartThemeEmColor       → 强调文字色（text2 / accent）
 *   --SmartThemeBorderColor   → 描边色（border / border2）
 *
 * 关键口径（红队修复）：不能只让部分 token 跨主题继承。若 text1 跟随宿主正文色、
 * 而 bg1 仍用 acu 卡底，宿主深色（正文浅字）+ acu 浅色卡底（白）就会白字落白底。
 * 因此所有前景 / 背景 token 都锚定同一组宿主变量，层级用 color-mix 派生：
 *   · 卡片底 bg1/bg2 从宿主底色朝宿主正文色偏移，明暗永远与宿主同源；
 *   · 辅助文字 text3 由宿主正文色降透明度得出；
 *   · 强调色 accent 锚定宿主强调文字色，按钮文字 onAccent 取宿主页面底色，二者天然对比；
 *   · 两级边框 border/border2 用同一宿主变量的不同混合比例，宿主有值时仍保持强度差。
 * 字体 / 圆角 / 阴影 / 状态色无宿主对应语义，保持 acu 原值。
 */
const HOST_BG = '--SmartThemeChatTintColor';
const HOST_PANEL = '--SmartThemeBlurTintColor';
const HOST_TEXT = '--SmartThemeBodyColor';
const HOST_TEXT_EM = '--SmartThemeEmColor';
const HOST_BORDER = '--SmartThemeBorderColor';

/** 有宿主直接语义映射的 token：注入值 = var(--SmartThemeX, acu 原值)。 */
const DIRECT_HOST_VAR: Partial<Record<keyof typeof TOKEN_VAR_MAP, string>> = {
  bg0: HOST_BG,
  sidebarBg: HOST_PANEL,
  text1: HOST_TEXT,
  text2: HOST_TEXT_EM,
};

export const THEME_STYLE_NODE_ID = 'acu-v2-theme';
export const APP_ROOT_ID = 'acu-app-v2';
export const HOST_SURFACE_CLASS = ACU_HOST_SURFACE_CLASS_ACU;

/**
 * 派生映射：值锚定同一组宿主变量，用 color-mix 生成层级，避免跨主题明暗混搭。
 * 宿主变量缺失时 var() 回退到 acu 原值，color-mix 再基于该原值派生，故整条链
 * 在宿主有值 / 无值两种情况下都保持同源明暗。
 */
function derivedHostValue(
  key: keyof typeof TOKEN_VAR_MAP,
  tokens: AcuV2Theme['tokens'],
): string {
  const anchor = (k: keyof AcuV2Theme['tokens']): string => `var(${HOST_VAR_BY_TOKEN[k]}, ${tokens[k]})`;
  const pageBg = anchor('bg0');
  const panelBg = anchor('sidebarBg');
  const text = anchor('text1');
  const textEm = anchor('text2');
  switch (key) {
    // 卡底：宿主页面底色朝宿主正文色偏移 5%，明暗与宿主同源，不会白底配浅字
    case 'bg1': return `color-mix(in srgb, ${pageBg} 95%, ${text})`;
    case 'bg2': return `color-mix(in srgb, ${panelBg} 90%, ${text})`;
    // 三级文字：宿主正文色降透明度，天然同明暗体系
    case 'text3': return `color-mix(in srgb, ${text} 62%, transparent)`;
    // 强调色锚定宿主强调文字色；按钮文字取宿主页面底色，二者明暗相反天然可读
    case 'accent': return textEm;
    case 'onAccent': return pageBg;
    // 两级边框：同一宿主变量不同混合比例（12% / 20%），宿主有值时仍保持强度差（G-18）。
    // 无宿主变量时回退到 acu 正文色再淡化，避免直接沿用已经带 alpha 的 acu border 原值造成二次淡化。
    case 'border': return `color-mix(in srgb, var(${HOST_BORDER}, ${tokens.text1}) 12%, transparent)`;
    case 'border2': return `color-mix(in srgb, var(${HOST_BORDER}, ${tokens.text1}) 20%, transparent)`;
    default: return tokens[key];
  }
}

/** token key → 其锚定的宿主变量（含直接映射与派生项）。 */
const HOST_VAR_BY_TOKEN: Partial<Record<keyof AcuV2Theme['tokens'], string>> = {
  bg0: HOST_BG,
  bg1: HOST_BG,
  bg2: HOST_PANEL,
  sidebarBg: HOST_PANEL,
  text1: HOST_TEXT,
  text2: HOST_TEXT_EM,
  text3: HOST_TEXT,
  accent: HOST_TEXT_EM,
  onAccent: HOST_BG,
};

export function buildThemeCss(theme: AcuV2Theme): string {
  // Claude 风格是刻意独立的自带配色（陶土 accent + 四层表面阶梯），
  // 不能被宿主 --SmartTheme* 覆盖，否则其设计语言与对比度被破坏。
  const inheritHost = !isClaudeStyleTheme_ACU(theme);
  const lines: string[] = [];
  const keys = Object.keys(TOKEN_VAR_MAP) as Array<keyof typeof TOKEN_VAR_MAP>;
  for (const key of keys) {
    const fallback = theme.tokens[key];
    const directVar = inheritHost ? DIRECT_HOST_VAR[key] : undefined;
    const value = directVar
      ? `var(${directVar}, ${fallback})`
      : inheritHost
        ? derivedHostValue(key, theme.tokens)
        : fallback;
    lines.push(`  ${TOKEN_VAR_MAP[key]}: ${value};`);
  }
  // CSS custom properties inherit from the app root. Avoid a universal
  // descendant selector here; it expands style recalculation on every UI
  // state change and is especially expensive on mobile WebViews.
  return `#${APP_ROOT_ID},
.${HOST_SURFACE_CLASS} {
${lines.join('\n')}
}

.${HOST_SURFACE_CLASS} {
  color-scheme: ${theme.colorScheme};
}

#${APP_ROOT_ID} {
  scrollbar-color: color-mix(in srgb, var(--acu-text-3) 55%, transparent) transparent;
  scrollbar-width: thin;
}

#${APP_ROOT_ID} ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

#${APP_ROOT_ID} ::-webkit-scrollbar-track {
  background: transparent;
}

#${APP_ROOT_ID} ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--acu-text-3) 42%, transparent);
  background-clip: content-box;
  border: 2px solid transparent;
  border-radius: 999px;
}

#${APP_ROOT_ID} ::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--acu-accent) 62%, var(--acu-text-3));
  background-clip: content-box;
}

#${APP_ROOT_ID} ::-webkit-scrollbar-corner {
  background: transparent;
}

#${APP_ROOT_ID} :is(.acu-input, .acu-textarea)::placeholder {
  color: var(--acu-text-3) !important;
  -webkit-text-fill-color: var(--acu-text-3) !important;
  opacity: 1 !important;
}

/* Keep Font Awesome icons tied to v2 component colors despite host CSS injection. */
#${APP_ROOT_ID} :is(.fa, .fas, .far, .fab, .fa-solid, .fa-regular, .fa-brands, [class^="fa-"], [class*=" fa-"]) {
  color: var(--acu-icon-color, currentColor) !important;
}
`;
}

export function applyTheme(theme: AcuV2Theme): void {
  const doc = getAcuHostDocument();
  let style = doc.getElementById(THEME_STYLE_NODE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = THEME_STYLE_NODE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = buildThemeCss(theme);

  const root = doc.getElementById(APP_ROOT_ID);
  if (root) {
    root.style.colorScheme = theme.colorScheme;
  }
}

/** 仅供测试：清掉注入的样式节点。 */
export function __resetThemeInjectorForTests(): void {
  const doc = getAcuHostDocument();
  doc.getElementById(THEME_STYLE_NODE_ID)?.remove();
}

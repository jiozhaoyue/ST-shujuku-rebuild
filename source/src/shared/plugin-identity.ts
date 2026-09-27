/**
 * shared/plugin-identity.ts — 插件自身的身份事实（构建戳 / 版本号）
 *
 * 由构建期的 rollup replace 注入到全局（源码里没有字面量），因此任何想展示或上报
 * 「这份产物是什么」的地方都必须走这里，而不是各自读全局、各自写一遍兜底。
 * 目前的使用方：Debug 面板导出、Developer 页「环境与能力总览」。
 *
 * 读不到时不猜：分别回退 `dev` / `unknown`，让「这不是正式构建」这件事在界面上是可见的。
 */

/** 构建戳（rollup 注入 `__ACU_BUILD_STAMP__`，形如 `20260927-15`）；读不到返回 `dev`。 */
export function getBuildStamp_ACU(): string {
  try {
    const stamp = (globalThis as any).__ACU_BUILD_STAMP__;
    return typeof stamp === 'string' && stamp ? stamp : 'dev';
  } catch {
    return 'dev';
  }
}

/** 插件版本（rollup 注入 `__ACU_BUILD_VERSION__`）；读不到返回 `unknown`。 */
export function getPluginVersion_ACU(): string {
  try {
    const v = (globalThis as any).__ACU_BUILD_VERSION__;
    return typeof v === 'string' && v ? v : 'unknown';
  } catch {
    return 'unknown';
  }
}

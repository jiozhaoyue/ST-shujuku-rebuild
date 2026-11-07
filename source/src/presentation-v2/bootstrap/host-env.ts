import { getAcuHostWindow } from './host-document';

export type AcuTimerHandle = number;

export function acuSetTimeout(callback: () => void, delayMs: number): AcuTimerHandle {
  return getAcuHostWindow().setTimeout(callback, delayMs);
}

export function acuClearTimeout(handle: AcuTimerHandle | null | undefined): void {
  if (handle === null || handle === undefined) return;
  getAcuHostWindow().clearTimeout(handle);
}

export function acuSetInterval(callback: () => void, delayMs: number): AcuTimerHandle {
  return getAcuHostWindow().setInterval(callback, delayMs);
}

export function acuClearInterval(handle: AcuTimerHandle | null | undefined): void {
  if (handle === null || handle === undefined) return;
  getAcuHostWindow().clearInterval(handle);
}

export function acuRequestAnimationFrame(callback: FrameRequestCallback): AcuTimerHandle {
  const win = getAcuHostWindow();
  if (typeof win.requestAnimationFrame === 'function') {
    return win.requestAnimationFrame(callback);
  }
  return win.setTimeout(() => callback(Date.now()), 16);
}

export function acuCancelAnimationFrame(handle: AcuTimerHandle | null | undefined): void {
  if (handle === null || handle === undefined) return;
  const win = getAcuHostWindow();
  if (typeof win.cancelAnimationFrame === 'function') {
    win.cancelAnimationFrame(handle);
    return;
  }
  win.clearTimeout(handle);
}

// 我方差量依赖（2026-11-07 上游追平恢复）：v2 组件层 _lib 套件（AcuPanel/AcuDisclosureGroup 等，
// 我方四面板与 SQL 控制台相关组件仍在用）需要这两个宿主安全封装；上游新版界面不再使用故删。
export function acuGetComputedStyle(el: Element): CSSStyleDeclaration {
  return (el.ownerDocument.defaultView ?? getAcuHostWindow()).getComputedStyle(el);
}

export function acuMatchesMedia(query: string): boolean {
  const win = getAcuHostWindow();
  return typeof win.matchMedia === 'function' && win.matchMedia(query).matches;
}

/**
 * presentation-v2/composables/clipboard.ts — 复制文本到剪贴板（唯一实现）
 *
 * 为什么抽出来：本仓有不止一处「把一段排查文本复制出去给用户/给 AI」的需求
 * （提示词检查器的排查报告、Developer 页的能力总览）。复制在酒馆宿主里并不总是可用，
 * 所以两份实现必然会各自演化出不同的降级口径 —— 统一在这里，调用方只处理返回值。
 *
 * 特性检测 + 静默降级（本仓插件纪律）：宿主可能跑在无权限/无 clipboard API 的 iframe 里，
 * 此时退回临时 textarea + execCommand；两条路都失败返回 false，由调用方提示改用导出文件。
 * **绝不抛错打断面板。**
 */
import { getAcuHostDocument } from '../bootstrap/host-document';

export async function copyTextToClipboard_ACU(text: string): Promise<boolean> {
  try {
    const clipboard = (globalThis as any)?.navigator?.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text);
      return true;
    }
  } catch { /* 降级到 execCommand */ }
  try {
    const doc = getAcuHostDocument();
    const textarea = doc.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    doc.body.appendChild(textarea);
    textarea.select();
    const ok = typeof (doc as any).execCommand === 'function' && (doc as any).execCommand('copy') === true;
    doc.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

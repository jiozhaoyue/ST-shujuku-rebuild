/**
 * useDiagnosticBundle — Developer 页「一键诊断包」的数据接缝
 *
 * 本仓 v2 分层：components / pages 不直接 import service，一律走 composable
 * （与 usePromptInspection / useWritePipeline 同形）。下载与剪贴板在这里做，
 * service 层（service/diagnostics/diagnostic-bundle）保持纯数据、可单测。
 */
import { buildDiagnosticBundle_ACU, formatDiagnosticBundleText_ACU } from '../../service/diagnostics/diagnostic-bundle';
import { maskSensitiveText_ACU } from '../../shared/log-buffer';
import { getAcuHostDocument } from '../bootstrap/host-document';
import { useToastStore } from '../stores/toast-store';
import { copyTextToClipboard_ACU as copyTextToClipboard } from './clipboard';

const EXPORT_FILENAME_PREFIX_ACU = 'acu-diagnostic-bundle';

function downloadTextFile_ACU(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const doc = getAcuHostDocument();
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  doc.body.appendChild(anchor);
  anchor.click();
  doc.body.removeChild(anchor);
  // 延迟 revoke：WebView2/部分内核在 click 后立即 revoke 会取消下载
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStamp_ACU(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function useDiagnosticBundle() {
  const toast = useToastStore();

  /** 导出诊断包 JSON（整体过一次脱敏兜底，与「复制总览给 AI」同路）。 */
  function exportJson(): void {
    const json = maskSensitiveText_ACU(JSON.stringify(buildDiagnosticBundle_ACU(), null, 2));
    downloadTextFile_ACU(`${EXPORT_FILENAME_PREFIX_ACU}-${fileStamp_ACU()}.json`, json);
    toast.success('已导出诊断包 JSON（已脱敏）。');
  }

  /** 复制诊断包文本（Markdown 分节、脱敏），可直接贴进酒馆给 AI。 */
  async function copyText(): Promise<void> {
    const ok = await copyTextToClipboard(formatDiagnosticBundleText_ACU(buildDiagnosticBundle_ACU()));
    if (ok) toast.success('已复制诊断包文本（已脱敏），可直接贴进聊天让 AI 排查。');
    else toast.warning('复制失败（宿主未开放剪贴板）。可改用「导出诊断包 JSON」。');
  }

  return { exportJson, copyText };
}

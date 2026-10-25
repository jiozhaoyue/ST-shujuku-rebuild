/**
 * download — 「下载 JSON 文件」的共享出口（presentation 层 DOM 助手）
 *
 * 之前这份实现逐字复制在 usePromptInspection / useWritePipeline / useDiagnosticBundle
 * 三处（2026-10-26 抽取）。行为契约：
 * - 用宿主文档（getAcuHostDocument）而非裸 document，兼容 TT/嵌入 iframe 场景；
 * - **延迟 revoke**（1s）：WebView2/部分内核在 click 后立即 revoke 会取消下载 —— 别「优化」掉。
 */
import { getAcuHostDocument } from '../bootstrap/host-document';

export function downloadTextFile_ACU(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const doc = getAcuHostDocument();
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  doc.body.appendChild(anchor);
  anchor.click();
  doc.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

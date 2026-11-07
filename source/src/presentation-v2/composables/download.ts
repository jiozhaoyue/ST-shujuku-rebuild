/**
 * download — 「下载文本文件」的共享出口（presentation 层助手的兼容薄壳）
 *
 * 历史包袱：2026-10-26 从 usePromptInspection / useWritePipeline / useDiagnosticBundle
 * 三处逐字副本抽出时建了独立实现；R10A-13 / R10B-18 约定全界面只保留
 * bootstrap/host-download.ts 一份 createObjectURL 实现，2026-11-07 追平后本文件
 * 降级为对统一入口的委托（保留旧导出名，调用方无需改）。
 * 行为契约不变：宿主文档挂载、延迟 revoke（委托实现内 1s）。
 */
import { downloadTextToHost_ACU } from '../bootstrap/host-download';

export function downloadTextFile_ACU(filename: string, text: string, mime = 'application/json'): void {
  downloadTextToHost_ACU(filename, text, mime);
}

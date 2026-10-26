/**
 * oversized-write-warning.ts — 超大字段写入软警告（只警告、不拦截）
 *
 * 为什么需要：checkpoint 的体积阈值已被显式废除（storage-frame-v2-persist 里全是
 * MAX_SAFE_INTEGER），唯一的 2 MiB 上限只用于截断观测日志。于是单个超大单元格可以
 * 直接写进聊天消息字段，把存档与存储配额撑大，且写入前没有任何提示。
 *
 * 本模块只做三件事：测量本次写库增量、与阈值比较、发一次性警告。
 * 它**不改写入结果、不截断、不抛错**；关闭开关时连测量都不做。
 */

import { logWarn_ACU } from '../../shared/utils';
import {
  OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU,
  OVERSIZED_CELL_WARN_CHARS_MAX_ACU,
  OVERSIZED_CELL_WARN_CHARS_MIN_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_MAX_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_MIN_ACU,
  OVERSIZED_WRITE_WARNING_ENABLED_DEFAULT_ACU,
} from '../../shared/defaults';
import { settings_ACU } from '../runtime/state-manager';
import type { Sheet_ACU, TableDataObject_ACU } from '../../shared/models/table-data';

// 默认值与边界统一定义在 shared/defaults.ts（单一注册表），这里原样转出，
// 便于调用方与测试从同一处取口径。
export {
  OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU,
  OVERSIZED_CELL_WARN_CHARS_MAX_ACU,
  OVERSIZED_CELL_WARN_CHARS_MIN_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_MAX_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_MIN_ACU,
  OVERSIZED_WRITE_WARNING_ENABLED_DEFAULT_ACU,
};

export const OVERSIZED_WRITE_RECENT_LIMIT_ACU = 10;

export interface OversizedWriteSettings_ACU {
  enabled: boolean;
  cellChars: number;
  payloadBytes: number;
}

export interface OversizedCellMeasurement_ACU {
  chars: number;
  sheetKey: string;
  rowIndex: number;
  columnIndex: number;
}

export interface OversizedWriteMetrics_ACU {
  maxCell?: OversizedCellMeasurement_ACU;
  payloadBytes: number;
}

export type OversizedWriteWarningKind_ACU = 'cell' | 'payload';

export interface OversizedWriteWarning_ACU {
  kind: OversizedWriteWarningKind_ACU;
  /** 实测值：cell 为字符数，payload 为 UTF-8 字节数。 */
  value: number;
  threshold: number;
  unit: 'chars' | 'bytes';
  at: number;
  sheetKey?: string;
  rowIndex?: number;
  columnIndex?: number;
}

export interface OversizedWriteProbeInput_ACU {
  tableData?: TableDataObject_ACU | null;
  /** 本次写入的目标表键；null/空表示全表。 */
  sheetKeys?: string[] | null;
  /** 本次提交的操作载荷。 */
  operations?: unknown[] | null;
  chatKey?: string;
  isolationKey?: string;
}

function normalizeFloorInt_ACU(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

export function normalizeOversizedWriteSettings_ACU(raw?: {
  enabled?: unknown;
  cellChars?: unknown;
  payloadBytes?: unknown;
}): OversizedWriteSettings_ACU {
  return {
    enabled: typeof raw?.enabled === 'boolean'
      ? raw.enabled
      : OVERSIZED_WRITE_WARNING_ENABLED_DEFAULT_ACU,
    cellChars: normalizeFloorInt_ACU(
      raw?.cellChars,
      OVERSIZED_CELL_WARN_CHARS_MIN_ACU,
      OVERSIZED_CELL_WARN_CHARS_MAX_ACU,
      OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU,
    ),
    payloadBytes: normalizeFloorInt_ACU(
      raw?.payloadBytes,
      OVERSIZED_PAYLOAD_WARN_BYTES_MIN_ACU,
      OVERSIZED_PAYLOAD_WARN_BYTES_MAX_ACU,
      OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU,
    ),
  };
}

/** 读取当前设置；settings 尚未就绪或测试未提供时回落默认值。 */
export function resolveOversizedWriteSettings_ACU(): OversizedWriteSettings_ACU {
  const source = settings_ACU as unknown as Record<string, unknown> | undefined;
  return normalizeOversizedWriteSettings_ACU({
    enabled: source?.oversizedWriteWarningEnabled,
    cellChars: source?.oversizedCellWarnChars,
    payloadBytes: source?.oversizedWriteWarnBytes,
  });
}

function utf8ByteLength_ACU(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return 0;
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
    return json.length;
  } catch {
    return 0;
  }
}

function resolveSheetKeys_ACU(tableData: TableDataObject_ACU, sheetKeys?: string[] | null): string[] {
  if (Array.isArray(sheetKeys) && sheetKeys.length > 0) return sheetKeys;
  return Object.keys(tableData).filter((key) => key.startsWith('sheet_'));
}

/**
 * 测量本次写入的增量：最长单元格（跳过表头行、只算字符串）与载荷字节数。
 * 只扫本次写入命中的表，不做全库扫描。
 */
export function measureOversizedWrite_ACU(input: OversizedWriteProbeInput_ACU): OversizedWriteMetrics_ACU {
  let maxCell: OversizedCellMeasurement_ACU | undefined;
  const tableData = input.tableData;
  if (tableData && typeof tableData === 'object') {
    for (const sheetKey of resolveSheetKeys_ACU(tableData, input.sheetKeys)) {
      const sheet = (tableData as Record<string, unknown>)[sheetKey] as Sheet_ACU | undefined;
      const rows = sheet?.content;
      if (!Array.isArray(rows)) continue;
      // 第 0 行是表头（模板作者写的固定文本），不是本次写入的风险源。
      for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        if (!Array.isArray(row)) continue;
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
          const cell = row[columnIndex];
          if (typeof cell !== 'string') continue;
          if (maxCell && cell.length <= maxCell.chars) continue;
          maxCell = { chars: cell.length, sheetKey, rowIndex, columnIndex };
        }
      }
    }
  }
  return {
    maxCell,
    payloadBytes: Array.isArray(input.operations) && input.operations.length > 0
      ? utf8ByteLength_ACU(input.operations)
      : 0,
  };
}

export function evaluateOversizedWriteWarnings_ACU(
  metrics: OversizedWriteMetrics_ACU,
  settings: OversizedWriteSettings_ACU,
  now: number = Date.now(),
): OversizedWriteWarning_ACU[] {
  if (!settings.enabled) return [];
  const warnings: OversizedWriteWarning_ACU[] = [];
  if (metrics.maxCell && metrics.maxCell.chars >= settings.cellChars) {
    warnings.push({
      kind: 'cell',
      value: metrics.maxCell.chars,
      threshold: settings.cellChars,
      unit: 'chars',
      at: now,
      sheetKey: metrics.maxCell.sheetKey,
      rowIndex: metrics.maxCell.rowIndex,
      columnIndex: metrics.maxCell.columnIndex,
    });
  }
  if (metrics.payloadBytes >= settings.payloadBytes) {
    warnings.push({
      kind: 'payload',
      value: metrics.payloadBytes,
      threshold: settings.payloadBytes,
      unit: 'bytes',
      at: now,
    });
  }
  return warnings;
}

// ─── 去重：同聊天同维度同数量级只提示一次；回落后重置 ───
interface DedupEntry_ACU {
  cell?: number;
  payload?: number;
}
const dedupState_ACU = new Map<string, DedupEntry_ACU>();

function scopeKeyOf_ACU(input: OversizedWriteProbeInput_ACU): string {
  return `${input.chatKey || ''}|${input.isolationKey || ''}`;
}

function bandOf_ACU(value: number, threshold: number): number {
  if (value < threshold || threshold <= 0) return -1;
  return Math.floor(Math.log2(value / threshold));
}

function updateDedupAndFilter_ACU(
  metrics: OversizedWriteMetrics_ACU,
  warnings: OversizedWriteWarning_ACU[],
  scopeKey: string,
  settings: OversizedWriteSettings_ACU,
): OversizedWriteWarning_ACU[] {
  const entry = dedupState_ACU.get(scopeKey) ?? {};
  if ((metrics.maxCell?.chars ?? 0) < settings.cellChars) delete entry.cell;
  if (metrics.payloadBytes < settings.payloadBytes) delete entry.payload;

  const fresh: OversizedWriteWarning_ACU[] = [];
  for (const warning of warnings) {
    const band = bandOf_ACU(warning.value, warning.threshold);
    if (band < 0) continue;
    const previous = warning.kind === 'cell' ? entry.cell : entry.payload;
    // 同一档或更低（数值缩小但仍超阈值）不再重复提示；涨一个数量级才再提示一次。
    if (previous !== undefined && band <= previous) continue;
    if (warning.kind === 'cell') entry.cell = band;
    else entry.payload = band;
    fresh.push(warning);
  }
  dedupState_ACU.set(scopeKey, entry);
  return fresh;
}

// ─── 出口：结构化日志 + 最近记录 + 订阅者（presentation 注册 toast） ───
const recentWarnings_ACU: OversizedWriteWarning_ACU[] = [];
type Sink_ACU = (warnings: OversizedWriteWarning_ACU[]) => void;
let sink_ACU: Sink_ACU | null = null;

export function registerOversizedWriteWarningSink_ACU(sink: Sink_ACU): () => void {
  sink_ACU = sink;
  return () => {
    if (sink_ACU === sink) sink_ACU = null;
  };
}

function recordAndEmit_ACU(warnings: OversizedWriteWarning_ACU[]): void {
  if (warnings.length === 0) return;
  for (const warning of warnings) {
    recentWarnings_ACU.push(warning);
    try {
      logWarn_ACU(`[数据体积] ${JSON.stringify({
        kind: warning.kind,
        value: warning.value,
        threshold: warning.threshold,
        unit: warning.unit,
        sheetKey: warning.sheetKey,
        rowIndex: warning.rowIndex,
        columnIndex: warning.columnIndex,
      })}`);
    } catch { /* 日志失败不影响主流程 */ }
  }
  while (recentWarnings_ACU.length > OVERSIZED_WRITE_RECENT_LIMIT_ACU) recentWarnings_ACU.shift();
  try {
    sink_ACU?.(warnings);
  } catch { /* 通知失败不影响主流程 */ }
}

/**
 * 唯一探针入口：设置关闭时直接返回（连测量都不做），任何异常都吞掉。
 * 调用方不得依赖它的返回值——它永远返回 void。
 */
export function probeOversizedWrite_ACU(input: OversizedWriteProbeInput_ACU): void {
  try {
    const settings = resolveOversizedWriteSettings_ACU();
    if (!settings.enabled) return;
    const metrics = measureOversizedWrite_ACU(input);
    const warnings = evaluateOversizedWriteWarnings_ACU(metrics, settings);
    const fresh = updateDedupAndFilter_ACU(metrics, warnings, scopeKeyOf_ACU(input), settings);
    recordAndEmit_ACU(fresh);
  } catch { /* 探针绝不影响主流程 */ }
}

export function getRecentOversizedWriteWarnings_ACU(): OversizedWriteWarning_ACU[] {
  return recentWarnings_ACU.map((warning) => ({ ...warning }));
}

function formatBytesForUser_ACU(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * 用户可见文案：说明「多大 / 会怎样 / 去哪里调」，并明确「数据已正常写入、不会被拦截」。
 */
export function formatOversizedWriteWarningsText_ACU(warnings: OversizedWriteWarning_ACU[]): string {
  const parts: string[] = [];
  const cell = warnings.find((warning) => warning.kind === 'cell');
  const payload = warnings.find((warning) => warning.kind === 'payload');
  if (cell) parts.push(`有一个单元格长达 ${cell.value} 字符（阈值 ${cell.threshold}）`);
  if (payload) {
    parts.push(`这次写入约 ${formatBytesForUser_ACU(payload.value)}（阈值 ${formatBytesForUser_ACU(payload.threshold)}）`);
  }
  return `数据体积提示：${parts.join('；')}。数据已正常写入、不会被拦截；`
    + '可在「数据管理 → 写入体积提示」调整阈值或关闭本提示。';
}

/** 仅测试使用：清空去重表、最近记录与订阅者。 */
export function resetOversizedWriteWarningStateForTests_ACU(): void {
  dedupState_ACU.clear();
  recentWarnings_ACU.length = 0;
  sink_ACU = null;
}

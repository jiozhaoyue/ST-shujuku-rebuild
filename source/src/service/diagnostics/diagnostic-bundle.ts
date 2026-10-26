/**
 * service/diagnostics/diagnostic-bundle.ts — 一键诊断包（聚合既有脱敏出口）
 *
 * 目的：排查问题时用户不必在四个面板（环境与能力总览 / 提示词检查器 / 写库流水 /
 * 历史楼层回放）里逐个导出再手工拼装 —— 一个入口把**全部观测面**收进一份产物，
 * 可下载为 JSON、可复制为文本，直接贴给 AI。
 *
 * 设计约束：
 * - **纯聚合，不新增事实源**：每一节都转调既有单一事实源（观察器导出、自检快照、
 *   帧回放只读视图、能力总览同路的环境读数）。这里不复制任何清单或阈值。
 * - **脱敏靠复用，不靠重写**：提示词观测与写库流水的导出函数自带脱敏与上限；
 *   环境节只含标签值（宿主/版本/存储模式等，与「复制总览给 AI」同路）；
 *   文本格式化出口整体再过一次 `maskSensitiveText_ACU` 兜底。
 * - **任何一节失败都不拖垮整包**：各节独立 try/catch，失败在原位记 `{ error }`。
 * - **本模块不碰 DOM**（下载/剪贴板由 presentation 层做），保持可单测。
 */
import { topLevelWindow_ACU } from '../../shared/env';
import { maskSensitiveText_ACU } from '../../shared/log-buffer';
import { getBuildStamp_ACU, getPluginVersion_ACU } from '../../shared/plugin-identity';
import { getAcuHostKind } from '../../shared/host-bridge';
import { exportPromptObservations_ACU } from '../ai/prompt-observer';
import { getCurrentIsolationKey_ACU, settings_ACU, currentChatFileIdentifier_ACU } from '../runtime/state-manager';
import { isSqliteMode } from '../table/storage-mode';
import { collectSelfCheckSnapshot_ACU, type SelfCheckProbe_ACU } from '../table/self-check';
import { exportTableWritePipeline_ACU } from '../table/write-pipeline-observer';
import {
  getRecentOversizedWriteWarnings_ACU,
  resolveOversizedWriteSettings_ACU,
  type OversizedWriteWarning_ACU,
} from '../table/oversized-write-warning';
import {
  buildFrameReplayView_ACU,
  listFrameBearingFloors_ACU,
  type FrameShape_ACU,
} from '../table/historical-frame-replay';

/** 诊断包结构版本。消费方（AI / 排障脚本）按此识别字段。 */
export const DIAGNOSTIC_BUNDLE_SCHEMA_ACU = 'acu-diagnostic-bundle-v1' as const;

/** 帧回放摘要默认收录的楼层上限（全列表在「历史楼层回放」面板里看）。 */
export const DIAGNOSTIC_BUNDLE_FRAME_FLOOR_LIMIT_ACU = 20;

export interface DiagnosticEnvRow_ACU {
  label: string;
  value: string;
}

export interface DiagnosticCapabilities_ACU {
  apiGroups: Array<{ name: string; methods: string[] }>;
  apiDefinedTotal: number;
  apiLiveTotal: number;
  apiGatedCount: number;
}

export interface DiagnosticFrameFloorSummary_ACU {
  messageIndex: number;
  aiFloor: number;
  shape: FrameShape_ACU;
  entryCount: number;
  operationCount: number;
}

export interface DiagnosticFrameReplaySection_ACU {
  floorCount: number;
  floors: DiagnosticFrameFloorSummary_ACU[];
  /** 最新一个含帧楼层的详情摘要（无含帧楼层时为 null）。 */
  latest: {
    messageIndex: number;
    shape: FrameShape_ACU;
    statementCount: number;
    truncated?: boolean;
    legacyPatchesOnly?: boolean;
    checkpointReason?: string;
    checkpointSheetKeyCount?: number;
  } | null;
}

export interface DiagnosticOversizedWriteSection_ACU {
  enabled: boolean;
  thresholds: { cellChars: number; payloadBytes: number };
  recent: OversizedWriteWarning_ACU[];
}

export interface DiagnosticBundle_ACU {
  schema: typeof DIAGNOSTIC_BUNDLE_SCHEMA_ACU;
  generatedAt: string;
  environment: DiagnosticEnvRow_ACU[];
  capabilities: DiagnosticCapabilities_ACU | { error: string };
  selfCheck: Record<string, SelfCheckProbe_ACU> | { error: string };
  promptObservations: Record<string, unknown>;
  writePipeline: Record<string, unknown>;
  frameReplay: DiagnosticFrameReplaySection_ACU | { error: string };
  /** 超大字段写入软警告：阈值 + 最近告警摘要（只含长度与位置，不含单元格原文）。 */
  oversizedWrite: DiagnosticOversizedWriteSection_ACU | { error: string };
}

/** 与 useCapabilityOverview 的环境节同一组事实源；这里是非响应式版本（service 层不依赖 vue）。 */
export function collectDiagnosticEnvironmentFacts_ACU(): DiagnosticEnvRow_ACU[] {
  const read = (fn: () => unknown, fallback = '—'): string => {
    try {
      const v = fn();
      return v === undefined || v === null || v === '' ? fallback : String(v);
    } catch {
      return fallback;
    }
  };
  return [
    { label: '宿主', value: read(() => getAcuHostKind()) },
    { label: '插件版本', value: read(() => getPluginVersion_ACU()) },
    { label: '构建戳', value: read(() => getBuildStamp_ACU()) },
    { label: '存储模式', value: read(() => (isSqliteMode() ? 'SQLite' : 'JSON（原生）')) },
    { label: '当前聊天标识', value: read(() => currentChatFileIdentifier_ACU) },
    {
      label: '数据隔离',
      value: (() => {
        try {
          if (settings_ACU?.dataIsolationEnabled !== true) return '未启用';
          const code = read(() => getCurrentIsolationKey_ACU(), '');
          return code ? '已启用' : '已启用（标记为空）';
        } catch {
          return '—';
        }
      })(),
    },
  ];
}

function collectCapabilitiesSection_ACU(): DiagnosticCapabilities_ACU {
  let groupIndex: Record<string, readonly string[]> = {};
  try {
    const raw = (topLevelWindow_ACU as { __ACU_API_GROUP_INDEX__?: unknown })?.__ACU_API_GROUP_INDEX__;
    if (raw && typeof raw === 'object') groupIndex = raw as Record<string, readonly string[]>;
  } catch { /* 拿不到就是空 */ }

  const apiGroups = Object.entries(groupIndex)
    .map(([name, methods]) => ({ name, methods: [...methods].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const apiDefinedTotal = apiGroups.reduce((sum, group) => sum + group.methods.length, 0);

  let apiLiveTotal = apiDefinedTotal;
  try {
    const api = (topLevelWindow_ACU as unknown as { AutoCardUpdaterAPI?: Record<string, unknown> })?.AutoCardUpdaterAPI;
    if (api && typeof api === 'object') {
      const count = Object.keys(api).length;
      if (count > 0) apiLiveTotal = count;
    }
  } catch { /* 退回定义数 */ }

  return {
    apiGroups,
    apiDefinedTotal,
    apiLiveTotal,
    apiGatedCount: Math.max(0, apiDefinedTotal - apiLiveTotal),
  };
}

function collectFrameReplaySection_ACU(limit: number): DiagnosticFrameReplaySection_ACU {
  const floors = listFrameBearingFloors_ACU();
  const summarized = floors.slice(0, limit).map(floor => ({
    messageIndex: floor.messageIndex,
    aiFloor: floor.aiFloor,
    shape: floor.shape,
    entryCount: floor.entryCount,
    operationCount: floor.operationCount,
  }));

  let latest: DiagnosticFrameReplaySection_ACU['latest'] = null;
  const newest = floors.reduce<number | null>(
    (max, floor) => (max === null || floor.messageIndex > max ? floor.messageIndex : max),
    null,
  );
  if (newest !== null) {
    const view = buildFrameReplayView_ACU(newest);
    latest = {
      messageIndex: view.messageIndex,
      shape: view.shape,
      statementCount: view.statementCount,
      ...(view.truncated ? { truncated: true } : {}),
      ...(view.legacyPatchesOnly ? { legacyPatchesOnly: true } : {}),
      ...(view.checkpoint
        ? { checkpointReason: view.checkpoint.reason, checkpointSheetKeyCount: view.checkpoint.sheetKeys.length }
        : {}),
    };
  }

  return { floorCount: floors.length, floors: summarized, latest };
}

function parseExportedJson_ACU(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { parseError: true };
  }
}

/** 单节安全采集：一节失败记 `{ error }`，不拖垮整包。 */
function safeCollect_ACU<T>(fn: () => T, label: string): T | { error: string } {
  try {
    return fn();
  } catch (error) {
    return { error: `${label}: ${(error as Error)?.message || String(error)}` };
  }
}

function collectOversizedWriteSection_ACU(): DiagnosticOversizedWriteSection_ACU {
  const settings = resolveOversizedWriteSettings_ACU();
  return {
    enabled: settings.enabled,
    thresholds: { cellChars: settings.cellChars, payloadBytes: settings.payloadBytes },
    recent: getRecentOversizedWriteWarnings_ACU(),
  };
}

export function buildDiagnosticBundle_ACU(
  options?: { frameFloorLimit?: number },
): DiagnosticBundle_ACU {
  const frameFloorLimit = Math.max(1, Math.floor(options?.frameFloorLimit ?? DIAGNOSTIC_BUNDLE_FRAME_FLOOR_LIMIT_ACU));
  return {
    schema: DIAGNOSTIC_BUNDLE_SCHEMA_ACU,
    generatedAt: new Date().toISOString(),
    environment: collectDiagnosticEnvironmentFacts_ACU(),
    capabilities: safeCollect_ACU(collectCapabilitiesSection_ACU, 'capabilities'),
    selfCheck: safeCollect_ACU(collectSelfCheckSnapshot_ACU, 'selfCheck'),
    promptObservations: parseExportedJson_ACU(safeCollect_ACU(exportPromptObservations_ACU, 'promptObservations') as string),
    writePipeline: parseExportedJson_ACU(safeCollect_ACU(exportTableWritePipeline_ACU, 'writePipeline') as string),
    frameReplay: safeCollect_ACU(() => collectFrameReplaySection_ACU(frameFloorLimit), 'frameReplay'),
    oversizedWrite: safeCollect_ACU(collectOversizedWriteSection_ACU, 'oversizedWrite'),
  };
}

/**
 * 组装「可贴给 AI」的脱敏文本。与「复制总览给 AI」同风格（Markdown 分节），
 * 出口整体过一次 `maskSensitiveText_ACU` 兜底。
 */
export function formatDiagnosticBundleText_ACU(bundle: DiagnosticBundle_ACU): string {
  const lines: string[] = [];
  lines.push('# 数据库插件一键诊断包');
  lines.push(`schema：${bundle.schema}`);
  lines.push(`导出时间：${bundle.generatedAt}`);
  lines.push('');
  lines.push('## 环境');
  for (const row of bundle.environment) lines.push(`- ${row.label}：${row.value}`);
  lines.push('');

  lines.push('## 公开 API（挂在 window.AutoCardUpdaterAPI）');
  if ('error' in bundle.capabilities) {
    lines.push(`- 采集失败：${bundle.capabilities.error}`);
  } else {
    const gatedNote = bundle.capabilities.apiGatedCount > 0
      ? `（其中 ${bundle.capabilities.apiGatedCount} 个当前被运行时门禁隐藏）`
      : '';
    lines.push(`当前可调用 ${bundle.capabilities.apiLiveTotal} 个；静态定义 ${bundle.capabilities.apiDefinedTotal} 个${gatedNote}`);
    for (const group of bundle.capabilities.apiGroups) {
      lines.push(`### ${group.name}（${group.methods.length}）`);
      lines.push(group.methods.join('、'));
    }
  }
  lines.push('');

  lines.push('## 启动/运行自检');
  for (const [name, probe] of Object.entries(bundle.selfCheck)) {
    if (probe && typeof probe === 'object' && 'ok' in probe) {
      lines.push(`- ${name}: ${probe.ok ? 'ok' : `失败（${probe.error}）`}`);
    } else {
      lines.push(`- ${name}: ${JSON.stringify(probe)}`);
    }
  }
  lines.push('');

  lines.push('## 出站提示词观测');
  if (bundle.promptObservations.parseError) {
    lines.push('- 导出内容无法解析（见 JSON 包内原始串）');
  } else {
    lines.push(`- 记录数：${String(bundle.promptObservations.recordCount ?? 0)}`);
  }
  lines.push('');

  lines.push('## 写库流水');
  if (bundle.writePipeline.parseError) {
    lines.push('- 导出内容无法解析（见 JSON 包内原始串）');
  } else {
    lines.push(`- 记录数：${String(bundle.writePipeline.recordCount ?? 0)}`);
  }
  lines.push('');

  lines.push('## 数据体积提示');
  if ('error' in bundle.oversizedWrite) {
    lines.push(`- 采集失败：${bundle.oversizedWrite.error}`);
  } else {
    const section = bundle.oversizedWrite;
    lines.push(`- 开关：${section.enabled ? '开启' : '关闭'}；阈值：单单元格 ${section.thresholds.cellChars} 字符 / 单次载荷 ${section.thresholds.payloadBytes} 字节`);
    if (section.recent.length === 0) {
      lines.push('- 最近没有触发告警');
    } else {
      for (const warning of section.recent) {
        const unit = warning.unit === 'chars' ? '字符' : '字节';
        const where = warning.sheetKey
          ? ` @ ${warning.sheetKey}${warning.rowIndex === undefined ? '' : ` 第 ${warning.rowIndex} 行第 ${warning.columnIndex} 列`}`
          : '';
        lines.push(`- ${warning.kind === 'cell' ? '单元格' : '载荷'} ${warning.value} ${unit}（阈值 ${warning.threshold}）${where}`);
      }
    }
  }
  lines.push('');

  lines.push('## 历史楼层回放');
  if ('error' in bundle.frameReplay) {
    lines.push(`- 采集失败：${bundle.frameReplay.error}`);
  } else {
    lines.push(`- 含帧楼层数：${bundle.frameReplay.floorCount}（摘要收录前 ${bundle.frameReplay.floors.length} 个）`);
    if (bundle.frameReplay.latest) {
      const latest = bundle.frameReplay.latest;
      const parts = [`形态 ${latest.shape}`, `语句 ${latest.statementCount} 条`];
      if (latest.checkpointReason) parts.push(`检查点原因 ${latest.checkpointReason}`);
      if (latest.truncated) parts.push('语句被截断');
      if (latest.legacyPatchesOnly) parts.push('仅旧版 patches');
      lines.push(`- 最新一楼 #${latest.messageIndex}：${parts.join('，')}`);
    }
  }
  lines.push('');
  lines.push('> 本诊断包由插件自身生成：提示词/写库节自带脱敏与上限，全文再过一次脱敏兜底（不含密钥/请求头）。');
  return maskSensitiveText_ACU(lines.join('\n'));
}

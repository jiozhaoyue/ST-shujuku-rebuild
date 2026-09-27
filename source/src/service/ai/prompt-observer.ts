/**
 * service/ai/prompt-observer.ts — 出站提示词观测器（Developer 页「提示词检查器」内核）
 *
 * 目的：把「AI 到底收到了什么提示词」从黑盒变成可看 / 可比 / 可导出的观测面。
 * 唯一埋点在 buildCustomApiRequestBody_ACU（全插件唯一的请求体组装漏斗），
 * 因此全部 AI 功能域天然被覆盖；scope 直接复用各处已在传的 sessionNamespace，
 * 不新造一套 scope 体系。
 *
 * 三条硬纪律：
 * 1. **零开销**：开关关闭时调用方只做一次布尔判断即返回（不分配、不复制、不算 token）。
 * 2. **绝不弄坏主链**：本模块任何路径都不抛错、不 await 调用方；token 估算单独排队异步补写。
 * 3. **只存内存**：不落 localStorage、不写 console；导出前过 maskSensitiveText_ACU。
 *
 * 刻意跨域复用（不搬家）：提示词 diff 内核在 service/continuation/agent/agent-prompt-drift.ts，
 * 内容是通用提示词比对、与 continuation 语义无关。本仓分层只禁 shared→上层 与 data→service，
 * service 内部跨域 import 属允许；搬家会改动既有调用点与测试路径，收益只是分层好看，不值得。
 *
 * 但 **scope 记忆刻意不共用** `trackAgentPromptDrift_ACU`：那个 Map 归 agent 主循环所有
 * （agent-main-loop 用它打印自己的漂移日志）。若共用，观测器每次记录都会顶掉主循环的
 * "上一次序列"，改变既有 debug 输出 —— 违反 R9「不改变既有行为」。故此处只转调纯函数
 * `compareAgentPromptMessages_ACU`（比对内核），序列记忆由本模块自持。
 */
import { logDebug_ACU } from '../../shared/utils';
import { maskSensitiveText_ACU } from '../../shared/log-buffer';
import { countTextTokens_ACU } from './token-counter';
import {
  compareAgentPromptMessages_ACU,
  formatAgentPromptDriftReport_ACU,
  type AgentPromptDriftReport_ACU,
  type AgentPromptMessage_ACU,
} from '../continuation/agent/agent-prompt-drift';

// ═══════════════════════════════════════════════════════════════
// 段名字面量（唯一权威源）
// ═══════════════════════════════════════════════════════════════

/**
 * 填表链占位符 → 段名。占位符替换点即天然的分段边界（见 prompt-api-call.ts 的
 * `$0/$1/$4/...` 单遍替换）：值在出站前被 nonce 保护、出站时按原样还原，
 * 因此「替换进正文的字符数」就是该段长度，无需额外埋点。
 */
export const PROMPT_PLACEHOLDER_SEGMENT_ACU: Readonly<Record<string, string>> = Object.freeze({
  $0: '表数据与DDL',
  $1: '历史消息',
  $4: '世界书',
  $6: '上轮规划',
  $8: '运行时数据',
  $9: '世界书(排除库)',
  $U: '用户设定',
  $C: '角色设定',
});

/** 骨架段名：模板自身的静态文本（占位符以外的部分）。 */
export const PROMPT_SEGMENT_SKELETON_ACU = '骨架';

/** 表名占位符 `{{表名}}` 解析出的世界书内容段名。 */
export const PROMPT_SEGMENT_TABLE_WORLDBOOK_ACU = '表名世界书';

// ═══════════════════════════════════════════════════════════════
// 内存上限（具名导出，便于测试与后续调参）
// ═══════════════════════════════════════════════════════════════

/** 环形缓冲最多保留的记录条数。 */
export const PROMPT_OBSERVATION_MAX_RECORDS_ACU = 30;
/** 单条消息正文上限（字符）；超出截断并置 `truncated`。 */
export const PROMPT_OBSERVATION_MAX_MESSAGE_CHARS_ACU = 120_000;
/** 缓冲总字符预算；超预算时丢最旧记录。 */
export const PROMPT_OBSERVATION_MAX_TOTAL_CHARS_ACU = 2 * 1024 * 1024;

// ═══════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════

export interface PromptMessageStat_ACU {
  role: string;
  /** 本条最终出站内容的字符数（截断前）。 */
  chars: number;
  /** 异步补齐；未算完时为 undefined（UI 显示 —）。 */
  tokens?: number;
  /** 最终出站内容（超上限截断）；仅供面板展开与导出。 */
  content: string;
  /** 本条内容被截断时置位。 */
  truncated?: boolean;
}

/** 段级报告：目前只由填表链产出（占位符注入点）。 */
export interface PromptSegmentStat_ACU {
  /** 段名，取自本模块导出的字面量集合。 */
  name: string;
  chars: number;
  /** 异步补齐。 */
  tokens?: number;
}

export interface PromptObservationRecord_ACU {
  /** 自增 ID。 */
  id: number;
  /** epoch ms。 */
  at: number;
  /** 调用方命名空间（sessionNamespace）；缺失时为 'unknown'。 */
  scope: string;
  model: string;
  /** 端点主机（含端口）；**不存完整 URL**（查询串可能带凭据）。 */
  endpointHost: string;
  stream: boolean;
  messageCount: number;
  messages: PromptMessageStat_ACU[];
  totalChars: number;
  /** 异步补齐。 */
  totalTokens?: number;
  /** 与**同 scope 上次调用**的 diff（复用 drift 内核的报告结构）。 */
  drift: AgentPromptDriftReport_ACU;
  /** drift 的人读单行文本（UI 直接展示，避免 UI 再 import 内核）。 */
  driftText: string;
  /** 仅填表链有；其他域为 undefined → UI 显示「未分段」。 */
  segments?: PromptSegmentStat_ACU[];
  /**
   * 各段字符数之和与最终总字符的差额。填表链上，宿主侧 role 归一 / 非预填充改写
   * 会在段统计之后追加少量字符（如每个 assistant 消息前加「助手：」），差额记在这里，
   * 保证「分段之和 + 差额 = 总数」这条账是平的、可审计的。
   */
  unsegmentedChars?: number;
  /** 任一条消息被截断时置位。 */
  truncated?: boolean;
}

export interface PromptObservationInput_ACU {
  messages: ReadonlyArray<{ role?: unknown; content?: unknown }>;
  effectiveApiConfig: { model?: unknown; url?: unknown; streamingEnabled?: unknown } | null | undefined;
  overrides?: {
    sessionNamespace?: string;
    promptSegments?: PromptSegmentStat_ACU[];
  };
}

// ═══════════════════════════════════════════════════════════════
// 内部状态
// ═══════════════════════════════════════════════════════════════

/** 观测开关（默认关闭）。由 UI store 推送，形态同 shared/log-buffer 的 applyWarnLogEnabled。 */
let _enabled = false;
/** 自增记录 ID。 */
let _nextId = 1;
/** 环形缓冲（最多 PROMPT_OBSERVATION_MAX_RECORDS_ACU 条，索引 0 为最旧）。 */
let _records: PromptObservationRecord_ACU[] = [];
/** 当前缓冲内容字符总量（用于总预算裁剪）。 */
let _bufferedChars = 0;
/** 订阅者。 */
const _subscribers = new Set<(records: readonly PromptObservationRecord_ACU[]) => void>();
/** 每个 scope 的上一次出站消息序列（本模块自持，刻意不共用 drift 内核的 Map，见文件头）。 */
const _lastMessagesByScope = new Map<string, AgentPromptMessage_ACU[]>();
/** token 估算串行链：避免多条记录同时压满宿主分词器。 */
let _estimateChain: Promise<void> = Promise.resolve();
/** 清空留痕（谁在何时清空），与 log-buffer 同形态。 */
const _clearHistory: Array<{ at: number; caller: string }> = [];

// ═══════════════════════════════════════════════════════════════
// 开关
// ═══════════════════════════════════════════════════════════════

export function setPromptObservationEnabled_ACU(enabled: boolean): void {
  _enabled = enabled === true;
}

/** 热路径调用：必须是纯布尔读取，不得有分配。 */
export function isPromptObservationEnabled_ACU(): boolean {
  return _enabled;
}

// ═══════════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════════

/** 端点只留主机（含端口）；解析失败时返回空串而不是原样回显（原串可能含查询串凭据）。 */
export function extractEndpointHost_ACU(url: unknown): string {
  try {
    return new URL(String(url || '')).host;
  } catch {
    return '';
  }
}

function notify_ACU(): void {
  for (const subscriber of _subscribers) {
    try {
      subscriber(_records);
    } catch (error) {
      // 订阅者回调出错不得影响观测器，更不得影响主生成链。
      try { logDebug_ACU('[提示词观测] 订阅者回调异常，已忽略。', error); } catch { /* 日志通道自身异常也吞掉 */ }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 记录
// ═══════════════════════════════════════════════════════════════

/**
 * 记录一次出站提示词。**不返回值、不抛错、不 await** —— 观察器绝不能弄坏主生成链。
 *
 * 调用方（buildCustomApiRequestBody_ACU）必须**先**判断 `isPromptObservationEnabled_ACU()`
 * 再调用本函数，以满足 R7 的零开销要求（关闭时连这个函数都不进）。
 */
export function recordPromptAssembly_ACU(input: PromptObservationInput_ACU): void {
  // 自守开关：调用方已按 R7 在热路径先判过一次（关闭时不进本函数、零开销），
  // 这里再判一次是为了让"开关关闭 ⇒ 不记录"成为模块自身的不变量 ——
  // 任何调用方（含测试与后续新接线点）都不必依赖纪律来保证它。
  if (!_enabled) return;
  try {
    const rawMessages = Array.isArray(input?.messages) ? input.messages : [];
    const config: any = input?.effectiveApiConfig || {};
    const scope = String(input?.overrides?.sessionNamespace || '').trim() || 'unknown';

    // 1) 消息统计 + 截断
    let truncated = false;
    const messages: PromptMessageStat_ACU[] = [];
    let totalChars = 0;
    for (const raw of rawMessages) {
      const role = typeof raw?.role === 'string' ? raw.role : '';
      const rawContent = typeof raw?.content === 'string' ? raw.content : String(raw?.content ?? '');
      const chars = rawContent.length;
      totalChars += chars;
      let content = rawContent;
      let messageTruncated = false;
      if (content.length > PROMPT_OBSERVATION_MAX_MESSAGE_CHARS_ACU) {
        content = content.slice(0, PROMPT_OBSERVATION_MAX_MESSAGE_CHARS_ACU);
        truncated = true;
        messageTruncated = true;
      }
      messages.push({ role, chars, content, ...(messageTruncated ? { truncated: true } : {}) });
    }

    // 2) 提示词 diff（同 scope 上次调用）。只转调比对内核，序列记忆由本模块自持。
    const snapshot: AgentPromptMessage_ACU[] = messages.map(message => ({ role: message.role, content: message.content }));
    const previous = _lastMessagesByScope.get(scope) ?? null;
    const drift = compareAgentPromptMessages_ACU(previous, snapshot);
    _lastMessagesByScope.set(scope, snapshot);

    // 3) 段统计（仅填表链传入）
    const promptSegments = Array.isArray(input?.overrides?.promptSegments) ? input.overrides.promptSegments : undefined;
    let segments: PromptSegmentStat_ACU[] | undefined;
    let unsegmentedChars: number | undefined;
    if (promptSegments) {
      segments = promptSegments.map(segment => ({ name: String(segment.name), chars: Math.max(0, Number(segment.chars) || 0) }));
      const segmentedChars = segments.reduce((sum, segment) => sum + segment.chars, 0);
      unsegmentedChars = totalChars - segmentedChars;
    }

    // 4) 落环形缓冲
    const record: PromptObservationRecord_ACU = {
      id: _nextId++,
      at: Date.now(),
      scope,
      model: String(config.model || ''),
      endpointHost: extractEndpointHost_ACU(config.url),
      stream: config.streamingEnabled === true,
      messageCount: messages.length,
      messages,
      totalChars,
      drift,
      driftText: formatAgentPromptDriftReport_ACU(drift),
      ...(segments ? { segments } : {}),
      ...(unsegmentedChars !== undefined ? { unsegmentedChars } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
    _records = [..._records, record];
    _bufferedChars += totalChars;
    trimToBudget_ACU();

    // 5) 异步补 token（不阻塞；失败只降级）
    scheduleTokenEstimation_ACU(record);

    notify_ACU();
  } catch (error) {
    try { logDebug_ACU('[提示词观测] 记录失败，已忽略（不影响本次 API 调用）。', error); } catch { /* ignore */ }
  }
}

/** 三重上限：条数、总字符预算。丢最旧。 */
function trimToBudget_ACU(): void {
  while (_records.length > PROMPT_OBSERVATION_MAX_RECORDS_ACU
    || (_bufferedChars > PROMPT_OBSERVATION_MAX_TOTAL_CHARS_ACU && _records.length > 1)) {
    const dropped = _records[0];
    _records = _records.slice(1);
    _bufferedChars -= dropped?.totalChars || 0;
  }
  if (_bufferedChars < 0) _bufferedChars = 0;
}

// ═══════════════════════════════════════════════════════════════
// 异步 token 估算
// ═══════════════════════════════════════════════════════════════

/**
 * 串行排队补 token。**刻意不 await**：估算要过宿主分词器（可能很慢），
 * 绝不允许它挡在任何一次 API 调用前面。结果回来后原地补写并通知订阅者。
 */
function scheduleTokenEstimation_ACU(record: PromptObservationRecord_ACU): void {
  _estimateChain = _estimateChain.then(async () => {
    // 记录可能已被清空/挤出缓冲：那样就没有补写的必要。
    if (!_records.includes(record)) return;
    let changed = false;
    try {
      for (const message of record.messages) {
        if (message.tokens !== undefined) continue;
        message.tokens = await countTextTokens_ACU(message.content);
        changed = true;
      }
      if (record.totalTokens === undefined) {
        record.totalTokens = record.messages.reduce((sum, message) => sum + (message.tokens || 0), 0);
        changed = true;
      }
      if (record.segments) {
        for (const segment of record.segments) {
          if (segment.tokens !== undefined) continue;
          // 段级只有字符数（正文未按段保留），按同系数估算——与 token-counter 的
          // 降级口径一致，不额外调用宿主分词器，避免为统计压满分词器。
          segment.tokens = Math.ceil(segment.chars / 1.5);
        }
        changed = true;
      }
    } catch (error) {
      try { logDebug_ACU('[提示词观测] token 估算失败，保留字符数展示。', error); } catch { /* ignore */ }
    }
    if (changed) notify_ACU();
  }).catch(() => { /* 链上任何异常都不得打断后续记录 */ });
}

// ═══════════════════════════════════════════════════════════════
// 读取 / 订阅 / 清空
// ═══════════════════════════════════════════════════════════════

/** 当前缓冲（只读快照，索引 0 为最旧）。 */
export function getPromptObservations_ACU(): readonly PromptObservationRecord_ACU[] {
  return _records;
}

export function subscribePromptObservations_ACU(
  callback: (records: readonly PromptObservationRecord_ACU[]) => void,
): () => void {
  _subscribers.add(callback);
  return () => { _subscribers.delete(callback); };
}

/** 清空缓冲与 scope 记忆（caller 留痕，与 log-buffer 同口径）。 */
export function clearPromptObservations_ACU(caller = 'unknown'): void {
  const count = _records.length;
  _records = [];
  _bufferedChars = 0;
  _lastMessagesByScope.clear();
  _clearHistory.push({ at: Date.now(), caller: String(caller || 'unknown').slice(0, 80) });
  if (_clearHistory.length > 20) _clearHistory.splice(0, _clearHistory.length - 20);
  notify_ACU();
  try { logDebug_ACU(`[提示词观测] 已清空 ${count} 条记录（caller=${caller}）。`); } catch { /* ignore */ }
}

/** 清空留痕（只读）。 */
export function getPromptObservationClearHistory_ACU(): Array<{ at: string; caller: string }> {
  return _clearHistory.map(item => ({ at: new Date(item.at).toISOString(), caller: item.caller }));
}

// ═══════════════════════════════════════════════════════════════
// 导出（脱敏）
// ═══════════════════════════════════════════════════════════════

/**
 * 导出当前缓冲为 JSON 文本。
 *
 * 脱敏口径（R6）：本模块**从不采集**请求头、apiKey、proxy 口令、完整 URL ——
 * 只留端点主机。正文里仍可能藏着用户数据中的密钥（如某个表格单元格写了
 * `api_key: sk-...`），故导出前对**每个字符串字段**逐个过 `maskSensitiveText_ACU`
 * （复用 log-buffer 的既有脱敏通道，不新开未脱敏通道）。
 *
 * 为什么逐字段而不是整串：`maskSensitiveText_ACU` 的 JSON 形态规则依赖**未转义**的引号。
 * 若先 JSON.stringify 再整串脱敏，内容里的 `"` 已变成 `\"`，规则匹配不上 → 静默漏网
 * （实测：`{"api_key":"sk-…"}` 整串形态能命中，`{\"api_key\":\"sk-…\"}` 命中不了）。
 * 因此必须在对象图上、字符串还未被转义时脱敏，之后再 stringify。
 */
export function exportPromptObservations_ACU(): string {
  try {
    const mask_ACU = (value: unknown): string => maskSensitiveText_ACU(String(value ?? ''));
    const payload = {
      exportedAt: new Date().toISOString(),
      recordCount: _records.length,
      limits: {
        maxRecords: PROMPT_OBSERVATION_MAX_RECORDS_ACU,
        maxMessageChars: PROMPT_OBSERVATION_MAX_MESSAGE_CHARS_ACU,
        maxTotalChars: PROMPT_OBSERVATION_MAX_TOTAL_CHARS_ACU,
      },
      records: _records.map(record => ({
        ...record,
        scope: mask_ACU(record.scope),
        model: mask_ACU(record.model),
        endpointHost: mask_ACU(record.endpointHost),
        messages: record.messages.map(message => ({ ...message, content: mask_ACU(message.content) })),
        ...(record.segments ? { segments: record.segments.map(segment => ({ ...segment })) } : {}),
      })),
    };
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    try { logDebug_ACU('[提示词观测] 导出失败。', error); } catch { /* ignore */ }
    return '{"error":"export_failed"}';
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试隔离
// ═══════════════════════════════════════════════════════════════

export function __resetPromptObservationForTests_ACU(): void {
  _enabled = false;
  _nextId = 1;
  _records = [];
  _bufferedChars = 0;
  _subscribers.clear();
  _lastMessagesByScope.clear();
  _clearHistory.length = 0;
  _estimateChain = Promise.resolve();
}

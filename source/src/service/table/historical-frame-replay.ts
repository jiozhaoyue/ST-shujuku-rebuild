/**
 * service/table/historical-frame-replay.ts — 历史楼层只读回放（父子任务 T3.3）
 *
 * 用途：让历史楼层「当时到底写了什么」可回看 —— 从聊天消息的持久化帧
 * （`TavernDB_ACU_IsolatedData[iso].storageFrame`）读出该帧**执行了哪些 SQL / DSL 操作**，只读呈现。
 *
 * 边界（2026-09-28 用户裁剪，务必守住）：
 * - **只列语句，不重执行、不写回、不建库、不重放求值**。没有 sql.js、没有 DDL 解析、没有表名改写、
 *   没有冲突容忍改写 —— 那些是 `scripts/rescue/replay-chat.mjs` 的**回放期**职责。
 * - 与救援脚本**逐项对齐**的是帧模型口径（帧位置 / string-object 容忍 / checkpoint 判据 / entries 来源 /
 *   坏帧宽容 / sheetKey→表名 的 key 形式）；**不同**的是我们不执行（见文件末「与救援脚本的差异」）。
 *
 * 只读纪律（硬约束）：
 * 1. 本模块**不 import 任何写接口**（不引 `write*` / `persist*` / `runTableUpdateCommit*`）。
 * 2. 仓储 `readIsolatedTagData_ACU` 返回的是**活引用的同一个对象**（其底层 `parseIsolatedDataField`
 *    带按消息的解析缓存）—— 因此这里只**读字段**，从不赋值写回；富化产出的都是新对象。
 * 3. 判据（回归用例固定）：调用前后同一 `isolationKey` 的 `TavernDB_ACU_IsolatedData`
 *    `JSON.stringify` **逐字节相等**，且无任何提交发生。
 */
import { getChatArray_ACU } from '../../data/gateways/chat-gateway';
import { readIsolatedTagData_ACU } from '../../data/repositories/chat-message-data-repo';
import { isAiFloor_ACU } from '../../shared/ai-floor';
import { logDebug_ACU } from '../../shared/utils';
import { getCurrentIsolationKey_ACU } from '../runtime/state-manager';
import { summarizeMutationOperations_ACU, type WriteStatementStat_ACU } from './write-pipeline-observer';

// ═══════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════

export type FrameShape_ACU = 'full_checkpoint' | 'delta' | 'empty' | 'invalid';

export interface FrameFloorEntry_ACU {
  messageIndex: number;
  /** 1 基 AI 楼层（该消息之前含本身的 AI 消息数）。 */
  aiFloor: number;
  shape: FrameShape_ACU;
  /** 帧内日志条目数。 */
  entryCount: number;
  /**
   * 粗粒度条数：各条目的 `operations` 槽位之和（**不富化**，故列表刷新快）。
   * 精确的语句条数由详情页给出 —— 列表与详情刻意用不同口径，避免为算列表而全量富化整个聊天。
   */
  operationCount: number;
  checkpointReason?: string;
  createdAt?: number;
  invalidReason?: string;
}

export interface FrameReplayEntry_ACU {
  seq: number;
  entryId: string;
  createdAt: number;
  source: string;
  aiFloor: number;
  targetMessageIndex: number;
  commitRevision?: string;
  statements: WriteStatementStat_ACU[];
}

export interface FrameCheckpointSummary_ACU {
  kind: 'full';
  createdAt?: number;
  reason: string;
  /** 全量 checkpoint 覆盖的 sheetKey（只读键名，不复制数据）。 */
  sheetKeys: string[];
  /** per-sheet checkpoint 的 sheetKey（仅形状）。 */
  perSheetSheetKeys: string[];
}

export interface FrameReplayView_ACU {
  messageIndex: number;
  shape: FrameShape_ACU;
  invalidReason?: string;
  checkpoint?: FrameCheckpointSummary_ACU;
  entries: FrameReplayEntry_ACU[];
  /** 精确语句条数（= entries 的各 statements 之和）。 */
  statementCount: number;
  /** 任一语句被截断、或语句集被总预算裁剪时置位。 */
  truncated?: boolean;
  /** 该帧含旧版 patches 且本视图不解析它们（如实标注，不静默跳过）。 */
  legacyPatchesOnly?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 只读工具
// ═══════════════════════════════════════════════════════════════

/**
 * sheetKey → 回放库物理表名（`sheet_ji_yao_biao` → `jiyaobiao`）。
 * **口径与 `scripts/rescue/replay-chat.mjs` 的 `keyFormOf` 同源**（该脚本是离线 .mjs，无法 import，故此处复刻）。
 * 仅用于**显示**，本模块不建表、不改名。
 */
export function tableNameFromSheetKey_ACU(sheetKey: unknown): string {
  return String(sheetKey ?? '').replace(/^sheet_/, '').replace(/_/g, '');
}

interface FrameReadResult_ACU {
  frame: unknown;
  /** 帧存在但解析不出来（如字符串形态的坏 JSON）时的原因。 */
  unparsable?: string;
}

/**
 * 读某楼层的帧。**只读**：不写回、不修改任何字段。
 *
 * @returns `null` 表示该楼层没有本插件的存储帧；`unparsable` 表示有帧但读不出来（诊断态）。
 */
function readFrameAt_ACU(message: unknown, isolationKey: string): FrameReadResult_ACU | null {
  if (!message || typeof message !== 'object') return null;
  let tagData: unknown;
  try {
    tagData = readIsolatedTagData_ACU(message as any, isolationKey);
  } catch {
    return { frame: null, unparsable: '隔离数据字段读取异常' };
  }
  const frame = (tagData as any)?.storageFrame;
  if (frame === undefined || frame === null) return null;
  if (typeof frame === 'string') {
    // 历史形态：帧可能是 JSON 串。宽容解析，失败即诊断态（与救援脚本的 ensureFrameParsed 同口径）。
    try {
      return { frame: JSON.parse(frame) };
    } catch (error) {
      return { frame: null, unparsable: `帧是字符串且 JSON 解析失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { frame };
}

/**
 * 帧形状判定。**宽容、无副作用、不抛错**。
 *
 * - 帧不是非数组对象 ⇒ `invalid`
 * - `logEntries` 不是数组 ⇒ `invalid`（沿用仓储层 `Array.isArray(frame?.logEntries)` 的守卫口径）
 * - `checkpoint.kind === 'full'` 或 `perSheetCheckpoints` 非空 ⇒ `full_checkpoint`
 * - 否则 `logEntries` 非空 ⇒ `delta`；为空 ⇒ `empty`
 *
 * 注意 checkpoint 与 logEntries **可以共存**（一轮填表后同一帧既有 checkpoint 又有本次 delta）：
 * 形状按 checkpoint 判，但 `entries` 仍**照常列全** —— 不因「有 checkpoint」就丢掉 delta。
 */
export function classifyStorageFrame_ACU(frame: unknown): { shape: FrameShape_ACU; invalidReason?: string } {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
    return { shape: 'invalid', invalidReason: '帧不是对象（可能未写入或字段形态异常）' };
  }
  const candidate = frame as Record<string, unknown>;
  if (!Array.isArray(candidate.logEntries)) {
    return { shape: 'invalid', invalidReason: '帧缺少 logEntries 数组' };
  }
  const checkpoint = candidate.checkpoint as Record<string, unknown> | undefined;
  const hasFullCheckpoint = Boolean(checkpoint && typeof checkpoint === 'object' && checkpoint.kind === 'full');
  const perSheet = candidate.perSheetCheckpoints;
  const hasPerSheet = Boolean(
    perSheet && typeof perSheet === 'object' && !Array.isArray(perSheet) && Object.keys(perSheet as object).length > 0,
  );
  if (hasFullCheckpoint || hasPerSheet) return { shape: 'full_checkpoint' };
  return (candidate.logEntries as unknown[]).length > 0 ? { shape: 'delta' } : { shape: 'empty' };
}

/** 粗粒度 operations 槽位计数（不富化，列表用）。 */
function countOperationSlots_ACU(entry: unknown): number {
  const operations = Array.isArray((entry as any)?.operations) ? (entry as any).operations : [];
  let count = 0;
  for (const operation of operations) {
    const statements = (operation as any)?.statements;
    count += Array.isArray(statements) && statements.length > 0 ? statements.length : 1;
  }
  return count;
}

function checkpointSummaryOf_ACU(frame: Record<string, unknown>): FrameCheckpointSummary_ACU | undefined {
  const checkpoint = frame.checkpoint as Record<string, unknown> | undefined;
  const perSheet = frame.perSheetCheckpoints as Record<string, unknown> | undefined;
  const perSheetSheetKeys = perSheet && typeof perSheet === 'object' && !Array.isArray(perSheet) ? Object.keys(perSheet) : [];
  const hasFull = Boolean(checkpoint && typeof checkpoint === 'object' && checkpoint.kind === 'full');
  if (!hasFull && perSheetSheetKeys.length === 0) return undefined;
  const data = (checkpoint?.data as Record<string, unknown> | undefined) ?? undefined;
  const sheetKeys = data && typeof data === 'object' && !Array.isArray(data)
    ? Object.keys(data).filter(key => key.startsWith('sheet_'))
    : [];
  return {
    kind: 'full',
    ...(typeof checkpoint?.createdAt === 'number' ? { createdAt: checkpoint.createdAt } : {}),
    reason: String(checkpoint?.reason ?? '—'),
    sheetKeys,
    perSheetSheetKeys,
  };
}

// ═══════════════════════════════════════════════════════════════
// 列表（只读扫描）
// ═══════════════════════════════════════════════════════════════

/**
 * 扫描当前聊天，列出**含帧**的楼层供点选。只读。
 *
 * AI 楼层用累积计数（`isAiFloor_ACU`）而非对每层 `chat.slice()` —— 后者是 O(n²)，
 * 在长聊天（数百层）上白白吃掉一次面板刷新的时间。
 */
export function listFrameBearingFloors_ACU(): FrameFloorEntry_ACU[] {
  const entries: FrameFloorEntry_ACU[] = [];
  try {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat)) return entries;
    const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
    let aiFloor = 0;
    for (let index = 0; index < chat.length; index += 1) {
      if (isAiFloor_ACU(chat[index])) aiFloor += 1;
      const read = readFrameAt_ACU(chat[index], isolationKey);
      if (!read) continue;

      if (read.unparsable) {
        entries.push({
          messageIndex: index,
          aiFloor,
          shape: 'invalid',
          entryCount: 0,
          operationCount: 0,
          invalidReason: read.unparsable,
        });
        continue;
      }

      const frame = read.frame as Record<string, unknown>;
      const classification = classifyStorageFrame_ACU(frame);
      const logEntries = Array.isArray(frame.logEntries) ? (frame.logEntries as unknown[]) : [];
      const summary = checkpointSummaryOf_ACU(frame);
      const createdAt = summary?.createdAt
        ?? (typeof (logEntries[0] as any)?.createdAt === 'number' ? (logEntries[0] as any).createdAt : undefined);
      entries.push({
        messageIndex: index,
        aiFloor,
        shape: classification.shape,
        entryCount: logEntries.length,
        operationCount: logEntries.reduce<number>((sum, entry) => sum + countOperationSlots_ACU(entry), 0),
        ...(summary ? { checkpointReason: summary.reason } : {}),
        ...(createdAt !== undefined ? { createdAt } : {}),
        ...(classification.invalidReason ? { invalidReason: classification.invalidReason } : {}),
      });
    }
  } catch (error) {
    try { logDebug_ACU('[历史帧回放] 扫描含帧楼层失败（只影响本面板）。', error); } catch { /* ignore */ }
  }
  return entries;
}

// ═══════════════════════════════════════════════════════════════
// 单帧视图（只读）
// ═══════════════════════════════════════════════════════════════

function emptyView_ACU(messageIndex: number, invalidReason: string): FrameReplayView_ACU {
  return { messageIndex, shape: 'invalid', invalidReason, entries: [], statementCount: 0 };
}

/**
 * 构造某楼层的帧视图。**坏帧不抛错**：降级为 `shape: 'invalid'` + 原因。
 * 语句富化复用 T3.2 的 `summarizeMutationOperations_ACU`（不另造一套）。
 */
export function buildFrameReplayView_ACU(messageIndex: number): FrameReplayView_ACU {
  try {
    const chat = getChatArray_ACU();
    if (!Array.isArray(chat)) return emptyView_ACU(messageIndex, '当前不可读取聊天消息（宿主接口未就绪）');
    const message = chat[messageIndex];
    if (!message) return emptyView_ACU(messageIndex, `楼层 #${messageIndex} 不存在`);

    const isolationKey = String(getCurrentIsolationKey_ACU() ?? '');
    const read = readFrameAt_ACU(message, isolationKey);
    if (!read) return emptyView_ACU(messageIndex, '该楼层没有本插件的存储帧（不是表格楼层，或隔离键不同）');
    if (read.unparsable) return emptyView_ACU(messageIndex, read.unparsable);

    const frame = read.frame as Record<string, unknown>;
    const classification = classifyStorageFrame_ACU(frame);
    const rawEntries = Array.isArray(frame.logEntries) ? (frame.logEntries as any[]) : [];

    let truncated = false;
    const entries: FrameReplayEntry_ACU[] = rawEntries.map(entry => {
      const summary = summarizeMutationOperations_ACU(entry?.operations);
      if (summary.truncated) truncated = true;
      return {
        seq: Number.isFinite(Number(entry?.seq)) ? Number(entry.seq) : 0,
        entryId: String(entry?.entryId ?? ''),
        createdAt: Number.isFinite(Number(entry?.createdAt)) ? Number(entry.createdAt) : 0,
        source: String(entry?.source ?? ''),
        aiFloor: Number.isFinite(Number(entry?.aiFloor)) ? Number(entry.aiFloor) : 0,
        targetMessageIndex: Number.isFinite(Number(entry?.targetMessageIndex)) ? Number(entry.targetMessageIndex) : -1,
        statements: summary.statements,
        ...(typeof entry?.commitRevision === 'string' && entry.commitRevision ? { commitRevision: entry.commitRevision } : {}),
      };
    });

    const checkpoint = checkpointSummaryOf_ACU(frame);
    // 旧版 derived patch log（新写入不再使用）：如实标注不解析，而不是让用户以为「这帧什么都没写」。
    const legacyPatchesOnly = entries.length > 0
      && entries.every(entry => entry.statements.length === 0)
      && rawEntries.some(entry => Array.isArray(entry?.patches) && entry.patches.length > 0);

    return {
      messageIndex,
      shape: classification.shape,
      ...(classification.invalidReason ? { invalidReason: classification.invalidReason } : {}),
      ...(checkpoint ? { checkpoint } : {}),
      entries,
      statementCount: entries.reduce((sum, entry) => sum + entry.statements.length, 0),
      ...(truncated ? { truncated: true } : {}),
      ...(legacyPatchesOnly ? { legacyPatchesOnly: true } : {}),
    };
  } catch (error) {
    try { logDebug_ACU('[历史帧回放] 构造帧视图失败（降级为诊断态）。', error); } catch { /* ignore */ }
    return emptyView_ACU(messageIndex, `读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * service/table/write-pipeline-observer.ts — 写库流水观测器（三段式的第三段）
 *
 * 目的：把「AI 说完了之后到底要写什么」从黑盒（此前只有 warn/error 碎片日志）变成可看的流水：
 * 出站提示词 → 响应正文 → **解析出的 SQL / DSL 操作**。
 *
 * 唯一埋点在写库主链的**单一收口点** `service/table/table-update-commit.ts` 的
 * `runTableUpdateCommit_ACU`（填表 / agent 协议 / chat-service / 可视化保存 / 导入全走它）。
 * 观测代码**不识别来源**，只透传 `options.source` —— 新增一个写入来源无需改这里。
 *
 * 边界（2026-09-28 用户裁剪，务必守住）：深度**止于「解析出的 SQL」**。不读表数据、不做行级 diff、
 * 不碰 `data/sqlite/**`（持久化帧内容与行级差异属后续任务）。
 *
 * 三条硬纪律（延续阶段 2 的 prompt-observer）：
 * 1. **零开销**：开关关闭时调用方只做一次布尔判断即返回（不分配、不解析）。
 * 2. **绝不弄坏主链**：本模块任何路径都不抛错、不 await 调用方；异常只降级为 debug 日志。
 * 3. **只存内存**：不落 localStorage、不写 console；导出前逐字段过 `maskSensitiveText_ACU`。
 */
import { logDebug_ACU } from '../../shared/utils';
import { maskSensitiveText_ACU } from '../../shared/log-buffer';
import { parseRestrictedSqlDml_ACU } from '../../shared/restricted-sql-dml';
import { getLatestObservationIdForScope_ACU } from '../ai/prompt-observer';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 环形缓冲最多保留的记录条数。 */
export const WRITE_PIPELINE_MAX_RECORDS_ACU = 30;
/** 单条语句/指令的文本上限（字符）；超出截断并置 `truncated`。 */
export const WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU = 8_000;
/** 缓冲总字符预算；超预算时丢最旧记录。 */
export const WRITE_PIPELINE_MAX_TOTAL_CHARS_ACU = 2 * 1024 * 1024;
/** 「就近关联」出站提示词记录的最大时间差；超过即不给关联（宁缺勿错）。 */
export const WRITE_PIPELINE_PROMPT_LINK_MAX_AGE_MS_ACU = 10 * 60 * 1000;

/**
 * 写入来源 → 出站提示词观测的 scope。**只用于「就近关联」**，不用于是否记录 ——
 * 因此新来源不进表也照常产出记录，只是没有可关联的提示词（如实为空）。
 * 映射依据：填表三条链走 `sessionNamespace:'table-fill'`（prompt-api-call.ts）；
 * 总结归并走 `'summary'`（summary/merge-logic.ts）。其余来源（manual_crud / raw_sql_* /
 * import / template_assistant / system）不经 AI 调用，故无对应 scope。
 */
const SOURCE_PROMPT_SCOPE_ACU: Readonly<Record<string, string>> = Object.freeze({
  auto_fill: 'table-fill',
  manual_fill: 'table-fill',
  group_fill: 'table-fill',
  merge_summary: 'summary',
});

// ═══════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════

export type WriteStatementDialect_ACU = 'sql' | 'dsl' | 'structured';
export type WriteStatementOperation_ACU = 'insert' | 'update' | 'delete' | 'replace' | 'schema' | 'other';

export interface WriteStatementStat_ACU {
  dialect: WriteStatementDialect_ACU;
  operation: WriteStatementOperation_ACU;
  /** 语句/指令原文；超上限截断并置 `truncated`。 */
  text: string;
  /** 截断前字符数。 */
  chars: number;
  truncated?: boolean;
  /**
   * 目标表。SQL 方言给物理表名；结构化 kind 给 sheetKey；
   * DSL 方言给不出表名（`insertRow(0, …)` 的首参是**索引**）⇒ 记 `#0` 这类索引提示。
   */
  tables: string[];
}

export type TableWriteOutcome_ACU = 'saved' | 'runtime_only' | 'failed';

export interface TableWritePipelineRecord_ACU {
  id: number;
  at: number;
  /** TableMutationSourceV2_ACU；只透传，不在此枚举。 */
  source: string;
  reason: string;
  outcome: TableWriteOutcome_ACU;
  targetMessageIndex: number;
  targetSheetKeys: string[];
  statements: WriteStatementStat_ACU[];
  /** 语句/指令条数（= statements.length）。 */
  statementCount: number;
  /** 关联的出站提示词记录 id；窗口外或无对应来源时缺失（如实为空，不猜）。 */
  promptRecordId?: number;
  errorCategory?: string;
  /** operations 未由调用方提供（由持久化层自行构建）时置位 —— 如实标注，不伪造语句。 */
  operationsUnavailable?: boolean;
  /** 任一语句被截断、或语句集被总预算裁剪时置位。 */
  truncated?: boolean;
}

export interface TableWritePipelineInput_ACU {
  source: unknown;
  reason: unknown;
  outcome: TableWriteOutcome_ACU;
  targetMessageIndex?: unknown;
  targetSheetKeys?: unknown;
  operations?: unknown;
  errorCategory?: unknown;
}

// ═══════════════════════════════════════════════════════════════
// 内部状态
// ═══════════════════════════════════════════════════════════════

/** 观测开关（默认关闭）。形态同 prompt-observer。 */
let _enabled = false;
let _nextId = 1;
/** 环形缓冲（索引 0 为最旧）。 */
let _records: TableWritePipelineRecord_ACU[] = [];
/** 当前缓冲内容字符总量。 */
let _bufferedChars = 0;
const _subscribers = new Set<(records: readonly TableWritePipelineRecord_ACU[]) => void>();

// ═══════════════════════════════════════════════════════════════
// 开关
// ═══════════════════════════════════════════════════════════════

export function setTableWriteObservationEnabled_ACU(enabled: boolean): void {
  _enabled = enabled === true;
}

/** 热路径调用：必须是纯布尔读取，不得有分配。 */
export function isTableWriteObservationEnabled_ACU(): boolean {
  return _enabled;
}

function notify_ACU(): void {
  for (const subscriber of _subscribers) {
    try {
      subscriber(_records);
    } catch (error) {
      try { logDebug_ACU('[写库流水] 订阅者回调异常，已忽略。', error); } catch { /* ignore */ }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 语句富化（纯函数，可单测；不依赖开关）
// ═══════════════════════════════════════════════════════════════

/** DSL 指令行：`insertRow(0, {…})` / `updateRow(…)` / `deleteRow(…)`，首参是**表索引**。 */
const DSL_LINE_RE_ACU = /^(insertRow|deleteRow|updateRow)\s*\(/;
const DSL_INDEX_RE_ACU = /^(?:insertRow|deleteRow|updateRow)\s*\(\s*([^,)]+)/;

const DSL_COMMAND_TO_OPERATION_ACU: Readonly<Record<string, WriteStatementOperation_ACU>> = Object.freeze({
  insertRow: 'insert',
  updateRow: 'update',
  deleteRow: 'delete',
});

function clampText_ACU(text: string): { text: string; chars: number; truncated?: boolean } {
  const chars = text.length;
  if (chars <= WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU) return { text, chars };
  return { text: text.slice(0, WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU), chars, truncated: true };
}

function buildStat_ACU(
  dialect: WriteStatementDialect_ACU,
  operation: WriteStatementOperation_ACU,
  rawText: unknown,
  tables: string[],
): WriteStatementStat_ACU {
  const clamped = clampText_ACU(String(rawText ?? ''));
  return {
    dialect,
    operation,
    tables,
    ...clamped,
  };
}

/** 单条 SQL 语句 → stat。解析失败不抛错，降级为 `operation:'other'` 并保留原文。 */
function statFromSqlStatement_ACU(statement: unknown): WriteStatementStat_ACU {
  const text = String(statement ?? '');
  let operation: WriteStatementOperation_ACU = 'other';
  let tables: string[] = [];
  try {
    const parsed = parseRestrictedSqlDml_ACU(text);
    if (parsed.length === 1) {
      operation = parsed[0].kind;
      tables = parsed[0].table ? [parsed[0].table] : [];
    } else if (parsed.length > 1) {
      // 单条槽位里塞了多条语句：不谎称单一操作类型，表名取并集。
      tables = [...new Set(parsed.map(item => item.table).filter(Boolean))];
    }
  } catch { /* 解析失败（非 INSERT/UPDATE/DELETE 或畸形）：保留原文，类型记 other */ }
  return buildStat_ACU('sql', operation, text, tables);
}

/**
 * `table_edit_dsl` 的文本 → 多条 stat。按**行**拆分（DSL 指令是一行一条，见
 * `table-edit-parser.ts` 的逐行解析）；非指令行（说明文字、JSON 块残片等）不逐行保留，
 * 只在完全拆不出指令时把整段作为一条 `other` stat —— 这样既有语句粒度，又不丢信息。
 */
function statsFromDslText_ACU(rawText: unknown): WriteStatementStat_ACU[] {
  const source = String(rawText ?? '');
  if (!source.trim()) return [];
  const stats: WriteStatementStat_ACU[] = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 行内注释形态（`<!-- insertRow(...) -->`）在解析器里被当注释跳过，此处同样跳过。
    if (trimmed.startsWith('<!--') || trimmed.startsWith('--') || trimmed.startsWith('//')) continue;
    const matched = trimmed.match(DSL_LINE_RE_ACU);
    if (!matched) continue;
    const operation = DSL_COMMAND_TO_OPERATION_ACU[matched[1]] || 'other';
    const indexMatch = trimmed.match(DSL_INDEX_RE_ACU);
    const firstArg = indexMatch ? indexMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';
    const tables = firstArg ? [`#${firstArg}`] : [];
    stats.push(buildStat_ACU('dsl', operation, trimmed, tables));
  }
  if (stats.length === 0) {
    // 拆不出任何指令：整段留一条，避免「明明有内容却显示 0 条」。
    stats.push(buildStat_ACU('dsl', 'other', source, []));
  }
  return stats;
}

function pickSheetKey_ACU(operation: any): string[] {
  const sheetKey = typeof operation?.sheetKey === 'string' && operation.sheetKey ? operation.sheetKey : '';
  return sheetKey ? [sheetKey] : [];
}

/**
 * 把一次提交的 operations 归一成可读的语句统计。
 *
 * **绝不抛错**：未知 kind、畸形对象一律降级为 `structured / other` 并保留可读线索。
 * 返回的 `truncated` 只表示「语句集被总预算裁剪」（单条截断记在各自 stat 上）。
 */
export function summarizeMutationOperations_ACU(operations: unknown): { statements: WriteStatementStat_ACU[]; truncated: boolean } {
  const list = Array.isArray(operations) ? operations : [];
  const statements: WriteStatementStat_ACU[] = [];
  let usedChars = 0;
  let truncated = false;

  const push_ACU = (stat: WriteStatementStat_ACU): void => {
    if (usedChars + stat.chars > WRITE_PIPELINE_MAX_TOTAL_CHARS_ACU) {
      truncated = true;
      return;
    }
    usedChars += stat.chars;
    statements.push(stat);
  };

  for (const operation of list) {
    try {
      const kind = String((operation as any)?.kind ?? '');
      if (kind === 'sql_batch' || kind === 'sql_sheet_batch') {
        const rawStatements = Array.isArray((operation as any).statements) ? (operation as any).statements : [];
        if (rawStatements.length === 0) {
          push_ACU(buildStat_ACU('sql', 'other', JSON.stringify(operation).slice(0, 400), []));
        }
        for (const statement of rawStatements) push_ACU(statFromSqlStatement_ACU(statement));
        continue;
      }
      if (kind === 'table_edit_dsl') {
        for (const stat of statsFromDslText_ACU((operation as any).text)) push_ACU(stat);
        continue;
      }
      if (kind === 'sheet_replace') {
        push_ACU(buildStat_ACU('structured', 'replace', `sheet_replace(${String((operation as any).reason ?? '')})`, pickSheetKey_ACU(operation)));
        continue;
      }
      if (kind === 'data_replace') {
        push_ACU(buildStat_ACU('structured', 'replace', `data_replace(${String((operation as any).reason ?? '')})`, []));
        continue;
      }
      if (kind === 'sheet_schema_migrate') {
        push_ACU(buildStat_ACU('structured', 'schema', 'sheet_schema_migrate', pickSheetKey_ACU(operation)));
        continue;
      }
      if (kind === 'row_upsert' || kind === 'row_delete' || kind === 'meta_update') {
        push_ACU(buildStat_ACU('structured', 'other', kind, pickSheetKey_ACU(operation)));
        continue;
      }
      // 未知 / 畸形：保留 kind 名作为线索，绝不抛错。
      push_ACU(buildStat_ACU('structured', 'other', kind || '(无 kind)', []));
    } catch (error) {
      try { logDebug_ACU('[写库流水] 单条 operation 富化失败，已跳过。', error); } catch { /* ignore */ }
    }
  }

  return { statements, truncated };
}

// ═══════════════════════════════════════════════════════════════
// 记录
// ═══════════════════════════════════════════════════════════════

/** 就近关联：来源 → scope → 窗口内的最近一条出站提示词记录。取不到就返回 undefined。 */
function resolvePromptRecordId_ACU(source: string): number | undefined {
  try {
    const scope = SOURCE_PROMPT_SCOPE_ACU[source];
    if (!scope) return undefined;
    const latest = getLatestObservationIdForScope_ACU(scope);
    if (!latest) return undefined;
    if (Date.now() - latest.at > WRITE_PIPELINE_PROMPT_LINK_MAX_AGE_MS_ACU) return undefined;
    return latest.id;
  } catch {
    return undefined;
  }
}

/**
 * 记录一次写库流水。**不返回值、不抛错、不 await** —— 观测器绝不能弄坏写库主链。
 *
 * 调用方必须**先**判断 `isTableWriteObservationEnabled_ACU()` 再调用本函数（零开销要求）；
 * 此处再判一次是为了让「开关关闭 ⇒ 不记录」成为模块自身的不变量。
 */
export function recordTableWritePipeline_ACU(input: TableWritePipelineInput_ACU): void {
  if (!_enabled) return;
  try {
    const source = String(input?.source ?? 'system');
    const outcome: TableWriteOutcome_ACU = input?.outcome === 'saved' || input?.outcome === 'runtime_only' || input?.outcome === 'failed'
      ? input.outcome
      : 'failed';
    const operations = Array.isArray(input?.operations) ? input.operations : [];
    const operationsUnavailable = operations.length === 0;
    const { statements, truncated } = summarizeMutationOperations_ACU(operations);
    const promptRecordId = resolvePromptRecordId_ACU(source);
    const targetSheetKeys = Array.isArray(input?.targetSheetKeys)
      ? (input!.targetSheetKeys as unknown[]).map(String).filter(Boolean)
      : [];
    const targetMessageIndex = Number.isFinite(Number(input?.targetMessageIndex)) ? Number(input?.targetMessageIndex) : -1;
    const reason = String(input?.reason ?? '');

    const record: TableWritePipelineRecord_ACU = {
      id: _nextId++,
      at: Date.now(),
      source,
      reason,
      outcome,
      targetMessageIndex,
      targetSheetKeys,
      statements,
      statementCount: statements.length,
      ...(promptRecordId !== undefined ? { promptRecordId } : {}),
      ...(typeof input?.errorCategory === 'string' && input.errorCategory ? { errorCategory: input.errorCategory } : {}),
      ...(operationsUnavailable ? { operationsUnavailable: true } : {}),
      ...(truncated ? { truncated: true } : {}),
    };

    _records = [..._records, record];
    _bufferedChars += record.statements.reduce((sum, stat) => sum + stat.chars, 0) + reason.length + source.length;
    trimToBudget_ACU();
    notify_ACU();
  } catch (error) {
    try { logDebug_ACU('[写库流水] 记录失败，已忽略（不影响本次提交）。', error); } catch { /* ignore */ }
  }
}

/** 三重上限：条数、总字符预算。丢最旧。 */
function trimToBudget_ACU(): void {
  while (_records.length > WRITE_PIPELINE_MAX_RECORDS_ACU
    || (_bufferedChars > WRITE_PIPELINE_MAX_TOTAL_CHARS_ACU && _records.length > 1)) {
    const dropped = _records[0];
    _records = _records.slice(1);
    _bufferedChars -= dropped
      ? dropped.statements.reduce((sum, stat) => sum + stat.chars, 0) + dropped.reason.length + dropped.source.length
      : 0;
  }
  if (_bufferedChars < 0) _bufferedChars = 0;
}

// ═══════════════════════════════════════════════════════════════
// 读取 / 订阅 / 清空 / 导出
// ═══════════════════════════════════════════════════════════════

export function getTableWritePipelineRecords_ACU(): readonly TableWritePipelineRecord_ACU[] {
  return _records;
}

export function subscribeTableWritePipeline_ACU(
  callback: (records: readonly TableWritePipelineRecord_ACU[]) => void,
): () => void {
  _subscribers.add(callback);
  return () => { _subscribers.delete(callback); };
}

export function clearTableWritePipeline_ACU(caller = 'unknown'): void {
  const count = _records.length;
  _records = [];
  _bufferedChars = 0;
  notify_ACU();
  try { logDebug_ACU(`[写库流水] 已清空 ${count} 条记录（caller=${caller}）。`); } catch { /* ignore */ }
}

/**
 * 导出当前缓冲为 JSON 文本。语句文本里可能藏着用户数据中的密钥
 * （例如某个单元格写了 `api_key: sk-…`），故对每个字符串字段逐个过 `maskSensitiveText_ACU`
 * —— **在对象图上、JSON 转义之前**（阶段 2 实测教训：先 stringify 再整串脱敏会静默漏网）。
 */
export function exportTableWritePipeline_ACU(): string {
  try {
    const mask_ACU = (value: unknown): string => maskSensitiveText_ACU(String(value ?? ''));
    const payload = {
      exportedAt: new Date().toISOString(),
      recordCount: _records.length,
      limits: {
        maxRecords: WRITE_PIPELINE_MAX_RECORDS_ACU,
        maxStatementChars: WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU,
        maxTotalChars: WRITE_PIPELINE_MAX_TOTAL_CHARS_ACU,
      },
      records: _records.map(record => ({
        ...record,
        source: mask_ACU(record.source),
        reason: mask_ACU(record.reason),
        targetSheetKeys: record.targetSheetKeys.map(mask_ACU),
        statements: record.statements.map(stat => ({ ...stat, text: mask_ACU(stat.text), tables: stat.tables.map(mask_ACU) })),
      })),
    };
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    try { logDebug_ACU('[写库流水] 导出失败。', error); } catch { /* ignore */ }
    return '{"error":"export_failed"}';
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试隔离
// ═══════════════════════════════════════════════════════════════

export function __resetTableWriteObservationForTests_ACU(): void {
  _enabled = false;
  _nextId = 1;
  _records = [];
  _bufferedChars = 0;
  _subscribers.clear();
}

/**
 * useSqlConsole — SQL 控制台业务流编排
 *
 * v2 页面只依赖本 composable；SQLite provider / storage mode 调用集中在这里，
 * 避免页面直接接触 service 单例。
 */
import { computed, ref, shallowRef } from 'vue';
import type { SqlQueryResult } from '../../shared/table-storage-provider';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { ensureStorageProviderReady_ACU } from '../../service/table/table-storage-strategy';
import { isSqliteMode } from '../../service/table/storage-mode';
import { currentChatFileIdentifier_ACU, currentJsonTableData_ACU, getCurrentIsolationKey_ACU } from '../../service/runtime/state-manager';
import { runSqliteRuntimeMutationCommit_ACU } from '../../service/table/table-update-commit';
import { isReadOnlySqlStatement_ACU } from '../../service/runtime/template-vars/read-only-sql-validation';
import { resolveCurrentRuntimeReadSql_ACU } from '../../service/runtime/read-query-resolver';
import { useToastStore } from '../stores/toast-store';
import {
  buildSqlResultFilename,
  copySqlResultCsv,
  downloadSqlResultFile,
  sqlResultToCsv,
  sqlResultToJson,
} from './sql-result-export';

export type SqlConsoleMessageKind = 'info' | 'success' | 'warning' | 'error';
export type SqlResultKind = 'idle' | 'query' | 'mutation' | 'error';

export interface SqlConsoleMessage {
  kind: SqlConsoleMessageKind;
  text: string;
  at: number;
}

export interface SqlHistoryItem {
  sql: string;
  timestamp: number;
  success: boolean;
  chatIdentity: string;
  isolationKey: string;
}

export interface SqlResultState {
  kind: SqlResultKind;
  columns: string[];
  values: SqlQueryResult['values'];
  rowCount: number;
  changes: number;
  elapsedMs: string;
  error: string;
}

export const SQL_CONSOLE_MAX_HISTORY = 50;

/**
 * 结果渲染窗口：大 SELECT 会整表物化进 values（engine.query 不截断），
 * 全量渲染进 vdom 会卡宿主页面（P-8 同类）。列表只渲染窗口内行，「显示更多」逐窗追加；
 * 复制/导出仍取全量（与日志查看器「渲染 300 条、导出取全部」同口径）。
 */
export const SQL_CONSOLE_VIEW_WINDOW = 200;

const sqlHistory = ref<SqlHistoryItem[]>([]);

type SqlConsoleContext = { chatIdentity: string; isolationKey: string; key: string };

function currentSqlConsoleContext(): SqlConsoleContext {
  const chatIdentity = String(currentChatFileIdentifier_ACU || '');
  const isolationKey = String(getCurrentIsolationKey_ACU() || '');
  return { chatIdentity, isolationKey, key: `${chatIdentity}::${isolationKey}` };
}

export function isSqlConsoleQuery(sql: string): boolean {
  return isReadOnlySqlStatement_ACU(sql);
}

function emptyResult(): SqlResultState {
  return {
    kind: 'idle',
    columns: [],
    values: [],
    rowCount: 0,
    changes: 0,
    elapsedMs: '',
    error: '',
  };
}

function addHistory(sql: string, success: boolean, context = currentSqlConsoleContext()): void {
  sqlHistory.value = [
    { sql, timestamp: Date.now(), success, chatIdentity: context.chatIdentity, isolationKey: context.isolationKey },
    ...sqlHistory.value,
  ].slice(0, SQL_CONSOLE_MAX_HISTORY);
}

export function __resetSqlConsoleHistoryForTests(): void {
  sqlHistory.value = [];
}

export function useSqlConsole() {
  const toast = useToastStore();
  const sqlText = ref('');
  const busyAction = ref('');
  const isSqliteAvailable = ref(false);
  const result = shallowRef<SqlResultState>(emptyResult());

  const history = computed(() => {
    const context = currentSqlConsoleContext();
    return sqlHistory.value.filter(item => item.chatIdentity === context.chatIdentity && item.isolationKey === context.isolationKey);
  });
  const hasSqlText = computed(() => sqlText.value.trim().length > 0);
  /** 渲染窗口：只把窗口内行交给 vdom。 */
  const visibleCount = ref(SQL_CONSOLE_VIEW_WINDOW);
  const displayedValues = computed<SqlResultState['values']>(() =>
    result.value.kind === 'query' ? result.value.values.slice(0, visibleCount.value) : [],
  );
  const hiddenByWindow = computed(() =>
    result.value.kind === 'query' ? Math.max(0, result.value.values.length - visibleCount.value) : 0,
  );
  function showMoreRows(): void {
    visibleCount.value += SQL_CONSOLE_VIEW_WINDOW;
  }
  /** 新查询/清空结果时把窗口收回默认值。 */
  function resetWindow(): void {
    visibleCount.value = SQL_CONSOLE_VIEW_WINDOW;
  }
  const statusLabel = computed(() => {
    if (busyAction.value === 'execute') return '执行中…';
    if (result.value.kind === 'query') return `${result.value.rowCount} 行 · ${result.value.elapsedMs}ms`;
    if (result.value.kind === 'mutation') return `${result.value.changes} 行受影响 · ${result.value.elapsedMs}ms`;
    if (result.value.kind === 'error') return `失败 · ${result.value.elapsedMs}ms`;
    return '等待执行';
  });
  const statusKind = computed<SqlConsoleMessageKind>(() => {
    if (result.value.kind === 'error') return 'error';
    if (result.value.kind === 'query' || result.value.kind === 'mutation') return 'success';
    return isSqliteAvailable.value ? 'info' : 'warning';
  });

  /**
   * 换聊天后清空上一次查询结果：结果行属于切换前的聊天，
   * 继续显示会让人照着旧行对新聊天下 SQL（写路径按当前隔离键落库）。
   */
  function clearResult(): void {
    result.value = emptyResult();
    resetWindow();
  }

  function clearHistory(): void {
    sqlHistory.value = [];
  }

  function refresh(): void {
    isSqliteAvailable.value = isSqliteMode();
  }

  function setSql(sql: string): void {
    sqlText.value = sql;
  }

  function clearSql(): void {
    sqlText.value = '';
  }

  function showTables(): void {
    setSql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_acu_%' ORDER BY name;");
    void executeCurrent();
  }

  function showSchema(): void {
    setSql("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_acu_%' ORDER BY name;");
    void executeCurrent();
  }

  function useHistoryItem(item: SqlHistoryItem): void {
    const context = currentSqlConsoleContext();
    if (item.chatIdentity !== context.chatIdentity || item.isolationKey !== context.isolationKey) {
      toast.warning('该 SQL 历史属于其他聊天，已拒绝填入当前上下文。');
      return;
    }
    sqlText.value = item.sql;
    toast.info('已把历史 SQL 填入编辑器。');
  }

  /**
   * 结果导出只针对查询结果：mutation/error 结果没有行列数据可导，
   * 且行数据属于执行时的聊天 —— 换聊天后 clearResult 已兜底清空。
   */
  function requireQueryResult(): { columns: string[]; values: SqlResultState['values'] } | null {
    if (result.value.kind !== 'query') {
      toast.warning('当前没有可导出的查询结果。');
      return null;
    }
    return { columns: result.value.columns, values: result.value.values };
  }

  async function copyResultCsv(): Promise<void> {
    const queryResult = requireQueryResult();
    if (!queryResult) return;
    const ok = await copySqlResultCsv(queryResult.columns, queryResult.values);
    if (ok) toast.success(`已复制 ${queryResult.values.length} 行为 CSV。`);
    else toast.error('复制失败，请改用「导出 CSV」。');
  }

  function exportResultCsv(): void {
    const queryResult = requireQueryResult();
    if (!queryResult) return;
    downloadSqlResultFile(buildSqlResultFilename('csv'), sqlResultToCsv(queryResult.columns, queryResult.values), 'text/csv');
    toast.success('已导出 CSV 文件。');
  }

  function exportResultJson(): void {
    const queryResult = requireQueryResult();
    if (!queryResult) return;
    downloadSqlResultFile(buildSqlResultFilename('json'), sqlResultToJson(queryResult.columns, queryResult.values), 'application/json');
    toast.success('已导出 JSON 文件。');
  }

  async function executeCurrent(): Promise<void> {
    const sql = sqlText.value.trim();
    if (!sql) {
      toast.warning('SQL 语句不能为空。');
      return;
    }

    refresh();
    if (!isSqliteAvailable.value) {
      result.value = { ...emptyResult(), kind: 'error', error: 'SQL 控制台仅在 SQLite 模式下可用。' };
      toast.error('SQL 控制台仅在 SQLite 模式下可用。');
      return;
    }

    const executionContext = currentSqlConsoleContext();
    busyAction.value = 'execute';
    const startTime = performance.now();

    try {
      const provider = await ensureStorageProviderReady_ACU();
      if (currentSqlConsoleContext().key !== executionContext.key) {
        result.value = { ...emptyResult(), kind: 'error', error: '聊天已切换，旧 SQL 已拒绝执行。' };
        toast.error('聊天已切换，旧 SQL 已拒绝执行。');
        return;
      }
      if (isSqlConsoleQuery(sql)) {
        const queryResult = provider.executeQuery(resolveCurrentRuntimeReadSql_ACU(sql).sql);
        const elapsedMs = (performance.now() - startTime).toFixed(1);
        resetWindow();
        result.value = {
          ...emptyResult(),
          kind: 'query',
          columns: queryResult.columns,
          values: queryResult.values,
          rowCount: queryResult.rowCount,
          elapsedMs,
        };
        addHistory(sql, true, executionContext);
        toast.success(queryResult.rowCount === 0 ? '查询成功，没有返回行。' : `查询成功，返回 ${queryResult.rowCount} 行。`);
        logDebug_ACU(`[ACU-V2 SQL Console] query ok: ${queryResult.rowCount} rows, ${elapsedMs}ms`);
        return;
      }

      const commitResult = await runSqliteRuntimeMutationCommit_ACU<null>({
        source: 'raw_sql_mutation',
        reason: 'sql_console_v2_mutation',
        isolationKey: executionContext.isolationKey,
        writeSet: [{ kind: 'all' as const }],
        revisionWriteSet: [{ kind: 'all' as const }],
        initialData: currentJsonTableData_ACU as any,
        targetMessageIndex: -1,
        targetSheetKeys: null,
        updateGroupKeys: null,
        trackingSheetKeys: [],
        trackAsUpdate: false,
        sql,
        mapValue: () => null,
      });
      if (currentSqlConsoleContext().key !== executionContext.key) {
        result.value = { ...emptyResult(), kind: 'error', error: '聊天已切换，旧 SQL 已拒绝执行。' };
        toast.error('聊天已切换，旧 SQL 已拒绝执行。');
        return;
      }
      const mutationResult = commitResult.mutationResult || { changes: 0, errors: commitResult.error ? [commitResult.error] : [] };
      const elapsedMs = (performance.now() - startTime).toFixed(1);
      if (!commitResult.success || mutationResult.errors.length > 0) {
        const error = mutationResult.errors.join('\n') || commitResult.error || '执行失败';
        result.value = { ...emptyResult(), kind: 'error', elapsedMs, error };
        addHistory(sql, false, executionContext);
        toast.error('执行失败，请检查结果区中的错误信息。');
        return;
      }

      result.value = {
        ...emptyResult(),
        kind: 'mutation',
        changes: mutationResult.changes,
        elapsedMs,
      };
      addHistory(sql, true, executionContext);
      toast.success(`执行成功，${mutationResult.changes} 行受影响。`);
      logDebug_ACU(`[ACU-V2 SQL Console] mutation ok: ${mutationResult.changes} changes, ${elapsedMs}ms`);
    } catch (e: any) {
      const elapsedMs = (performance.now() - startTime).toFixed(1);
      const error = e?.message || String(e);
      result.value = { ...emptyResult(), kind: 'error', elapsedMs, error };
      addHistory(sql, false, executionContext);
      toast.error('执行失败，请检查结果区中的错误信息。');
      logError_ACU(`[ACU-V2 SQL Console] execute failed: ${error}`);
    } finally {
      busyAction.value = '';
    }
  }

  return {
    sqlText,
    busyAction,
    isSqliteAvailable,
    result,
    history,
    hasSqlText,
    statusLabel,
    statusKind,
    displayedValues,
    hiddenByWindow,
    showMoreRows,
    refresh,
    clearResult,
    clearHistory,
    setSql,
    clearSql,
    showTables,
    showSchema,
    useHistoryItem,
    copyResultCsv,
    exportResultCsv,
    exportResultJson,
    executeCurrent,
  };
}

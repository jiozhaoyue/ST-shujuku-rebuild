/**
 * presentation-v2/composables/sql-statement-count.ts — 顶层 SQL 语句计数（纯函数，零依赖）
 *
 * 为什么独立成文件：useSqlConsole 背后拖着整条 service 导入链（state-manager 等），
 * 纯逻辑放它身上就没法在 node 环境轻量单测；本模块零依赖，node/jsdom 都能直接 import。
 *
 * 语义：'…'、"…"、`…`（内层双写转义）、-- 行注释、/* 块注释内的分号不算语句边界。
 * 引擎（engine.query）对多条语句只返回第一个结果集，SQL 控制台据此给"多语句"诚实提示。
 */
export function countTopLevelSqlStatements(sql: string): number {
  let count = 0;
  let hasContent = false;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : '';
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (next === "'") {
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        if (next === '"') {
          i += 2;
          continue;
        }
        inDouble = false;
      }
      i++;
      continue;
    }
    if (inBacktick) {
      if (ch === '`') inBacktick = false;
      i++;
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      if (ch === "'") inSingle = true;
      else if (ch === '"') inDouble = true;
      else inBacktick = true;
      hasContent = true;
      i++;
      continue;
    }
    if (ch === ';') {
      if (hasContent) count++;
      hasContent = false;
      i++;
      continue;
    }
    if (!/\s/.test(ch)) hasContent = true;
    i++;
  }
  if (hasContent) count++;
  return count;
}

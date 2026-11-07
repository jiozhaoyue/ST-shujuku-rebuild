/**
 * presentation-v2/composables/sql-result-export.ts — SQL 控制台查询结果导出（纯序列化 + DOM 薄封装）
 *
 * 为什么抽出来：导出格式（CSV/JSON）与取值转换是纯逻辑，要能脱离 DOM 单测；
 * 下载/复制是宿主 DOM 细节，集中在此与 useLogViewer 的下载口径保持一致
 * （host-document + 延迟 revoke）。
 *
 * 序列化口径：
 * - CSV：RFC 4180（含引号/逗号/换行的字段加引号并双写引号），行结束符 CRLF，首行恒为表头；
 *   单元格取值经 sqlValueToExportText（NULL → 空串、BLOB → base64）。BOM 由下载方追加（Excel 中文兼容）。
 * - JSON：按行对象数组输出；同名列后者覆盖前者（SQL `SELECT a, a` 的极端场景，CSV 不受影响）。
 * - BLOB → base64：控制台表格里展示为 BLOB(n)，导出给的是可再消费的数据而不是占位文本。
 */
import { getAcuHostDocument } from '../bootstrap/host-document';
import { copyTextToClipboard_ACU } from './clipboard';

export type SqlCellValue = string | number | null | Uint8Array;

/** btoa 对大数组会栈溢出，分块拼接二进制串。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 导出取值：NULL → 空串；BLOB → base64；其余按 String()。 */
export function sqlValueToExportText(value: SqlCellValue): string {
  if (value === null) return '';
  if (value instanceof Uint8Array) return bytesToBase64(value);
  return String(value);
}

/**
 * 取值 → SQLite 字面量（单元格点击复制用，可直接粘进 WHERE/SET）：
 * NULL → `NULL`；BLOB → `X'hex'`；字符串 → 单引号包裹并双写转义；数字原样。
 */
export function sqlValueToSqlLiteral(value: SqlCellValue): string {
  if (value === null) return 'NULL';
  if (value instanceof Uint8Array) {
    let hex = '';
    for (let i = 0; i < value.length; i++) hex += value[i].toString(16).padStart(2, '0');
    return `X'${hex}'`;
  }
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function sqlResultToCsv(columns: readonly string[], values: readonly SqlCellValue[][]): string {
  const lines = [columns.map(column => csvField(column)).join(',')];
  for (const row of values) {
    lines.push(columns.map((_, index) => csvField(sqlValueToExportText(row[index] ?? null))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function sqlResultToRecords(columns: readonly string[], values: readonly SqlCellValue[][]): Record<string, unknown>[] {
  return values.map(row => {
    const record: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      const value = row[index];
      record[column] = value instanceof Uint8Array ? bytesToBase64(value) : value;
    });
    return record;
  });
}

export function sqlResultToJson(columns: readonly string[], values: readonly SqlCellValue[][]): string {
  return JSON.stringify(sqlResultToRecords(columns, values), null, 2);
}

export function buildSqlResultFilename(ext: 'csv' | 'json', now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `acu-sql-result-${stamp}.${ext}`;
}

export function downloadSqlResultFile(
  filename: string,
  content: string,
  mime: 'text/csv' | 'application/json',
): void {
  // CSV 追加 UTF-8 BOM：不带 BOM 的 UTF-8 会被 Excel 按 ANSI 解码，中文变乱码。
  const payload = mime === 'text/csv' ? `\uFEFF${content}` : content;
  const blob = new Blob([payload], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const doc = getAcuHostDocument();
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // 延迟 revoke：WebView2/部分内核在 click 后立即 revoke 会取消下载（与 useLogViewer 同口径）
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copySqlResultCsv(columns: readonly string[], values: readonly SqlCellValue[][]): Promise<boolean> {
  return copyTextToClipboard_ACU(sqlResultToCsv(columns, values));
}

/**
 * 结果行排序（列头点击）：定义一个全序 —— NULL 视为最大（升序在尾、降序在首）；
 * 数值按值、字符串按 localeCompare、BLOB 按字节长度；类型间按 数字 < 字符串 < BLOB 排。
 * 只对内存中的行数组排序，不动 SQLite。
 */
export function compareSqlCells(a: SqlCellValue, b: SqlCellValue): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const aBlob = a instanceof Uint8Array;
  const bBlob = b instanceof Uint8Array;
  if (aBlob || bBlob) {
    const aLen = aBlob ? (a as Uint8Array).length : -1;
    const bLen = bBlob ? (b as Uint8Array).length : -1;
    if (aBlob && bBlob) return aLen - bLen;
    return aBlob ? 1 : -1;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true });
}

export type SqlSortDirection = 'asc' | 'desc';

export function sortSqlRows(
  values: readonly SqlCellValue[][],
  column: number,
  dir: SqlSortDirection,
): SqlCellValue[][] {
  const factor = dir === 'asc' ? 1 : -1;
  return values.slice().sort((rowA, rowB) => factor * compareSqlCells(rowA[column] ?? null, rowB[column] ?? null));
}

/**
 * 结果 → Markdown 表格（贴进酒馆聊天给 AI/人看）。
 * 展示语义而非导出保真：NULL → `NULL`、BLOB → `BLOB(n)`；`|` 转义、换行折叠成空格；
 * 单元格文本超 200 字符截断（聊天里贴巨表没意义，全量请用导出）。
 */
export function sqlResultToMarkdownTable(columns: readonly string[], values: readonly SqlCellValue[][]): string {
  const display = (value: SqlCellValue): string => {
    if (value === null) return 'NULL';
    if (value instanceof Uint8Array) return `BLOB(${value.byteLength})`;
    return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 200);
  };
  const header = `| ${columns.map(column => display(column)).join(' | ')} |`;
  const separator = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = values.map(row => `| ${columns.map((_, index) => display(row[index] ?? null)).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

export async function copySqlResultMarkdown(columns: readonly string[], values: readonly SqlCellValue[][]): Promise<boolean> {
  return copyTextToClipboard_ACU(sqlResultToMarkdownTable(columns, values));
}

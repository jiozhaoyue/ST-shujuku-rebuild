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

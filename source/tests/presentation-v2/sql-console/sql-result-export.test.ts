/**
 * SQL 结果导出纯函数 — CSV/JSON 序列化、取值转换、文件名
 *
 * 只测纯逻辑（下载/复制的 DOM 封装走既有页测与真机验证）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildSqlResultFilename,
  sqlResultToCsv,
  sqlResultToJson,
  sqlValueToExportText,
  sqlValueToSqlLiteral,
} from '../../../src/presentation-v2/composables/sql-result-export';

describe('sqlValueToSqlLiteral', () => {
  it('NULL → NULL；数字原样', () => {
    expect(sqlValueToSqlLiteral(null)).toBe('NULL');
    expect(sqlValueToSqlLiteral(42)).toBe('42');
    expect(sqlValueToSqlLiteral(-1.5)).toBe('-1.5');
  });

  it('字符串单引号包裹并双写转义', () => {
    expect(sqlValueToSqlLiteral('abc')).toBe("'abc'");
    expect(sqlValueToSqlLiteral("it's")).toBe("'it''s'");
    expect(sqlValueToSqlLiteral('')).toBe("''");
  });

  it("BLOB → X'hex'（SQLite blob 字面量）", () => {
    expect(sqlValueToSqlLiteral(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))).toBe("X'deadbeef'");
    expect(sqlValueToSqlLiteral(Uint8Array.from([0x0f]))).toBe("X'0f'");
    expect(sqlValueToSqlLiteral(new Uint8Array(0))).toBe("X''");
  });
});

describe('sqlValueToExportText', () => {
  it('NULL → 空串；普通值 → String()', () => {
    expect(sqlValueToExportText(null)).toBe('');
    expect(sqlValueToExportText(42)).toBe('42');
    expect(sqlValueToExportText('abc')).toBe('abc');
  });

  it('BLOB → base64', () => {
    // Uint8Array.from([1, 2, 3]) → base64 "AQID"
    expect(sqlValueToExportText(Uint8Array.from([1, 2, 3]))).toBe('AQID');
    expect(sqlValueToExportText(new Uint8Array(0))).toBe('');
  });
});

describe('sqlResultToCsv', () => {
  it('首行表头 + CRLF 行结束', () => {
    const csv = sqlResultToCsv(['id', 'name'], [[1, '背包'], [2, '技能表']]);
    expect(csv).toBe('id,name\r\n1,背包\r\n2,技能表\r\n');
  });

  it('含逗号/引号/换行的字段按 RFC 4180 加引号并双写引号', () => {
    const csv = sqlResultToCsv(['v'], [['a,b'], ['说"hi"'], ['行1\n行2'], ['普通']]);
    expect(csv).toBe(
      'v\r\n"a,b"\r\n"说""hi"""\r\n"行1\n行2"\r\n普通\r\n',
    );
  });

  it('NULL → 空字段；短行补空', () => {
    const csv = sqlResultToCsv(['a', 'b'], [[null, 'x'], ['y']]);
    expect(csv).toBe('a,b\r\n,x\r\ny,\r\n');
  });

  it('BLOB 单元格导出为 base64', () => {
    const csv = sqlResultToCsv(['data'], [[Uint8Array.from([1, 2, 3])]]);
    expect(csv).toBe('data\r\nAQID\r\n');
  });

  it('零行查询仍输出表头行', () => {
    expect(sqlResultToCsv(['a', 'b'], [])).toBe('a,b\r\n');
  });
});

describe('sqlResultToJson', () => {
  it('按行对象数组输出；null 保持 null、BLOB → base64', () => {
    const json = sqlResultToJson(['id', 'data'], [[1, null], [2, Uint8Array.from([1, 2, 3])]]);
    expect(JSON.parse(json)).toEqual([
      { id: 1, data: null },
      { id: 2, data: 'AQID' },
    ]);
  });

  it('零行查询输出空数组', () => {
    expect(sqlResultToJson(['a'], [])).toBe('[]');
  });
});

describe('buildSqlResultFilename', () => {
  it('acu-sql-result-YYYYMMDD-HHMMSS.ext，单位数补零', () => {
    const name = buildSqlResultFilename('csv', new Date(2026, 10, 7, 0, 42, 3));
    expect(name).toBe('acu-sql-result-20261107-004203.csv');
    expect(buildSqlResultFilename('json', new Date(2026, 0, 2, 13, 5, 9))).toBe('acu-sql-result-20260102-130509.json');
  });
});

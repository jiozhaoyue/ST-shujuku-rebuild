/**
 * SQL 结果导出纯函数 — CSV/JSON 序列化、取值转换、文件名
 *
 * 只测纯逻辑（下载/复制的 DOM 封装走既有页测与真机验证）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildSqlResultFilename,
  compareSqlCells,
  sortSqlRows,
  sqlResultToCsv,
  sqlResultToMarkdownTable,
  sqlResultToJson,
  sqlValueToExportText,
  sqlValueToSqlLiteral,
} from '../../../src/presentation-v2/composables/sql-result-export';
import { countTopLevelSqlStatements } from '../../../src/presentation-v2/composables/sql-statement-count';

describe('sqlResultToMarkdownTable', () => {
  it('表头 + 分隔行 + 数据行', () => {
    const md = sqlResultToMarkdownTable(['id', 'name'], [[1, '背包'], [2, '技能表']]);
    expect(md).toBe('| id | name |\n| --- | --- |\n| 1 | 背包 |\n| 2 | 技能表 |');
  });

  it('竖线转义、换行折叠、NULL/BLOB 展示语义、超长截断 200', () => {
    const long = 'x'.repeat(250);
    const md = sqlResultToMarkdownTable(
      ['a|b'],
      [['含|竖线\n两行'], [null], [Uint8Array.from([1, 2, 3])], [long]],
    );
    const lines = md.split('\n');
    expect(lines[0]).toBe('| a\\|b |');
    expect(lines[2]).toContain('含\\|竖线 两行');
    expect(lines[3]).toContain('| NULL |');
    expect(lines[4]).toContain('| BLOB(3) |');
    expect(lines[5]?.includes('x'.repeat(200))).toBe(true);
    expect(lines[5]?.includes('x'.repeat(201))).toBe(false);
  });

  it('零行仍输出表头 + 分隔行；短行按 NULL 补', () => {
    expect(sqlResultToMarkdownTable(['a'], [])).toBe('| a |\n| --- |');
    expect(sqlResultToMarkdownTable(['a', 'b'], [['x']])).toBe('| a | b |\n| --- | --- |\n| x | NULL |');
  });
});

describe('countTopLevelSqlStatements', () => {
  it('空串/纯注释 → 0；单条 → 1', () => {
    expect(countTopLevelSqlStatements('')).toBe(0);
    expect(countTopLevelSqlStatements('   \n  ')).toBe(0);
    expect(countTopLevelSqlStatements('-- 全是注释\n')).toBe(0);
    expect(countTopLevelSqlStatements('/* 块注释 */')).toBe(0);
    expect(countTopLevelSqlStatements('SELECT 1;')).toBe(1);
    expect(countTopLevelSqlStatements('SELECT 1')).toBe(1);
  });

  it('多条语句按顶层分号计数，尾分号不重复计', () => {
    expect(countTopLevelSqlStatements('SELECT 1; SELECT 2;')).toBe(2);
    expect(countTopLevelSqlStatements('SELECT 1; SELECT 2; SELECT 3;')).toBe(3);
    expect(countTopLevelSqlStatements(';;SELECT 1;;')).toBe(1);
  });

  it('字符串/注释里的分号不算语句边界', () => {
    expect(countTopLevelSqlStatements("SELECT 'a;b' FROM t;")).toBe(1);
    expect(countTopLevelSqlStatements("SELECT 'it''s; ok' FROM t;")).toBe(1);
    expect(countTopLevelSqlStatements('SELECT "col;name" FROM t;')).toBe(1);
    expect(countTopLevelSqlStatements('SELECT `tab;le` FROM t;')).toBe(1);
    expect(countTopLevelSqlStatements('SELECT 1 -- 注释;还有\nFROM t;')).toBe(1);
    expect(countTopLevelSqlStatements('SELECT 1 /* 块;注释 */ FROM t;')).toBe(1);
  });

  it('注释先行不吞后续语句', () => {
    expect(countTopLevelSqlStatements('-- 说明\nSELECT 1; SELECT 2;')).toBe(2);
    expect(countTopLevelSqlStatements('/* 头部\n说明 */ SELECT 1; SELECT 2;')).toBe(2);
  });
});

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

describe('compareSqlCells / sortSqlRows', () => {
  it('全序：数字 < 字符串 < BLOB < NULL', () => {
    expect(compareSqlCells(1, 2)).toBeLessThan(0);
    expect(compareSqlCells('a', 'b')).toBeLessThan(0);
    expect(compareSqlCells(1, 'a')).toBeLessThan(0);
    expect(compareSqlCells('a', Uint8Array.from([1]))).toBeLessThan(0);
    expect(compareSqlCells(Uint8Array.from([1]), null)).toBeLessThan(0);
    expect(compareSqlCells(null, null)).toBe(0);
  });

  it('sortSqlRows：升/降序翻转且不改原数组；缺列按 NULL', () => {
    const rows = [[3, 'c'], [1, 'a'], [2, null]];
    const asc = sortSqlRows(rows, 0, 'asc');
    expect(asc.map(r => r[0])).toEqual([1, 2, 3]);
    const desc = sortSqlRows(rows, 0, 'desc');
    expect(desc.map(r => r[0])).toEqual([3, 2, 1]);
    // 原数组不动
    expect(rows.map(r => r[0])).toEqual([3, 1, 2]);
    // 按第 2 列排：null 视为最大 → 升序在尾
    const byName = sortSqlRows(rows, 1, 'asc');
    expect(byName.map(r => r[1])).toEqual(['a', 'c', null]);
    // 行短于列数（短行补 NULL 口径一致）
    const short = sortSqlRows([[2], [1, 'x']], 1, 'asc');
    expect(short[short.length - 1][0]).toBe(2);
  });

  it('字符串数字感知排序（numeric: true）', () => {
    const rows = [['row10'], ['row2'], ['row1']];
    expect(sortSqlRows(rows, 0, 'asc').map(r => r[0])).toEqual(['row1', 'row2', 'row10']);
  });
});

describe('buildSqlResultFilename', () => {
  it('acu-sql-result-YYYYMMDD-HHMMSS.ext，单位数补零', () => {
    const name = buildSqlResultFilename('csv', new Date(2026, 10, 7, 0, 42, 3));
    expect(name).toBe('acu-sql-result-20261107-004203.csv');
    expect(buildSqlResultFilename('json', new Date(2026, 0, 2, 13, 5, 9))).toBe('acu-sql-result-20260102-130509.json');
  });
});

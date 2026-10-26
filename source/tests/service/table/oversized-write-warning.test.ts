import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: {
    oversizedWriteWarningEnabled: true,
    oversizedCellWarnChars: 10_000,
    oversizedWriteWarnBytes: 512 * 1024,
  } as Record<string, unknown>,
  logWarn: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mocks.logWarn,
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  get settings_ACU() {
    return mocks.settings;
  },
}));

import {
  OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU,
  OVERSIZED_CELL_WARN_CHARS_MAX_ACU,
  OVERSIZED_CELL_WARN_CHARS_MIN_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_MAX_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_MIN_ACU,
  OVERSIZED_WRITE_RECENT_LIMIT_ACU,
  evaluateOversizedWriteWarnings_ACU,
  getRecentOversizedWriteWarnings_ACU,
  measureOversizedWrite_ACU,
  normalizeOversizedWriteSettings_ACU,
  probeOversizedWrite_ACU,
  registerOversizedWriteWarningSink_ACU,
  resetOversizedWriteWarningStateForTests_ACU,
  resolveOversizedWriteSettings_ACU,
  type OversizedWriteSettings_ACU,
} from '../../../src/service/table/oversized-write-warning';

const SETTINGS: OversizedWriteSettings_ACU = {
  enabled: true,
  cellChars: 10_000,
  payloadBytes: 512 * 1024,
};

function makeTable(rows: (string | null)[][], sheetKey = 'sheet_character') {
  return {
    mate: { type: 'acu', version: 2, updateConfigUiSentinel: 0, globalInjectionConfig: {} } as any,
    [sheetKey]: {
      uid: 'u1',
      name: '角色表',
      sourceData: { ddl: '' } as any,
      content: rows,
      updateConfig: {} as any,
      exportConfig: {} as any,
      orderNo: 0,
    } as any,
  } as any;
}

beforeEach(() => {
  mocks.settings = {
    oversizedWriteWarningEnabled: true,
    oversizedCellWarnChars: 10_000,
    oversizedWriteWarnBytes: 512 * 1024,
  };
  mocks.logWarn.mockClear();
  resetOversizedWriteWarningStateForTests_ACU();
});

describe('normalizeOversizedWriteSettings_ACU', () => {
  it('空输入回落默认值与默认开关', () => {
    expect(normalizeOversizedWriteSettings_ACU()).toEqual({
      enabled: true,
      cellChars: OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU,
      payloadBytes: OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU,
    });
  });

  it('非法输入回落默认值', () => {
    expect(normalizeOversizedWriteSettings_ACU({
      enabled: 'yes',
      cellChars: 'abc',
      payloadBytes: Number.NaN,
    })).toEqual({
      enabled: true,
      cellChars: OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU,
      payloadBytes: OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU,
    });
  });

  it('上下界裁剪且取整', () => {
    expect(normalizeOversizedWriteSettings_ACU({
      enabled: false,
      cellChars: 1,
      payloadBytes: 1,
    })).toEqual({
      enabled: false,
      cellChars: OVERSIZED_CELL_WARN_CHARS_MIN_ACU,
      payloadBytes: OVERSIZED_PAYLOAD_WARN_BYTES_MIN_ACU,
    });
    expect(normalizeOversizedWriteSettings_ACU({
      cellChars: 99_999_999_999,
      payloadBytes: 99_999_999_999,
    })).toEqual({
      enabled: true,
      cellChars: OVERSIZED_CELL_WARN_CHARS_MAX_ACU,
      payloadBytes: OVERSIZED_PAYLOAD_WARN_BYTES_MAX_ACU,
    });
    expect(normalizeOversizedWriteSettings_ACU({ cellChars: 12_345.9 }).cellChars).toBe(12_345);
  });

  it('解析当前设置为归一化结果', () => {
    mocks.settings.oversizedCellWarnChars = 20_000;
    mocks.settings.oversizedWriteWarnBytes = 1024 * 1024;
    mocks.settings.oversizedWriteWarningEnabled = false;
    expect(resolveOversizedWriteSettings_ACU()).toEqual({
      enabled: false,
      cellChars: 20_000,
      payloadBytes: 1024 * 1024,
    });
  });
});

describe('measureOversizedWrite_ACU', () => {
  it('跳过表头行与空/非字符串单元格', () => {
    const table = makeTable([
      ['名字', '很长很长的表头'.repeat(100)],
      ['甲', null],
      ['乙', '正文'],
    ]);
    const metrics = measureOversizedWrite_ACU({ tableData: table });
    expect(metrics.maxCell).toEqual({
      chars: 2,
      sheetKey: 'sheet_character',
      rowIndex: 2,
      columnIndex: 1,
    });
  });

  it('只扫描本次写入命中的表', () => {
    const table = makeTable([['h'], ['短']]);
    (table as any).sheet_other = {
      uid: 'u2', name: '其它', sourceData: { ddl: '' }, content: [['h'], ['超长'.repeat(5000)]],
      updateConfig: {}, exportConfig: {}, orderNo: 1,
    };
    const scoped = measureOversizedWrite_ACU({ tableData: table, sheetKeys: ['sheet_character'] });
    expect(scoped.maxCell?.sheetKey).toBe('sheet_character');
    const all = measureOversizedWrite_ACU({ tableData: table });
    expect(all.maxCell?.sheetKey).toBe('sheet_other');
    expect(all.maxCell?.chars).toBe(10_000);
  });

  it('载荷按 UTF-8 字节计', () => {
    const operations = [{ kind: 'sql_batch', statements: ['INSERT INTO t VALUES (\'中文\')'] }];
    const expected = new TextEncoder().encode(JSON.stringify(operations)).length;
    const metrics = measureOversizedWrite_ACU({ operations });
    expect(metrics.payloadBytes).toBe(expected);
    expect(metrics.payloadBytes).toBeGreaterThan(JSON.stringify(operations).length);
  });

  it('空载荷为 0，循环引用不抛错', () => {
    expect(measureOversizedWrite_ACU({}).payloadBytes).toBe(0);
    const circular: any = { a: 1 };
    circular.self = circular;
    expect(() => measureOversizedWrite_ACU({ operations: [circular] })).not.toThrow();
    expect(measureOversizedWrite_ACU({ operations: [circular] }).payloadBytes).toBe(0);
  });
});

describe('evaluateOversizedWriteWarnings_ACU', () => {
  it('开关关闭时永不产出', () => {
    expect(evaluateOversizedWriteWarnings_ACU(
      { maxCell: { chars: 999_999, sheetKey: 's', rowIndex: 1, columnIndex: 0 }, payloadBytes: 10_000_000 },
      { ...SETTINGS, enabled: false },
    )).toEqual([]);
  });

  it('恰好等于阈值即警告（含两个维度）', () => {
    const warnings = evaluateOversizedWriteWarnings_ACU(
      { maxCell: { chars: 10_000, sheetKey: 's', rowIndex: 2, columnIndex: 3 }, payloadBytes: 512 * 1024 },
      SETTINGS,
      1234,
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ kind: 'cell', value: 10_000, threshold: 10_000, unit: 'chars', sheetKey: 's', rowIndex: 2, columnIndex: 3, at: 1234 });
    expect(warnings[1]).toMatchObject({ kind: 'payload', value: 512 * 1024, threshold: 512 * 1024, unit: 'bytes', at: 1234 });
  });

  it('低于阈值不警告', () => {
    expect(evaluateOversizedWriteWarnings_ACU(
      { maxCell: { chars: 9_999, sheetKey: 's', rowIndex: 1, columnIndex: 0 }, payloadBytes: 512 * 1024 - 1 },
      SETTINGS,
    )).toEqual([]);
  });
});

describe('probeOversizedWrite_ACU', () => {
  const BIG_CELL = 'x'.repeat(10_001);

  it('超阈值时记日志、留最近记录并通知订阅者', () => {
    const sink = vi.fn();
    registerOversizedWriteWarningSink_ACU(sink);
    probeOversizedWrite_ACU({
      tableData: makeTable([['h'], [BIG_CELL]]),
      sheetKeys: ['sheet_character'],
      chatKey: 'chat-a',
    });
    expect(mocks.logWarn).toHaveBeenCalledTimes(1);
    expect(String(mocks.logWarn.mock.calls[0][0])).toContain('"kind":"cell"');
    expect(sink).toHaveBeenCalledTimes(1);
    expect(getRecentOversizedWriteWarnings_ACU()).toHaveLength(1);
  });

  it('同档位重复写入只提示一次；回落后再超标可重新提示', () => {
    const sink = vi.fn();
    registerOversizedWriteWarningSink_ACU(sink);
    const write = (chars: number) => probeOversizedWrite_ACU({
      tableData: makeTable([['h'], ['x'.repeat(chars)]]),
      sheetKeys: ['sheet_character'],
      chatKey: 'chat-b',
    });

    write(10_001);
    write(10_500);
    expect(sink).toHaveBeenCalledTimes(1);

    write(9_999); // 回落到阈值以下，重置
    write(10_001);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('数量级翻倍时再提示一次', () => {
    const sink = vi.fn();
    registerOversizedWriteWarningSink_ACU(sink);
    const write = (chars: number) => probeOversizedWrite_ACU({
      tableData: makeTable([['h'], ['x'.repeat(chars)]]),
      sheetKeys: ['sheet_character'],
      chatKey: 'chat-c',
    });

    write(10_001);
    write(20_001); // 翻倍 → 高一档
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('开关关闭时零日志、零通知、零记录', () => {
    mocks.settings.oversizedWriteWarningEnabled = false;
    const sink = vi.fn();
    registerOversizedWriteWarningSink_ACU(sink);
    probeOversizedWrite_ACU({
      tableData: makeTable([['h'], [BIG_CELL]]),
      operations: [{ huge: 'x'.repeat(1_000_000) }],
      chatKey: 'chat-d',
    });
    expect(mocks.logWarn).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
    expect(getRecentOversizedWriteWarnings_ACU()).toEqual([]);
  });

  it('未超阈值时零噪音', () => {
    probeOversizedWrite_ACU({ tableData: makeTable([['h'], ['short']]), chatKey: 'chat-e' });
    expect(mocks.logWarn).not.toHaveBeenCalled();
    expect(getRecentOversizedWriteWarnings_ACU()).toEqual([]);
  });

  it('订阅者抛错不影响探针本身', () => {
    registerOversizedWriteWarningSink_ACU(() => { throw new Error('sink boom'); });
    expect(() => probeOversizedWrite_ACU({
      tableData: makeTable([['h'], [BIG_CELL]]),
      chatKey: 'chat-f',
    })).not.toThrow();
    expect(mocks.logWarn).toHaveBeenCalledTimes(1);
  });

  it('最近记录有上限', () => {
    for (let i = 0; i < OVERSIZED_WRITE_RECENT_LIMIT_ACU + 5; i += 1) {
      probeOversizedWrite_ACU({
        tableData: makeTable([['h'], [BIG_CELL]]),
        chatKey: `chat-${i}`,
      });
    }
    expect(getRecentOversizedWriteWarnings_ACU()).toHaveLength(OVERSIZED_WRITE_RECENT_LIMIT_ACU);
  });
});

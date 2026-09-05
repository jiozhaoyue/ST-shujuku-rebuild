/**
 * tests/service/ai/table-injection-scope.test.ts — 差量注入热表解析
 * hot = (recentTouched ∪ explicitHot) − explicitCold；cold 恒胜出。
 */
import { describe, it, expect } from 'vitest';
import { resolveDifferentialHotSheetKeys_ACU } from '../../src/service/ai/prompt-builder/table-injection-scope';

describe('resolveDifferentialHotSheetKeys_ACU', () => {
  it('空输入 → 空集合', () => {
    expect(resolveDifferentialHotSheetKeys_ACU({}).size).toBe(0);
  });

  it('enabled 缺省/false → 空集合（缺省全量注入）', () => {
    expect(resolveDifferentialHotSheetKeys_ACU({ hotSheetKeys: ['sheet_a'] } as any).size).toBe(0);
    expect(resolveDifferentialHotSheetKeys_ACU({ enabled: false, hotSheetKeys: ['sheet_a'] }).size).toBe(0);
  });

  it('recentTouched 与 explicitHot 并集', () => {
    const hot = resolveDifferentialHotSheetKeys_ACU({
      enabled: true,
      recentTouchedSheetKeys: ['sheet_a'],
      hotSheetKeys: ['sheet_b'],
    });
    expect(hot.has('sheet_a')).toBe(true);
    expect(hot.has('sheet_b')).toBe(true);
  });

  it('explicitCold 压过 recent 与 hot', () => {
    const hot = resolveDifferentialHotSheetKeys_ACU({
      enabled: true,
      recentTouchedSheetKeys: ['sheet_a', 'sheet_c'],
      hotSheetKeys: ['sheet_b'],
      coldSheetKeys: ['sheet_a', 'sheet_b'],
    });
    expect(hot.has('sheet_a')).toBe(false);
    expect(hot.has('sheet_b')).toBe(false);
    expect(hot.has('sheet_c')).toBe(true);
  });

  it('重复键幂等；非法输入不抛错', () => {
    const hot = resolveDifferentialHotSheetKeys_ACU({
      enabled: true,
      recentTouchedSheetKeys: ['sheet_a', 'sheet_a'],
      hotSheetKeys: 'not-array' as any,
    });
    expect([...hot]).toEqual(['sheet_a']);
  });
});

/**
 * tests/service/ai/table-injection-scope.test.ts — 差量注入热表解析
 * hot = (recentTouched ∪ explicitHot) − explicitCold；cold 恒胜出。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveDifferentialHotSheetKeys_ACU,
  recordTouchedSheetKeys_ACU,
  getRecentTouchedSheetKeys_ACU,
  _resetRecentTouchedLedgerForTests_ACU,
  expandSheetSelectorsToKeys_ACU,
  buildDifferentialInjectionFromSettings_ACU,
} from '../../../src/service/ai/prompt-builder/table-injection-scope';

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

describe('近期改动表账本', () => {
  afterEach(() => {
    _resetRecentTouchedLedgerForTests_ACU();
  });
  it('空账本 → null（无信号）', () => {
    expect(getRecentTouchedSheetKeys_ACU()).toBeNull();
  });

  it('记录 K 批内并集；非法输入静默忽略', () => {
    recordTouchedSheetKeys_ACU(['sheet_a', 'sheet_b']);
    recordTouchedSheetKeys_ACU(['sheet_b', 'sheet_c']);
    recordTouchedSheetKeys_ACU('garbage');
    recordTouchedSheetKeys_ACU([1, null, 'sheet_d']);
    const keys = getRecentTouchedSheetKeys_ACU();
    expect(keys).not.toBeNull();
    expect(new Set(keys as string[])).toEqual(new Set(['sheet_a', 'sheet_b', 'sheet_c', 'sheet_d']));
  });

  it('只保留最近 K=3 批，最旧批滚出', () => {
    recordTouchedSheetKeys_ACU(['sheet_old']);
    recordTouchedSheetKeys_ACU(['sheet_m1']);
    recordTouchedSheetKeys_ACU(['sheet_m2']);
    recordTouchedSheetKeys_ACU(['sheet_new']);
    const keys = getRecentTouchedSheetKeys_ACU() as string[];
    expect(keys).not.toContain('sheet_old');
    expect(new Set(keys)).toEqual(new Set(['sheet_new', 'sheet_m2', 'sheet_m1']));
  });
});

describe('名单展开与设置构造', () => {
  const tableData = {
    sheet_a: { name: '背包' },
    sheet_b: { name: '纪要' },
    sheet_c: { name: '背包' },
  };

  it('expandSheetSelectorsToKeys_ACU：键直配 + 名称匹配（同名多键全收）', () => {
    const keys = expandSheetSelectorsToKeys_ACU(['sheet_a', '背包', '不存在'], tableData);
    expect(new Set(keys)).toEqual(new Set(['sheet_a', 'sheet_c']));
  });

  it('expandSheetSelectorsToKeys_ACU：空/非法输入 → 空集合', () => {
    expect(expandSheetSelectorsToKeys_ACU(null, tableData).size).toBe(0);
    expect(expandSheetSelectorsToKeys_ACU('x,y', null).size).toBe(0);
  });

  it('buildDifferentialInjectionFromSettings_ACU：关→enabled false；开→CSV 解析+账本并入', () => {
    _resetRecentTouchedLedgerForTests_ACU();
    recordTouchedSheetKeys_ACU(['sheet_b']);
    const off = buildDifferentialInjectionFromSettings_ACU({ differentialInjectionEnabled: false, differentialHotSheets: '背包' });
    expect(off.enabled).toBe(false);
    const on = buildDifferentialInjectionFromSettings_ACU({
      differentialInjectionEnabled: true,
      differentialHotSheets: '背包, sheet_b',
      differentialColdSheets: '纪要',
    });
    expect(on.enabled).toBe(true);
    expect(on.hotSheetKeys).toEqual(['背包', 'sheet_b']);
    expect(on.coldSheetKeys).toEqual(['纪要']);
    expect(on.recentTouchedSheetKeys).toEqual(['sheet_b']);
    _resetRecentTouchedLedgerForTests_ACU();
  });
});

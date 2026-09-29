import { describe, expect, it } from 'vitest';
import {
  formatCanonicalRowIssues_ACU,
  isEmptyCanonicalRowId_ACU,
  normalizeCanonicalTableRows_ACU,
  repairLegacyAutoMergedRowTails_ACU,
  repairLegacyOrphanIdentityColumn_ACU,
  repairOrphanIdentityColumnOnSheet_ACU,
  restoreLegacyRowIdentity_ACU,
} from '../../../src/shared/canonical-row-normalizer';

describe('canonical-row-normalizer', () => {
  it('识别 null、undefined 与空白 row_id，但保留字符串 null/undefined', () => {
    expect(isEmptyCanonicalRowId_ACU(null)).toBe(true);
    expect(isEmptyCanonicalRowId_ACU(undefined)).toBe(true);
    expect(isEmptyCanonicalRowId_ACU('  ')).toBe(true);
    expect(isEmptyCanonicalRowId_ACU('null')).toBe(false);
    expect(isEmptyCanonicalRowId_ACU('undefined')).toBe(false);
  });

  it('同时规范化 content 与 seedRows，并只删除空 row_id 行', () => {
    const data: any = {
      sheet_0: {
        content: [[null, '名称'], [null, '坏行1'], [undefined, '坏行2'], ['  ', '坏行3'], [' null ', '保留']],
        seedRows: [[null, '坏种子'], ['undefined', '保留种子']],
      },
    };

    const result = normalizeCanonicalTableRows_ACU(data);

    expect(data.sheet_0.content).toEqual([['row_id', '名称'], ['null', '保留']]);
    expect(data.sheet_0.seedRows).toEqual([['undefined', '保留种子']]);
    expect(result.changedSheetKeys).toEqual(['sheet_0']);
    expect(result.removedRows).toHaveLength(4);
    expect(result.errors).toEqual([]);
  });

  it('表头已经是 row_id 时仍扫描数据行', () => {
    const data: any = { sheet_0: { content: [['row_id', '名称'], ['', '坏行'], ['1', '好行']] } };
    const result = normalizeCanonicalTableRows_ACU(data);
    expect(data.sheet_0.content).toEqual([['row_id', '名称'], ['1', '好行']]);
    expect(result.removedRows).toEqual([{ sheetKey: 'sheet_0', rowIndex: 1, reason: 'empty_row_id' }]);
  });

  it('重复 row_id 与非数组行作为错误保留拒绝证据，不静默选择赢家', () => {
    const invalidRow = { secret: '不得进入错误文本' };
    const data: any = { sheet_0: { content: [['row_id', '名称'], ['1', '甲'], ['1', '乙'], invalidRow] } };
    const result = normalizeCanonicalTableRows_ACU(data);

    expect(data.sheet_0.content).toEqual([['row_id', '名称'], ['1', '甲'], ['1', '乙']]);
    expect(result.errors).toEqual([
      { sheetKey: 'sheet_0', rowIndex: 2, reason: 'duplicate_row_id' },
      { sheetKey: 'sheet_0', rowIndex: 3, reason: 'invalid_row' },
    ]);
    expect(formatCanonicalRowIssues_ACU(result.errors)).toBe('sheet_0 第 2 行：duplicate_row_id；sheet_0 第 3 行：invalid_row');
    expect(formatCanonicalRowIssues_ACU(result.errors)).not.toContain('不得进入错误文本');
  });

  it('将历史“行号”首列视为已有身份并仅改名，不右移业务列或重分配 ID', () => {
    const data: any = {
      sheet_0: {
        content: [['行号', '名称'], ['7', '药水']],
        seedRows: [['8', '种子药水']],
      },
    };

    const result = restoreLegacyRowIdentity_ACU(data);

    expect(data.sheet_0).toEqual({
      content: [['row_id', '名称'], ['7', '药水']],
      seedRows: [['8', '种子药水']],
    });
    expect(result.repairs).toEqual([{ sheetKey: 'sheet_0', rowIndex: 0, code: 'header_identity_alias' }]);
    expect(result.conservation).toEqual({
      rowCountBefore: 2, rowCountAfter: 2,
      businessCellCountBefore: 2, businessCellCountAfter: 2,
    });
  });

  it('只剥离恰好多一格且末位严格为 auto_merged 的历史尾标记', () => {
    const data: any = {
      sheet_0: {
        content: [
          ['row_id', '名称'],
          ['1', '历史自动合并行', 'auto_merged'],
          ['2', '额外业务列', 'auto_merged', '仍然保留'],
          ['3', '非标记尾列', 'manual'],
        ],
      },
    };

    expect(repairLegacyAutoMergedRowTails_ACU(data)).toEqual(['sheet_0']);
    expect(data.sheet_0.content).toEqual([
      ['row_id', '名称'],
      ['1', '历史自动合并行'],
      ['2', '额外业务列', 'auto_merged', '仍然保留'],
      ['3', '非标记尾列', 'manual'],
    ]);
  });

  it('不把 seedRows 当作运行时历史尾标记修复对象', () => {
    const data: any = { sheet_0: { content: [['row_id', '名称'], ['1', '正常']], seedRows: [['2', '种子', 'auto_merged']] } };
    expect(repairLegacyAutoMergedRowTails_ACU(data)).toEqual([]);
    expect(data.sheet_0.seedRows).toEqual([['2', '种子', 'auto_merged']]);
  });

  it('历史前导零 row_id 保持原值，新空身份分配到 SQLite 不冲突的下一整数', () => {
    const data: any = {
      sheet_0: {
        content: [['row_id', '名称'], ['01', '旧行'], [null, '新行']],
        seedRows: [],
      },
    };

    const identity = restoreLegacyRowIdentity_ACU(data);
    const normalization = normalizeCanonicalTableRows_ACU(data);

    expect(data.sheet_0.content).toEqual([
      ['row_id', '名称'],
      ['01', '旧行'],
      ['2', '新行'],
    ]);
    expect(identity.repairs).toContainEqual({ sheetKey: 'sheet_0', rowIndex: 2, code: 'assigned_row_id' });
    expect(normalization.errors).toEqual([]);
    expect(normalization.removedRows).toEqual([]);
  });
});

describe('canonical-row-normalizer · 孤儿身份列复位（缺陷 ② 回归）', () => {
  // 形态取自 Dev ST 聊天 `Branch #206 - 2026-04-11@01h39m54s486ms` 的真实
  // storageFrame.checkpoint.data：xing 时代首格 undefined 被误插 row_id 后固化为
  // ["row_id", null, 业务列…]，行尾补 null —— 表头与行值整体错开一格。
  // 未复位时会喂给 resolveEffectiveDDL → generateFallbackDDL 抛
  // `fallback DDL 表头不合法：第 2 列「」empty_column_name`（真机实测文案）。
  const orphanSheet = () => ({
    name: '背包物品表',
    content: [
      ['row_id', null, '物品名称', '数量', '描述/效果', '类别'],
      ['1', '手机', '1', '通讯与网购工具', '杂物', null],
    ],
    seedRows: [] as unknown[][],
  });

  it('数据级复位：删掉空标签孤儿列，列名与行值重新对齐', () => {
    const data: any = { sheet_in05z9vz: orphanSheet() };
    const result = repairLegacyOrphanIdentityColumn_ACU(data);

    expect(result.changedSheetKeys).toEqual(['sheet_in05z9vz']);
    expect(result.warnings).toEqual([]);
    expect(data.sheet_in05z9vz.content).toEqual([
      ['row_id', '物品名称', '数量', '描述/效果', '类别'],
      ['1', '手机', '1', '通讯与网购工具', '杂物'],
    ]);
  });

  it('单表复位与数据级共用同一份规则（changed=true，无 warning）', () => {
    const sheet: any = orphanSheet();
    const result = repairOrphanIdentityColumnOnSheet_ACU('sheet_in05z9vz', sheet);

    expect(result).toEqual({ changed: true });
    expect(sheet.content[0]).toEqual(['row_id', '物品名称', '数量', '描述/效果', '类别']);
    expect(sheet.content[1]).toEqual(['1', '手机', '1', '通讯与网购工具', '杂物']);
  });

  it('row[1] 为空的行走 splice 分支，同样只删空格', () => {
    const sheet: any = { name: '后加表', content: [['row_id', null, '名称'], ['1', null, '甲']], seedRows: [] };

    expect(repairOrphanIdentityColumnOnSheet_ACU('sheet_x', sheet).changed).toBe(true);
    expect(sheet.content).toEqual([['row_id', '名称'], ['1', '甲']]);
  });

  it('歧义行（第 1 列与尾格均非空）整表放弃并给 warning，绝不删可能的业务值', () => {
    const sheet: any = { name: '歧义表', content: [['row_id', null, '名称'], ['1', '甲', '乙']], seedRows: [] };
    const result = repairOrphanIdentityColumnOnSheet_ACU('sheet_y', sheet);

    expect(result.changed).toBe(false);
    expect(result.warning).toContain('无法无损判定，已放弃复位');
    expect(sheet.content).toEqual([['row_id', null, '名称'], ['1', '甲', '乙']]);
  });

  it('幂等：复位后不再命中指纹', () => {
    const sheet: any = orphanSheet();

    expect(repairOrphanIdentityColumnOnSheet_ACU('sheet_in05z9vz', sheet).changed).toBe(true);
    expect(repairOrphanIdentityColumnOnSheet_ACU('sheet_in05z9vz', sheet)).toEqual({ changed: false });
  });

  it('健康表头不误伤：首列 null 占位与字面 row_id 两种规范形态都不动', () => {
    const placeholder: any = { content: [[null, '名称'], ['1', '甲']], seedRows: [] };
    const literal: any = { content: [['row_id', '名称'], ['1', '甲']], seedRows: [] };

    expect(repairOrphanIdentityColumnOnSheet_ACU('sheet_z', placeholder)).toEqual({ changed: false });
    expect(repairOrphanIdentityColumnOnSheet_ACU('sheet_w', literal)).toEqual({ changed: false });
  });
});

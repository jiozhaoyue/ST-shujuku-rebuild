/**
 * tests/service/table/write-pipeline-observer.test.ts
 * 写库流水观测器 单元测试
 *
 * 覆盖 design §7 的行：双方言富化、9 种 operation kind、未知 kind 不抛错、
 * 三重上限截断、开关关闭零记录、导出脱敏、就近关联的时间窗与来源映射。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLatestByScope, mockLogDebug } = vi.hoisted(() => ({
  mockLatestByScope: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/service/ai/prompt-observer', () => ({
  getLatestObservationIdForScope_ACU: mockLatestByScope,
}));

vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return { ...actual, logDebug_ACU: mockLogDebug };
});

import {
  __resetTableWriteObservationForTests_ACU,
  WRITE_PIPELINE_MAX_RECORDS_ACU,
  WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU,
  WRITE_PIPELINE_PROMPT_LINK_MAX_AGE_MS_ACU,
  clearTableWritePipeline_ACU,
  exportTableWritePipeline_ACU,
  getTableWritePipelineRecords_ACU,
  isTableWriteObservationEnabled_ACU,
  recordTableWritePipeline_ACU,
  setTableWriteObservationEnabled_ACU,
  subscribeTableWritePipeline_ACU,
  summarizeMutationOperations_ACU,
} from '../../../src/service/table/write-pipeline-observer';

/** 造一条最小记录输入。 */
function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    source: 'auto_fill',
    reason: 'applyFill',
    outcome: 'saved' as const,
    targetMessageIndex: 7,
    targetSheetKeys: ['sheet_backpack'],
    operations: [],
    ...overrides,
  } as Parameters<typeof recordTableWritePipeline_ACU>[0];
}

describe('summarizeMutationOperations_ACU（纯函数富化）', () => {
  it('sql_sheet_batch / sql_batch：逐条解析出操作类型与表名', () => {
    const result = summarizeMutationOperations_ACU([
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_backpack', statements: [
        'INSERT INTO backpack (name, qty) VALUES (\'potion\', 3)',
        'UPDATE backpack SET qty = 4 WHERE name = \'potion\'',
        'DELETE FROM backpack WHERE name = \'potion\'',
      ] },
      { kind: 'sql_batch', statements: ['INSERT INTO other (a) VALUES (1)'] },
    ]);

    expect(result.truncated).toBe(false);
    expect(result.statements.map(stat => stat.operation)).toEqual(['insert', 'update', 'delete', 'insert']);
    expect(result.statements.every(stat => stat.dialect === 'sql')).toBe(true);
    expect(result.statements[0].tables).toEqual(['backpack']);
    expect(result.statements[0].text).toContain('INSERT INTO backpack');
    expect(result.statements[3].tables).toEqual(['other']);
  });

  it('裸 SQL 解析失败时降级 other 并保留原文（不抛错）', () => {
    const result = summarizeMutationOperations_ACU([
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_x', statements: ['SELECT * FROM x', 'VACUUM'] },
    ]);

    expect(result.statements).toHaveLength(2);
    expect(result.statements.map(stat => stat.operation)).toEqual(['other', 'other']);
    expect(result.statements[0].text).toBe('SELECT * FROM x');
    expect(result.statements[1].text).toBe('VACUUM');
  });

  it('table_edit_dsl：按行拆出多条指令，首参索引记作 #N', () => {
    const result = summarizeMutationOperations_ACU([
      { kind: 'table_edit_dsl', text: 'insertRow(0, {"0": "药水"})\nupdateRow(1, 2, {"0": "x"})\ndeleteRow(0, 3)' },
    ]);

    expect(result.statements).toHaveLength(3);
    expect(result.statements.map(stat => stat.operation)).toEqual(['insert', 'update', 'delete']);
    expect(result.statements.every(stat => stat.dialect === 'dsl')).toBe(true);
    expect(result.statements[0].tables).toEqual(['#0']);
    expect(result.statements[1].tables).toEqual(['#1']);
  });

  it('table_edit_dsl：拆不出指令时整段留一条 other（不误报为 0 条）', () => {
    const result = summarizeMutationOperations_ACU([
      { kind: 'table_edit_dsl', text: '这段没有可识别的指令\n第二行也没有' },
    ]);

    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].operation).toBe('other');
    expect(result.statements[0].text).toContain('这段没有可识别的指令');
  });

  it('table_edit_dsl：行内注释形态不产出语句', () => {
    const result = summarizeMutationOperations_ACU([
      { kind: 'table_edit_dsl', text: '<!-- insertRow(0, {"0": "x"}) -->' },
    ]);
    // 只剩「拆不出指令」的兜底一条，且不含被注释的指令本身
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].operation).toBe('other');
  });

  it('结构化 kind：sheet_replace / data_replace / sheet_schema_migrate / row_upsert / row_delete / meta_update', () => {
    const result = summarizeMutationOperations_ACU([
      { kind: 'sheet_replace', sheetKey: 'sheet_a', reason: 'manual_crud' },
      { kind: 'data_replace', reason: 'import' },
      { kind: 'sheet_schema_migrate', sheetKey: 'sheet_b' },
      { kind: 'row_upsert', sheetKey: 'sheet_c' },
      { kind: 'row_delete', sheetKey: 'sheet_d' },
      { kind: 'meta_update', sheetKey: 'sheet_e' },
    ]);

    expect(result.statements.map(stat => stat.operation)).toEqual(['replace', 'replace', 'schema', 'other', 'other', 'other']);
    expect(result.statements.every(stat => stat.dialect === 'structured')).toBe(true);
    expect(result.statements[0].tables).toEqual(['sheet_a']);
    expect(result.statements[2].tables).toEqual(['sheet_b']);
    expect(result.statements[5].tables).toEqual(['sheet_e']);
  });

  it('未知 kind 与畸形对象不抛错，保留线索', () => {
    const result = summarizeMutationOperations_ACU([
      { kind: 'brand_new_kind', sheetKey: 'sheet_z' },
      null,
      undefined,
      'not-an-operation',
      { noKind: true },
    ]);

    expect(result.statements).toHaveLength(5);
    expect(result.statements[0].text).toBe('brand_new_kind');
    expect(result.statements[1].text).toBe('(无 kind)');
    expect(result.statements[2].text).toBe('(无 kind)');
  });

  it('非数组入参返回空语句集（不抛错）', () => {
    expect(summarizeMutationOperations_ACU(undefined).statements).toEqual([]);
    expect(summarizeMutationOperations_ACU(null).statements).toEqual([]);
    expect(summarizeMutationOperations_ACU('nope').statements).toEqual([]);
  });

  it('单条超上限截断并置 truncated，chars 记截断前长度', () => {
    const longStatement = `INSERT INTO big (a) VALUES ('${'x'.repeat(WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU + 500)}')`;
    const result = summarizeMutationOperations_ACU([
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_big', statements: [longStatement] },
    ]);

    const stat = result.statements[0];
    expect(stat.truncated).toBe(true);
    expect(stat.chars).toBe(longStatement.length);
    expect(stat.text.length).toBe(WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU);
  });

  it('语句集超总预算时裁剪并置 truncated', () => {
    // 每条接近单条上限 ⇒ 约 270 条即越过 2 MiB 总预算
    const statements = Array.from({ length: 400 }, (_, index) => `INSERT INTO t (a) VALUES ('${'y'.repeat(WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU - 100)}${index}')`);
    const result = summarizeMutationOperations_ACU([
      { kind: 'sql_sheet_batch', sheetKey: 'sheet_many', statements },
    ]);

    expect(result.truncated).toBe(true);
    expect(result.statements.length).toBeLessThan(statements.length);
  });
});

describe('recordTableWritePipeline_ACU', () => {
  beforeEach(() => {
    __resetTableWriteObservationForTests_ACU();
    mockLatestByScope.mockReset();
  });

  it('开关关闭时零记录（模块自守）', () => {
    recordTableWritePipeline_ACU(makeInput({ operations: [{ kind: 'sql_batch', statements: ['INSERT INTO a (b) VALUES (1)'] }] }));
    expect(isTableWriteObservationEnabled_ACU()).toBe(false);
    expect(getTableWritePipelineRecords_ACU()).toHaveLength(0);
  });

  it('开关开启时记录来源 / 结果 / 楼层 / 表 / 语句', () => {
    setTableWriteObservationEnabled_ACU(true);
    recordTableWritePipeline_ACU(makeInput({
      source: 'group_fill',
      reason: 'applyUnifiedGroupFillResponses:runtime_sql',
      outcome: 'saved',
      targetMessageIndex: 12,
      targetSheetKeys: ['sheet_a', 'sheet_b'],
      operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_a', statements: ['INSERT INTO a (b) VALUES (1)'] }],
    }));

    const records = getTableWritePipelineRecords_ACU();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.source).toBe('group_fill');
    expect(record.reason).toBe('applyUnifiedGroupFillResponses:runtime_sql');
    expect(record.outcome).toBe('saved');
    expect(record.targetMessageIndex).toBe(12);
    expect(record.targetSheetKeys).toEqual(['sheet_a', 'sheet_b']);
    expect(record.statementCount).toBe(1);
    expect(record.statements[0].tables).toEqual(['a']);
    expect(record.operationsUnavailable).toBeUndefined();
  });

  it('operations 为空时置 operationsUnavailable（不伪造语句）', () => {
    setTableWriteObservationEnabled_ACU(true);
    recordTableWritePipeline_ACU(makeInput({ operations: undefined }));

    const record = getTableWritePipelineRecords_ACU()[0];
    expect(record.operationsUnavailable).toBe(true);
    expect(record.statements).toEqual([]);
    expect(record.statementCount).toBe(0);
  });

  it('失败结果带 errorCategory', () => {
    setTableWriteObservationEnabled_ACU(true);
    recordTableWritePipeline_ACU(makeInput({ outcome: 'failed', errorCategory: 'model' }));

    const record = getTableWritePipelineRecords_ACU()[0];
    expect(record.outcome).toBe('failed');
    expect(record.errorCategory).toBe('model');
  });

  it('runtime_only 结果被如实记录', () => {
    setTableWriteObservationEnabled_ACU(true);
    recordTableWritePipeline_ACU(makeInput({ outcome: 'runtime_only' }));
    expect(getTableWritePipelineRecords_ACU()[0].outcome).toBe('runtime_only');
  });

  it('环形上限：超出条数上限丢最旧', () => {
    setTableWriteObservationEnabled_ACU(true);
    for (let index = 0; index < WRITE_PIPELINE_MAX_RECORDS_ACU + 5; index += 1) {
      recordTableWritePipeline_ACU(makeInput({ targetMessageIndex: index }));
    }

    const records = getTableWritePipelineRecords_ACU();
    expect(records).toHaveLength(WRITE_PIPELINE_MAX_RECORDS_ACU);
    expect(records[0].targetMessageIndex).toBe(5);
    expect(records[records.length - 1].targetMessageIndex).toBe(WRITE_PIPELINE_MAX_RECORDS_ACU + 4);
  });

  it('订阅者收到通知；清空后归零', () => {
    setTableWriteObservationEnabled_ACU(true);
    const seen: number[] = [];
    const unsubscribe = subscribeTableWritePipeline_ACU(records => seen.push(records.length));

    recordTableWritePipeline_ACU(makeInput());
    expect(seen).toEqual([1]);

    clearTableWritePipeline_ACU('test');
    expect(seen).toEqual([1, 0]);
    expect(getTableWritePipelineRecords_ACU()).toHaveLength(0);

    unsubscribe();
    recordTableWritePipeline_ACU(makeInput());
    expect(seen).toEqual([1, 0]);
  });

  it('订阅者抛错不影响记录与其它订阅者', () => {
    setTableWriteObservationEnabled_ACU(true);
    subscribeTableWritePipeline_ACU(() => { throw new Error('boom'); });
    const seen: number[] = [];
    subscribeTableWritePipeline_ACU(records => seen.push(records.length));

    expect(() => recordTableWritePipeline_ACU(makeInput())).not.toThrow();
    expect(seen).toEqual([1]);
  });

  it('畸形输入不抛错', () => {
    setTableWriteObservationEnabled_ACU(true);
    expect(() => recordTableWritePipeline_ACU({} as never)).not.toThrow();
    expect(() => recordTableWritePipeline_ACU(undefined as never)).not.toThrow();
    expect(getTableWritePipelineRecords_ACU()).toHaveLength(2);
  });
});

describe('就近关联（promptRecordId）', () => {
  beforeEach(() => {
    __resetTableWriteObservationForTests_ACU();
    mockLatestByScope.mockReset();
    setTableWriteObservationEnabled_ACU(true);
  });

  it('窗口内且来源有 scope 时带上 promptRecordId', () => {
    mockLatestByScope.mockReturnValue({ id: 42, at: Date.now() - 1000 });
    recordTableWritePipeline_ACU(makeInput({ source: 'auto_fill' }));

    expect(mockLatestByScope).toHaveBeenCalledWith('table-fill');
    expect(getTableWritePipelineRecords_ACU()[0].promptRecordId).toBe(42);
  });

  it('merge_summary 走 summary scope', () => {
    mockLatestByScope.mockReturnValue({ id: 7, at: Date.now() });
    recordTableWritePipeline_ACU(makeInput({ source: 'merge_summary' }));

    expect(mockLatestByScope).toHaveBeenCalledWith('summary');
    expect(getTableWritePipelineRecords_ACU()[0].promptRecordId).toBe(7);
  });

  it('超出时间窗不给关联（宁缺勿错）', () => {
    mockLatestByScope.mockReturnValue({ id: 42, at: Date.now() - WRITE_PIPELINE_PROMPT_LINK_MAX_AGE_MS_ACU - 1000 });
    recordTableWritePipeline_ACU(makeInput({ source: 'auto_fill' }));

    expect(getTableWritePipelineRecords_ACU()[0].promptRecordId).toBeUndefined();
  });

  it('不经 AI 的来源不给关联，也不查询', () => {
    recordTableWritePipeline_ACU(makeInput({ source: 'manual_crud' }));

    expect(mockLatestByScope).not.toHaveBeenCalled();
    expect(getTableWritePipelineRecords_ACU()[0].promptRecordId).toBeUndefined();
  });

  it('没有最近记录时不给关联', () => {
    mockLatestByScope.mockReturnValue(null);
    recordTableWritePipeline_ACU(makeInput({ source: 'manual_fill' }));

    expect(getTableWritePipelineRecords_ACU()[0].promptRecordId).toBeUndefined();
  });

  it('关联查询抛错不影响记录', () => {
    mockLatestByScope.mockImplementation(() => { throw new Error('scope boom'); });
    expect(() => recordTableWritePipeline_ACU(makeInput({ source: 'auto_fill' }))).not.toThrow();

    expect(getTableWritePipelineRecords_ACU()).toHaveLength(1);
    expect(getTableWritePipelineRecords_ACU()[0].promptRecordId).toBeUndefined();
  });
});

describe('导出脱敏', () => {
  beforeEach(() => {
    __resetTableWriteObservationForTests_ACU();
    mockLatestByScope.mockReset();
    setTableWriteObservationEnabled_ACU(true);
  });

  it('语句里的密钥不出现在导出里', () => {
    recordTableWritePipeline_ACU(makeInput({
      reason: 'fill with token=abcdef1234567890',
      operations: [{
        kind: 'sql_sheet_batch',
        sheetKey: 'sheet_secret',
        statements: ['INSERT INTO s (k) VALUES (\'{"api_key":"sk-ant-abcdefghijklmnopqrstuvwxyz"}\')'],
      }],
    }));

    const exported = exportTableWritePipeline_ACU();
    expect(exported).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz');
    expect(exported).not.toContain('abcdef1234567890');
    expect(exported).toContain('recordCount');
  });

  it('导出是合法 JSON 且句子文本在无密钥时原样保留', () => {
    recordTableWritePipeline_ACU(makeInput({
      operations: [{ kind: 'sql_sheet_batch', sheetKey: 'sheet_ok', statements: ['INSERT INTO t (a) VALUES (\'hello\')'] }],
    }));

    const parsed = JSON.parse(exportTableWritePipeline_ACU());
    expect(parsed.records[0].statements[0].text).toContain('hello');
  });
});

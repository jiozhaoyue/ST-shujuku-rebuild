import { describe, expect, it, vi } from 'vitest';

/**
 * 回放回归基线（A 节）：零覆盖导出函数的锚点用例。
 *
 * 目的：在移植 #5（快照机制将改写 storage-frame-v2-replay 的回放/诊断路径）之前，
 * 锁定这些导出的初始字段/空数组契约与纯函数行为。所有断言按 source 真实实现编写
 * （见各 it 注释中的 file:line），不猜行为。
 *
 * 本文件只读被测对象，不写 source/src 任何文件。
 */

const { mockLogWarn } = vi.hoisted(() => ({ mockLogWarn: vi.fn() }));

vi.mock('../../../src/shared/utils', async () => {
  const actual = await vi.importActual<any>('../../../src/shared/utils');
  return { ...actual, logWarn_ACU: mockLogWarn };
});

vi.mock('../../../src/shared/ui-surface-registry', () => ({
  getUiSurface_ACU: vi.fn(() => null),
  showUiSurfaceToast_ACU: vi.fn(),
}));

import {
  buildCompatReadonlyGuidance_ACU,
  createLegacyToleranceReport_ACU,
  createReplayMetrics_ACU,
  hasUnanchoredReplayArtifactsForChatV2_ACU,
  replaySpv79DuplicateRowIdHistory_ACU,
  summarizeLegacyToleranceReport_ACU,
  type LegacyToleranceDiagnosis_ACU,
} from '../../../src/service/table/storage-frame-v2-replay';

function makeCheckpointData() {
  return {
    mate: { type: 'acu', version: 1 },
    sheet_0: {
      uid: 'inventory',
      name: 'inventory',
      content: [['row_id', 'name'], ['1', '铁剑']],
      sourceData: { ddl: 'CREATE TABLE inventory (row_id INTEGER PRIMARY KEY, name TEXT);' },
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
  } as any;
}

describe('createLegacyToleranceReport_ACU (source/src/service/table/storage-frame-v2-replay.ts:236)', () => {
  it('初始报告所有计数为 0、列表为空数组（契约字段齐全）', () => {
    const report = createLegacyToleranceReport_ACU();
    expect(report).toEqual({
      outOfOrderSeqSorted: 0,
      legacyMetaUpdateDdlApplied: 0,
      unknownOperationKindsSkipped: [],
      lenientRowUpserts: 0,
      legacyDslRowIdAllocations: 0,
      identityRemaps: [],
    });
    expect(report.unknownOperationKindsSkipped).toEqual([]);
    expect(report.identityRemaps).toEqual([]);
  });

  it('多次调用返回互不共享的独立空数组', () => {
    const first = createLegacyToleranceReport_ACU();
    const second = createLegacyToleranceReport_ACU();
    expect(first.unknownOperationKindsSkipped).not.toBe(second.unknownOperationKindsSkipped);
    expect(first.identityRemaps).not.toBe(second.identityRemaps);
    first.unknownOperationKindsSkipped.push('x');
    expect(second.unknownOperationKindsSkipped).toEqual([]);
  });
});

describe('summarizeLegacyToleranceReport_ACU (source/src/service/table/storage-frame-v2-replay.ts:299)', () => {
  it('空报告只返回恒定的 legacy_duplicate_row_ids 代码', () => {
    expect(summarizeLegacyToleranceReport_ACU(createLegacyToleranceReport_ACU())).toEqual([
      'legacy_duplicate_row_ids',
    ]);
  });

  it('含单个容忍项：按字段名生成对应代码并保留末尾恒定代码', () => {
    const report = createLegacyToleranceReport_ACU();
    report.outOfOrderSeqSorted = 3;
    expect(summarizeLegacyToleranceReport_ACU(report)).toEqual([
      'out_of_order_seq:3',
      'legacy_duplicate_row_ids',
    ]);
  });

  it('多容忍项：按固定顺序生成全部代码并计数明细条数', () => {
    const report = createLegacyToleranceReport_ACU();
    report.outOfOrderSeqSorted = 2;
    report.legacyMetaUpdateDdlApplied = 1;
    report.unknownOperationKindsSkipped = ['mystery', 'future_kind'];
    report.lenientRowUpserts = 4;
    report.legacyDslRowIdAllocations = 5;
    report.identityRemaps = [
      { fromKey: 'a', toKey: 'b', canonicalName: 'b', overriddenRows: 0, appendedRows: 0 } as any,
      { fromKey: 'c', toKey: 'd', canonicalName: 'd', overriddenRows: 0, appendedRows: 0 } as any,
    ];
    expect(summarizeLegacyToleranceReport_ACU(report)).toEqual([
      'out_of_order_seq:2',
      'legacy_meta_update_ddl:1',
      'unknown_operation_kind_skipped:2',
      'lenient_row_upsert:4',
      'legacy_dsl_row_id:5',
      'sheet_identity_remap:2',
      'legacy_duplicate_row_ids',
    ]);
  });
});

describe('createReplayMetrics_ACU (source/src/service/table/storage-frame-v2-replay.ts:473)', () => {
  it('初始指标所有 14 个计数器均为 0', () => {
    expect(createReplayMetrics_ACU()).toEqual({
      frameCount: 0,
      logEntryCount: 0,
      operationCount: 0,
      sqlOperationCount: 0,
      columnRebindCount: 0,
      tableAliasBuildCount: 0,
      columnAliasBuildCount: 0,
      aliasInvalidateCount: 0,
      aliasCacheHitCount: 0,
      sqliteHydrateCount: 0,
      sqliteMaterializeCount: 0,
      replayReuseCount: 0,
      replayReuseFallbackCount: 0,
      replayShareCount: 0,
      yieldCount: 0,
    });
  });

  it('多次调用返回互不共享的独立对象', () => {
    const first = createReplayMetrics_ACU();
    const second = createReplayMetrics_ACU();
    expect(first).not.toBe(second);
    first.frameCount = 9;
    expect(second.frameCount).toBe(0);
  });
});

describe('buildCompatReadonlyGuidance_ACU (source/src/service/table/storage-frame-v2-replay.ts:262)', () => {
  it('diagnosis 为 null/undefined 或不含身份归并：返回自动固化口径', () => {
    const auto = '不含身份归并的兼容结果会在重新加载聊天时由后台自动固化为过渡根（没有手动固化按钮），请重载聊天或稍候再重试写入。';
    expect(buildCompatReadonlyGuidance_ACU()).toBe(auto);
    expect(buildCompatReadonlyGuidance_ACU(null)).toBe(auto);
    expect(buildCompatReadonlyGuidance_ACU({ tolerances: [], strictError: 'boom', identityRemaps: [] })).toBe(auto);
  });

  it('含 strictError 但无身份归并：仍返回自动固化口径', () => {
    const diagnosis: LegacyToleranceDiagnosis_ACU = {
      tolerances: ['legacy_duplicate_row_ids'],
      strictError: 'strict replay failed: duplicate row id',
      identityRemaps: [],
    };
    expect(buildCompatReadonlyGuidance_ACU(diagnosis)).toContain('自动固化为过渡根');
  });

  it('含身份归并：返回不可自助修复、指向历史恢复诊断的口径', () => {
    const diagnosis: LegacyToleranceDiagnosis_ACU = {
      tolerances: ['sheet_identity_remap:1'],
      strictError: 'strict replay failed',
      identityRemaps: [
        { fromKey: 'old', toKey: 'new', canonicalName: 'new', overriddenRows: 1, appendedRows: 0 } as any,
      ],
    };
    const guidance = buildCompatReadonlyGuidance_ACU(diagnosis);
    expect(guidance).toContain('sheetKey 身份归并');
    expect(guidance).toContain('不会自动固化');
    expect(guidance).toContain('历史恢复诊断');
  });
});

describe('hasUnanchoredReplayArtifactsForChatV2_ACU (source/src/service/table/storage-frame-v2-replay.ts:906)', () => {
  it('空 chat / null 输入：导出可调用且恒返回 false', () => {
    expect(hasUnanchoredReplayArtifactsForChatV2_ACU([], '')).toBe(false);
    expect(hasUnanchoredReplayArtifactsForChatV2_ACU(null, '')).toBe(false);
    expect(hasUnanchoredReplayArtifactsForChatV2_ACU(undefined, '')).toBe(false);
  });

  it('仅含空 full checkpoint 且无 logEntries 的帧：无锚点 artifact（返回 false）', () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [],
          },
        },
      },
    }];
    expect(hasUnanchoredReplayArtifactsForChatV2_ACU(chat, '')).toBe(false);
  });

  it('帧携带非空 logEntries：判定为存在 artifact（返回 true）', () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            logEntries: [{
              seq: 1, entryId: 'e1', createdAt: 2, source: 'auto_fill', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '木剑'] }],
            }],
          },
        },
      },
    }];
    expect(hasUnanchoredReplayArtifactsForChatV2_ACU(chat, '')).toBe(true);
  });

  it('maxMessageIndex 过滤 artifact 所在帧后返回 false', () => {
    const chat = [
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': { _acu_storage_version: 2, storageFrame: { version: 2, logEntries: [] } },
        },
      },
      {
        is_user: false,
        TavernDB_ACU_IsolatedData: {
          '': {
            _acu_storage_version: 2,
            storageFrame: {
              version: 2,
              logEntries: [{
                seq: 1, entryId: 'late', createdAt: 2, source: 'auto_fill', targetMessageIndex: 1, aiFloor: 2,
                filledSheetKeys: [], changedSheetKeys: [], groupKeys: [],
                operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '木剑'] }],
              }],
            },
          },
        },
      },
    ];
    expect(hasUnanchoredReplayArtifactsForChatV2_ACU(chat, '')).toBe(true);
    expect(hasUnanchoredReplayArtifactsForChatV2_ACU(chat, '', { maxMessageIndex: 0 })).toBe(false);
  });
});

describe('replaySpv79DuplicateRowIdHistory_ACU (source/src/service/table/storage-frame-v2-replay.ts:3451)', () => {
  it('最小 chat 上导出可调用：返回 data + cutoff，且不依赖宿主 save（原 frame 不被改写）', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [{
              seq: 1, entryId: 'add', createdAt: 2, source: 'auto_fill', targetMessageIndex: 0, aiFloor: 1,
              filledSheetKeys: ['sheet_0'], changedSheetKeys: ['sheet_0'], groupKeys: [],
              operations: [{ kind: 'row_upsert', sheetKey: 'sheet_0', rowId: '2', cells: ['2', '木剑'] }],
            }],
          },
        },
      },
    }];
    const before = structuredClone(chat);

    const result = await replaySpv79DuplicateRowIdHistory_ACU(chat, '');

    expect(result.data.sheet_0.content).toEqual([['row_id', 'name'], ['1', '铁剑'], ['2', '木剑']]);
    expect(result.cutoff).toEqual({ messageIndex: 0, seq: 1, operationIndex: 0 });
    expect(chat).toEqual(before);
  });

  it('strict 基底相同的重复调用结果一致（幂等）', async () => {
    const chat = [{
      is_user: false,
      TavernDB_ACU_IsolatedData: {
        '': {
          _acu_storage_version: 2,
          storageFrame: {
            version: 2,
            checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data: makeCheckpointData() },
            logEntries: [],
          },
        },
      },
    }];
    const first = await replaySpv79DuplicateRowIdHistory_ACU(chat, '');
    const second = await replaySpv79DuplicateRowIdHistory_ACU(chat, '');
    expect(first).toEqual(second);
    expect(first.cutoff).toEqual({ messageIndex: 0, seq: 0, operationIndex: -1 });
  });
});

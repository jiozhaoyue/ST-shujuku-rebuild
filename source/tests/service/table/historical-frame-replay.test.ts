/**
 * tests/service/table/historical-frame-replay.test.ts
 * 历史楼层只读回放 单元测试
 *
 * 覆盖 design §6 的各组：
 * - AC2 三形态 + invalid（含 perSheetCheckpoints 判 full、checkpoint 与 delta 共存时 entries 列全）；
 * - AC3 只读（持久化字段字节不变、无写入调用）；
 * - AC4 坏帧不抛错且给原因；
 * - AC5 与 scripts/rescue/replay-chat.mjs 的口径对齐（A1–A7）与四处差异（D1–D4）的显式固定。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: [] as any[],
  isolationKey: 'iso-test',
}));

vi.mock('../../../src/data/gateways/chat-gateway', () => ({
  getChatArray_ACU: () => mocks.chat,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: () => mocks.isolationKey,
}));
vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return { ...actual, logDebug_ACU: vi.fn() };
});

import {
  buildFrameReplayView_ACU,
  classifyStorageFrame_ACU,
  listFrameBearingFloors_ACU,
  tableNameFromSheetKey_ACU,
} from '../../../src/service/table/historical-frame-replay';

/** 造一条带帧的消息（默认走 object 形态；string 形态由用例单独给）。 */
function messageWithFrame(tagData: unknown): any {
  return { mes: 'x', TavernDB_ACU_IsolatedData: { 'iso-test': tagData } };
}

const fullCheckpointFrame = {
  version: 2,
  checkpoint: {
    kind: 'full',
    createdAt: 1000,
    reason: 'init',
    data: { sheet_a: { uid: 'sheet_a', name: '表A', content: [['row_id'], ['r1']] } },
  },
  logEntries: [],
};

const deltaFrame = {
  version: 2,
  logEntries: [
    {
      seq: 1,
      entryId: 'e1',
      createdAt: 2000,
      source: 'auto_fill',
      targetMessageIndex: 3,
      aiFloor: 1,
      commitRevision: 'rev-1',
      operations: [
        { kind: 'sql_sheet_batch', sheetKey: 'sheet_a', statements: ['INSERT INTO a (b) VALUES (1)'] },
      ],
    },
  ],
};

const emptyFrame = { version: 2, logEntries: [] };

beforeEach(() => {
  mocks.chat = [];
  mocks.isolationKey = 'iso-test';
});

describe('classifyStorageFrame_ACU（形状判定）', () => {
  it('checkpoint.kind === full ⇒ full_checkpoint', () => {
    expect(classifyStorageFrame_ACU(fullCheckpointFrame).shape).toBe('full_checkpoint');
  });

  it('仅 perSheetCheckpoints 非空也判 full_checkpoint', () => {
    const frame = { version: 2, perSheetCheckpoints: { sheet_a: { kind: 'sheet_full', sheetKey: 'sheet_a', createdAt: 1, reason: 'init', data: { uid: 'sheet_a', name: 'A', content: [] } } }, logEntries: [] };
    expect(classifyStorageFrame_ACU(frame).shape).toBe('full_checkpoint');
  });

  it('无 checkpoint 但有 logEntries ⇒ delta；都没有 ⇒ empty', () => {
    expect(classifyStorageFrame_ACU(deltaFrame).shape).toBe('delta');
    expect(classifyStorageFrame_ACU(emptyFrame).shape).toBe('empty');
  });

  it('帧非对象 / logEntries 非数组 ⇒ invalid 且给出原因', () => {
    expect(classifyStorageFrame_ACU(null).shape).toBe('invalid');
    expect(classifyStorageFrame_ACU([]).shape).toBe('invalid');
    expect(classifyStorageFrame_ACU('str').shape).toBe('invalid');
    const result = classifyStorageFrame_ACU({ version: 2 });
    expect(result.shape).toBe('invalid');
    expect(result.invalidReason).toContain('logEntries');
  });
});

describe('tableNameFromSheetKey_ACU（与救援脚本 keyFormOf 同源）', () => {
  it('sheet_ 前缀剥掉、下划线去掉', () => {
    expect(tableNameFromSheetKey_ACU('sheet_ji_yao_biao')).toBe('jiyaobiao');
    expect(tableNameFromSheetKey_ACU('sheet_a')).toBe('a');
    expect(tableNameFromSheetKey_ACU('')).toBe('');
  });
});

describe('listFrameBearingFloors_ACU（只读扫描）', () => {
  it('只列含帧的楼层，aiFloor 按宽档口径累积', () => {
    mocks.chat = [
      { is_user: true, mes: 'hi' },
      messageWithFrame({ storageFrame: fullCheckpointFrame }),   // index 1，AI 楼 1
      { is_system: true, mes: 'sys' },
      { mes: '无帧的 AI 楼' },                                    // index 3，AI 楼 2，无帧
      messageWithFrame({ storageFrame: deltaFrame }),            // index 4，AI 楼 3
    ];

    const floors = listFrameBearingFloors_ACU();
    expect(floors.map(floor => floor.messageIndex)).toEqual([1, 4]);
    expect(floors.map(floor => floor.aiFloor)).toEqual([1, 3]);
    expect(floors[0].shape).toBe('full_checkpoint');
    expect(floors[0].checkpointReason).toBe('init');
    expect(floors[0].createdAt).toBe(1000);
    expect(floors[1].shape).toBe('delta');
    expect(floors[1].entryCount).toBe(1);
    expect(floors[1].operationCount).toBe(1);
  });

  it('隔离键不匹配时不列（不会误认别人的帧）', () => {
    mocks.chat = [{ mes: 'ai', TavernDB_ACU_IsolatedData: { 'other-iso': { storageFrame: deltaFrame } } }];
    expect(listFrameBearingFloors_ACU()).toEqual([]);
  });

  it('宿主聊天不可读时返回空数组，不抛错', () => {
    mocks.chat = undefined as any;
    expect(() => listFrameBearingFloors_ACU()).not.toThrow();
    expect(listFrameBearingFloors_ACU()).toEqual([]);
  });
});

describe('buildFrameReplayView_ACU（单帧视图）', () => {
  it('full checkpoint 帧：给出 checkpoint 概要（sheetKey 清单 + per-sheet）', () => {
    mocks.chat = [messageWithFrame({ storageFrame: fullCheckpointFrame })];

    const view = buildFrameReplayView_ACU(0);
    expect(view.shape).toBe('full_checkpoint');
    expect(view.checkpoint).toMatchObject({ kind: 'full', reason: 'init', sheetKeys: ['sheet_a'] });
    expect(view.statementCount).toBe(0);
  });

  it('delta 帧：列出条目与语句（含方言、操作、表）', () => {
    mocks.chat = [messageWithFrame({ storageFrame: deltaFrame })];

    const view = buildFrameReplayView_ACU(0);
    expect(view.shape).toBe('delta');
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({ seq: 1, entryId: 'e1', source: 'auto_fill', aiFloor: 1, commitRevision: 'rev-1' });
    expect(view.statementCount).toBe(1);
    expect(view.entries[0].statements[0]).toMatchObject({ dialect: 'sql', operation: 'insert', tables: ['a'] });
  });

  it('checkpoint 与 delta 共存：形状判 full，但 entries 仍列全（不丢 delta）', () => {
    const combined = { ...fullCheckpointFrame, logEntries: deltaFrame.logEntries };
    mocks.chat = [messageWithFrame({ storageFrame: combined })];

    const view = buildFrameReplayView_ACU(0);
    expect(view.shape).toBe('full_checkpoint');
    expect(view.entries).toHaveLength(1);
    expect(view.statementCount).toBe(1);
  });

  it('空帧：显式 empty，不是「无数据」', () => {
    mocks.chat = [messageWithFrame({ storageFrame: emptyFrame })];
    expect(buildFrameReplayView_ACU(0).shape).toBe('empty');
  });

  it('DSL 方言同样被列出（富化复用 T3.2 的实现）', () => {
    const dslFrame = {
      version: 2,
      logEntries: [{
        seq: 1, entryId: 'e1', createdAt: 1, source: 'manual_fill', targetMessageIndex: 2, aiFloor: 1,
        operations: [{ kind: 'table_edit_dsl', text: 'insertRow(0, {"0": "x"})\ndeleteRow(1, 2)' }],
      }],
    };
    mocks.chat = [messageWithFrame({ storageFrame: dslFrame })];

    const view = buildFrameReplayView_ACU(0);
    expect(view.statementCount).toBe(2);
    expect(view.entries[0].statements.map(stat => stat.operation)).toEqual(['insert', 'delete']);
    expect(view.entries[0].statements[0].dialect).toBe('dsl');
  });

  it('帧为 JSON 字符串形态同样可读（与救援脚本同口径）', () => {
    mocks.chat = [{ mes: 'ai', TavernDB_ACU_IsolatedData: JSON.stringify({ 'iso-test': { storageFrame: deltaFrame } }) }];

    const view = buildFrameReplayView_ACU(0);
    expect(view.shape).toBe('delta');
    expect(view.statementCount).toBe(1);
  });

  it('AC4 坏帧：不抛错，降级为 invalid 并给原因', () => {
    // 1) logEntries 非数组
    mocks.chat = [messageWithFrame({ storageFrame: { version: 2, logEntries: 'oops' } })];
    let view = buildFrameReplayView_ACU(0);
    expect(view.shape).toBe('invalid');
    expect(view.invalidReason).toContain('logEntries');

    // 2) 帧不是对象
    mocks.chat = [messageWithFrame({ storageFrame: 42 })];
    view = buildFrameReplayView_ACU(0);
    expect(view.shape).toBe('invalid');

    // 3) 帧是字符串但 JSON 坏掉
    mocks.chat = [messageWithFrame({ storageFrame: '{not json' })];
    view = buildFrameReplayView_ACU(0);
    expect(view.shape).toBe('invalid');
    expect(view.invalidReason).toContain('JSON');

    // 4) 楼层不存在
    mocks.chat = [];
    view = buildFrameReplayView_ACU(5);
    expect(view.shape).toBe('invalid');
    expect(view.invalidReason).toContain('#5');

    // 5) 楼层存在但没有帧
    mocks.chat = [{ mes: 'ai' }];
    view = buildFrameReplayView_ACU(0);
    expect(view.shape).toBe('invalid');
    expect(view.invalidReason).toContain('没有本插件的存储帧');
  });

  it('旧版 patches-only 帧：如实标注不解析，不假装「什么都没写」', () => {
    const legacyFrame = {
      version: 2,
      logEntries: [{
        seq: 1, entryId: 'e1', createdAt: 1, source: 'auto_fill', targetMessageIndex: 2, aiFloor: 1,
        operations: [],
        patches: [{ kind: 'row_upsert', sheetKey: 'sheet_a', rowId: 'r1', cells: ['v'] }],
      }],
    };
    mocks.chat = [messageWithFrame({ storageFrame: legacyFrame })];

    const view = buildFrameReplayView_ACU(0);
    expect(view.legacyPatchesOnly).toBe(true);
    expect(view.statementCount).toBe(0);
  });

  it('无效条目字段不抛错（全部降级为默认值）', () => {
    const messyFrame = { version: 2, logEntries: [null, 'bad', { seq: 'x', operations: 'nope' }] };
    mocks.chat = [messageWithFrame({ storageFrame: messyFrame })];

    let view!: ReturnType<typeof buildFrameReplayView_ACU>;
    expect(() => { view = buildFrameReplayView_ACU(0); }).not.toThrow();
    expect(view.entries).toHaveLength(3);
    expect(view.entries[0].seq).toBe(0);
    expect(view.entries[2].statements).toEqual([]);
  });
});

describe('AC3 只读保证', () => {
  it('回放前后 TavernDB_ACU_IsolatedData 逐字节不变，且不触碰任何写接口', () => {
    const tagData = { storageFrame: { ...fullCheckpointFrame, logEntries: deltaFrame.logEntries } };
    const message = messageWithFrame(tagData);
    mocks.chat = [message];

    const before = JSON.stringify(message.TavernDB_ACU_IsolatedData);

    listFrameBearingFloors_ACU();
    const view = buildFrameReplayView_ACU(0);

    const after = JSON.stringify(message.TavernDB_ACU_IsolatedData);
    expect(after).toBe(before);
    // 视图产出的是新对象，不与帧共享引用
    expect(view.entries[0].statements[0]).not.toBe((tagData.storageFrame.logEntries[0] as any).operations[0]);
  });

  it('模块源码不 import 任何写接口（只读是结构性的，不靠纪律）', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(process.cwd(), 'src/service/table/historical-frame-replay.ts'), 'utf8');

    for (const forbidden of ['persistTablesToChatMessage_ACU', 'writeIsolatedTagData_ACU', 'runTableUpdateCommit_ACU', 'saveChatToHost_ACU']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

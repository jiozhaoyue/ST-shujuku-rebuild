/**
 * tests/service/table/storage-frame-v2-orphan-identity-column.test.ts
 *
 * 缺陷 ② 回归：**无 DDL 旧聊天**的「孤儿身份列错位」。
 *
 * 形态（2026-09-29 真机 + 离线取证，见
 * .trellis/tasks/09-29-no-ddl-legacy-chat-write-failure/research/S3.2b-base-repair-gap.md）：
 * 旧版本把「身份列占位」误插 `row_id` 后固化为表头 `["row_id", null, 业务列…]`、
 * 行 `[id, 值…, null]`（表头多一个空标签孤儿列，行值相对标签整体左移一列）。
 * 该形态对 row_id 校验与 upgrade audit **都不可见**，故「顺路」复位不可靠：真机聊天恰好落在
 * `normalizeLegacyDuplicateCheckpointState_ACU` 的 `audit==='clean'` 提前返回分支，复位形同虚设
 * ⇒ 回放输出仍是畸形表头 ⇒ 下游任何在该基底上解析 DDL 的路径都撞
 * `fallback DDL 表头不合法：第 2 列「」empty_column_name`：
 *   (a) 手动重填的身份重绑定（`rebindSheetKeysThroughTableAliases_ACU` → `resolveEffectiveDDL`）；
 *   (b) 写入侧重放追加的 SQL（写时严格探针）。
 *
 * 本套件钉住：回放**基底**即复位（而非只在历史兼容支路）+ (a)(b) 两条失败路径均已消除 +
 * 空表头绝不被掩盖成 col_N + 有 DDL 的正常路径零变化。
 */
import { describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ chat: [] as any[] }));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  getCurrentIsolationKey_ACU: () => '',
  independentTableStates_ACU: {},
  settings_ACU: { dataIsolationEnabled: false, dataIsolationCode: '' },
}));
vi.mock('../../../src/data/gateways/chat-gateway', async (orig) => {
  const actual = await orig() as any;
  return { ...actual, getChatArray_ACU: () => holder.chat };
});

import { loadTableStateFromFramesV2Detailed_ACU } from '../../../src/service/table/storage-frame-v2-replay';
import { persistTableMutationLogV2_ACU } from '../../../src/service/table/storage-frame-v2-persist';
import { generateFallbackDDL } from '../../../src/data/sqlite/schema-mapper';
import { buildSheetColumnAliasMap_ACU } from '../../../src/shared/sql-read-resolver';
import { _set_SillyTavern_API_ACU, SillyTavern_API_ACU } from '../../../src/shared/host-api';

/** 无 DDL（`sourceData` 只有 note）+ 畸形孤儿列表头。ASCII 表头让 fallback 物理列名可预测。 */
function makeOrphanNoDdlCheckpointData() {
  return {
    mate: { type: 'acu', version: 1 },
    sheet_bag: {
      uid: 'bag',
      name: 'bag',
      content: [
        ['row_id', null, 'name', 'qty'],
        ['1', 'phone', '1', null],
      ],
      sourceData: { note: '无 DDL 旧聊天' },
      updateConfig: {},
      exportConfig: {},
      orderNo: 0,
    },
  } as any;
}

function frameAt(data: any, logEntries: any[] = []) {
  return {
    is_user: false,
    TavernDB_ACU_IsolatedData: {
      '': {
        _acu_storage_version: 2,
        storageFrame: {
          version: 2,
          checkpoint: { kind: 'full', createdAt: 1, reason: 'init', data },
          logEntries,
        },
      },
    },
  };
}

function readHeaders(replay: any, sheetKey: string): unknown[] {
  return (replay.data as any)[sheetKey].content[0];
}

async function replayOrphanBase() {
  const chat = [frameAt(makeOrphanNoDdlCheckpointData())];
  const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
    updateRuntimeState: false,
    compatibilityMode: 'disabled',
  });
  expect(replay).not.toBeNull();
  return replay!;
}

describe('缺陷 ② · 无 DDL 旧聊天的孤儿身份列错位', () => {
  it('前提：未复位的空占位表头确实会让 fallback DDL 生成抛 empty_column_name（且不掩盖成 col_N）', () => {
    expect(() => generateFallbackDDL('bag', ['row_id', null, 'name', 'qty']))
      .toThrow(/第 2 列「」empty_column_name/);
  });

  it('回放基底即复位：无 DDL + 空占位表头被对齐，不再进入 fallback DDL 报错分支', async () => {
    const replay = await replayOrphanBase();

    // 孤儿列被删，表头与行值重新对齐；行业务值一格不动。
    expect(readHeaders(replay, 'sheet_bag')).toEqual(['row_id', 'name', 'qty']);
    expect((replay.data as any).sheet_bag.content[1]).toEqual(['1', 'phone', '1']);
  });

  it('(a) 列身份解析：畸形基底解析 fallback DDL 抛错，回放基底复位后同一解析成功', async () => {
    // 写入侧（sql_sheet_batch 的列重绑 / 手动重填的身份解析）都要在这份基底上解析列身份；
    // 畸形表头会让 `resolveEffectiveDDL` → `generateFallbackDDL` 抛 empty_column_name。
    const malformed = makeOrphanNoDdlCheckpointData();
    expect(() => buildSheetColumnAliasMap_ACU(malformed as any))
      .toThrow(/empty_column_name/);

    // 回放基底经复位后，同一条解析路径不再抛错（回放输出即下游真正消费的数据）。
    const replay = await replayOrphanBase();
    expect(() => buildSheetColumnAliasMap_ACU(replay.data as any)).not.toThrow();
  });

  it('(b) 写入路径：真实 persist（含写时严格探针）在有孤儿列基底的聊天上不再被拒绝', async () => {
    const base = makeOrphanNoDdlCheckpointData();
    holder.chat = [frameAt(base), { is_user: false, mes: 'AI 楼' }];
    const previousHostApi = SillyTavern_API_ACU;
    try {
      _set_SillyTavern_API_ACU({ chat: holder.chat, saveChat: async () => undefined } as any);
      const afterData = {
        ...base,
        sheet_bag: {
          ...base.sheet_bag,
          content: [
            ['row_id', null, 'name', 'qty'],
            ['1', 'phone', '1', null],
            ['2', 'book', '3', null],
          ],
        },
      };
      const result = await persistTableMutationLogV2_ACU({
        targetMessageIndex: 1,
        source: 'manual_fill',
        afterData,
        filledSheetKeys: ['sheet_bag'],
        candidateChangedSheetKeys: ['sheet_bag'],
        operations: [{
          kind: 'sql_batch',
          reason: 'system',
          statements: ['INSERT INTO bag (row_id, name, qty) VALUES (?, ?, ?)'],
          params: [[2, 'book', '3']],
        }],
        transactionContext: {
          baseRevision: 'orphan-test',
          writeSet: [{ kind: 'sheet', sheetKey: 'sheet_bag' }],
          assertFresh: () => undefined,
          runCommit: async (task: () => Promise<any>) => task(),
        },
      });

      expect(result.saved).toBe(true);
      expect(result.error).toBeUndefined();
    } finally {
      _set_SillyTavern_API_ACU(previousHostApi);
    }
  });

  it('有 DDL 的正常路径不受影响（表头不含空占位时复位是空操作）', async () => {
    const data = {
      mate: { type: 'acu', version: 1 },
      sheet_ok: {
        uid: 'ok',
        name: 'ok',
        content: [['row_id', 'name'], ['1', '铁剑']],
        sourceData: { ddl: 'CREATE TABLE ok (row_id INTEGER PRIMARY KEY, name TEXT);' },
        updateConfig: {},
        exportConfig: {},
        orderNo: 0,
      },
    } as any;
    const chat = [frameAt(data)];

    const replay = await loadTableStateFromFramesV2Detailed_ACU(chat, '', {
      updateRuntimeState: false,
      compatibilityMode: 'disabled',
    });

    expect(readHeaders(replay, 'sheet_ok')).toEqual(['row_id', 'name']);
    expect((replay!.data as any).sheet_ok.content[1]).toEqual(['1', '铁剑']);
  });
});

/**
 * diagnostic-bundle 单测 — 一键诊断包的聚合契约
 *
 * 覆盖：schema/JSON 往返、环境事实兜底、能力计数（定义/可调用/门禁差）、
 * 各节失败隔离（一节挂不拖垮整包）、帧回放摘要的截取与「最新一楼」取最大 messageIndex、
 * 文本格式化分节、以及「包内不得出现敏感键」的静态扫描。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const harness = vi.hoisted(() => ({
  hostKind: 'luker',
  pluginVersion: '9.7.5-test',
  buildStamp: 'stamp-xyz',
  chatIdentifier: 'chat-abc.json',
  sqliteMode: false,
  apiGroupIndex: {
    'core-data': ['exportTableAsJson', 'triggerUpdate'],
    'table-crud': ['createSheet', 'deleteSheet'],
  } as Record<string, string[]>,
  liveApiKeys: 3,
  selfCheckSnapshot: {
    host: { ok: true, value: { kind: 'luker' } },
    storage: { ok: false, error: 'runtime 未就绪' },
  } as Record<string, unknown>,
  promptExport: JSON.stringify({ exportedAt: 'T0', recordCount: 2, records: [{ id: 'a' }, { id: 'b' }] }),
  defaultPromptExport: JSON.stringify({ exportedAt: 'T0', recordCount: 2, records: [{ id: 'a' }, { id: 'b' }] }),
  writeExport: JSON.stringify({ exportedAt: 'T0', recordCount: 1, records: [] }),
  promptExportThrows: false,
  floors: [] as Array<Record<string, unknown>>,
  frameView: null as Record<string, unknown> | null,
  listFloorsThrows: false,
}));

vi.mock('../../../src/shared/host-bridge', () => ({
  getAcuHostKind: () => harness.hostKind,
}));
vi.mock('../../../src/shared/plugin-identity', () => ({
  getPluginVersion_ACU: () => harness.pluginVersion,
  getBuildStamp_ACU: () => harness.buildStamp,
}));
vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: { dataIsolationEnabled: true },
  getCurrentIsolationKey_ACU: () => 'iso-key',
  currentChatFileIdentifier_ACU: harness.chatIdentifier,
}));
vi.mock('../../../src/service/table/storage-mode', () => ({
  isSqliteMode: () => harness.sqliteMode,
}));
vi.mock('../../../src/service/table/self-check', () => ({
  collectSelfCheckSnapshot_ACU: () => harness.selfCheckSnapshot,
}));
vi.mock('../../../src/service/ai/prompt-observer', () => ({
  exportPromptObservations_ACU: () => {
    if (harness.promptExportThrows) throw new Error('observer boom');
    return harness.promptExport;
  },
}));
vi.mock('../../../src/service/table/write-pipeline-observer', () => ({
  exportTableWritePipeline_ACU: () => harness.writeExport,
}));
vi.mock('../../../src/service/table/historical-frame-replay', () => ({
  listFrameBearingFloors_ACU: () => {
    if (harness.listFloorsThrows) throw new Error('floors boom');
    return harness.floors;
  },
  buildFrameReplayView_ACU: (messageIndex: number) => {
    if (!harness.frameView) throw new Error('no view');
    return { messageIndex, ...harness.frameView };
  },
}));

import {
  buildDiagnosticBundle_ACU,
  formatDiagnosticBundleText_ACU,
  DIAGNOSTIC_BUNDLE_SCHEMA_ACU,
  DIAGNOSTIC_BUNDLE_FRAME_FLOOR_LIMIT_ACU,
} from '../../../src/service/diagnostics/diagnostic-bundle';

function fakeFloor(overrides: Record<string, unknown>): Record<string, unknown> {
  return { messageIndex: 0, aiFloor: 1, shape: 'delta', entryCount: 1, operationCount: 1, ...overrides };
}

describe('buildDiagnosticBundle_ACU', () => {
  beforeEach(() => {
    harness.hostKind = 'luker';
    harness.pluginVersion = '9.7.5-test';
    harness.buildStamp = 'stamp-xyz';
    harness.chatIdentifier = 'chat-abc.json';
    harness.sqliteMode = false;
    harness.promptExport = harness.defaultPromptExport;
    (globalThis as Record<string, unknown>).__ACU_API_GROUP_INDEX__ = harness.apiGroupIndex;
    (globalThis as Record<string, unknown>).AutoCardUpdaterAPI = Object.fromEntries(
      Array.from({ length: harness.liveApiKeys }, (_, i) => [`m${i}`, () => undefined]),
    );
    harness.promptExportThrows = false;
    harness.listFloorsThrows = false;
    harness.floors = [];
    harness.frameView = null;
  });

  it('schema 与 JSON 往返：整包可序列化且结构稳定', () => {
    harness.floors = [fakeFloor({ messageIndex: 4 })];
    harness.frameView = { shape: 'delta', statementCount: 3 };

    const bundle = buildDiagnosticBundle_ACU();
    expect(bundle.schema).toBe(DIAGNOSTIC_BUNDLE_SCHEMA_ACU);
    expect(typeof bundle.generatedAt).toBe('string');
    expect(new Date(bundle.generatedAt).getTime()).not.toBeNaN();

    const roundTrip = JSON.parse(JSON.stringify(bundle));
    expect(roundTrip).toEqual(bundle);
  });

  it('环境事实读数与「当前聊天标识/隔离」一致', () => {
    const { environment } = buildDiagnosticBundle_ACU();
    const rowOf = (label: string) => environment.find(row => row.label === label)?.value;
    expect(rowOf('宿主')).toBe('luker');
    expect(rowOf('插件版本')).toBe('9.7.5-test');
    expect(rowOf('构建戳')).toBe('stamp-xyz');
    expect(rowOf('存储模式')).toBe('JSON（原生）');
    expect(rowOf('当前聊天标识')).toBe('chat-abc.json');
    expect(rowOf('数据隔离')).toBe('已启用');
  });

  it('环境事实：取值抛错时回退「—」而不是让整包失败', () => {
    harness.hostKind = undefined as unknown as string; // 触发 fallback 分支
    const { environment } = buildDiagnosticBundle_ACU();
    expect(environment.find(row => row.label === '宿主')?.value).toBe('—');
  });

  it('能力计数：可调用数来自运行时 API 对象，门禁差 = 定义 − 可调用', () => {
    const { capabilities } = buildDiagnosticBundle_ACU() as Extract<
      ReturnType<typeof buildDiagnosticBundle_ACU>['capabilities'],
      { apiGroups: unknown[] }
    >;
    if (!('apiGroups' in capabilities)) throw new Error('capabilities 采集失败');
    expect(capabilities.apiDefinedTotal).toBe(4);
    expect(capabilities.apiLiveTotal).toBe(3);
    expect(capabilities.apiGatedCount).toBe(1);
    expect(capabilities.apiGroups[0].name).toBe('core-data');
  });

  it('promptObservations / writePipeline：解析观察器导出串', () => {
    const bundle = buildDiagnosticBundle_ACU();
    expect(bundle.promptObservations.recordCount).toBe(2);
    expect(bundle.writePipeline.recordCount).toBe(1);
  });

  it('观察器导出串损坏时该节记 parseError，不抛出', () => {
    harness.promptExport = '{not json';
    const bundle = buildDiagnosticBundle_ACU();
    expect(bundle.promptObservations.parseError).toBe(true);
    expect(bundle.writePipeline.recordCount).toBe(1);
  });

  it('帧回放摘要：floors 截取受 limit 控制，latest 取最大 messageIndex', () => {
    harness.floors = [
      fakeFloor({ messageIndex: 1, shape: 'delta', entryCount: 2, operationCount: 2 }),
      fakeFloor({ messageIndex: 9, shape: 'full_checkpoint', entryCount: 0, operationCount: 0 }),
      fakeFloor({ messageIndex: 5, shape: 'delta', entryCount: 1, operationCount: 4 }),
    ];
    harness.frameView = { shape: 'full_checkpoint', statementCount: 7, checkpoint: { reason: 'init', sheetKeys: ['a', 'b'] } };

    const bundle = buildDiagnosticBundle_ACU({ frameFloorLimit: 2 });
    if (!('floors' in bundle.frameReplay)) throw new Error('frameReplay 采集失败');
    expect(bundle.frameReplay.floorCount).toBe(3);
    expect(bundle.frameReplay.floors).toHaveLength(2); // 截取前 2 个
    expect(bundle.frameReplay.latest?.messageIndex).toBe(9); // 最大，不是第一个
    expect(bundle.frameReplay.latest?.statementCount).toBe(7);
    expect(bundle.frameReplay.latest?.checkpointReason).toBe('init');
    expect(bundle.frameReplay.latest?.checkpointSheetKeyCount).toBe(2);
  });

  it('默认 limit 常量为 20 且非法值被钳制为 ≥1', () => {
    expect(DIAGNOSTIC_BUNDLE_FRAME_FLOOR_LIMIT_ACU).toBe(20);
    harness.floors = [fakeFloor({ messageIndex: 0 })];
    harness.frameView = { shape: 'delta', statementCount: 0 };
    const bundle = buildDiagnosticBundle_ACU({ frameFloorLimit: 0 });
    if (!('floors' in bundle.frameReplay)) throw new Error('frameReplay 采集失败');
    expect(bundle.frameReplay.floors).toHaveLength(1);
  });

  it('节失败隔离：帧回放抛错只记 error，其余节完好', () => {
    harness.listFloorsThrows = true;
    const bundle = buildDiagnosticBundle_ACU();
    expect('error' in bundle.frameReplay).toBe(true);
    expect(String((bundle.frameReplay as { error: string }).error)).toContain('floors boom');
    expect(bundle.environment.length).toBe(6);
    expect(bundle.promptObservations.recordCount).toBe(2);
    expect(bundle.selfCheck).toHaveProperty('host');
  });

  it('无含帧楼层时 frameReplay 给出零值空态而非 error', () => {
    const bundle = buildDiagnosticBundle_ACU();
    if (!('floors' in bundle.frameReplay)) throw new Error('frameReplay 采集失败');
    expect(bundle.frameReplay.floorCount).toBe(0);
    expect(bundle.frameReplay.floors).toEqual([]);
    expect(bundle.frameReplay.latest).toBeNull();
  });

  it('脱敏契约：整包序列化后不出现敏感键名', () => {
    const bundle = buildDiagnosticBundle_ACU();
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toMatch(/api[_-]?key|secret|authorization|cookie/i);
  });

  it('数据体积提示：默认开启并给出两个阈值的默认值', () => {
    const bundle = buildDiagnosticBundle_ACU();
    expect('error' in bundle.oversizedWrite).toBe(false);
    if ('error' in bundle.oversizedWrite) return;
    expect(bundle.oversizedWrite.enabled).toBe(true);
    expect(bundle.oversizedWrite.thresholds).toEqual({ cellChars: 10_000, payloadBytes: 512 * 1024 });
    expect(bundle.oversizedWrite.recent).toEqual([]);
  });
});

describe('formatDiagnosticBundleText_ACU', () => {
  beforeEach(() => {
    harness.promptExport = harness.defaultPromptExport;
    harness.promptExportThrows = false;
    harness.listFloorsThrows = false;
    harness.floors = [];
    harness.frameView = null;
    (globalThis as Record<string, unknown>).__ACU_API_GROUP_INDEX__ = harness.apiGroupIndex;
  });

  it('文本分节完整且含关键计数', () => {
    harness.floors = [fakeFloor({ messageIndex: 3 })];
    harness.frameView = { shape: 'delta', statementCount: 2 };
    const bundle = buildDiagnosticBundle_ACU();
    const text = formatDiagnosticBundleText_ACU(bundle);
    expect(text).toContain('# 数据库插件一键诊断包');
    expect(text).toContain(DIAGNOSTIC_BUNDLE_SCHEMA_ACU);
    expect(text).toContain('## 环境');
    expect(text).toContain('- 宿主：luker');
    expect(text).toContain('## 公开 API');
    expect(text).toContain('## 启动/运行自检');
    expect(text).toContain('- host: ok');
    expect(text).toContain('- storage: 失败（runtime 未就绪）');
    expect(text).toContain('## 出站提示词观测');
    expect(text).toContain('记录数：2');
    expect(text).toContain('## 写库流水');
    expect(text).toContain('记录数：1');
    expect(text).toContain('## 数据体积提示');
    expect(text).toContain('最近没有触发告警');
    expect(text).toContain('## 历史楼层回放');
    expect(text).toContain('最新一楼 #3');
    expect(text).toContain('不含密钥/请求头');
  });

  it('某节采集失败时文本如实标注失败而不是留空', () => {
    harness.listFloorsThrows = true;
    const bundle = buildDiagnosticBundle_ACU();
    const text = formatDiagnosticBundleText_ACU(bundle);
    expect(text).toContain('采集失败');
    expect(text).toContain('floors boom');
  });
});

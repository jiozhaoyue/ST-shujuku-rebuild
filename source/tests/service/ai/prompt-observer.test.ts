/**
 * tests/service/ai/prompt-observer.test.ts
 * 出站提示词观测器 单元测试
 *
 * 覆盖 design §9 的观察器行：开关关=0 记录、字符数正确、环形丢最旧、清空、订阅通知、
 * 导出不含密钥、token 异步补齐不阻塞、段级报告与差额账。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPromptObservationForTests_ACU,
  PROMPT_OBSERVATION_MAX_RECORDS_ACU,
  PROMPT_PLACEHOLDER_SEGMENT_ACU,
  PROMPT_SEGMENT_SKELETON_ACU,
  PROMPT_SEGMENT_TABLE_WORLDBOOK_ACU,
  clearPromptObservations_ACU,
  exportPromptObservations_ACU,
  extractEndpointHost_ACU,
  getPromptObservationClearHistory_ACU,
  getPromptObservations_ACU,
  isPromptObservationEnabled_ACU,
  recordPromptAssembly_ACU,
  setPromptObservationEnabled_ACU,
  subscribePromptObservations_ACU,
} from '../../../src/service/ai/prompt-observer';
import { _set_SillyTavern_API_ACU } from '../../../src/shared/host-api';

const { mockLogDebug } = vi.hoisted(() => ({ mockLogDebug: vi.fn() }));

vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return { ...actual, logDebug_ACU: mockLogDebug };
});

/** 造一条最小可用的调用输入。 */
function makeInput(overrides: Partial<Parameters<typeof recordPromptAssembly_ACU>[0]> = {}) {
  return {
    messages: [
      { role: 'system', content: '你是填表助手' },
      { role: 'user', content: '请更新表格' },
    ],
    effectiveApiConfig: { model: 'models/test-model', url: 'https://api.example.com/v1/chat?token=secret', streamingEnabled: false },
    overrides: { sessionNamespace: 'table-fill' },
    ...overrides,
  } as Parameters<typeof recordPromptAssembly_ACU>[0];
}

/** 让异步 token 补写链跑完（等待微任务）。 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('prompt-observer · 开关与零记录', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
    mockLogDebug.mockClear();
  });

  it('开关关闭时 isPromptObservationEnabled 为 false，且不产生任何记录', () => {
    expect(isPromptObservationEnabled_ACU()).toBe(false);
    setPromptObservationEnabled_ACU(false);
    recordPromptAssembly_ACU(makeInput());
    expect(getPromptObservations_ACU()).toHaveLength(0);
  });

  it('开关开启后记录一条，messageCount / totalChars 与实际一致', () => {
    setPromptObservationEnabled_ACU(true);
    recordPromptAssembly_ACU(makeInput());
    const records = getPromptObservations_ACU();
    expect(records).toHaveLength(1);
    expect(records[0].messageCount).toBe(2);
    // '你是填表助手'.length === 6，'请更新表格'.length === 5
    expect(records[0].messages.map(m => m.chars)).toEqual([6, 5]);
    expect(records[0].totalChars).toBe(11);
  });

  it('scope 取 sessionNamespace；缺失时为 unknown', () => {
    setPromptObservationEnabled_ACU(true);
    recordPromptAssembly_ACU(makeInput());
    recordPromptAssembly_ACU(makeInput({ overrides: {} }));
    expect(getPromptObservations_ACU().map(r => r.scope)).toEqual(['table-fill', 'unknown']);
  });

  it('endpointHost 只留主机（含端口），不含路径与查询串', () => {
    setPromptObservationEnabled_ACU(true);
    recordPromptAssembly_ACU(makeInput());
    const record = getPromptObservations_ACU()[0];
    expect(record.endpointHost).toBe('api.example.com');
    expect(JSON.stringify(record)).not.toContain('token=secret');
  });

  it('extractEndpointHost_ACU 对非法 URL 返回空串而不回显原串', () => {
    expect(extractEndpointHost_ACU('not a url')).toBe('');
    expect(extractEndpointHost_ACU('http://127.0.0.1:8001/v1')).toBe('127.0.0.1:8001');
  });
});

describe('prompt-observer · 环形缓冲与清空', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
    setPromptObservationEnabled_ACU(true);
  });

  it(`超过 ${PROMPT_OBSERVATION_MAX_RECORDS_ACU} 条后丢最旧，长度封顶`, () => {
    for (let i = 0; i < PROMPT_OBSERVATION_MAX_RECORDS_ACU + 5; i += 1) {
      recordPromptAssembly_ACU(makeInput({ messages: [{ role: 'user', content: `第${i}次` }] }));
    }
    const records = getPromptObservations_ACU();
    expect(records).toHaveLength(PROMPT_OBSERVATION_MAX_RECORDS_ACU);
    // 最旧的是第 5 次（前 5 条被丢）
    expect(records[0].messages[0].content).toBe('第5次');
    expect(records[records.length - 1].messages[0].content).toBe(`第${PROMPT_OBSERVATION_MAX_RECORDS_ACU + 4}次`);
  });

  it('清空后计数为 0，且留下 caller 留痕', () => {
    recordPromptAssembly_ACU(makeInput());
    expect(getPromptObservations_ACU()).toHaveLength(1);
    clearPromptObservations_ACU('panel:test');
    expect(getPromptObservations_ACU()).toHaveLength(0);
    expect(getPromptObservationClearHistory_ACU().at(-1)?.caller).toBe('panel:test');
  });

  it('清空会重置 scope 记忆：下一次同 scope 记录回到「基线建立」', () => {
    recordPromptAssembly_ACU(makeInput());
    recordPromptAssembly_ACU(makeInput());
    expect(getPromptObservations_ACU()[1].drift.baseline).toBe(false);
    clearPromptObservations_ACU('panel:test');
    recordPromptAssembly_ACU(makeInput());
    expect(getPromptObservations_ACU()[0].drift.baseline).toBe(true);
  });
});

describe('prompt-observer · 订阅', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
    setPromptObservationEnabled_ACU(true);
  });

  it('记录与清空都会通知订阅者；退订后不再收到', () => {
    const seen: number[] = [];
    const unsubscribe = subscribePromptObservations_ACU(records => seen.push(records.length));
    recordPromptAssembly_ACU(makeInput());
    clearPromptObservations_ACU('panel:test');
    unsubscribe();
    recordPromptAssembly_ACU(makeInput());
    expect(seen).toEqual([1, 0]);
  });

  it('订阅者抛错不影响记录本身，也不外泄异常', () => {
    subscribePromptObservations_ACU(() => { throw new Error('subscriber boom'); });
    expect(() => recordPromptAssembly_ACU(makeInput())).not.toThrow();
    expect(getPromptObservations_ACU()).toHaveLength(1);
  });
});

describe('prompt-observer · diff（同 scope 上次调用）', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
    setPromptObservationEnabled_ACU(true);
  });

  it('首次调用为基线，第二次尾部追加识别为「前缀完整保留」', () => {
    recordPromptAssembly_ACU(makeInput());
    recordPromptAssembly_ACU(makeInput({
      messages: [
        { role: 'system', content: '你是填表助手' },
        { role: 'user', content: '请更新表格' },
        { role: 'user', content: '追加一轮' },
      ],
    }));
    const [first, second] = getPromptObservations_ACU();
    expect(first.drift.baseline).toBe(true);
    expect(first.driftText).toContain('基线建立');
    expect(second.drift.baseline).toBe(false);
    expect(second.drift.appendedMessages).toBe(1);
    expect(second.drift.sharedMessages).toBe(2);
    expect(second.driftText).toContain('前缀完整保留');
  });

  it('不同 scope 各自独立记基线（互不顶掉）', () => {
    recordPromptAssembly_ACU(makeInput());
    recordPromptAssembly_ACU(makeInput({ overrides: { sessionNamespace: 'summary' } }));
    const [a, b] = getPromptObservations_ACU();
    expect(a.drift.baseline).toBe(true);
    expect(b.drift.baseline).toBe(true);
  });
});

describe('prompt-observer · 段级报告', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
    setPromptObservationEnabled_ACU(true);
  });

  it('未传段报告时 segments 为 undefined（UI 显示「未分段」而非空白）', () => {
    recordPromptAssembly_ACU(makeInput());
    expect(getPromptObservations_ACU()[0].segments).toBeUndefined();
    expect(getPromptObservations_ACU()[0].unsegmentedChars).toBeUndefined();
  });

  it('传入段报告时保留段名与字符数，并算出未分段差额', () => {
    recordPromptAssembly_ACU(makeInput({
      overrides: {
        sessionNamespace: 'table-fill',
        promptSegments: [
          { name: PROMPT_SEGMENT_SKELETON_ACU, chars: 20 },
          { name: PROMPT_PLACEHOLDER_SEGMENT_ACU.$0, chars: 100 },
          { name: PROMPT_SEGMENT_TABLE_WORLDBOOK_ACU, chars: 5 },
        ],
      },
    }));
    const record = getPromptObservations_ACU()[0];
    expect(record.segments).toEqual([
      { name: '骨架', chars: 20 },
      { name: '表数据与DDL', chars: 100 },
      { name: '表名世界书', chars: 5 },
    ]);
    // 总字符 11，各段之和 125 → 差额为负（宿主侧改写之外的场景），仍如实记录，账可审计。
    expect(record.unsegmentedChars).toBe(11 - 125);
  });

  it('占位符段名常量覆盖填表链全部占位符且无重复名', () => {
    expect(Object.keys(PROMPT_PLACEHOLDER_SEGMENT_ACU).sort()).toEqual(['$0', '$1', '$4', '$6', '$8', '$9', '$C', '$U']);
    const names = Object.values(PROMPT_PLACEHOLDER_SEGMENT_ACU);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('prompt-observer · 截断与上限', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
    setPromptObservationEnabled_ACU(true);
  });

  it('超长消息被截断并置 truncated，chars 仍记录截断前长度', () => {
    const huge = 'x'.repeat(200_000);
    recordPromptAssembly_ACU(makeInput({ messages: [{ role: 'user', content: huge }] }));
    const record = getPromptObservations_ACU()[0];
    expect(record.truncated).toBe(true);
    expect(record.messages[0].truncated).toBe(true);
    expect(record.messages[0].chars).toBe(200_000);
    expect(record.messages[0].content.length).toBe(120_000);
  });

  it('正常长度消息不置 truncated', () => {
    recordPromptAssembly_ACU(makeInput({ messages: [{ role: 'user', content: '短' }] }));
    expect(getPromptObservations_ACU()[0].truncated).toBeUndefined();
  });
});

describe('prompt-observer · 导出脱敏', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
    setPromptObservationEnabled_ACU(true);
  });

  it('导出内容不含正文里夹带的 API 密钥', () => {
    recordPromptAssembly_ACU(makeInput({
      messages: [{ role: 'user', content: '配置如下 {"api_key": "sk-abcdefghijklmnopqrstuvwxyz012345", "Authorization": "Bearer tok1234567890"}' }],
    }));
    const exported = exportPromptObservations_ACU();
    expect(exported).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(exported).not.toContain('tok1234567890');
    // 结构仍可用（是合法 JSON，且记录数正确）
    expect(JSON.parse(exported).recordCount).toBe(1);
  });

  it('导出不含端点查询串（观测器根本不采完整 URL）', () => {
    recordPromptAssembly_ACU(makeInput());
    expect(exportPromptObservations_ACU()).not.toContain('secret');
  });

  it('导出为空缓冲时结构完整', () => {
    const exported = JSON.parse(exportPromptObservations_ACU());
    expect(exported.recordCount).toBe(0);
    expect(exported.records).toEqual([]);
    expect(exported.limits.maxRecords).toBe(PROMPT_OBSERVATION_MAX_RECORDS_ACU);
  });
});

describe('prompt-observer · 异步 token 补齐不阻塞', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
    mockLogDebug.mockClear();
  });

  it('记录先落（tokens 未定），分词器返回后原地补齐并通知', async () => {
    let release: ((value: number) => void) | null = null;
    _set_SillyTavern_API_ACU({
      getTokenCountAsync: () => new Promise<number>(resolve => { release = resolve; }),
    } as any);
    setPromptObservationEnabled_ACU(true);

    const notified: number[] = [];
    subscribePromptObservations_ACU(records => {
      notified.push(records[0]?.totalTokens ?? -1);
    });

    recordPromptAssembly_ACU(makeInput());
    // 同步返回：记录已在，但 token 还没算完 —— 证明估算没有挡在记录之前。
    const record = getPromptObservations_ACU()[0];
    expect(record).toBeDefined();
    expect(record.totalTokens).toBeUndefined();
    expect(record.messages[0].tokens).toBeUndefined();

    // 估算链在自己的微任务里启动，等一拍后才能拿到分词器的 pending promise。
    await flushAsync();
    expect(release).not.toBeNull();
    // 两条消息各等一次，逐次放行
    release!(7);
    await flushAsync();
    if (record.messages[0].tokens === undefined) { release!(7); await flushAsync(); }
    if (record.messages[1].tokens === undefined) { release!(3); await flushAsync(); }

    expect(record.messages[0].tokens).toBe(7);
    expect(record.messages[1].tokens).toBe(3);
    expect(record.totalTokens).toBe(10);
    expect(notified).toContain(10);
  });

  it('分词器抛错时保留字符数，不抛给调用方', async () => {
    _set_SillyTavern_API_ACU({
      getTokenCountAsync: async () => { throw new Error('tokenizer down'); },
    } as any);
    setPromptObservationEnabled_ACU(true);
    recordPromptAssembly_ACU(makeInput());
    await flushAsync();
    const record = getPromptObservations_ACU()[0];
    // token-counter 自身降级为字符估算（ceil(chars/1.5)），故这里仍能补齐而不抛错
    expect(record.messages[0].tokens).toBe(Math.ceil(6 / 1.5));
    expect(record.totalTokens).toBe(Math.ceil(6 / 1.5) + Math.ceil(5 / 1.5));
  });

  it('段级 token 按同系数估算，不额外压宿主分词器', async () => {
    let calls = 0;
    _set_SillyTavern_API_ACU({ getTokenCountAsync: async () => { calls += 1; return 1; } } as any);
    setPromptObservationEnabled_ACU(true);
    recordPromptAssembly_ACU(makeInput({
      overrides: { sessionNamespace: 'table-fill', promptSegments: [{ name: '骨架', chars: 30 }] },
    }));
    await flushAsync();
    const record = getPromptObservations_ACU()[0];
    expect(record.segments?.[0].tokens).toBe(Math.ceil(30 / 1.5));
    // 仅两条消息各调一次；段级没有额外调用
    expect(calls).toBe(2);
  });
});

describe('prompt-observer · 健壮性', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    _set_SillyTavern_API_ACU(undefined);
    mockLogDebug.mockClear();
    setPromptObservationEnabled_ACU(true);
  });

  it('异常输入不抛错（undefined / null / 非数组），降级为一条空记录', () => {
    expect(() => recordPromptAssembly_ACU(undefined as any)).not.toThrow();
    expect(() => recordPromptAssembly_ACU({ messages: null as any, effectiveApiConfig: null })).not.toThrow();
    const records = getPromptObservations_ACU();
    expect(records.length).toBe(2);
    expect(records[0].messageCount).toBe(0);
    expect(records[0].scope).toBe('unknown');
    expect(records[0].endpointHost).toBe('');
  });

  it('非字符串 content 被安全字符串化，非字符串 role 记空', () => {
    recordPromptAssembly_ACU(makeInput({
      messages: [{ role: 123, content: { a: 1 } }, { role: 'user', content: null }] as any,
    }));
    const record = getPromptObservations_ACU()[0];
    expect(record.messages[0].role).toBe('');
    expect(record.messages[0].content).toBe('[object Object]');
    expect(record.messages[1].content).toBe('');
  });
});

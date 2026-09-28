/**
 * tests/service/ai/api-call-observer.test.ts
 * AI 出口的**响应观测接线** 单元测试（三段式的第二段）
 *
 * 覆盖 design §7 的 `api-call-observer` 行：
 * - 三档 transport 判定（真增量 / 整读回退 / 非流式）与 res.body 的对应关系；
 * - body **对象引用同一性**是配对成立的前提（buildCustomApiRequestBody_ACU → postChatCompletion_ACU）；
 * - 观测关闭时对外行为逐字不变（onDelta 恒 undefined、返回值一致、不写 response）；
 * - 异常路径上抛原异常且不补写正文（有界收尾）。
 *
 * 刻意**不 mock** prompt-observer：本文件验的就是它与出口的接线。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSettings, mockGetHeaders, mockHandleApiResponse, mockRateLimitSlot } = vi.hoisted(() => ({
  mockSettings: {
    apiMode: 'custom',
    apiConfig: { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test' },
    streamingEnabled: false,
    nonPrefillSupport: false,
    apiPresets: [] as any[],
  } as any,
  mockGetHeaders: vi.fn(() => ({ 'X-Custom': 'test' })),
  mockHandleApiResponse: vi.fn(),
  mockRateLimitSlot: vi.fn(async () => {}),
}));

vi.mock('../../../src/service/ai/prompt-builder', () => ({
  handleApiResponse_ACU: mockHandleApiResponse,
  extractAiUsageMetadata_ACU: vi.fn(() => null),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({
  settings_ACU: mockSettings,
}));

vi.mock('../../../src/data/gateways/ai-gateway', () => ({
  getHostRequestHeaders_ACU: mockGetHeaders,
}));

vi.mock('../../../src/service/ai/preset-rate-limiter', () => ({
  acquirePresetRateLimitSlot_ACU: mockRateLimitSlot,
}));

vi.mock('../../../src/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/utils')>();
  return { ...actual, logDebug_ACU: vi.fn(), logWarn_ACU: vi.fn() };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  buildCustomApiRequestBody_ACU,
  postChatCompletion_ACU,
} from '../../../src/service/ai/api-call';
import {
  __resetPromptObservationForTests_ACU,
  getPromptObservations_ACU,
  setPromptObservationEnabled_ACU,
} from '../../../src/service/ai/prompt-observer';

/** 造一个可观测的请求体（streamingEnabled 决定 body.stream）。 */
function buildObservableBody(streamingEnabled: boolean): Record<string, any> {
  return buildCustomApiRequestBody_ACU(
    [{ role: 'user', content: 'hi' }],
    { url: 'https://api.example.com', model: 'gpt-4', apiKey: 'sk-test', streamingEnabled } as any,
    { sessionNamespace: 'table-fill' },
  );
}

/** 造一个带 / 不带 getReader 的伪响应。 */
function fakeResponse(options: { withReader: boolean }) {
  return {
    ok: true,
    status: 200,
    body: options.withReader ? { getReader: () => ({}) } : null,
  } as any;
}

describe('postChatCompletion_ACU 的响应观测接线', () => {
  beforeEach(() => {
    __resetPromptObservationForTests_ACU();
    mockFetch.mockReset();
    mockHandleApiResponse.mockReset();
    setPromptObservationEnabled_ACU(true);
  });

  it('真增量：res.body.getReader 存在 ⇒ transport=incremental，onDelta 被转接并计数', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ withReader: true }));
    mockHandleApiResponse.mockImplementation(async (_res: any, _wants: any, _usage: any, onDelta: any) => {
      onDelta?.('a');
      onDelta?.('b');
      return 'ab';
    });

    const body = buildObservableBody(true);
    const result = await postChatCompletion_ACU(body);

    expect(result).toBe('ab');
    const record = getPromptObservations_ACU().at(-1)!;
    expect(record.response).toBeDefined();
    expect(record.response!.transport).toBe('incremental');
    expect(record.response!.chunkCount).toBe(2);
    expect(record.response!.content).toBe('ab');
  });

  it('整读回退：请求要流但 res.body 无 getReader ⇒ transport=buffered（回调仍会来）', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ withReader: false }));
    mockHandleApiResponse.mockImplementation(async (_res: any, _wants: any, _usage: any, onDelta: any) => {
      // 整读回退分支同样逐行触发 onDelta —— 这正是不能用 chunkCount 判增量的原因
      onDelta?.('line');
      return 'line';
    });

    const body = buildObservableBody(true);
    await postChatCompletion_ACU(body);

    const response = getPromptObservations_ACU().at(-1)!.response!;
    expect(response.transport).toBe('buffered');
    expect(response.chunkCount).toBe(1);
  });

  it('非流式：请求未带 stream ⇒ transport=json', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ withReader: true }));
    mockHandleApiResponse.mockResolvedValue('plain');

    const body = buildObservableBody(false);
    expect(body.stream).toBeFalsy();
    await postChatCompletion_ACU(body);

    expect(getPromptObservations_ACU().at(-1)!.response!.transport).toBe('json');
  });

  it('配对成立依赖 body 对象引用同一性（同一引用 ⇒ 拿到记录）', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ withReader: true }));
    mockHandleApiResponse.mockResolvedValue('ok');

    const body = buildObservableBody(true);
    await postChatCompletion_ACU(body);

    expect(getPromptObservations_ACU()).toHaveLength(1);
    expect(getPromptObservations_ACU()[0].response).toBeDefined();
  });

  it('引用被换掉（等价内容的新对象）⇒ 不补写正文（宁缺勿错，不猜）', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ withReader: true }));
    mockHandleApiResponse.mockResolvedValue('ok');

    const body = buildObservableBody(true);
    await postChatCompletion_ACU({ ...body });

    expect(getPromptObservations_ACU()).toHaveLength(1);
    expect(getPromptObservations_ACU()[0].response).toBeUndefined();
  });

  it('观测关闭：onDelta 恒为 undefined、返回值不变、不写 response', async () => {
    setPromptObservationEnabled_ACU(false);
    mockFetch.mockResolvedValue(fakeResponse({ withReader: true }));
    mockHandleApiResponse.mockResolvedValue('closed');

    const body = buildObservableBody(true);
    const result = await postChatCompletion_ACU(body);

    expect(result).toBe('closed');
    const [, wantsStream, , onDelta] = mockHandleApiResponse.mock.calls[0];
    expect(wantsStream).toBe(true);
    expect(onDelta).toBeUndefined();
    expect(getPromptObservations_ACU()).toHaveLength(0);
  });

  it('响应解析抛错：原异常照常上抛，且不补写正文', async () => {
    mockFetch.mockResolvedValue(fakeResponse({ withReader: true }));
    mockHandleApiResponse.mockRejectedValue(new Error('parse blew up'));

    const body = buildObservableBody(true);
    await expect(postChatCompletion_ACU(body)).rejects.toThrow('parse blew up');

    expect(getPromptObservations_ACU().at(-1)!.response).toBeUndefined();
  });

  it('HTTP 非 2xx：抛既有错误且不进入观测（记录无 response）', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom', body: null } as any);

    const body = buildObservableBody(true);
    await expect(postChatCompletion_ACU(body)).rejects.toThrow();

    expect(getPromptObservations_ACU().at(-1)!.response).toBeUndefined();
  });
});

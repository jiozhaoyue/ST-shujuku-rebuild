/**
 * tests/shared/host-compat/native-st-backend.luker.test.ts
 * Luker 2.7.0（stCompat 1.18.0）ctx 形状下的 native 后端行为校准：
 * 与 TT dev st-context 同面——loadWorldInfo / saveWorldInfo / getWorldInfoNames；
 * charLore 缺失时降级 POST /api/settings/get（带 CSRF 头）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogWarn, mockLogDebug } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
  logDebug_ACU: mockLogDebug,
}));

import { createNativeStBackend_ACU } from '../../../src/shared/host-compat/native-st-backend';

/** 构造一份与 Luker 1.18 getContext() 同形的最小 context 快照 */
function buildLukerContext(overrides: Record<string, any> = {}): any {
  return {
    getRequestHeaders: () => ({ 'X-CSRF-Token': 'luker-csrf' }),
    loadWorldInfo: vi.fn(async (_name: string) => ({
      entries: { '0': { uid: 0, comment: '条目A', content: '内容', enabled: true } },
    })),
    saveWorldInfo: vi.fn(async (_name: string | null, _data: any) => undefined),
    executeSlashCommandsWithOptions: vi.fn(async () => ({ pipe: 'slash-result' })),
    getWorldInfoNames: vi.fn(() => ['Luker世界书']),
    characters: [],
    characterId: 0,
    chat: [],
    ...overrides,
  };
}

describe('native-st-backend on Luker ctx shape', () => {
  let ctx: any;
  let backend: ReturnType<typeof createNativeStBackend_ACU>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctx = buildLukerContext();
    backend = createNativeStBackend_ACU(() => ctx);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ world_info_settings: { world_info: { charLore: [] } } }), { status: 200 }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('isUsable：Luker 1.18 面满足最低可用条件', () => {
    expect(backend.isUsable()).toBe(true);
  });

  it('getLorebookEntries 走 ctx.loadWorldInfo，无网络往返', async () => {
    const entries = await backend.getLorebookEntries('Luker世界书');
    expect(ctx.loadWorldInfo).toHaveBeenCalledWith('Luker世界书');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries[0]?.comment).toBe('条目A');
  });

  it('getLorebooks 走 ctx.getWorldInfoNames，返回 string[]', async () => {
    const names = await backend.getLorebooks();
    expect(names).toEqual(['Luker世界书']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('setLorebookEntries 走 ctx.saveWorldInfo', async () => {
    await backend.setLorebookEntries('Luker世界书', [{ uid: 0, comment: '条目A' }]);
    expect(ctx.saveWorldInfo).toHaveBeenCalledTimes(1);
    const [bookName] = ctx.saveWorldInfo.mock.calls[0];
    expect(bookName).toBe('Luker世界书');
  });

  it('getWorldInfoNames 缺失时 getLorebooks 降级 POST /api/settings/get 并携带 CSRF 头', async () => {
    const ctxNoNames = buildLukerContext({ getWorldInfoNames: undefined });
    const backend2 = createNativeStBackend_ACU(() => ctxNoNames);
    const names = await backend2.getLorebooks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/settings/get');
    expect((init as any)?.headers?.['X-CSRF-Token']).toBe('luker-csrf');
    expect(Array.isArray(names)).toBe(true);
  });
});

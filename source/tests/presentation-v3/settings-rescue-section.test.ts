/**
 * SettingsRescueSection — 配置副本恢复面板：空态说明、findings 列表、恢复/忽略调用链
 *
 * 数据面（rescue-service 门面）在本文件内 mock，只验 UI 交互与调用链。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

interface Harness {
  app: ReturnType<typeof createApp>;
  el: HTMLElement;
  find: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  decline: ReturnType<typeof vi.fn>;
  toastError: ReturnType<typeof vi.fn>;
}

function stored(backend: string, writtenAt: number, savedAt: number, keys: string[]): any {
  const entries: Record<string, unknown> = {};
  keys.forEach(key => { entries[key] = key; });
  return {
    backend,
    record: {
      format: 'acu-settings-rescue',
      version: 1,
      writtenAt,
      savedAt,
      declinedWrittenAt: null,
      backup: { entries },
    },
  };
}

async function mountPanel(findings: any[]): Promise<Harness> {
  vi.resetModules();
  document.body.innerHTML = '<div id="sr-app"></div>';

  // 每次 find 返回当前 findings 的快照；restore/decline 从数组移除对应副本，模拟刷新后列表即时更新。
  const find = vi.fn(async () => ({ ready: true, candidate: findings.length ? { latest: findings[0], pending: [...findings] } : null, failures: [] }));
  const restore = vi.fn(() => ({ ok: true, persistence: 'confirmed' }));
  const decline = vi.fn(async () => ({ ok: true, persistence: 'confirmed' }));
  const toastError = vi.fn();

  restore.mockImplementation((candidate: any) => {
    const writtenAt = candidate.latest.record.writtenAt;
    const index = findings.findIndex(f => f.record.writtenAt === writtenAt);
    if (index >= 0) findings.splice(index, 1);
    return { ok: true, persistence: 'confirmed' };
  });
  decline.mockImplementation(async (candidate: any) => {
    const writtenAt = candidate.latest.record.writtenAt;
    const index = findings.findIndex(f => f.record.writtenAt === writtenAt);
    if (index >= 0) findings.splice(index, 1);
    return { ok: true, persistence: 'confirmed' };
  });

  vi.doMock('../../src/service/settings/settings-rescue-service', () => ({
    findSettingsRescueCandidate_ACU: find,
    restoreSettingsRescue_ACU: restore,
    declineSettingsRescue_ACU: decline,
  }));
  vi.doMock('../../src/presentation-v2/stores/toast-store', () => ({
    useToastStore: () => ({ error: toastError }),
  }));

  const { default: SettingsRescueSection } = await import('../../src/presentation-v3/parts/SettingsRescueSection.vue');
  const app = createApp(SettingsRescueSection);
  app.mount('#sr-app');
  await nextTick();
  await nextTick();
  const el = document.getElementById('sr-app')!;
  return { app, el, find, restore, decline, toastError };
}

const clickByText = (el: HTMLElement, text: string): HTMLElement => {
  const btn = Array.from(el.querySelectorAll<HTMLElement>('button')).find(b => b.textContent?.trim() === text);
  if (!btn) throw new Error(`按钮未找到：${text}`);
  return btn;
};

/** restore 是同步门面、decline 是异步门面，两者后都跟一次异步 refresh，用宏任务轮次等链尾。 */
async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SettingsRescueSection', () => {
  it('无发现时显示一行短空态说明', async () => {
    const { el, find } = await mountPanel([]);
    expect(find).toHaveBeenCalled();
    expect(el.querySelector('[data-sr-list]')).toBeNull();
    expect(el.textContent).toContain('暂无待恢复的配置副本');
  });

  it('有 findings 时列表渲染每条的时间与键数', async () => {
    const savedAt = new Date(2026, 0, 2, 3, 4).getTime();
    const { el } = await mountPanel([stored('indexeddb', 100, savedAt, ['a', 'b', 'c'])]);
    const items = el.querySelectorAll('[data-sr-item]');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('3 个键');
    expect(items[0].textContent).toContain('2026-01-02 03:04');
  });

  it('恢复走门面 restoreSettingsRescue_ACU，成功后列表即时刷新', async () => {
    const findings = [stored('indexeddb', 100, 1000, ['a']), stored('indexeddb', 90, 900, ['b'])];
    const { el, restore, decline } = await mountPanel(findings);
    expect(el.querySelectorAll('[data-sr-item]')).toHaveLength(2);

    clickByText(el.querySelector('[data-sr-item]') as HTMLElement, '恢复').click();
    await settle();

    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0][0].latest.record.writtenAt).toBe(100);
    expect(decline).not.toHaveBeenCalled();
    expect(el.querySelectorAll('[data-sr-item]')).toHaveLength(1);
  });

  it('忽略走门面 declineSettingsRescue_ACU，成功后列表即时刷新', async () => {
    const findings = [stored('tauritavern-store', 200, 2000, ['a']), stored('indexeddb', 190, 1900, ['b'])];
    const { el, decline, restore } = await mountPanel(findings);

    clickByText(el.querySelector('[data-sr-item]') as HTMLElement, '忽略').click();
    await settle();

    expect(decline).toHaveBeenCalledTimes(1);
    expect(decline.mock.calls[0][0].latest.record.writtenAt).toBe(200);
    expect(restore).not.toHaveBeenCalled();
    expect(el.querySelectorAll('[data-sr-item]')).toHaveLength(1);
  });
});

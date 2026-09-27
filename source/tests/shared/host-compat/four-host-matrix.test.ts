/**
 * tests/shared/host-compat/four-host-matrix.test.ts — 四宿主兼容矩阵
 *
 * 覆盖目标：**SillyTavern / Luker / PureTavern / TauriTavern 四种宿主**在同一份
 * 判定与就绪等待逻辑下的行为，保证「一个构建装到四种宿主上都走对分支」。
 *
 * 与既有 `host-bridge-kind.test.ts` 的关系：那份测「三态判定」本身；
 * 本份测**四宿主的实际 ABI 形态**（含 PureTavern 的专属标记）以及 `waitForAcuHostReady`
 * 在各宿主上的就绪/降级口径 —— 这是「换了宿主会不会卡住启动」的那条线。
 *
 * 各宿主的真身 ABI 依据（2026-09-28 现场取证）：
 * - PureTavern：`window.SillyTavern` 存在、另有 `window.__PURE_TAVERN__` /
 *   `__PURE_TAVERN_DATA_STREAMING__` 自有标记；**没有** Luker、**没有** __TAURITAVERN__
 *   ⇒ 必须判定为通用分支（`sillytavern`），且其自有标记不得被误认成 TT/Luker。
 * - Luker：`window.Luker.getContext` 存在（Luker 2.7.0 实测）。
 * - TauriTavern：`window.__TAURITAVERN__` ABI（含 `.ready` 与 `.invoke.safeInvoke`）。
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  getAcuHostKind,
  isAcuLukerRuntime,
  isAcuTauriRuntime,
  waitForAcuHostReady,
  readAcuTauriVersion,
  isAcuTauriVersionOutdated,
  ACU_REQUIRED_TAURITAVERN_VERSION,
} from '../../../src/shared/host-bridge';

const originalWindow = (globalThis as any).window;

function setWindow(shape: Record<string, any>): void {
  (globalThis as any).window = { ...shape };
}

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as any).window;
  else (globalThis as any).window = originalWindow;
});

/** ST 家族（ST / Luker / PureTavern）共有的最小可用 getContext 快照。 */
function stContext(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    eventSource: { on: () => undefined },
    eventTypes: { APP_READY: 'app_ready' },
    saveSettingsDebounced: () => undefined,
    ...overrides,
  };
}

/** 各宿主的 ABI 形状（同一份构建要面对的全部形态）。 */
const HOSTS = [
  {
    key: 'SillyTavern',
    window: { SillyTavern: { getContext: () => stContext() } },
    kind: 'sillytavern',
    tauri: false,
    luker: false,
  },
  {
    key: 'Luker',
    window: { SillyTavern: { getContext: () => stContext() }, Luker: { getContext: () => stContext() } },
    kind: 'luker',
    tauri: false,
    luker: true,
  },
  {
    key: 'PureTavern',
    window: {
      SillyTavern: { getContext: () => stContext() },
      __PURE_TAVERN__: { version: 'x' },
      __PURE_TAVERN_DATA_STREAMING__: true,
    },
    kind: 'sillytavern',
    tauri: false,
    luker: false,
  },
  {
    key: 'TauriTavern',
    window: {
      SillyTavern: { getContext: () => stContext() },
      __TAURITAVERN__: { ready: true, invoke: { safeInvoke: async () => ({ tauriVersion: '2.3.0' }) } },
      __TAURITAVERN_MAIN_READY__: true,
    },
    kind: 'tauritavern',
    tauri: true,
    luker: false,
  },
] as const;

describe('四宿主 · 判定矩阵', () => {
  for (const host of HOSTS) {
    it(`${host.key} → 判定为 ${host.kind}`, () => {
      setWindow(host.window as Record<string, any>);
      expect(getAcuHostKind()).toBe(host.kind);
      expect(isAcuTauriRuntime()).toBe(host.tauri);
      expect(isAcuLukerRuntime()).toBe(host.luker);
    });
  }

  it('PureTavern 的自有标记不被误判为 TT 或 Luker', () => {
    setWindow({
      SillyTavern: { getContext: () => stContext() },
      __PURE_TAVERN__: { ready: true },
      __PURE_TAVERN_DATA_STREAMING__: true,
    });
    // 它没有 __TAURITAVERN__ / Luker.getContext，必须落到通用分支
    expect(isAcuTauriRuntime()).toBe(false);
    expect(isAcuLukerRuntime()).toBe(false);
    // 名字里带 ready 也不能被 TT 的 ready 探测认领
    expect(getAcuHostKind()).toBe('sillytavern');
  });

  it('Luker 全局在但缺 getContext → 按通用分支处理（不抛错）', () => {
    setWindow({ SillyTavern: { getContext: () => stContext() }, Luker: {} });
    expect(getAcuHostKind()).toBe('sillytavern');
  });
});

describe('四宿主 · 就绪等待口径', () => {
  it('ST / Luker / PureTavern：ctx 齐备即就绪，且不等待任何宿主 ABI', async () => {
    for (const host of HOSTS.filter(h => h.kind !== 'tauritavern')) {
      setWindow(host.window as Record<string, any>);
      const started = Date.now();
      await expect(waitForAcuHostReady(2000)).resolves.toBe(true);
      // 不应走满超时（这些宿主没有额外 ABI 要等）
      expect(Date.now() - started).toBeLessThan(1000);
    }
  });

  it('TauriTavern：ctx 齐备但 ABI 未就绪 → 不就绪（等满超时后返回 false）', async () => {
    setWindow({
      SillyTavern: { getContext: () => stContext() },
      __TAURITAVERN__: { ready: false },
    });
    await expect(waitForAcuHostReady(300)).resolves.toBe(false);
  });

  it('TauriTavern：ABI 以 Promise 形式就绪 → 等它兑现后返回 true', async () => {
    let resolveReady: (() => void) | null = null;
    const ready = new Promise<void>(r => { resolveReady = r; });
    setWindow({
      SillyTavern: { getContext: () => stContext() },
      __TAURITAVERN__: { ready },
    });
    const pending = waitForAcuHostReady(3000);
    setTimeout(() => resolveReady?.(), 50);
    await expect(pending).resolves.toBe(true);
  });

  it('TauriTavern：ABI 以布尔 true 就绪 → 立即 true', async () => {
    setWindow({
      SillyTavern: { getContext: () => stContext() },
      __TAURITAVERN__: { ready: true },
    });
    await expect(waitForAcuHostReady(2000)).resolves.toBe(true);
  });

  it('完全没有宿主全局 → 返回 false 且不抛错（纯浏览器/测试环境降级）', async () => {
    setWindow({});
    await expect(waitForAcuHostReady(200)).resolves.toBe(false);
  });

  it('getContext 齐备但缺 saveSettingsDebounced → 视为未就绪（不假就绪）', async () => {
    setWindow({
      SillyTavern: { getContext: () => ({ eventSource: {}, eventTypes: {} }) },
    });
    await expect(waitForAcuHostReady(200)).resolves.toBe(false);
  });
});

describe('四宿主 · TT 版本读取的宿主边界', () => {
  it('非 TT 宿主一律返回 null（不去调 safeInvoke）', async () => {
    setWindow({ SillyTavern: { getContext: () => stContext() } });
    await expect(readAcuTauriVersion()).resolves.toBeNull();

    setWindow({ SillyTavern: { getContext: () => stContext() }, Luker: { getContext: () => stContext() } });
    await expect(readAcuTauriVersion()).resolves.toBeNull();
  });

  it('TT 但 ABI 无 safeInvoke → 返回 null，不猜版本', async () => {
    setWindow({ SillyTavern: { getContext: () => stContext() }, __TAURITAVERN__: { ready: true } });
    await expect(readAcuTauriVersion()).resolves.toBeNull();
  });

  it('TT safeInvoke 抛错 → 返回 null（不把异常抛给启动链）', async () => {
    setWindow({
      SillyTavern: { getContext: () => stContext() },
      __TAURITAVERN__: { ready: true, invoke: { safeInvoke: async () => { throw new Error('abi down'); } } },
    });
    await expect(readAcuTauriVersion()).resolves.toBeNull();
  });

  it('读不到版本时按「不过旧」放行（fail-open，不误报纯 ST 用户）', () => {
    expect(isAcuTauriVersionOutdated(null)).toBe(false);
    expect(isAcuTauriVersionOutdated('')).toBe(false);
    expect(isAcuTauriVersionOutdated('not-a-version')).toBe(false);
  });

  it('版本比较：低于最低要求判过旧，等于/高于判可用', () => {
    expect(isAcuTauriVersionOutdated('2.2.9')).toBe(true);
    expect(isAcuTauriVersionOutdated('1.9.9')).toBe(true);
    expect(isAcuTauriVersionOutdated(ACU_REQUIRED_TAURITAVERN_VERSION)).toBe(false);
    expect(isAcuTauriVersionOutdated('2.3.1')).toBe(false);
    expect(isAcuTauriVersionOutdated('v2.3.0')).toBe(false);
  });
});

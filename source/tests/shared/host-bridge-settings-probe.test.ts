/**
 * tests/shared/host-bridge-settings-probe.test.ts — 配置防丢三件套的宿主能力探测（差异只进桥）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  probeSettingsConfirmBridge_ACU,
  getTauriSettingsStore_ACU,
} from '../../src/shared/host-bridge';

function setWindow(shape: Record<string, any>): void {
  (globalThis as any).window = { ...shape };
}

afterEach(() => { delete (globalThis as any).window; });

describe('probeSettingsConfirmBridge_ACU', () => {
  it('getContext 暴露 eventSource + SETTINGS_UPDATED 时返回桥接描述', () => {
    const eventSource = { on: vi.fn() };
    setWindow({
      SillyTavern: {
        getContext: () => ({ eventSource, eventTypes: { SETTINGS_UPDATED: 'settings_updated' } }),
      },
    });
    const bridge = probeSettingsConfirmBridge_ACU()!;
    expect(bridge).not.toBeNull();
    expect(bridge.eventSource).toBe(eventSource);
    expect(bridge.settingsUpdatedEventType).toBe('settings_updated');
    expect(bridge.debounceMs).toBe(1000);
  });

  it('兼容小写 event_types 形态', () => {
    setWindow({
      SillyTavern: {
        getContext: () => ({ eventSource: { on: vi.fn() }, event_types: { SETTINGS_UPDATED: 'SU' } }),
      },
    });
    expect(probeSettingsConfirmBridge_ACU()?.settingsUpdatedEventType).toBe('SU');
  });

  it('探测失败一律返回 null（静默降级）', () => {
    setWindow({});
    expect(probeSettingsConfirmBridge_ACU()).toBeNull();
    setWindow({ SillyTavern: { getContext: () => ({ eventSource: {} }) } });
    expect(probeSettingsConfirmBridge_ACU()).toBeNull();
  });
});

describe('getTauriSettingsStore_ACU', () => {
  it('TT 且 extension.store 形态完整时返回 store', () => {
    const store = { setJson: vi.fn(), tryGetJson: vi.fn() };
    setWindow({ __TAURITAVERN__: { api: { extension: { store } } } });
    expect(getTauriSettingsStore_ACU()).toBe(store);
  });

  it('非 TT 或形态不全时返回 null', () => {
    setWindow({ SillyTavern: { getContext: () => ({}) } });
    expect(getTauriSettingsStore_ACU()).toBeNull();
    setWindow({ __TAURITAVERN__: { api: { extension: { store: { setJson: vi.fn() } } } } });
    expect(getTauriSettingsStore_ACU()).toBeNull();
  });
});

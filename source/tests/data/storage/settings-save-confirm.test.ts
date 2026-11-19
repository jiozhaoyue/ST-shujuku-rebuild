/**
 * tests/data/storage/settings-save-confirm.test.ts
 * 酒馆设置写盘确认 单元测试（宿主事件通道经 host-bridge 探测；探测失败静默降级）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockProbe } = vi.hoisted(() => ({ mockProbe: vi.fn() as any }));

vi.mock('../../../src/shared/host-bridge', () => ({
  probeSettingsConfirmBridge_ACU: () => mockProbe(),
}));
vi.mock('../../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));

import {
  HOST_SETTINGS_DEBOUNCE_MS_ACU,
  SETTINGS_CONFIRM_GRACE_MS_ACU,
  SETTINGS_MAX_RESAVES_ACU,
  getSettingsPersistenceSnapshot_ACU,
  getSettingsPersistenceState_ACU,
  noteSettingsWrite_ACU,
  noteSettingsWriteFailed_ACU,
  subscribeSettingsPersistence_ACU,
  subscribeSettingsWrites_ACU,
  _resetSettingsSaveConfirm_ACU,
} from '../../../src/data/storage/settings-save-confirm';

const handlers: Array<() => void> = [];
const eventSource = { on: vi.fn((_type: string, handler: () => void) => { handlers.push(handler); }) };
const emitSettingsUpdated = () => { for (const handler of [...handlers]) handler(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  handlers.length = 0;
  eventSource.on.mockClear();
  _resetSettingsSaveConfirm_ACU();
  mockProbe.mockReturnValue({
    eventSource,
    settingsUpdatedEventType: 'settings_updated',
    debounceMs: HOST_SETTINGS_DEBOUNCE_MS_ACU,
  });
});

afterEach(() => {
  _resetSettingsSaveConfirm_ACU();
  vi.useRealTimers();
});

describe('settings-save-confirm（宿主能力探测成功）', () => {
  it('防抖窗口之后到达的 SETTINGS_UPDATED 确认写入', () => {
    const resave = vi.fn();
    const seq = noteSettingsWrite_ACU({ direct: false, resave });
    expect(getSettingsPersistenceState_ACU()).toBe('pending');
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU);
    emitSettingsUpdated();
    expect(getSettingsPersistenceSnapshot_ACU()).toMatchObject({ state: 'confirmed', confirmedWriteSeq: seq });
    expect(resave).not.toHaveBeenCalled();
  });

  it('事件一直不到时超时标为未落盘', () => {
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU + SETTINGS_CONFIRM_GRACE_MS_ACU - 1);
    expect(getSettingsPersistenceState_ACU()).toBe('pending');
    vi.advanceTimersByTime(1);
    expect(getSettingsPersistenceState_ACU()).toBe('unsaved');
  });

  it('早于防抖窗口的事件不确认写入，补发一次保存后等待后续事件', () => {
    const resave = vi.fn();
    noteSettingsWrite_ACU({ direct: false, resave });
    emitSettingsUpdated();
    expect(resave).toHaveBeenCalledTimes(1);
    expect(getSettingsPersistenceState_ACU()).toBe('pending');
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU);
    emitSettingsUpdated();
    expect(getSettingsPersistenceState_ACU()).toBe('confirmed');
  });

  it('直接保存的写入可被紧随其后的事件确认', () => {
    const resave = vi.fn();
    noteSettingsWrite_ACU({ direct: true, resave });
    emitSettingsUpdated();
    expect(getSettingsPersistenceState_ACU()).toBe('confirmed');
    expect(resave).not.toHaveBeenCalled();
  });

  it('同步失败直接标为未落盘并记录失败序号', () => {
    const seq = noteSettingsWriteFailed_ACU();
    expect(getSettingsPersistenceSnapshot_ACU()).toMatchObject({ state: 'unsaved', lastFailedWriteSeq: seq });
  });

  it('订阅者收到状态变化，取消订阅后不再收到', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSettingsPersistence_ACU(listener);
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    vi.advanceTimersByTime(HOST_SETTINGS_DEBOUNCE_MS_ACU);
    emitSettingsUpdated();
    expect(listener.mock.calls.map(call => call[0])).toEqual(['pending', 'confirmed']);
    unsubscribe();
    noteSettingsWriteFailed_ACU();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('同一事件源只安装一次监听', () => {
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    expect(eventSource.on).toHaveBeenCalledTimes(1);
  });
});

describe('settings-save-confirm（宿主能力探测失败→静默降级 D-03）', () => {
  it('无事件源时标为无法确认、不安装监听、不抛错', () => {
    mockProbe.mockReturnValue(null);
    expect(() => noteSettingsWrite_ACU({ direct: false, resave: vi.fn() })).not.toThrow();
    expect(getSettingsPersistenceState_ACU()).toBe('unconfirmable');
    expect(eventSource.on).not.toHaveBeenCalled();
  });

  it('写入订阅者在无法确认路径同样收到写入序号', () => {
    const listener = vi.fn();
    subscribeSettingsWrites_ACU(listener);
    mockProbe.mockReturnValue(null);
    const a = noteSettingsWrite_ACU({ direct: false, resave: vi.fn() });
    const b = noteSettingsWriteFailed_ACU();
    expect(listener.mock.calls.map(call => call[0])).toEqual([a, b]);
  });

  it('补发次数上限（写入路径参数照旧生效）', () => {
    const resave = vi.fn();
    noteSettingsWrite_ACU({ direct: false, resave });
    for (let i = 0; i < SETTINGS_MAX_RESAVES_ACU + 2; i++) emitSettingsUpdated();
    expect(resave).toHaveBeenCalledTimes(SETTINGS_MAX_RESAVES_ACU);
    expect(getSettingsPersistenceState_ACU()).toBe('pending');
  });
});

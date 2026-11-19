/**
 * tests/data/storage/settings-save-confirm-switch.test.ts
 * save-confirm 开关两态：默认关闭（保守上线）+ 开启后 unsaved 才提示；探测失败的 unconfirmable 静默。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: {} as any,
  state: 'confirmed' as string,
  listeners: new Set<(s: string) => void>(),
  showToast: vi.fn(),
}));

vi.mock('../../../src/service/runtime/state-manager', () => ({ settings_ACU: h.settings }));
vi.mock('../../../src/shared/ui-surface-registry', () => ({
  showUiSurfaceToast_ACU: (payload: any) => h.showToast(payload),
}));
vi.mock('../../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));
vi.mock('../../../src/data/storage/settings-save-confirm', () => ({
  getSettingsPersistenceState_ACU: () => h.state,
  subscribeSettingsPersistence_ACU: (listener: (s: string) => void) => {
    h.listeners.add(listener);
    return () => { h.listeners.delete(listener); };
  },
}));

import {
  SETTINGS_UNSAVED_TEXT_ACU,
  isSettingsSaveConfirmEnabled_ACU,
  syncSettingsSaveConfirmNotice_ACU,
  installSettingsSaveConfirmNotice_ACU,
  _resetSettingsSaveConfirmNotice_ACU,
} from '../../../src/service/settings/settings-save-confirm-notice';

beforeEach(() => {
  for (const key of Object.keys(h.settings)) delete h.settings[key];
  h.state = 'confirmed';
  h.listeners.clear();
  h.showToast.mockClear();
  _resetSettingsSaveConfirmNotice_ACU();
});

afterEach(() => {
  _resetSettingsSaveConfirmNotice_ACU();
});

describe('save-confirm 开关两态', () => {
  it('默认关闭（未设置 saveConfirmEnabled）', () => {
    expect(isSettingsSaveConfirmEnabled_ACU()).toBe(false);
  });

  it('显式 false 仍关闭', () => {
    h.settings.saveConfirmEnabled = false;
    expect(isSettingsSaveConfirmEnabled_ACU()).toBe(false);
  });

  it('显式 true 开启', () => {
    h.settings.saveConfirmEnabled = true;
    expect(isSettingsSaveConfirmEnabled_ACU()).toBe(true);
  });

  it('开关关闭时 unsaved 不弹提示', () => {
    h.settings.saveConfirmEnabled = false;
    syncSettingsSaveConfirmNotice_ACU('unsaved');
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('开关开启且 unsaved 时经既有 UI 通道提示', () => {
    h.settings.saveConfirmEnabled = true;
    syncSettingsSaveConfirmNotice_ACU('unsaved');
    expect(h.showToast).toHaveBeenCalledTimes(1);
    expect(h.showToast).toHaveBeenCalledWith({ kind: 'warning', text: SETTINGS_UNSAVED_TEXT_ACU });
  });

  it('开关开启但状态为 unconfirmable（探测失败）时静默降级', () => {
    h.settings.saveConfirmEnabled = true;
    syncSettingsSaveConfirmNotice_ACU('unconfirmable');
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('订阅安装后状态变化只在开关开启且 unsaved 时提示', () => {
    h.settings.saveConfirmEnabled = true;
    installSettingsSaveConfirmNotice_ACU();
    h.state = 'unsaved';
    for (const listener of [...h.listeners]) listener('unsaved');
    expect(h.showToast).toHaveBeenCalledTimes(1);
    for (const listener of [...h.listeners]) listener('confirmed');
    expect(h.showToast).toHaveBeenCalledTimes(1);
  });
});

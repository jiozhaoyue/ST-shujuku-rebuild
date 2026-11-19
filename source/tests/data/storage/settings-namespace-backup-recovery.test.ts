/**
 * tests/data/storage/settings-namespace-backup-recovery.test.ts
 * globalMeta 缺失恢复路径 单元测试：缺失标记/配置档枚举/恢复提示状态/写暂停开关。
 *
 * syncProfileRecovery_ACU 本身是 settings-service 的私有编排函数，这里逐项验证其依赖的
 * 数据面契约（上游 5518792c 的 namespace-backup 恢复路径正是由这些原语组成）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  store: null as any,
  globalMetaMissing: false,
  suspended: false,
  settings: {} as any,
}));

vi.mock('../../../src/data/storage/tavern-storage', () => ({
  getConfigStorage_ACU: () => harness.store,
}));
vi.mock('../../../src/shared/utils', () => ({ logWarn_ACU: vi.fn() }));
vi.mock('../../../src/shared/json-helpers', () => ({
  safeJsonParse_ACU: (json: string, fallback: any) => { try { return JSON.parse(json); } catch { return fallback; } },
  safeJsonStringify_ACU: (value: any, fallback: string) => { try { return JSON.stringify(value); } catch { return fallback; } },
}));
vi.mock('../../../src/shared/defaults-json.js', () => ({ TABLE_TEMPLATE_ACU: '' }));
vi.mock('../../../src/shared/takeover-control', () => ({ setTakeoverRuntimeEnabled_ACU: vi.fn() }));

import {
  STORAGE_KEY_GLOBAL_META_ACU,
  STORAGE_KEY_PROFILE_PREFIX_ACU,
  getProfileSettingsKey_ACU,
  getProfileTemplateKey_ACU,
} from '../../../src/shared/data-constants';
import {
  loadGlobalMeta_ACU,
  wasGlobalMetaMissingOnLoad_ACU,
  setGlobalMetaWriteSuspended_ACU,
  isGlobalMetaWriteSuspended_ACU,
  listStoredProfileCodes_ACU,
  saveGlobalMeta_ACU,
} from '../../../src/data/repositories/profile-repo';
import {
  getProfileRecoveryCodes_ACU,
  setProfileRecoveryCodes_ACU,
  subscribeProfileRecovery_ACU,
  _resetProfileRecoveryState_ACU,
} from '../../../src/service/settings/profile-recovery-state';

function makeStore(keys: string[], globalMetaRaw?: string): any {
  const map = new Map<string, any>();
  for (const key of keys) map.set(key, '{"v":1}');
  if (globalMetaRaw !== undefined) map.set(STORAGE_KEY_GLOBAL_META_ACU, globalMetaRaw);
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k) : null),
    setItem: (k: string, v: any) => { map.set(k, v); return true; },
    keys: () => [...map.keys()],
    setItemIfChanged: (k: string, v: any) => { map.set(k, v); return true; },
  };
}

beforeEach(() => {
  harness.globalMetaMissing = false;
  harness.suspended = false;
  _resetProfileRecoveryState_ACU();
  setGlobalMetaWriteSuspended_ACU(false);
});

afterEach(() => {
  _resetProfileRecoveryState_ACU();
  setGlobalMetaWriteSuspended_ACU(false);
});

describe('globalMeta 缺失检测', () => {
  it('键缺失 → wasGlobalMetaMissingOnLoad 为 true', () => {
    harness.store = makeStore([]);
    loadGlobalMeta_ACU();
    expect(wasGlobalMetaMissingOnLoad_ACU()).toBe(true);
  });

  it('键存在 → wasGlobalMetaMissingOnLoad 为 false', () => {
    harness.store = makeStore([], '{"activeIsolationCode":"a"}');
    loadGlobalMeta_ACU();
    expect(wasGlobalMetaMissingOnLoad_ACU()).toBe(false);
  });
});

describe('listStoredProfileCodes_ACU 枚举已有配置档', () => {
  it('列出设置/模板键中的非默认配置档，默认槽映射为空串', () => {
    harness.store = makeStore([
      getProfileSettingsKey_ACU('alpha'),
      getProfileTemplateKey_ACU('beta'),
      getProfileSettingsKey_ACU(''), // 默认槽
      `${STORAGE_KEY_PROFILE_PREFIX_ACU}__noise__bogus`,
    ]);
    const codes = listStoredProfileCodes_ACU()!;
    expect(codes).toContain('alpha');
    expect(codes).toContain('beta');
    expect(codes).toContain('');
    expect(codes).not.toContain('noise');
  });

  it('存储不支持 keys 时返回 null', () => {
    harness.store = { getItem: () => null, setItem: () => true };
    expect(listStoredProfileCodes_ACU()).toBeNull();
  });
});

describe('配置档恢复提示状态与写暂停开关', () => {
  it('恢复标识可订阅，切换配置档后清空', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProfileRecovery_ACU(listener);
    setProfileRecoveryCodes_ACU(['alpha', 'beta']);
    expect(getProfileRecoveryCodes_ACU()).toEqual(['alpha', 'beta']);
    setProfileRecoveryCodes_ACU(null);
    expect(getProfileRecoveryCodes_ACU()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('写暂停开关生效时 saveGlobalMeta 返回 false 且不写存储', () => {
    harness.store = makeStore([]);
    setGlobalMetaWriteSuspended_ACU(true);
    expect(isGlobalMetaWriteSuspended_ACU()).toBe(true);
    expect(saveGlobalMeta_ACU()).toBe(false);
    setGlobalMetaWriteSuspended_ACU(false);
    expect(saveGlobalMeta_ACU()).toBe(true);
  });
});

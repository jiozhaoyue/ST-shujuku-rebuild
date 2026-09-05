/**
 * tests/shared/host-compat/host-bridge-kind.test.ts — 宿主判定四态
 * tt / luker / generic-st / 探测降级。真机已验证 Luker 2.7.0 命中 'luker'。
 */
import { describe, it, expect, afterEach } from 'vitest';

import { getAcuHostKind, isAcuTauriRuntime, isAcuLukerRuntime } from '../../../src/shared/host-bridge';

function setWindow(shape: Record<string, any>): void {
  (globalThis as any).window = { ...shape };
}

describe('host kind detection', () => {
  afterEach(() => { delete (globalThis as any).window; });

  it('TT ABI 存在 → tauritavern（优先级最高）', () => {
    setWindow({ __TAURITAVERN__: { ready: true }, Luker: { getContext: () => ({}) } });
    expect(getAcuHostKind()).toBe('tauritavern');
    expect(isAcuTauriRuntime()).toBe(true);
    expect(isAcuLukerRuntime()).toBe(false);
  });

  it('Luker.getContext 存在 → luker', () => {
    setWindow({ Luker: { getContext: () => ({}) } });
    expect(getAcuHostKind()).toBe('luker');
    expect(isAcuLukerRuntime()).toBe(true);
    expect(isAcuTauriRuntime()).toBe(false);
  });

  it('只有 SillyTavern → sillytavern', () => {
    setWindow({ SillyTavern: { getContext: () => ({}) } });
    expect(getAcuHostKind()).toBe('sillytavern');
    expect(isAcuLukerRuntime()).toBe(false);
  });

  it('Luker 全局缺失 getContext → 降级 sillytavern', () => {
    setWindow({ Luker: {} });
    expect(getAcuHostKind()).toBe('sillytavern');
    expect(isAcuLukerRuntime()).toBe(false);
  });
});

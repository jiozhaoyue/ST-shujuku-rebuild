/**
 * tests/service/table/v2-replay-session.test.ts
 * evidence 复用新鲜度：结构映射与 options 指纹任一变化即失效（fail-open 回冷 replay）。
 */
import { describe, expect, it } from 'vitest';

import {
  buildReplayOptionsFingerprint_ACU,
  validateV2ReplayEvidenceFresh_ACU,
  type V2ReplayEvidence_ACU,
} from '../../../src/service/table/v2-replay-session';

function evidence(overrides: Partial<V2ReplayEvidence_ACU> = {}): V2ReplayEvidence_ACU {
  const chat: unknown[] = [];
  const { chatIdentity, ...rest } = overrides as any;
  return {
    chatIdentity: chatIdentity ?? chat,
    isolationKey: '',
    maxMessageIndex: undefined,
    baseKind: 'full_checkpoint',
    compatibilityRepairs: null,
    requiresCheckpointConvergence: false,
    data: {},
    headRevisionDigest: 'head-1',
    structureMappingDigest: 'struct-1',
    replayOptionsFingerprint: 'tpl|0|compat|default|alias|1',
    createdAt: 0,
    ...rest,
  } as V2ReplayEvidence_ACU;
}

describe('buildReplayOptionsFingerprint_ACU', () => {
  it('与 in-flight key 的 options 段口径一致', () => {
    expect(buildReplayOptionsFingerprint_ACU({})).toBe('tpl|0|compat|default|alias|1');
    expect(buildReplayOptionsFingerprint_ACU({ allowTemporaryTemplateBaseline: true }))
      .toBe('tpl|1|compat|default|alias|1');
    expect(buildReplayOptionsFingerprint_ACU({ compatibilityMode: 'disabled', enableAliasContext: false }))
      .toBe('tpl|0|compat|disabled|alias|0');
  });
});

describe('validateV2ReplayEvidenceFresh_ACU 结构/options 信号', () => {
  it('全部信号一致时复用', () => {
    const ev = evidence();
    expect(validateV2ReplayEvidenceFresh_ACU(
      ev, ev.chatIdentity as unknown[], '', {}, 'head-1', 'struct-1', 'tpl|0|compat|default|alias|1',
    )).toBe(true);
  });

  it('模板结构映射变化时失效', () => {
    const ev = evidence();
    expect(validateV2ReplayEvidenceFresh_ACU(
      ev, ev.chatIdentity as unknown[], '', {}, 'head-1', 'struct-2', 'tpl|0|compat|default|alias|1',
    )).toBe(false);
  });

  it('回放 options 变化时失效', () => {
    const ev = evidence();
    expect(validateV2ReplayEvidenceFresh_ACU(
      ev, ev.chatIdentity as unknown[], '', {}, 'head-1', 'struct-1', 'tpl|0|compat|disabled|alias|1',
    )).toBe(false);
  });

  it('旧 evidence 缺新字段时失效（不与新调用复用）', () => {
    const ev = evidence({ structureMappingDigest: undefined as any, replayOptionsFingerprint: undefined as any });
    expect(validateV2ReplayEvidenceFresh_ACU(
      ev, ev.chatIdentity as unknown[], '', {}, 'head-1', 'struct-1', 'tpl|0|compat|default|alias|1',
    )).toBe(false);
  });
});

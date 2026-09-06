/**
 * tests/service/table/floor-level-catch-up.test.ts — 楼层级追平调度器循环语义
 *
 * 完全 mock 编排器（staging/锚点机制不在被测面），只测外层循环：
 * 失败重规划续跑 / 尝试上限 / abort 贯通 / 终局类不重试 / no_work 收尾语义。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOrchestrate, mockLogWarn, mockLogDebug } = vi.hoisted(() => ({
  mockOrchestrate: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/service/table/update-orchestrator', () => ({
  orchestrateManualCatchUp_ACU: (...args: any[]) => mockOrchestrate(...args),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
  logDebug_ACU: mockLogDebug,
}));

import { runFloorLevelCatchUp_ACU } from '../../../src/service/table/floor-level-catch-up';

const refresh = async () => undefined;

function result(overrides: Record<string, any> = {}): any {
  return {
    success: true,
    committedBucketCount: 0,
    ...overrides,
  };
}

describe('runFloorLevelCatchUp_ACU', () => {
  beforeEach(() => {
    mockOrchestrate.mockReset();
  });

  it('一轮成功 → success，attempts=1，bucket 计数累计', async () => {
    mockOrchestrate.mockResolvedValueOnce(result({ success: true, outcome: 'complete', committedBucketCount: 3 }));
    const out = await runFloorLevelCatchUp_ACU(['sheet_a'], refresh);
    expect(out).toMatchObject({ outcome: 'success', committedBucketCount: 3, attempts: 1 });
    expect(mockOrchestrate).toHaveBeenCalledTimes(1);
  });

  it('失败后重规划续跑：第一轮失败提交 2 bucket，第二轮补完 → success，累计 5', async () => {
    mockOrchestrate
      .mockResolvedValueOnce(result({ success: false, committedBucketCount: 2, error: 'AI 调用失败' }))
      .mockResolvedValueOnce(result({ success: true, outcome: 'complete', committedBucketCount: 3 }));
    const out = await runFloorLevelCatchUp_ACU(['sheet_a'], refresh, { maxPlanAttempts: 2 });
    expect(out).toMatchObject({ outcome: 'success', committedBucketCount: 5, attempts: 2 });
    expect(mockOrchestrate).toHaveBeenCalledTimes(2);
    // 重规划续跑：编排器被原样再次调用（其内部规划会自动跳过已提交 bucket）
    expect(mockOrchestrate.mock.calls[1][0]).toEqual(['sheet_a']);
  });

  it('达到尝试上限 → failed，附已提交计数与续跑提示', async () => {
    mockOrchestrate
      .mockResolvedValueOnce(result({ success: false, committedBucketCount: 1, error: '网络错误' }))
      .mockResolvedValueOnce(result({ success: false, committedBucketCount: 0, error: '网络错误' }));
    const out = await runFloorLevelCatchUp_ACU(['sheet_a'], refresh, { maxPlanAttempts: 2 });
    expect(out).toMatchObject({ outcome: 'failed', committedBucketCount: 1, attempts: 2 });
    expect(out.error).toContain('断点续跑');
  });

  it('integrity_failed / blocked / sync_pending 不自动重试', async () => {
    for (const outcome of ['integrity_failed', 'blocked', 'sync_pending'] as const) {
      mockOrchestrate.mockReset();
      mockOrchestrate.mockResolvedValueOnce(result({ success: false, outcome, committedBucketCount: 1, error: 'x' }));
      const out = await runFloorLevelCatchUp_ACU(['sheet_a'], refresh, { maxPlanAttempts: 3 });
      expect(out.outcome).toBe(outcome);
      expect(mockOrchestrate).toHaveBeenCalledTimes(1);
    }
  });

  it('abort 信号贯通：编排器报 stopped 时透传并累计已提交', async () => {
    mockOrchestrate.mockResolvedValueOnce(result({ success: false, outcome: 'stopped', committedBucketCount: 4 }));
    const out = await runFloorLevelCatchUp_ACU(['sheet_a'], refresh);
    expect(out).toMatchObject({ outcome: 'stopped', committedBucketCount: 4, attempts: 1 });
  });

  it('开始前已 abort → 不调用编排器直接 stopped', async () => {
    const abortController = new AbortController();
    abortController.abort();
    const out = await runFloorLevelCatchUp_ACU(['sheet_a'], refresh, { abortController });
    expect(out.outcome).toBe('stopped');
    expect(mockOrchestrate).not.toHaveBeenCalled();
  });

  it('no_work 且本轮无提交 → no_work；有提交 → success 语义', async () => {
    mockOrchestrate.mockResolvedValueOnce(result({ success: true, outcome: 'no_work', committedBucketCount: 0 }));
    const out1 = await runFloorLevelCatchUp_ACU(['sheet_a'], refresh);
    expect(out1.outcome).toBe('no_work');

    mockOrchestrate.mockReset();
    mockOrchestrate
      .mockResolvedValueOnce(result({ success: false, committedBucketCount: 2, error: 'e' }))
      .mockResolvedValueOnce(result({ success: true, outcome: 'no_work', committedBucketCount: 0 }));
    const out2 = await runFloorLevelCatchUp_ACU(['sheet_a'], refresh, { maxPlanAttempts: 2 });
    expect(out2).toMatchObject({ outcome: 'success', committedBucketCount: 2 });
  });

  it('batchSizeOverride 透传编排器', async () => {
    mockOrchestrate.mockResolvedValueOnce(result({ success: true, outcome: 'complete' }));
    await runFloorLevelCatchUp_ACU(['sheet_a'], refresh, { batchSizeOverride: 1 });
    expect(mockOrchestrate.mock.calls[0][2].batchSizeOverride).toBe(1);
  });
});

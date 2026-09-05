/**
 * service/table/floor-level-catch-up.ts — 楼层级追平调度器
 *
 * 在 orchestrateManualCatchUp_ACU 之上的外层循环，不触碰编排器内部的
 * staging/锚点/TOCTOU 安全机制（那是阻塞事故的高危区，禁止外层改写）：
 * - 编排器本身 fail-fast：一个 bucket 失败即整轮终止，但已提交 bucket 保留；
 * - 本调度器在失败后**重新规划续跑**——追平规划只覆盖"已提交连续前沿之后的
 *   后缀缺口"，已完成的 bucket 在重规划时自动消失，因此失败楼之前的成果
 *   永远不重复消耗，失败楼之后自动续跑；
 * - 完整性/阻断类终局（integrity_failed / blocked / sync_pending）绝不自动重试，
 *   这类结果需要人工介入（V2 恢复/重新确认），盲目重试只会掩盖问题；
 * - abort 贯通：信号直接透传编排器，staging 收敛语义由编排器负责。
 */

import {
    orchestrateManualCatchUp_ACU,
    type ManualUpdateResult,
} from './update-orchestrator';
import { logDebug_ACU, logWarn_ACU } from '../../shared/utils';

export interface FloorLevelCatchUpOptions_ACU {
    abortController?: AbortController;
    onProgress?: (event: any) => void;
    executionSnapshot?: { sheetKeys: string[] };
    /** 正整数覆盖追平分批粒度（1 = 逐楼）；缺省走手动面板设置。 */
    batchSizeOverride?: number;
    /** 每轮规划（缺口窗口）的执行尝试上限；默认 2（失败后重规划重试一次）。 */
    maxPlanAttempts?: number;
}

export interface FloorLevelCatchUpResult_ACU {
    outcome: 'success' | 'no_work' | 'stopped' | 'failed' | 'blocked' | 'integrity_failed' | 'sync_pending' | 'progress_metadata_failed';
    committedBucketCount: number;
    attempts: number;
    error?: string;
}

function stoppedResult(result: FloorLevelCatchUpResult_ACU): FloorLevelCatchUpResult_ACU {
    return result;
}

export async function runFloorLevelCatchUp_ACU(
    targetKeys: string[],
    refreshData: () => Promise<{ degraded?: boolean } | void>,
    options: FloorLevelCatchUpOptions_ACU = {},
): Promise<FloorLevelCatchUpResult_ACU> {
    const maxPlanAttempts = Math.max(1, Math.trunc(Number(options.maxPlanAttempts) || 2));
    let committedTotal = 0;
    let attempts = 0;
    let lastError: string | undefined;

    for (;;) {
        if (options.abortController?.signal.aborted) {
            return stoppedResult({
                outcome: 'stopped',
                committedBucketCount: committedTotal,
                attempts,
                error: '追平在开始下一轮规划前被终止。',
            });
        }

        attempts += 1;
        const result: ManualUpdateResult = await orchestrateManualCatchUp_ACU(targetKeys, refreshData, {
            abortController: options.abortController,
            onProgress: options.onProgress,
            executionSnapshot: options.executionSnapshot,
            batchSizeOverride: options.batchSizeOverride,
        });
        committedTotal += result.committedBucketCount || 0;

        if (result.outcome === 'no_work') {
            // 无新增缺口：若本次调用累计提交过 bucket，按成功收尾。
            return stoppedResult(committedTotal > 0
                ? { outcome: 'success', committedBucketCount: committedTotal, attempts }
                : { outcome: 'no_work', committedBucketCount: 0, attempts });
        }
        if (result.outcome === 'complete' || result.success) {
            return stoppedResult({ outcome: 'success', committedBucketCount: committedTotal, attempts });
        }
        if (result.outcome === 'stopped') {
            return stoppedResult({
                outcome: 'stopped',
                committedBucketCount: committedTotal,
                attempts,
                error: result.error,
            });
        }
        if (result.outcome === 'sync_pending' || result.outcome === 'progress_metadata_failed'
            || result.outcome === 'blocked' || result.outcome === 'integrity_failed') {
            // 终局类：需要人工介入或属非致命收尾，绝不自动重试。
            return stoppedResult({
                outcome: result.outcome,
                committedBucketCount: committedTotal,
                attempts,
                error: result.error,
            });
        }
        // 通用失败（success:false 且无终局 outcome）：
        // 在尝试预算内重规划续跑（已提交 bucket 由规划天然跳过）。
        lastError = result.error || '手动追平失败。';
        if (attempts >= maxPlanAttempts) {
            logWarn_ACU(`[楼层级追平] 已达尝试上限（${attempts} 次），停止：已提交 ${committedTotal} 个 bucket，失败原因：${lastError}`);
            return stoppedResult({
                outcome: 'failed',
                committedBucketCount: committedTotal,
                attempts,
                error: `${lastError}（已提交 ${committedTotal} 个 bucket，重新执行追平会自动从断点续跑。）`,
            });
        }
        logDebug_ACU(`[楼层级追平] 第 ${attempts} 轮失败（${lastError}），重规划续跑（已提交 ${committedTotal} 个 bucket 不受影响）。`);
    }
}

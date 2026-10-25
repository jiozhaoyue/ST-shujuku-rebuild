/**
 * api-call 响应观测接线守卫 —— 把台账判据固化成会响的钉子
 *
 * 背景（docs/superpowers/specs/2026-09-27-fork-delta-ledger.md §3 阶段 3 口径提示）：
 * 响应正文观测（写库流水三段式的第一/二段）依赖「本方注册的 AI 出口只有两个」这一前提 ——
 * 每个出口内部必须**恰好一处** `handleApiResponse_ACU(` 接线（响应正文在那里被观测器补写）。
 * 若上游新增/改名 AI 出口而忘接线，会出现「有出站提示词、无响应正文」的半截记录，
 * 且面板只如实显示「未补写」，不会报错 —— 静默缺口。本守卫把它变成测试失败。
 *
 * 形态参照 tests/shared/manifest-identity.test.ts（结构不变式守卫，读源码文本断言）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest 以 source/ 为 cwd（__dirname 在转换层不可靠）；结构守卫按 cwd 定位源码。
const API_CALL_FILE = join(process.cwd(), 'src', 'service', 'ai', 'api-call.ts');

/** 台账口径：本方注册的 AI 出口清单（新增出口时：先接线，再把名字加进这里）。 */
const REGISTERED_AI_OUTLETS_ACU = ['postChatCompletion_ACU', 'callAIWithResolvedPreset_ACU'] as const;

describe('api-call 响应观测接线守卫（台账阶段 3 判据）', () => {
  const source = readFileSync(API_CALL_FILE, 'utf8');

  it('handleApiResponse_ACU 接线点数与已注册出口数一致（多出口少接线 = 半截记录）', () => {
    const wiringSites = source.match(/handleApiResponse_ACU\(/g)?.length ?? 0;
    expect(
      wiringSites,
      `handleApiResponse_ACU 接线点 ${wiringSites} 个，但已注册出口 ${REGISTERED_AI_OUTLETS_ACU.length} 个。` +
        '新增 AI 出口必须在出口内部接线响应观测（参照既有两处），否则写库流水会出现' +
        '「有出站提示词、无响应正文」的半截记录；确认接线后请同步更新 REGISTERED_AI_OUTLETS_ACU。',
    ).toBe(REGISTERED_AI_OUTLETS_ACU.length);
  });

  it('每个已注册出口都被 export，且函数体内含恰好一处接线', () => {
    for (const outlet of REGISTERED_AI_OUTLETS_ACU) {
      const declPattern = new RegExp(`export async function ${outlet}\\(`);
      expect(declPattern.test(source), `出口 ${outlet} 未找到 export async function 声明（改名了？同步台账与本守卫）`).toBe(true);

      // 从声明处切到下一个顶层 export（或文件尾）作为函数体窗口
      const start = source.search(declPattern);
      const nextExport = source.indexOf('\nexport ', start + 1);
      const body = source.slice(start, nextExport === -1 ? source.length : nextExport);
      const sites = body.match(/handleApiResponse_ACU\(/g)?.length ?? 0;
      expect(sites, `出口 ${outlet} 函数体内接线点 ${sites} 个（应为 1）——出站提示词与响应正文靠它配对`).toBe(1);
    }
  });

  it('观测侧配对原语存在（linkBody / beginPromptStreamObservation_ACU）', async () => {
    const observer = await import('../../../src/service/ai/prompt-observer');
    expect(typeof (observer as Record<string, unknown>).beginPromptStreamObservation_ACU).toBe('function');
    expect(typeof (observer as Record<string, unknown>).getLatestObservationIdForScope_ACU).toBe('function');
    const source = readFileSync(API_CALL_FILE, 'utf8');
    expect(source).toContain('beginPromptStreamObservation_ACU');
  });
});

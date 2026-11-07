import { describe, expect, it } from 'vitest';
import { rankAgentWorldbookCandidates_ACU } from '../../../src/service/agent/agent-worldbook-ranking';

const emptyQuery = { userInput: '', recentContext: '', taskContext: '' };

function candidate(comment: string, keys: string[] = [], description = '', triggerWhen = '') {
  return { comment, keys, description, triggerWhen };
}

describe('rankAgentWorldbookCandidates_ACU', () => {

  it('3000 候选 + 长上下文排序保持线性量级（query 词项只提一次）', () => {
    const bigContext = '夜色漫过屋檐，她收起最后一封信。'.repeat(400);
    const longComment = '条目正文酒馆传闻矿洞地图，附带冗长的背景描述与人物关系铺陈。'.repeat(60);
    const candidates = Array.from({ length: 3000 }, (_, i) =>
      candidate(`${longComment}条目${i}`, [`key${i % 100}`, `地点${i % 50}`], `描述${i}地下通道`, `触发${i}调查时使用`));
    const startedAt = Date.now();
    const ranked = rankAgentWorldbookCandidates_ACU(candidates, {
      userInput: '寻找矿洞入口',
      recentContext: bigContext,
      taskContext: '',
    });
    // 预算口径（2026-09-27 实测重定）：
    // 本断言要抓的是**复杂度回归**（query 词项若按候选项重提，规模一上来就是数量级劣化），
    // 不是绝对速度。旧值 1500ms 是更快的机器上定的，在本机已贴边：
    // 单独跑三次实测 786 / 894 / 1179ms，全量并发下 2104ms（超时 15s，故不能放宽到 15s 量级）。
    // 真回归（每候选重提词项）实测为 10 倍以上，6000ms 仍能稳稳抓住。
    expect(Date.now() - startedAt).toBeLessThan(6000);
    expect(ranked).toHaveLength(3000);
  });

  it('preserves input order for empty queries and equal scores', () => {
    const first = candidate('第一条');
    const second = candidate('第二条');
    const third = candidate('第三条');

    expect(rankAgentWorldbookCandidates_ACU([first, second, third], emptyQuery)).toEqual([first, second, third]);
    expect(rankAgentWorldbookCandidates_ACU([first, second, third], {
      ...emptyQuery,
      userInput: '不存在的词项',
    })).toEqual([first, second, third]);
  });
});

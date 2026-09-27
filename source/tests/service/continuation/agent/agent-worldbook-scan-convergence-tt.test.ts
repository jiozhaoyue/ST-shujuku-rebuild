/**
 * TT 移植上游 ce867f86-B：$WORLDBOOK_HITS 的触发扫描文本收敛。
 *
 * buildAgentWorldbookScanText_ACU 从「初始要求 + 本轮目标 + 未结算正文 + 尾楼」改为
 * 「仅最近一个用户楼 + 最近一个 AI 楼」。扫描文本变短是收敛不是放宽：T11 级联触发、
 * excludeRecursion/preventRecursion 语义与命中清单口径保持不变；命中只给目录行提示，
 * 注入面不因收敛放大（read-gate 不因此放宽）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildAgentWorldbookScanText_ACU,
  buildRecentWorldbookScanText_ACU,
  type AgentResolveContext_ACU,
} from '../../../../src/service/continuation/agent/agent-placeholder-resolver';
import { renderAgentWorldbookHits_ACU } from '../../../../src/service/continuation/agent/agent-worldbook-read';

function context_ACU(overrides: Partial<AgentResolveContext_ACU> = {}): AgentResolveContext_ACU {
  return {
    chat: [
      { is_user: true, mes: 'ORIGIN 关键词只出现在更早用户楼' },
      { mes: 'OLD_AI 楼正文' },
      { is_user: true, mes: 'LAST_USER 楼关键词' },
      { mes: 'LAST_AI 楼正文' },
    ],
    moduleSnapshot: { modules: [], revisions: {}, unsettled: [] } as any,
    settledThroughIndex: -1,
    execution: { turn: { goal: '本轮目标GOAL词' } } as any,
    originInstruction: '用户初始要求ORIGIN词',
    ...overrides,
  } as AgentResolveContext_ACU;
}

describe('世界书命中扫描收敛（ce867f86-B）', () => {
  it('扫描文本只含最近一个用户楼与最近一个 AI 楼，按 user→AI 顺序拼接', () => {
    const scan = buildAgentWorldbookScanText_ACU(context_ACU());
    expect(scan).toBe('LAST_USER 楼关键词\nLAST_AI 楼正文');
  });

  it('初始要求、本轮目标、更早楼层内容不再进入扫描文本', () => {
    const scan = buildAgentWorldbookScanText_ACU(context_ACU());
    expect(scan).not.toContain('ORIGIN 关键词');
    expect(scan).not.toContain('用户初始要求ORIGIN词');
    expect(scan).not.toContain('本轮目标GOAL词');
    expect(scan).not.toContain('OLD_AI 楼正文');
    expect(scan).not.toContain('没有尚未结算');
  });

  it('独立入口 buildRecentWorldbookScanText_ACU：只有 AI 楼/只有用户楼/空聊天都如实返回', () => {
    expect(buildRecentWorldbookScanText_ACU([{ mes: '只有AI' }])).toBe('只有AI');
    expect(buildRecentWorldbookScanText_ACU([{ is_user: true, mes: '只有用户' }])).toBe('只有用户');
    expect(buildRecentWorldbookScanText_ACU([])).toBe('');
    expect(buildRecentWorldbookScanText_ACU([
      { is_user: true, mes: '用户一' },
      { is_user: true, mes: '用户二' },
    ])).toBe('用户二');
  });

  it('上下文排除规则对两楼同样生效（P1 过滤不弱化）', () => {
    const scan = buildRecentWorldbookScanText_ACU(
      [
        { is_user: true, mes: '用户楼 <disclaimer>免责</disclaimer>保留' },
        { mes: 'AI楼 <disclaimer>免责</disclaimer>保留' },
      ],
      { extractRules: [], excludeRules: [{ start: '<disclaimer', end: '</disclaimer>' }] } as any,
    );
    expect(scan).not.toContain('免责');
    expect(scan).toContain('用户楼');
    expect(scan).toContain('保留');
  });

  it('命中口径随扫描收敛：仅由更早文本触发的条目不再命中，级联语义保持', () => {
    const context = context_ACU();
    const scan = buildAgentWorldbookScanText_ACU(context);
    const snapshot = {
      available: true,
      entries: [
        { bookName: 'B', uid: '1', title: '靠初始要求命中', keys: ['ORIGIN词'], constant: false, content: 'c1', tokens: 10 },
        { bookName: 'B', uid: '2', title: '靠最近用户楼命中', keys: ['LAST_USER'], constant: false, content: '正文含 CASCADE_FROM_2 标记，用于级联', tokens: 10 },
        { bookName: 'B', uid: '3', title: '级联命中', keys: ['CASCADE_FROM_2'], constant: false, content: 'c3', tokens: 10 },
      ],
    };
    const hits = renderAgentWorldbookHits_ACU(snapshot, scan);
    expect(hits).toContain('靠最近用户楼命中');
    expect(hits).toContain('级联命中');
    expect(hits).not.toContain('靠初始要求命中');
    // 命中清单仍只给目录行提示（标题/地址），不注入条目全文——注入面不因收敛放大。
    expect(hits).not.toContain('正文含 CASCADE_FROM_2 标记');
    expect(hits).toContain('$WORLDBOOK:B:2');
  });
});

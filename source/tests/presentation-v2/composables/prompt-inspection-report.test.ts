/**
 * tests/presentation-v2/composables/prompt-inspection-report.test.ts
 * 「复制给 AI 的排查报告」文本渲染 单元测试（纯函数，无 DOM）
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_MESSAGE_PREVIEW_CHARS,
  buildPromptInspectionReport,
  formatCount,
  formatRecordMeta,
  formatRecordTitle,
} from '../../../src/presentation-v2/composables/prompt-inspection-report';
import type { PromptObservationRecord_ACU } from '../../../src/service/ai/prompt-observer';

function makeRecord(overrides: Partial<PromptObservationRecord_ACU> = {}): PromptObservationRecord_ACU {
  return {
    id: 1,
    at: Date.UTC(2026, 8, 27, 14, 30, 5),
    scope: 'table-fill',
    model: 'deepseek-v3',
    endpointHost: 'api.example.com:8001',
    stream: true,
    messageCount: 2,
    messages: [
      { role: 'system', content: '你是填表助手', chars: 6 },
      { role: 'user', content: '请更新表格', chars: 5 },
    ],
    totalChars: 11,
    drift: { baseline: true, messageCount: 2, systemRoleCount: 1 },
    driftText: '基线建立：消息 2 条，system 1 条',
    ...overrides,
  };
}

describe('buildPromptInspectionReport', () => {
  it('空列表给出明确说明而不是空白', () => {
    const text = buildPromptInspectionReport([]);
    expect(text).toContain('没有记录');
  });

  it('渲染表头与说明（含「密钥从未被采集」的口径）', () => {
    const text = buildPromptInspectionReport([makeRecord()]);
    expect(text).toContain('# 提示词观测报告');
    expect(text).toContain('记录数：1');
    expect(text).toContain('密钥与请求头从未被采集');
  });

  it('单条记录含 scope / 模型 / 端点主机 / 流式 / 消息量 / diff / 消息明细', () => {
    const text = buildPromptInspectionReport([makeRecord()]);
    expect(text).toContain('## 记录 1 · table-fill');
    expect(text).toContain('模型：deepseek-v3');
    expect(text).toContain('端点主机：api.example.com:8001');
    expect(text).toContain('流式：是');
    expect(text).toContain('消息：2 条 / 11 字符');
    expect(text).toContain('与同 scope 上次调用：基线建立');
    expect(text).toContain('### 消息明细');
    expect(text).toContain('1. [system] 6 字符');
    expect(text).toContain('你是填表助手');
  });

  it('多次记录按「最新在前」排列', () => {
    const text = buildPromptInspectionReport([
      makeRecord({ id: 1, scope: 'older' }),
      makeRecord({ id: 2, scope: 'newer' }),
    ]);
    expect(text.indexOf('· newer')).toBeLessThan(text.indexOf('· older'));
  });

  it('填表记录给出分段占比与未归类差额', () => {
    const text = buildPromptInspectionReport([makeRecord({
      totalChars: 100,
      unsegmentedChars: 10,
      segments: [
        { name: '骨架', chars: 20 },
        { name: '表数据与DDL', chars: 70 },
      ],
    })]);
    expect(text).toContain('骨架：20 字符（占总量 20.0%）');
    expect(text).toContain('表数据与DDL：70 字符（占总量 70.0%）');
    expect(text).toContain('未归类差额：+10 字符');
  });

  it('非填表记录显式写明「未分段」及其原因，不留空白', () => {
    const text = buildPromptInspectionReport([makeRecord({ segments: undefined })]);
    expect(text).toContain('未分段');
    expect(text).toContain('该功能域不提供段级拆解');
  });

  it('正文脱敏：夹带的 API 密钥不出现在报告里', () => {
    const text = buildPromptInspectionReport([makeRecord({
      messages: [{
        role: 'user',
        chars: 60,
        content: '配置：{"api_key": "sk-abcdefghijklmnopqrstuvwxyz012345"} 与 apiKey=plainsecretvalue',
      }],
    })]);
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(text).not.toContain('plainsecretvalue');
  });

  it('超长正文按上限截断并显式标注，且给出完整长度', () => {
    const long = 'x'.repeat(REPORT_MESSAGE_PREVIEW_CHARS + 500);
    const text = buildPromptInspectionReport([makeRecord({
      messages: [{ role: 'user', content: long, chars: long.length }],
    })]);
    expect(text).toContain('此处截断，完整内容见「导出 JSON」');
    expect(text).toContain(formatCount(long.length));
    // 正文没有全量塞进报告
    expect(text.length).toBeLessThan(long.length);
  });

  it('token 未算完时如实标注「估算中」而不是编造数字', () => {
    const text = buildPromptInspectionReport([makeRecord({ totalTokens: undefined })]);
    expect(text).toContain('估算中');
  });

  it('截断标志被如实写进报告', () => {
    const text = buildPromptInspectionReport([makeRecord({ truncated: true })]);
    expect(text).toContain('内容超上限已截断');
  });
});

describe('格式化助手', () => {
  it('formatCount 千分位且对空值给占位符', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(undefined)).toBe('—');
    expect(formatCount(Number.NaN)).toBe('—');
  });

  it('formatRecordTitle / formatRecordMeta 给出人读标题', () => {
    const record = makeRecord();
    expect(formatRecordTitle(record)).toBe('#1 · table-fill');
    expect(formatRecordMeta(record)).toContain('2 条');
    expect(formatRecordMeta(record)).toContain('11 字符');
  });
});

/**
 * prompt-inspection-report — 把提示词观测记录渲染成「可直接贴进酒馆让 AI 排查」的文本报告
 *
 * 为什么单独成模块：这是纯函数（无 Vue、无 DOM），既能被面板调用，也能被单测直接钉住格式。
 *
 * 两条纪律：
 * 1. **脱敏**：报告与导出同一条口径 —— 每个字符串字段先过 `maskSensitiveText_ACU`
 *    （复用 shared/log-buffer 的既有通道），绝不新开未脱敏出口。
 * 2. **有界**：单条消息正文在报告里按上限截断并显式标注，避免把 12 万字符塞进一次聊天；
 *    完整正文仍在「导出 JSON」里。上限具名导出，便于按需调整。
 */
import { maskSensitiveText_ACU } from '../../shared/log-buffer';
import type { PromptObservationRecord_ACU } from '../../service/ai/prompt-observer';

/** 报告里单条消息正文的截断上限（字符）。 */
export const REPORT_MESSAGE_PREVIEW_CHARS = 8_000;

const PLACEHOLDER_ACU = '—';

function mask(value: unknown): string {
  return maskSensitiveText_ACU(String(value ?? ''));
}

/** 千分位：长提示词的字符量级只看数量级，加分隔更好读。 */
export function formatCount(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return PLACEHOLDER_ACU;
  return Math.round(value).toLocaleString('en-US');
}

function formatTime(at: number): string {
  try {
    const d = new Date(at);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return PLACEHOLDER_ACU;
  }
}

/** 一条记录的人读标题（面板折叠头与报告小节标题共用）。 */
export function formatRecordTitle(record: PromptObservationRecord_ACU): string {
  return `#${record.id} · ${record.scope}`;
}

/** 一条记录的人读副标题：时间 · 消息数 · 字符量。 */
export function formatRecordMeta(record: PromptObservationRecord_ACU): string {
  const time = formatTime(record.at).slice(11);
  return `${time} · ${record.messageCount} 条 · ${formatCount(record.totalChars)} 字符`;
}

/**
 * 渲染单条记录为报告小节（Markdown 形，AI 与人共读）。
 * @param record 待渲染记录
 * @param index 小节序号（1 起）
 */
function renderRecord(record: PromptObservationRecord_ACU, index: number): string {
  const lines: string[] = [];
  lines.push(`## 记录 ${index} · ${mask(record.scope)}`);
  lines.push(`- 时间：${formatTime(record.at)}`);
  lines.push(`- 模型：${record.model ? mask(record.model) : PLACEHOLDER_ACU}`);
  lines.push(`- 端点主机：${record.endpointHost ? mask(record.endpointHost) : PLACEHOLDER_ACU}`);
  lines.push(`- 流式：${record.stream ? '是' : '否'}`);
  lines.push(`- 消息：${record.messageCount} 条 / ${formatCount(record.totalChars)} 字符 / 约 ${formatCount(record.totalTokens)} token${record.totalTokens === undefined ? '（估算中）' : ''}`);
  if (record.truncated) lines.push('- ⚠️ 内容超上限已截断，完整长度见 JSON 导出的 chars 字段');
  lines.push(`- 与同 scope 上次调用：${mask(record.driftText)}`);

  if (record.segments && record.segments.length) {
    const segmented = record.segments.reduce((sum, segment) => sum + segment.chars, 0);
    lines.push(`- 分段（各段合计 ${formatCount(segmented)} 字符）：`);
    for (const segment of record.segments) {
      const share = record.totalChars > 0 ? (segment.chars / record.totalChars) * 100 : 0;
      lines.push(`  - ${mask(segment.name)}：${formatCount(segment.chars)} 字符（占总量 ${share.toFixed(1)}%）`);
    }
    if (record.unsegmentedChars) {
      const sign = record.unsegmentedChars > 0 ? '+' : '';
      lines.push(`  - 未归类差额：${sign}${formatCount(record.unsegmentedChars)} 字符（宿主侧 role 归一 / 非预填充改写等）`);
    }
  } else {
    lines.push(`- 分段：未分段（该功能域不提供段级拆解，只有填表链做分段统计）`);
  }

  lines.push('');
  lines.push('### 消息明细');
  record.messages.forEach((message, messageIndex) => {
    const role = message.role || '(无 role)';
    // 与面板一致用 1 起编号：人读时「第几条」不该从 0 开始。
    const tokens = message.tokens === undefined ? 'token 计算中' : `约 ${formatCount(message.tokens)} token`;
    lines.push(`${messageIndex + 1}. [${mask(role)}] ${formatCount(message.chars)} 字符 / ${tokens}`);
    const content = mask(message.content);
    const preview = content.length > REPORT_MESSAGE_PREVIEW_CHARS
      ? `${content.slice(0, REPORT_MESSAGE_PREVIEW_CHARS)}\n…（本条正文共 ${formatCount(message.chars)} 字符，此处截断，完整内容见「导出 JSON」）`
      : content;
    lines.push('```text');
    lines.push(preview);
    lines.push('```');
  });

  return lines.join('\n');
}

/**
 * 渲染整份报告。
 * @param records 记录（按缓冲顺序，最旧在前）；报告按**最新在前**呈现，与面板一致
 * @returns 已脱敏的 Markdown 文本
 */
export function buildPromptInspectionReport(records: readonly PromptObservationRecord_ACU[]): string {
  if (!records.length) return '提示词观测报告：当前没有记录。';
  const head = [
    '# 提示词观测报告',
    `导出时间：${new Date().toISOString()}`,
    `记录数：${records.length}`,
    '',
    '> 说明：本报告由酒馆插件「提示词检查器」生成，用于排查「AI 实际收到的提示词长什么样」。',
    '> 端点只保留主机，密钥与请求头从未被采集；导出内容已过脱敏。',
  ].join('\n');
  const body = records
    .slice()
    .reverse()
    .map((record, index) => renderRecord(record, index + 1))
    .join('\n\n---\n\n');
  return `${head}\n\n---\n\n${body}\n`;
}

import { describe, expect, it } from 'vitest';
import {
  createSseEventParser_ACU,
  type SseEvent_ACU,
} from '../../src/shared/sse-event-parser';

function collect(chunks: string[], finalize = true): SseEvent_ACU[] {
  const events: SseEvent_ACU[] = [];
  const parser = createSseEventParser_ACU(e => { events.push(e); });
  for (const chunk of chunks) parser.push(chunk);
  if (finalize) parser.end();
  return events;
}

const payloads = (events: SseEvent_ACU[]) => events.map(e => e.data);

describe('createSseEventParser_ACU（WHATWG SSE 事件拆分，移植 albus/main c45d50ee）', () => {
  describe('行结束符：CR / LF / CRLF', () => {
    it('LF 行界：空行派发两个独立事件', () => {
      const events = collect(['data: a\n\ndata: b\n\n']);
      expect(payloads(events)).toEqual(['a', 'b']);
      expect(events.map(e => e.event)).toEqual(['message', 'message']);
    });

    it('CR 行界：空行派发两个独立事件', () => {
      expect(payloads(collect(['data: a\r\rdata: b\r\r']))).toEqual(['a', 'b']);
    });

    it('CRLF 行界：空行派发两个独立事件', () => {
      expect(payloads(collect(['data: a\r\n\r\ndata: b\r\n\r\n']))).toEqual(['a', 'b']);
    });

    it('混合行界：CRLF 算单个行界，LF+CR 才算空行派发', () => {
      // 'a\n\r' = LF+CR 两个行界 → 中间空行 → 派发 'a'
      // 'b\r\nc' = 一个 CRLF 行界，无空行 → 'b'/'c' 同事件拼接
      expect(payloads(collect(['data: a\n\rdata: b\r\ndata: c\n']))).toEqual(['a', 'b\nc']);
    });
  });

  describe('冒号后单空格剥离', () => {
    it('冒号后恰好一个空格时剥离', () => {
      expect(payloads(collect(['data:hello\n\n']))).toEqual(['hello']);
      expect(payloads(collect(['data: hello\n\n']))).toEqual(['hello']);
    });

    it('冒号后无空格时不改值', () => {
      expect(payloads(collect(['data:hello\n\n']))).toEqual(['hello']);
    });

    it('只剥离一个空格：两个空格保留一个', () => {
      expect(payloads(collect(['data:  hello\n\n']))).toEqual([' hello']);
    });

    it('非空格（tab）不剥离', () => {
      expect(payloads(collect(['data:\thello\n\n']))).toEqual(['\thello']);
    });

    it('无冒号字段：整行作字段名，值为空串', () => {
      expect(collect(['data\n\n'])).toEqual([{ event: 'message', data: '', dataLines: [''] }]);
    });
  });

  describe('多 data 行以 \\n 拼接', () => {
    it('同一事件多行 data 拼成一个事件，dataLines 原样保留', () => {
      const events = collect(['data: line1\ndata: line2\n\n']);
      expect(events).toEqual([{ event: 'message', data: 'line1\nline2', dataLines: ['line1', 'line2'] }]);
    });

    it('拼接后是可解析的跨行 JSON（换行在 token 之间是合法空白）', () => {
      const events = collect(['data: {"a":\ndata: 1}\n\n']);
      expect(JSON.parse(events[0].data)).toEqual({ a: 1 });
    });

    it('空 data 行参与拼接但不额外派发', () => {
      expect(payloads(collect(['data:\ndata: x\n\n']))).toEqual(['\nx']);
    });
  });

  describe('空行派发与注释行忽略', () => {
    it('无空行分隔时所有 data 归入同一事件，由 end() 收尾派发', () => {
      expect(payloads(collect(['data: a\ndata: b\n']))).toEqual(['a\nb']);
    });

    it('注释行（冒号开头）被忽略，不产生事件', () => {
      expect(payloads(collect([': keep-alive\ndata: a\n\n']))).toEqual(['a']);
      expect(payloads(collect([':comment\n\n']))).toEqual([]);
    });

    it('未知字段被忽略', () => {
      expect(payloads(collect(['retry: 3000\nid: 7\ndata: a\n\n']))).toEqual(['a']);
    });

    it('连续空行只派发一次，不派发空事件', () => {
      expect(payloads(collect(['data: a\n\n\n\ndata: b\n\n']))).toEqual(['a', 'b']);
    });

    it('纯空格行不是空行：作为无冒号字段忽略，不派发', () => {
      // ' ' 非空行、无冒号 → field=' ' 未被识别，既不并入 data 也不派发
      expect(payloads(collect(['data: a\n \n\n']))).toEqual(['a']);
    });
  });

  describe('event 字段', () => {
    it('event 字段决定事件名，默认回退 message', () => {
      expect(collect(['event: custom\ndata: x\n\n'])[0].event).toBe('custom');
      expect(collect(['data: x\n\n'])[0].event).toBe('message');
      expect(collect(['event:\ndata: x\n\n'])[0].event).toBe('message');
    });

    it('事件名在派发后重置，不泄漏到下一个事件', () => {
      const events = collect(['event: first\ndata: a\n\ndata: b\n\n']);
      expect(events.map(e => e.event)).toEqual(['first', 'message']);
    });
  });

  describe('跨 chunk 边界（流式喂入）', () => {
    it('逐字符喂入与一次性喂入结果一致', () => {
      const raw = 'data: a\ndata: b\n\n: ping\nevent: e\ndata: c\r\n\r\n';
      expect(collect(raw.split(''))).toEqual(collect([raw]));
    });

    it('CR 在 chunk 末尾、LF 在下一 chunk 开头：CRLF 不被拆成两个行界', () => {
      // 若按 CR 派发一次、再按 LF 派发一次，会产生多余空事件/错误切分。
      const events = collect(['data: a\r', '\n\r\ndata: b\r\n\r\n']);
      expect(payloads(events)).toEqual(['a', 'b']);
      expect(events.length).toBe(2);
    });

    it('chunk 正好切在空行中间', () => {
      expect(payloads(collect(['data: a\n', '\ndata: b\n', '\n']))).toEqual(['a', 'b']);
    });

    it('末尾事件无空行，由 end() 收尾派发', () => {
      expect(payloads(collect(['data: a\ndata: b']))).toEqual(['a\nb']);
    });

    it('多字节字符被拆进不同 chunk（按解码后的字符串喂入）仍完整', () => {
      expect(payloads(collect(['data: 你', '好\r\n\r\n']))).toEqual(['你好']);
    });

    it('空 chunk 无副作用', () => {
      expect(payloads(collect(['', 'data: a\n\n', '']))).toEqual(['a']);
    });
  });

  describe('不规范输入容错', () => {
    it('push("") 不报错、不产生事件', () => {
      expect(collect(['', '', ''])).toEqual([]);
    });

    it('end() 在空解析器上不产生事件，重复 end() 幂等', () => {
      const events: SseEvent_ACU[] = [];
      const parser = createSseEventParser_ACU(e => { events.push(e); });
      parser.end();
      parser.end();
      expect(events).toEqual([]);
    });

    it('[DONE] 等控制载荷仅作为普通 data 交给调用方', () => {
      expect(payloads(collect(['data: [DONE]\n\n']))).toEqual(['[DONE]']);
      expect(payloads(collect(['data:[DONE]\r\n\r\n']))).toEqual(['[DONE]']);
    });

    it('无效 JSON 原文保留，不做解析与丢弃', () => {
      expect(payloads(collect(['data: {broken\n\n']))).toEqual(['{broken']);
    });

    it('end() 后再次 push 使用全新状态', () => {
      const events: SseEvent_ACU[] = [];
      const parser = createSseEventParser_ACU(e => { events.push(e); });
      parser.push('event: stale\ndata: a\n\n');
      parser.end();
      parser.push('data: b\n\n');
      parser.end();
      expect(events).toEqual([
        { event: 'stale', data: 'a', dataLines: ['a'] },
        { event: 'message', data: 'b', dataLines: ['b'] },
      ]);
    });

    it('仅 event 字段而无 data 时不派发事件', () => {
      expect(collect(['event: ping\n\n'])).toEqual([]);
    });
  });

  describe('移植 albus 配套场景（原 native-tool.test.ts 的解析器层覆盖）', () => {
    const event = (content: string, finish?: string) =>
      JSON.stringify({ choices: [{ delta: { content }, ...(finish ? { finish_reason: finish } : {}) }] });

    it.each([
      ['data 冒号后带空格', `data: ${event('hello', 'stop')}\n\ndata: [DONE]\n\n`],
      ['data 冒号后无空格', `data:${event('hello', 'stop')}\n\ndata:[DONE]\n\n`],
      ['CR 行结束符', `data: ${event('hello', 'stop')}\r\rdata: [DONE]\r\r`],
      ['CRLF 行结束符', `data: ${event('hello', 'stop')}\r\n\r\ndata: [DONE]\r\n\r\n`],
      ['同一事件 JSON 分布于多个 data 字段', 'data: {"choices":[{"delta":\ndata: {"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'],
      ['注释行与 event 字段', `: keep-alive\nevent: message\ndata: ${event('hello', 'stop')}\n\n`],
      ['末尾事件缺少空行', `data: ${event('hello', 'stop')}`],
    ])('%s：能按规范拆出完整可解析事件', (_name, raw) => {
      const events = collect([raw]);
      const contents = events
        .map(e => { try { return JSON.parse(e.data); } catch { return null; } })
        .filter(Boolean);
      expect(contents.some(j => j?.choices?.[0]?.delta?.content === 'hello')).toBe(true);
    });

    it('按字节拆分网络 chunk（含多字节字符与跨块 CRLF）仍完整恢复', () => {
      const raw = `data:${event('你好', 'stop')}\r\n\r\ndata: [DONE]\r\n\r\n`;
      const bytes = new TextEncoder().encode(raw);
      const decoder = new TextDecoder();
      const events: SseEvent_ACU[] = [];
      const parser = createSseEventParser_ACU(e => { events.push(e); });
      for (const byte of bytes) {
        const decoded = decoder.decode(Uint8Array.of(byte), { stream: true });
        if (decoded) parser.push(decoded);
      }
      parser.push(decoder.decode());
      parser.end();
      expect(payloads(events)).toEqual([event('你好', 'stop'), '[DONE]']);
    });
  });
});

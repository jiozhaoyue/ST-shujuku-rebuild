/**
 * FormFillPromptDrawer 组件测试
 *
 * 覆盖两件事：
 * 1. 「填写指南」默认收起（`aria-expanded=false`），点开后展开——提示词编辑器本身已占满侧抽屉，
 *    指南不该抢屏（用户明确要求「有限屏幕内可看懂」）。
 * 2. 占位符清单**来自服务层单一事实源** `PROMPT_PLACEHOLDER_DOCS_ACU`，组件里不得硬编码 token
 *    字面量（形态对齐改表助手的 `TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU`）。
 *
 * 不引入 @vue/test-utils；沿用项目 createApp + 真实 DOM 断言范式。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { type App, createApp, defineComponent, h, nextTick } from 'vue';
import FormFillPromptDrawer from '../../../src/presentation-v2/components/FormFillPromptDrawer.vue';
import PlotPromptSegments from '../../../src/presentation-v2/components/PlotPromptSegments.vue';
import {
  PROMPT_PLACEHOLDER_DOCS_ACU,
  PROMPT_PLACEHOLDER_SEGMENT_ACU,
} from '../../../src/service/ai/prompt-observer';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountDrawer(): HTMLElement {
  const wrapper = defineComponent({
    setup() {
      return () => h(FormFillPromptDrawer as any, {
        isOpen: true,
        segments: [{ role: 'SYSTEM', content: '你是填表助手', deletable: false }],
        dirty: false,
        message: null,
      });
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const app = createApp(wrapper);
  app.mount(el);
  apps.push({ app, el });
  return el;
}

afterEach(() => {
  while (apps.length > 0) {
    const entry = apps.pop()!;
    entry.app.unmount();
    entry.el.remove();
  }
  document.body.innerHTML = '';
});

beforeEach(() => {
  setActivePinia(createPinia());
});

function guideHeader(el: HTMLElement): HTMLButtonElement {
  const header = Array.from(el.querySelectorAll<HTMLButtonElement>('.acu-disclosure-group__header'))
    .find(node => (node.textContent || '').includes('填写指南'));
  if (!header) throw new Error('未找到「填写指南」折叠头');
  return header;
}

describe('FormFillPromptDrawer 填写指南', () => {
  it('指南默认收起，点开后展开（有限屏幕不抢位）', async () => {
    const el = mountDrawer();
    const header = guideHeader(el);
    expect(header.getAttribute('aria-expanded')).toBe('false');

    header.click();
    await nextTick();
    expect(guideHeader(el).getAttribute('aria-expanded')).toBe('true');
  });

  it('指南说明文案给出「这段提示词做什么」与输出契约', () => {
    const el = mountDrawer();
    const text = el.textContent || '';
    expect(text).toContain('真正发给 AI 的提示词');
    expect(text).toContain('<tableEdit>');
  });

  it('占位符清单逐条渲染，且全部来自服务层单一事实源（组件不得硬编码 token）', () => {
    const el = mountDrawer();
    // 展开后正文可读（bodyMode 默认 show，正文本就在 DOM 里；这里断言内容齐备）
    expect(PROMPT_PLACEHOLDER_DOCS_ACU.length).toBeGreaterThan(0);
    for (const doc of PROMPT_PLACEHOLDER_DOCS_ACU) {
      expect(el.textContent, `缺少占位符 ${doc.token}`).toContain(doc.token);
      expect(el.textContent, `缺少 ${doc.token} 的说明`).toContain(doc.description.slice(0, 12));
    }
    // 折叠头的 meta 报出条数，用户一眼知道有多少个可用占位符
    expect(guideHeader(el).textContent).toContain(`${PROMPT_PLACEHOLDER_DOCS_ACU.length} 个可用占位符`);
  });
});

describe('通用教程兜底（没有专属说明的编辑器也有教程可看）', () => {
  it('PlotPromptSegments 未传 tutorial，仍渲染「填写指南」并给出段/role/槽语义', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(defineComponent({
      setup() {
        return () => h(PlotPromptSegments as any, {
          segments: [{ role: 'USER', content: '推进当前剧情', mainSlot: 'A' }],
        });
      },
    }));
    app.mount(el);
    apps.push({ app, el });

    const text = el.textContent || '';
    expect(text).toContain('填写指南');
    expect(text).toContain('每一「段」');
    expect(text).toContain('主插槽 A / B');
    // 没传 tokens 时不显示占位符条数
    expect(text).not.toContain('个可用占位符');
  });
});

describe('填表占位符清单与服务层定义不得漂移', () => {
  it('清单里的 $X 内容槽与 PROMPT_PLACEHOLDER_SEGMENT_ACU 的键逐字相等', () => {
    const slotTokens = PROMPT_PLACEHOLDER_DOCS_ACU
      .map(doc => doc.token)
      .filter(token => /^\$[0-9A-Z]$/.test(token))
      .sort();
    expect(slotTokens).toEqual(Object.keys(PROMPT_PLACEHOLDER_SEGMENT_ACU).sort());
  });

  it('清单每条的说明非空且不重复 token', () => {
    const tokens = PROMPT_PLACEHOLDER_DOCS_ACU.map(doc => doc.token);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const doc of PROMPT_PLACEHOLDER_DOCS_ACU) {
      expect(doc.description.trim().length, `${doc.token} 的说明为空`).toBeGreaterThan(4);
    }
  });
});

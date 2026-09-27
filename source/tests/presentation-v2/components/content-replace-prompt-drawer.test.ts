/**
 * ContentReplacePromptDrawer 组件测试
 *
 * 钉住两件事：
 * 1. 占位符清单来自**本域**服务层单一事实源 `CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU`
 *    （组件不得硬编码 token）——本域与填表链同形不同义，套错清单会误导用户；
 * 2. 填写指南默认收起、可展开，且 `$CONTENT`（待改写正文本身）被显式标注为必须保留。
 *
 * 不引入 @vue/test-utils；沿用项目 createApp + 真实 DOM 断言范式。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { type App, createApp, defineComponent, h, nextTick } from 'vue';
import ContentReplacePromptDrawer from '../../../src/presentation-v2/components/ContentReplacePromptDrawer.vue';
import { CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU } from '../../../src/service/optimization/content-optimization';
import { PROMPT_PLACEHOLDER_DOCS_ACU } from '../../../src/service/ai/prompt-observer';

const apps: Array<{ app: App<Element>; el: HTMLElement }> = [];

function mountDrawer(): HTMLElement {
  const wrapper = defineComponent({
    setup() {
      return () => h(ContentReplacePromptDrawer as any, {
        isOpen: true,
        segments: [{ role: 'USER', content: '改写这段：$CONTENT', deletable: false }],
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

describe('ContentReplacePromptDrawer 填写指南', () => {
  it('指南默认收起、点开可展开', async () => {
    const el = mountDrawer();
    const header = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.acu-disclosure-group__header'))
      .find(node => (node.textContent || '').includes('填写指南'))!;
    expect(header().getAttribute('aria-expanded')).toBe('false');
    header().click();
    await nextTick();
    expect(header().getAttribute('aria-expanded')).toBe('true');
  });

  it('渲染本域全部占位符（含 $CONTENT），逐条带说明', () => {
    const el = mountDrawer();
    const text = el.textContent || '';
    for (const doc of CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU) {
      expect(text, `缺少占位符 ${doc.token}`).toContain(doc.token);
      expect(text, `缺少 ${doc.token} 的说明`).toContain(doc.description.slice(0, 10));
    }
    expect(text).toContain('$CONTENT');
    expect(text).toContain(`${CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU.length} 个可用占位符`);
  });

  it('教程文案点明「AI 回复会被写回楼层」与 $CONTENT 不可删', () => {
    const text = mountDrawer().textContent || '';
    expect(text).toContain('改写结果写回楼层');
    expect(text).toContain('务必保留');
  });
});

describe('两域占位符清单同形不同义，不得互相套用', () => {
  it('各自的 token 集合与自身服务层常量逐字相等', () => {
    expect(CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU.map(d => d.token).sort())
      .toEqual(['$1', '$5', '$6', '$7', '$8', '$C', '$CONTENT', '$U'].sort());
    expect(PROMPT_PLACEHOLDER_DOCS_ACU.map(d => d.token)).toContain('$0');
  });

  it('同一 token 在两域含义不同（$1 / $8）——这条断言就是「不能混用」的证据', () => {
    const pick = (docs: readonly { token: string; description: string }[], token: string) =>
      docs.find(d => d.token === token)?.description || '';
    const contentReplace = CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU;
    const formFill = PROMPT_PLACEHOLDER_DOCS_ACU;
    expect(pick(contentReplace, '$1')).toContain('世界书');
    expect(pick(formFill, '$1')).toContain('最近对话');
    expect(pick(contentReplace, '$8')).toContain('用户输入');
    expect(pick(formFill, '$8')).toContain('额外要求');
  });
});

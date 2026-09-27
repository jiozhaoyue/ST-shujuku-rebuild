/**
 * shared/prompt-placeholder-doc.ts — 提示词占位符说明的**共享类型**
 *
 * 为什么单独成一个模块：本插件的提示词编辑器有 8 处，每处的占位符集合**各不相同**
 * （同一个 `$1` 在填表链是「最近对话内容」，在正文替换链却是「世界书内容」；`$8`
 * 分别是「手动填表额外要求」与「本轮用户输入」）。因此：
 *
 * - 说明清单必须**按域**各自定义在**该域的服务模块**里（单一事实源，紧邻真实替换点）；
 * - UI 只渲染、**不得硬编码 token 字面量**；
 * - 类型共用本文件，避免每个服务模块各写一份同形接口而慢慢漂移。
 *
 * 形态先例：`service/template-assistant/service.ts` 的 `TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU`。
 */
export interface PromptPlaceholderDoc_ACU {
  /** 用户在提示词里实际要写的形态（如 `$0`、`{{表名}}`）。 */
  token: string;
  /** 一句话说明它会被替换成什么 / 该怎么用。 */
  description: string;
}

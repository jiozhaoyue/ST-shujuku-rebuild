<template>
  <AcuDrawer
    :is-open="isOpen"
    title="编辑正文替换提示词"
    width="720px"
    :before-close="confirmIfDirty"
    @close="$emit('close')"
  >
    <AcuMessage v-if="message" :kind="message.kind">
      {{ message.text }}
    </AcuMessage>

    <div class="acu-content-replace-prompt-drawer__meta">
      <span>{{ segments.length }} 段提示词</span>
    </div>

    <div class="acu-content-replace-prompt-drawer__toolbar">
      <AcuButton size="sm" @click="$emit('reset')">载入默认提示词</AcuButton>
    </div>

    <!-- 占位符不再在模板里硬编码：清单来自服务层单一事实源，见 CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU。 -->
    <AcuPromptSegments
      :segments="segments"
      :show-slot="true"
      :rows="8"
      :tutorial="CONTENT_REPLACE_PROMPT_TUTORIAL"
      :tokens="contentReplaceTokens"
      empty-text="暂无正文替换提示词段。点击下方按钮添加第一段。"
      @add="$emit('add', $event)"
      @delete="$emit('delete', $event)"
      @update="(index, patch) => $emit('update', index, patch)"
    />

    <footer class="acu-content-replace-prompt-drawer__actions">
      <AcuButton @click="requestClose">关闭</AcuButton>
      <AcuButton variant="primary" :disabled="!dirty" @click="$emit('save')">保存提示词</AcuButton>
    </footer>
  </AcuDrawer>
</template>

<script setup lang="ts">
import AcuButton from './_lib/AcuButton.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPromptSegments, { type PromptSegment, type PromptTokenHint } from './_lib/AcuPromptSegments.vue';
import { CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU } from '../../service/optimization/content-optimization';
import { useDialogStore } from '../stores/dialog-store';
import type { ContentReplaceMessage } from '../stores/content-replace-store';

/**
 * 正文替换提示词填写指南（说明文案）。
 *
 * ⚠️ 本域的占位符与填表链**同形不同义**（这里 `$1` 是世界书、`$8` 是本轮用户输入），
 * 所以清单必须用本域自己的 `CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU`，不能套用填表那份。
 * 组件里**不得**硬编码 token 字面量：本抽屉原有一行并列 8 个 `<code>` 的 chip，
 * 它虽然当时与实现相符，但一是与清单重复、二是没有任何说明，现已换成单一事实源 + 可展开指南。
 */
const CONTENT_REPLACE_PROMPT_TUTORIAL =
  '这里编辑的是「改写当前楼层正文」时发给 AI 的提示词。AI 的回复会被当作改写结果写回楼层，'
  + '所以提示词里要写清改写口径（保留什么、可改什么、输出格式）。'
  + '$CONTENT 是待改写正文本身——它被删掉后运行时不知道该改哪一段，务必保留。';

const contentReplaceTokens: PromptTokenHint[] = CONTENT_OPTIMIZATION_PLACEHOLDER_DOCS_ACU.map(doc => ({
  token: doc.token,
  meaning: doc.description,
}));

const props = defineProps<{
  isOpen: boolean;
  segments: PromptSegment[];
  dirty: boolean;
  message: ContentReplaceMessage | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save'): void;
  (e: 'reset'): void;
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'update', index: number, patch: Partial<PromptSegment>): void;
}>();

const dialogStore = useDialogStore();

async function confirmIfDirty(): Promise<boolean> {
  if (!props.dirty) return true;
  return dialogStore.confirm({
    title: '关闭提示词编辑器',
    message: '你有未保存的正文替换提示词修改，确定要关闭吗？',
    confirmLabel: '关闭',
    confirmVariant: 'danger',
  });
}

async function requestClose(): Promise<void> {
  if (await confirmIfDirty()) emit('close');
}
</script>

<style scoped>
.acu-content-replace-prompt-drawer__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: 1.5;
}

.acu-content-replace-prompt-drawer__meta code {
  padding: 2px 5px;
  border: 0;
  border-radius: var(--acu-radius-sm);
  background: var(--acu-bg-2);
  color: var(--acu-text-2);
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-caption, 11px);
}

.acu-content-replace-prompt-drawer__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.acu-content-replace-prompt-drawer__actions {
  position: sticky;
  bottom: -16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 0;
  background: var(--acu-bg-1);
}
</style>

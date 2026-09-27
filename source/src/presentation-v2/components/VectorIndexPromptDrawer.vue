<template>
  <AcuDrawer
    :is-open="isOpen"
    title="编辑关键词生成提示词"
    width="720px"
    :before-close="confirmIfDirty"
    @close="$emit('close')"
  >
    <AcuMessage v-if="message" :kind="message.kind">
      {{ message.text }}
    </AcuMessage>

    <div class="acu-vector-prompt-drawer__toolbar">
      <AcuButton size="sm" @click="$emit('reset')">载入默认提示词</AcuButton>
    </div>

    <AcuPromptSegments
      :segments="segments"
      :show-slot="false"
      :role-options="roleOptions"
      :rows="8"
      :tutorial="KEYWORD_PROMPT_TUTORIAL"
      empty-text="暂无关键词提示词段。点击下方按钮添加第一段。"
      @add="$emit('add', $event)"
      @delete="$emit('delete', $event)"
      @update="(index, patch) => $emit('update', index, patch)"
    />

    <footer class="acu-vector-prompt-drawer__actions">
      <AcuButton @click="requestClose">关闭</AcuButton>
      <AcuButton variant="primary" :disabled="!dirty" @click="$emit('save')">保存提示词</AcuButton>
    </footer>
  </AcuDrawer>
</template>

<script setup lang="ts">
import AcuButton from './_lib/AcuButton.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPromptSegments, { type PromptSegment } from './_lib/AcuPromptSegments.vue';
import type { AcuSelectOption } from './_lib/AcuSelect.vue';
import type { VectorIndexMessage } from '../composables/useVectorIndexConfig';
import { useDialogStore } from '../stores/dialog-store';

/**
 * 关键词生成提示词填写指南（说明文案）。
 *
 * 输出契约来自解析实现 `service/vector/summary-vector-index-runtime.ts` 的 `parseKeywords_ACU`：
 * 优先取 `<keywords>…</keywords>` 内的内容；取不到时回退到「关键词：」前缀；
 * 关键词之间用 `，,、\n;；|` 任一分隔；`<thinking>` / `<thought>` / `<think>` 块会被剥掉。
 * 因此提示词里**明确要求用 <keywords> 标签、只输出关键词**，命中率最高。
 */
const KEYWORD_PROMPT_TUTORIAL =
  '这里编辑的是「为交火模式生成检索关键词」时发给 AI 的提示词。'
  + 'AI 的回复会被解析成关键词列表用于召回：优先读 <keywords>…</keywords> 里的内容，'
  + '读不到才回退到「关键词：」前缀；关键词之间用逗号、顿号、分号或换行分隔。'
  + '所以最稳的写法是明确要求 AI「只用 <keywords> 标签输出关键词、不要解释」——'
  + '写成散文会导致关键词被整段当成一个词，检索命中率下降。';

const props = defineProps<{
  isOpen: boolean;
  segments: PromptSegment[];
  dirty: boolean;
  message: VectorIndexMessage | null;
  roleOptions: AcuSelectOption[];
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
    message: '你有未保存的关键词生成提示词修改，确定要关闭吗？',
    confirmLabel: '关闭',
    confirmVariant: 'danger',
  });
}

async function requestClose(): Promise<void> {
  if (await confirmIfDirty()) emit('close');
}
</script>

<style scoped>
.acu-vector-prompt-drawer__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.acu-vector-prompt-drawer__actions {
  position: sticky;
  bottom: -16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 0;
  background: var(--acu-bg-1);
}
</style>

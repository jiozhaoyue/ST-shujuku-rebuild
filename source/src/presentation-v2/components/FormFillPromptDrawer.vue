<template>
  <AcuDrawer
    :is-open="isOpen"
    title="编辑填表提示词"
    width="720px"
    :before-close="confirmIfDirty"
    @close="emit('close')"
  >
    <AcuMessage v-if="message" :kind="message.kind">
      {{ message.text }}
    </AcuMessage>

    <div class="acu-form-fill-prompt-drawer__toolbar">
      <AcuFileButton size="sm" accept="application/json,.json" @file="$emit('import-file', $event)">
        <i class="fa-solid fa-download"></i> 导入 JSON
      </AcuFileButton>
      <AcuButton size="sm" @click="$emit('export')">
        <i class="fa-solid fa-upload"></i> 导出 JSON
      </AcuButton>
      <AcuButton size="sm" @click="$emit('reset')">载入默认提示词</AcuButton>
    </div>

    <AcuPromptSegments
      :segments="segments"
      :rows="8"
      :tutorial="FORM_FILL_PROMPT_TUTORIAL"
      :tokens="FORM_FILL_PROMPT_TOKENS"
      @add="$emit('add', $event)"
      @delete="$emit('delete', $event)"
      @update="(index, patch) => $emit('update', index, patch)"
    />

    <footer class="acu-form-fill-prompt-drawer__actions">
      <AcuButton @click="requestClose">关闭</AcuButton>
      <AcuButton variant="primary" :disabled="!dirty" @click="$emit('save')">保存提示词</AcuButton>
    </footer>
  </AcuDrawer>
</template>

<script setup lang="ts">
import AcuButton from './_lib/AcuButton.vue';
import AcuDrawer from './_lib/AcuDrawer.vue';
import AcuFileButton from './_lib/AcuFileButton.vue';
import AcuMessage from './_lib/AcuMessage.vue';
import AcuPromptSegments from './_lib/AcuPromptSegments.vue';
import type { PromptSegment, PromptTokenHint } from './_lib/AcuPromptSegments.vue';
import type { FormFillMessage } from '../composables/useFormFillSettings';
import { PROMPT_PLACEHOLDER_DOCS_ACU } from '../../service/ai/prompt-observer';
import { useDialogStore } from '../stores/dialog-store';

/**
 * 填表提示词填写指南（说明文案）。
 *
 * 写作口径：**人读得懂、AI 也照着填**。
 * 占位符清单**不在这里硬编码** —— 它是服务层单一事实源 `PROMPT_PLACEHOLDER_DOCS_ACU`
 * （形态对齐改表助手的 `TEMPLATE_ASSISTANT_PLACEHOLDER_DOCS_ACU`），此处只做映射。
 */
const FORM_FILL_PROMPT_TUTORIAL =
  '这里是每次填表时真正发给 AI 的提示词。每「段」= 一条消息，段右侧的 role 决定它作为 SYSTEM / USER / ASSISTANT 发出。'
  + 'AI 的回复必须含 <tableEdit>…</tableEdit>，其中的 SQL 会被执行并写回表格——所以提示词里要明确告诉 AI「输出什么格式」。'
  + '下面这些占位符会在发送前被替换成真实内容；直接写字面量不会被替换。';

const FORM_FILL_PROMPT_TOKENS: PromptTokenHint[] = PROMPT_PLACEHOLDER_DOCS_ACU.map(doc => ({
  token: doc.token,
  meaning: doc.description,
}));

const props = defineProps<{
  isOpen: boolean;
  segments: PromptSegment[];
  dirty: boolean;
  message: FormFillMessage | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save'): void;
  (e: 'reset'): void;
  (e: 'import-file', file: File): void;
  (e: 'export'): void;
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'update', index: number, patch: Partial<PromptSegment>): void;
}>();

const dialogStore = useDialogStore();

async function confirmIfDirty(): Promise<boolean> {
  if (!props.dirty) return true;
  return dialogStore.confirm({
    title: '关闭提示词编辑器',
    message: '你有未保存的填表提示词修改，确定要关闭吗？',
    confirmLabel: '关闭',
    confirmVariant: 'danger',
  });
}

async function requestClose(): Promise<void> {
  if (await confirmIfDirty()) emit('close');
}
</script>

<style scoped>
.acu-form-fill-prompt-drawer__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.acu-form-fill-prompt-drawer__actions {
  position: sticky;
  bottom: -16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 0;
  background: var(--acu-bg-1);
}
</style>

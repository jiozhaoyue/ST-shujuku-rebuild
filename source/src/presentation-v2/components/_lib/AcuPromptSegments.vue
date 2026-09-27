<template>
  <div class="acu-prompt-segs">
    <!-- 填写指南：默认收起，避免在有限屏幕里挤掉正文；展开后给出段/role/槽语义与占位符速查。 -->
    <AcuDisclosureGroup
      class="acu-prompt-segs__guide"
      label="填写指南"
      :meta="tokens && tokens.length ? `${tokens.length} 个可用占位符` : ''"
      :expanded="guideOpen"
      @toggle="guideOpen = !guideOpen"
    >
      <AcuInfoBanner tone="tip" class="acu-prompt-segs__guide-text">
        {{ guideText }}
      </AcuInfoBanner>
      <dl v-if="tokens && tokens.length" class="acu-prompt-segs__tokens">
        <div v-for="item in tokens" :key="item.token" class="acu-prompt-segs__token">
          <dt><code>{{ item.token }}</code></dt>
          <dd>{{ item.meaning }}</dd>
        </div>
      </dl>
    </AcuDisclosureGroup>

    <div class="acu-prompt-segs__add">
      <AcuButton size="sm" class="acu-prompt-segs__add-btn" @click="$emit('add', 'top')">
        <i class="fa-solid fa-plus"></i> 在最上方插入
      </AcuButton>
    </div>
    <ol class="acu-prompt-segs__list">
      <li v-for="(seg, index) in segments" :key="index" class="acu-prompt-segs__item">
        <header class="acu-prompt-segs__item-head">
          <span class="acu-prompt-segs__index">#{{ index + 1 }}</span>
          <AcuSelect
            class="acu-prompt-segs__role"
            size="sm"
            :options="roleOptions"
            :model-value="seg.role"
            @update:model-value="$emit('update', index, { role: $event })"
          />
          <AcuSelect
            v-if="showSlot"
            class="acu-prompt-segs__slot"
            size="sm"
            :options="slotOptions"
            :model-value="seg.mainSlot || ''"
            title="主插槽 A=主提示词；B=拦截任务详细指令"
            @update:model-value="onSlot(index, $event)"
          />
          <div class="acu-prompt-segs__actions">
            <template v-if="allowMove">
              <AcuIconButton
                icon="fa-solid fa-arrow-up"
                size="sm"
                :disabled="index === 0"
                :title="index === 0 ? '已经是第一段' : '上移该段'"
                @click="$emit('move', index, -1)"
              />
              <AcuIconButton
                icon="fa-solid fa-arrow-down"
                size="sm"
                :disabled="index === segments.length - 1"
                :title="index === segments.length - 1 ? '已经是最后一段' : '下移该段'"
                @click="$emit('move', index, 1)"
              />
            </template>
            <AcuIconButton
              icon="fa-solid fa-trash-can"
              variant="danger"
              size="sm"
              :disabled="seg.deletable === false"
              :title="seg.deletable === false ? '该段不可删除' : '删除该段'"
              @click="$emit('delete', index)"
            />
          </div>
        </header>
        <AcuTextarea
          :model-value="seg.content"
          :rows="rows"
          placeholder="提示词内容..."
          @update:model-value="$emit('update', index, { content: $event })"
        />
      </li>
      <li v-if="!segments.length" class="acu-prompt-segs__empty">
        {{ emptyText }}
      </li>
    </ol>
    <div class="acu-prompt-segs__add">
      <AcuButton size="sm" class="acu-prompt-segs__add-btn" @click="$emit('add', 'bottom')">
        <i class="fa-solid fa-plus"></i> 在最下方插入
      </AcuButton>
    </div>
  </div>
</template>

<script lang="ts">
import type { AcuSelectOption } from './AcuSelect.vue';

export interface PromptSegment {
  role: string;
  content: string;
  deletable?: boolean;
  mainSlot?: 'A' | 'B' | '';
  isMain?: boolean;
  isMain2?: boolean;
}

/** 填写指南里的一个占位符条目（token 写成它实际要被替换的形态，如 `$0`、`{{表名}}`）。 */
export interface PromptTokenHint {
  token: string;
  meaning: string;
}

const DEFAULT_ROLE_OPTIONS: AcuSelectOption[] = [
  { value: 'SYSTEM', label: 'SYSTEM' },
  { value: 'USER', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];

const DEFAULT_SLOT_OPTIONS: AcuSelectOption[] = [
  { value: '', label: '普通段' },
  { value: 'A', label: '主插槽 A' },
  { value: 'B', label: '主插槽 B' },
];
</script>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AcuButton from './AcuButton.vue';
import AcuDisclosureGroup from './AcuDisclosureGroup.vue';
import AcuIconButton from './AcuIconButton.vue';
import AcuInfoBanner from './AcuInfoBanner.vue';
import AcuSelect from './AcuSelect.vue';
import AcuTextarea from './AcuTextarea.vue';

const props = withDefaults(defineProps<{
  segments: PromptSegment[];
  roleOptions?: AcuSelectOption[];
  slotOptions?: AcuSelectOption[];
  showSlot?: boolean;
  allowMove?: boolean;
  rows?: number;
  emptyText?: string;
  /** 一段「这段提示词做什么」的说明（人读得懂，AI 也照着填）。 */
  tutorial?: string;
  /** 该提示词里可用的占位符速查。 */
  tokens?: PromptTokenHint[];
}>(), {
  roleOptions: () => DEFAULT_ROLE_OPTIONS,
  slotOptions: () => DEFAULT_SLOT_OPTIONS,
  showSlot: true,
  allowMove: false,
  rows: 6,
  emptyText: '暂无提示词段。点击下方按钮添加第一段。',
  tutorial: '',
  tokens: () => [],
});

/** 填写指南默认收起：提示词编辑器本身已占满侧抽屉，指南不该再抢屏。 */
const guideOpen = ref(false);

/**
 * 通用填写指南。没有专属说明的调用点会拿到它——
 * 对**每一个**提示词编辑器都成立（段 / role / 主插槽 / 顺序的语义本身就不自明），
 * 比在 8 处各写一段可能过期的文案更可靠；有专属内容的面（如填表）再叠加自己的说明与占位符清单。
 */
const DEFAULT_TUTORIAL_ACU =
  '每一「段」= 发给 AI 的一条单独消息，按这里的顺序从上到下发出。'
  + '段右侧的 role 决定它以 SYSTEM / USER / ASSISTANT 的身份发出——不同后端对顺序与角色敏感，改顺序可能改变模型行为。'
  + '「主插槽 A / B」用来标记特殊段：A = 主提示词，B = 拦截任务详细指令；普通段留「普通段」即可。'
  + '留空某段会让它作为空消息发出，建议删除而不是留空。';

/** 调用点给了专属说明就用它，否则退到通用说明（保证每处都有教程可看）。 */
const guideText = computed(() => props.tutorial || DEFAULT_TUTORIAL_ACU);

const emit = defineEmits<{
  (e: 'add', position: 'top' | 'bottom'): void;
  (e: 'delete', index: number): void;
  (e: 'move', index: number, delta: -1 | 1): void;
  (e: 'update', index: number, patch: Partial<PromptSegment>): void;
}>();

function onSlot(index: number, raw: string): void {
  const value = raw === 'A' || raw === 'B' ? raw : '';
  emit('update', index, { mainSlot: value });
}
</script>

<style scoped>
.acu-prompt-segs { display: flex; flex-direction: column; gap: 10px; min-width: 0; max-width: 100%; }

.acu-prompt-segs__guide { min-width: 0; }
.acu-prompt-segs__guide-text { margin-bottom: var(--acu-space-150, 6px); }
.acu-prompt-segs__tokens { margin: 0; display: flex; flex-direction: column; gap: var(--acu-space-100, 4px); min-width: 0; }
.acu-prompt-segs__token { display: flex; gap: var(--acu-space-2, 8px); align-items: baseline; min-width: 0; }
.acu-prompt-segs__token dt { flex: 0 0 auto; margin: 0; }
.acu-prompt-segs__token dd {
  margin: 0; min-width: 0; flex: 1 1 auto;
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
  word-break: break-word;
}
.acu-prompt-segs__token code {
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-1);
  background: var(--acu-bg-2);
  padding: 1px var(--acu-space-100, 4px);
  border-radius: var(--acu-radius-sm);
  white-space: nowrap;
}
.acu-prompt-segs__add { display: flex; justify-content: center; min-width: 0; max-width: 100%; }
.acu-prompt-segs__add-btn { max-width: 100%; white-space: normal; }

.acu-prompt-segs__list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 10px; min-width: 0; max-width: 100%;
}

.acu-prompt-segs__item {
  border: 0; border-bottom: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent);
  border-radius: 0;
  background: transparent; padding: 0 0 12px;
  display: flex; flex-direction: column; gap: 8px;
  min-width: 0; max-width: 100%;
}

.acu-prompt-segs__item:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.acu-prompt-segs__item-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; max-width: 100%;
}

.acu-prompt-segs__index {
  font-size: var(--acu-font-size-caption, 11px); color: var(--acu-text-3);
  min-width: 26px;
  font-family: var(--acu-font-mono);
}

.acu-prompt-segs__role { flex: 1 1 110px; min-width: 0; max-width: 180px; }
.acu-prompt-segs__slot { flex: 1 1 120px; min-width: 0; max-width: 200px; }

.acu-prompt-segs__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.acu-prompt-segs :deep(.acu-textarea),
.acu-prompt-segs :deep(textarea) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

.acu-prompt-segs__empty {
  padding: 10px 0; text-align: center;
  color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px);
  border-top: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--acu-text-3) 14%, transparent);
  overflow-wrap: anywhere;
}

@media (max-width: 480px) {
  .acu-prompt-segs__item-head { align-items: stretch; }
  .acu-prompt-segs__index { flex: 0 0 100%; }
  .acu-prompt-segs__role,
  .acu-prompt-segs__slot { flex-basis: 100%; max-width: 100%; }
  .acu-prompt-segs__actions { width: 100%; margin-left: 0; justify-content: flex-end; }
}
</style>

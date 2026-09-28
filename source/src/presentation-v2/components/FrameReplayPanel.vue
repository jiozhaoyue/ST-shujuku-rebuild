<template>
  <AcuPanel
    id="developer-frame-replay-panel"
    class="acu-v2-frame-replay"
    title="历史楼层回放"
    description="从聊天消息的持久化帧里读出「这一层当时到底执行了哪些 SQL / DSL 操作」，只读呈现。不重执行、不写回、不建库 —— 重建当时执行了哪些语句只需列出，不需要求值。与同页的「写库流水」配合：那个看现在，这个看历史。"
  >
    <template #actions>
      <AcuBadge :variant="flow.floors.value.length ? 'accent' : 'neutral'">
        {{ flow.floors.value.length ? `${flow.floors.value.length} 个含帧楼层` : '无含帧楼层' }}
      </AcuBadge>
      <AcuBadge v-if="flow.selectedMessageIndex.value !== null" variant="success">
        已选 #{{ flow.selectedMessageIndex.value }}
      </AcuBadge>
    </template>

    <div class="acu-v2-frame-replay__actions">
      <AcuButton @click="flow.refreshFloors()">
        <i class="fa-solid fa-rotate"></i>
        重新扫描
      </AcuButton>
      <AcuButton v-if="flow.selectedMessageIndex.value !== null" @click="flow.clearSelection()">
        <i class="fa-solid fa-xmark"></i>
        取消选择
      </AcuButton>
    </div>

    <AcuInfoBanner tone="tip" class="acu-v2-frame-replay__howto">
      本面板只读：扫描当前聊天里含存储帧的楼层，点一层即列出该帧的日志条目与语句。
      回放不会触发任何写入 —— 回放前后该消息的持久化字段逐字节不变。
      「空帧」与「不可解析」会显式标出，不会被静默跳过。
    </AcuInfoBanner>

    <p v-if="!flow.floors.value.length" class="acu-v2-frame-replay__empty">
      当前聊天没有含存储帧的楼层。{{ '先触发一次填表或导入，再回来重新扫描。' }}
    </p>

    <div v-else class="acu-v2-frame-replay__floors" role="list">
      <AcuButton
        v-for="floor in flow.floors.value"
        :key="floor.messageIndex"
        role="listitem"
        class="acu-v2-frame-replay__floor"
        :class="{ 'acu-v2-frame-replay__floor--active': flow.selectedMessageIndex.value === floor.messageIndex }"
        @click="flow.select(floor.messageIndex)"
      >
        <div class="acu-v2-frame-replay__floor-head">
          <span class="acu-v2-frame-replay__floor-index">#{{ floor.messageIndex }} · AI 楼层 {{ floor.aiFloor }}</span>
          <AcuBadge :variant="shapeVariant(floor.shape)">{{ shapeLabel(floor.shape) }}</AcuBadge>
          <span class="acu-v2-frame-replay__floor-meta">
            {{ formatCount(floor.entryCount) }} 条 · {{ formatCount(floor.operationCount) }} 个操作
          </span>
        </div>
        <p v-if="floor.checkpointReason" class="acu-v2-frame-replay__note">检查点原因：{{ floor.checkpointReason }}</p>
        <p v-if="floor.invalidReason" class="acu-v2-frame-replay__note">{{ floor.invalidReason }}</p>
      </AcuButton>
    </div>

    <section v-if="flow.view.value" class="acu-v2-frame-replay__detail">
      <h4 class="acu-v2-frame-replay__section-title">帧内容（楼层 #{{ flow.view.value.messageIndex }}）</h4>

      <div class="acu-v2-frame-replay__badges">
        <AcuBadge :variant="shapeVariant(flow.view.value.shape)">{{ shapeLabel(flow.view.value.shape) }}</AcuBadge>
        <AcuBadge variant="neutral">{{ formatCount(flow.view.value.statementCount) }} 条语句</AcuBadge>
        <AcuBadge v-if="flow.view.value.legacyPatchesOnly" variant="warning">仅旧版 patches（本视图不解析）</AcuBadge>
        <AcuBadge v-if="flow.view.value.truncated" variant="warning">语句集已截断</AcuBadge>
      </div>

      <p v-if="flow.view.value.invalidReason" class="acu-v2-frame-replay__note">
        {{ flow.view.value.invalidReason }}
      </p>

      <AcuStatsList
        v-if="flow.view.value.checkpoint"
        class="acu-v2-frame-replay__stats"
        :items="checkpointItems(flow.view.value.checkpoint)"
        mono
      />

      <p v-if="!flow.view.value.entries.length" class="acu-v2-frame-replay__note">
        {{ flow.view.value.shape === 'empty'
          ? '这一帧是空帧：没有检查点也没有日志条目。'
          : '这一帧没有日志条目（可能只有检查点）。' }}
      </p>

      <div v-else class="acu-v2-frame-replay__entries">
        <div
          v-for="entry in flow.view.value.entries"
          :key="entry.entryId || entry.seq"
          class="acu-v2-frame-replay__entry"
        >
          <AcuStatsList class="acu-v2-frame-replay__stats" :items="entryItems(entry)" mono />

          <div v-if="entry.statements.length" class="acu-v2-frame-replay__statements">
            <div v-for="(stat, index) in entry.statements" :key="index" class="acu-v2-frame-replay__statement">
              <div class="acu-v2-frame-replay__badges">
                <AcuBadge :variant="dialectVariant_ACU(stat.dialect)">{{ dialectLabel_ACU(stat.dialect) }}</AcuBadge>
                <AcuBadge :variant="operationVariant_ACU(stat.operation)">{{ operationLabel_ACU(stat.operation) }}</AcuBadge>
                <span v-if="stat.tables.length" class="acu-v2-frame-replay__tables">{{ stat.tables.join('、') }}</span>
              </div>
              <pre class="acu-v2-frame-replay__content">{{ stat.text }}</pre>
              <p v-if="stat.truncated" class="acu-v2-frame-replay__note">本条超字符上限，已截断。</p>
            </div>
          </div>
          <p v-else class="acu-v2-frame-replay__note">该条目没有可列出的语句。</p>
        </div>
      </div>
    </section>
  </AcuPanel>
</template>

<script setup lang="ts">
import AcuBadge, { type AcuBadgeVariant } from './_lib/AcuBadge.vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuInfoBanner from './_lib/AcuInfoBanner.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuStatsList, { type AcuStatsItem } from './_lib/AcuStatsList.vue';
import { formatCount } from '../composables/prompt-inspection-report';
import {
  dialectLabel_ACU,
  dialectVariant_ACU,
  operationLabel_ACU,
  operationVariant_ACU,
} from '../composables/write-statement-display';
import {
  useFrameReplay,
  type FrameCheckpointSummary_ACU,
  type FrameReplayEntry_ACU,
  type FrameShape_ACU,
} from '../composables/useFrameReplay';

const flow = useFrameReplay();

const SHAPE_LABEL_ACU: Readonly<Record<FrameShape_ACU, string>> = {
  full_checkpoint: '整帧检查点',
  delta: '增量',
  empty: '空帧',
  invalid: '不可解析',
};

function shapeLabel(shape: FrameShape_ACU): string {
  return SHAPE_LABEL_ACU[shape] || shape;
}

function shapeVariant(shape: FrameShape_ACU): AcuBadgeVariant {
  if (shape === 'full_checkpoint') return 'success';
  if (shape === 'delta') return 'accent';
  if (shape === 'invalid') return 'danger';
  return 'neutral';
}

function checkpointItems(checkpoint: FrameCheckpointSummary_ACU): AcuStatsItem[] {
  const items: AcuStatsItem[] = [
    { label: '检查点原因', value: checkpoint.reason },
    { label: '覆盖表', value: checkpoint.sheetKeys.length ? checkpoint.sheetKeys.join('、') : '—' },
  ];
  if (checkpoint.perSheetSheetKeys.length) {
    items.push({ label: '单表检查点', value: checkpoint.perSheetSheetKeys.join('、') });
  }
  if (checkpoint.createdAt !== undefined) {
    items.push({ label: '创建时间', value: new Date(checkpoint.createdAt).toLocaleString('zh-CN') });
  }
  return items;
}

function entryItems(entry: FrameReplayEntry_ACU): AcuStatsItem[] {
  return [
    { label: 'seq', value: String(entry.seq) },
    { label: '来源', value: entry.source || '—' },
    { label: 'AI 楼层', value: String(entry.aiFloor) },
    { label: '目标楼层', value: entry.targetMessageIndex >= 0 ? `#${entry.targetMessageIndex}` : '—' },
    ...(entry.commitRevision ? [{ label: '提交版本', value: entry.commitRevision }] : []),
  ];
}
</script>

<style scoped>
.acu-v2-frame-replay__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--acu-space-2, 8px);
}

.acu-v2-frame-replay__howto {
  margin-top: var(--acu-space-3, 12px);
}

.acu-v2-frame-replay__empty {
  margin: var(--acu-space-3, 12px) 0 0;
  padding: var(--acu-space-4, 16px);
  border: 1px dashed var(--acu-border);
  border-radius: var(--acu-radius-md);
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-body, 1.6);
  text-align: center;
}

.acu-v2-frame-replay__floors {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 260px;
  overflow: auto;
  margin-top: var(--acu-space-3, 12px);
  border: 1px solid var(--acu-border-2);
  border-radius: var(--acu-radius-sm);
}

.acu-v2-frame-replay__floor.acu-btn {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--acu-border-2);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.acu-v2-frame-replay__floor.acu-btn:last-child {
  border-bottom: 0;
}

.acu-v2-frame-replay__floor.acu-btn:hover {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), transparent;
}

.acu-v2-frame-replay__floor--active.acu-btn {
  background: linear-gradient(var(--acu-hover-overlay), var(--acu-hover-overlay)), transparent;
  box-shadow: inset 2px 0 0 var(--acu-accent);
}

.acu-v2-frame-replay__floor-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--acu-space-150, 6px);
}

.acu-v2-frame-replay__floor-index {
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-caption, 11px);
  color: var(--acu-text-1);
}

.acu-v2-frame-replay__floor-meta {
  margin-left: auto;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  white-space: nowrap;
}

.acu-v2-frame-replay__detail {
  margin-top: var(--acu-space-3, 12px);
  padding-top: var(--acu-space-3, 12px);
  border-top: 1px solid var(--acu-border-2);
  min-width: 0;
}

.acu-v2-frame-replay__section-title {
  margin: 0 0 var(--acu-space-150, 6px);
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  font-weight: 600;
}

.acu-v2-frame-replay__badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--acu-space-150, 6px);
}

.acu-v2-frame-replay__stats {
  margin-top: var(--acu-space-2, 8px);
}

.acu-v2-frame-replay__entries {
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-2, 8px);
  margin-top: var(--acu-space-2, 8px);
  min-width: 0;
}

.acu-v2-frame-replay__entry {
  min-width: 0;
  padding: var(--acu-space-2, 8px);
  border: 1px solid var(--acu-border-2);
  border-radius: var(--acu-radius-sm);
}

.acu-v2-frame-replay__statements {
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-2, 8px);
  margin-top: var(--acu-space-150, 6px);
  min-width: 0;
}

.acu-v2-frame-replay__statement {
  min-width: 0;
}

.acu-v2-frame-replay__tables {
  color: var(--acu-text-2);
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-caption, 11px);
  word-break: break-all;
}

.acu-v2-frame-replay__note {
  margin: var(--acu-space-150, 6px) 0 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
}

.acu-v2-frame-replay__content {
  margin: var(--acu-space-150, 6px) 0 0;
  padding: var(--acu-space-2, 8px);
  background: var(--acu-bg-2);
  border-radius: var(--acu-radius-sm);
  color: var(--acu-text-1);
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}
</style>

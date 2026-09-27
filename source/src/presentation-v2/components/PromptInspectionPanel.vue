<template>
  <AcuPanel
    id="developer-prompt-inspection-panel"
    class="acu-v2-prompt-inspection"
    title="提示词检查器"
    description="打开记录后，插件每次调用 AI（填表 / 总结 / 剧情推进 / 正文替换 …）都会在这里留下一条：这次到底把什么提示词发了出去。分段统计目前只覆盖填表链——其他功能域没有「段」的概念，会如实显示「未分段」。记录只存在内存里，关掉酒馆即消失，不写盘、不写日志。"
  >
    <template #actions>
      <AcuBadge :variant="flow.enabled.value ? 'success' : 'neutral'">
        {{ flow.enabled.value ? `记录中 · ${flow.count.value} 条` : '未开启' }}
      </AcuBadge>
      <AcuBadge v-if="flow.count.value" variant="accent">
        上限 {{ flow.maxRecords }} 条
      </AcuBadge>
    </template>

    <div class="acu-v2-prompt-inspection__control">
      <AcuFormRow
        label="开始记录"
        hint="开启后每次 AI 调用记一条（保留最近 30 条）。排查完请关掉：关闭时埋点只做一次判断，零额外开销。"
      >
        <AcuToggle
          :model-value="flow.enabled.value"
          @update:model-value="flow.setEnabled"
        />
      </AcuFormRow>

      <div class="acu-v2-prompt-inspection__actions">
        <AcuButton :disabled="!flow.count.value" @click="flow.copyReport()">
          <i class="fa-solid fa-clipboard"></i>
          复制排查报告
        </AcuButton>
        <AcuButton :disabled="!flow.count.value" @click="flow.exportRecords()">
          <i class="fa-solid fa-download"></i>
          导出 JSON
        </AcuButton>
        <AcuButton variant="danger" :disabled="!flow.count.value" @click="flow.clearAll()">
          <i class="fa-solid fa-trash-can"></i>
          清空
        </AcuButton>
      </div>
    </div>

    <AcuInfoBanner tone="tip" class="acu-v2-prompt-inspection__howto">
      「复制排查报告」会生成一份已脱敏的文本，直接贴进酒馆聊天发给 AI，它就能照着这次实测提示词定位问题（例如「某张表没进提示词」「世界书条目没命中」）。
      端点只保留主机名；API 密钥与请求头从未被采集。
    </AcuInfoBanner>

    <p v-if="!flow.count.value" class="acu-v2-prompt-inspection__empty">
      还没有记录。{{ flow.enabled.value ? '下一次 AI 调用后就会出现。' : '先打开上面的「开始记录」，再触发一次填表或总结。' }}
    </p>

    <div v-else class="acu-v2-prompt-inspection__records">
      <AcuDisclosureGroup
        v-for="record in flow.records.value"
        :key="record.id"
        :label="formatRecordTitle(record)"
        :meta="formatRecordMeta(record)"
        :expanded="flow.isExpanded(record.id)"
        body-max-height="70vh"
        @toggle="flow.toggleExpanded(record.id)"
      >
        <AcuStatsList class="acu-v2-prompt-inspection__stats" :items="statsOf(record)" mono />

        <div class="acu-v2-prompt-inspection__drift">
          <AcuBadge :variant="driftVariant(record)">{{ record.drift.baseline ? '基线' : '同比上次' }}</AcuBadge>
          <span class="acu-v2-prompt-inspection__drift-text">{{ record.driftText }}</span>
        </div>

        <section class="acu-v2-prompt-inspection__section">
          <h4 class="acu-v2-prompt-inspection__section-title">分段</h4>
          <template v-if="record.segments && record.segments.length">
            <AcuStatsList class="acu-v2-prompt-inspection__stats" :items="segmentItems(record)" mono />
            <p v-if="record.unsegmentedChars" class="acu-v2-prompt-inspection__note">
              未归类差额 {{ formatSigned(record.unsegmentedChars) }} 字符：来自宿主侧的 role 归一 / 非预填充改写等收尾处理，不在任何占位符段内。
            </p>
          </template>
          <p v-else class="acu-v2-prompt-inspection__note">
            未分段 —— 该功能域不提供段级拆解（只有填表链按占位符分段）。上面的「消息数 / 总字符」仍然准确。
          </p>
        </section>

        <section class="acu-v2-prompt-inspection__section">
          <h4 class="acu-v2-prompt-inspection__section-title">消息明细（{{ record.messageCount }} 条）</h4>
          <AcuDisclosureGroup
            v-for="(message, index) in record.messages"
            :key="index"
            :label="`#${index + 1} · ${message.role || '(无 role)'}`"
            :meta="messageMeta(message)"
            :expanded="flow.isExpanded(messageKey(record, index))"
            body-max-height="45vh"
            @toggle="flow.toggleExpanded(messageKey(record, index))"
          >
            <pre class="acu-v2-prompt-inspection__content">{{ message.content || '（空）' }}</pre>
            <p v-if="message.truncated" class="acu-v2-prompt-inspection__note">
              本条正文超 {{ formatCount(flow.maxMessageChars) }} 字符上限，此处已截断；chars 字段仍记录截断前长度。
            </p>
          </AcuDisclosureGroup>
        </section>
      </AcuDisclosureGroup>
    </div>
  </AcuPanel>
</template>

<script setup lang="ts">
import AcuBadge from './_lib/AcuBadge.vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuDisclosureGroup from './_lib/AcuDisclosureGroup.vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuInfoBanner from './_lib/AcuInfoBanner.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuStatsList, { type AcuStatsItem } from './_lib/AcuStatsList.vue';
import AcuToggle from './_lib/AcuToggle.vue';
import {
  formatCount,
  formatRecordMeta,
  formatRecordTitle,
} from '../composables/prompt-inspection-report';
import { usePromptInspection } from '../composables/usePromptInspection';
import type { PromptMessageStat_ACU, PromptObservationRecord_ACU } from '../../service/ai/prompt-observer';

const flow = usePromptInspection();

/**
 * 消息展开态的 key：messageKey 用负数偏移与记录 id 同处一个集合，避免两套展开状态。
 */
function messageKey(record: PromptObservationRecord_ACU, index: number): number {
  return -(record.id * 1000 + index) - 1;
}

function formatSigned(value: number): string {
  return `${value > 0 ? '+' : ''}${formatCount(value)}`;
}

function percentOf(chars: number, total: number): string {
  if (total <= 0) return '—';
  return `${((chars / total) * 100).toFixed(1)}%`;
}

function statsOf(record: PromptObservationRecord_ACU): AcuStatsItem[] {
  return [
    { label: '功能域（scope）', value: record.scope },
    { label: '模型', value: record.model || '—' },
    { label: '端点主机', value: record.endpointHost || '—' },
    { label: '流式', value: record.stream ? '是' : '否' },
    { label: '消息数', value: formatCount(record.messageCount) },
    { label: '总字符', value: formatCount(record.totalChars) },
    { label: '估算 token', value: record.totalTokens === undefined ? '计算中…' : formatCount(record.totalTokens) },
    { label: '正文截断', value: record.truncated ? '是' : '否' },
  ];
}

function segmentItems(record: PromptObservationRecord_ACU): AcuStatsItem[] {
  return (record.segments || []).map(segment => ({
    label: segment.name,
    value: `${formatCount(segment.chars)} 字符（${percentOf(segment.chars, record.totalChars)}）`,
  }));
}

function messageMeta(message: PromptMessageStat_ACU): string {
  const tokens = message.tokens === undefined ? 'token 计算中' : `约 ${formatCount(message.tokens)} token`;
  return `${formatCount(message.chars)} 字符 · ${tokens}`;
}

function driftVariant(record: PromptObservationRecord_ACU): 'neutral' | 'success' | 'warning' {
  if (record.drift.baseline) return 'neutral';
  // 前缀被完整保留（纯尾部追加）是缓存友好的健康形态；出现头部/中部分歧才值得警惕。
  return record.drift.appendedMessages !== undefined ? 'success' : 'warning';
}
</script>

<style scoped>
.acu-v2-prompt-inspection__control {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--acu-space-3, 12px);
}

.acu-v2-prompt-inspection__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--acu-space-2, 8px);
}

.acu-v2-prompt-inspection__howto {
  margin-top: var(--acu-space-3, 12px);
}

.acu-v2-prompt-inspection__empty {
  margin: var(--acu-space-3, 12px) 0 0;
  padding: var(--acu-space-4, 16px);
  border: 1px dashed var(--acu-border);
  border-radius: var(--acu-radius-md);
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-body, 1.6);
  text-align: center;
}

.acu-v2-prompt-inspection__records {
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-2, 8px);
  margin-top: var(--acu-space-3, 12px);
  min-width: 0;
}

.acu-v2-prompt-inspection__stats {
  margin-bottom: var(--acu-space-2, 8px);
}

.acu-v2-prompt-inspection__drift {
  display: flex;
  align-items: flex-start;
  gap: var(--acu-space-2, 8px);
  padding: var(--acu-space-2, 8px) 0;
  border-top: 1px solid var(--acu-border-2);
  min-width: 0;
}

.acu-v2-prompt-inspection__drift-text {
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
  word-break: break-word;
}

.acu-v2-prompt-inspection__section {
  margin-top: var(--acu-space-3, 12px);
  min-width: 0;
}

.acu-v2-prompt-inspection__section-title {
  margin: 0 0 var(--acu-space-150, 6px);
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  font-weight: 600;
}

.acu-v2-prompt-inspection__note {
  margin: var(--acu-space-150, 6px) 0 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
}

.acu-v2-prompt-inspection__content {
  margin: 0;
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

@media (max-width: 860px) {
  .acu-v2-prompt-inspection__control {
    align-items: stretch;
  }
}
</style>

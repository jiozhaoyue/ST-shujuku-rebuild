<template>
  <AcuPanel
    id="developer-write-pipeline-panel"
    class="acu-v2-write-pipeline"
    title="写库流水"
    description="打开记录后，插件每次往表格里写东西（填表 / agent 协议 / 导入 / 可视化保存 …）都会在这里留下一条：这次解析出了哪些 SQL / DSL 操作。与同页的「提示词检查器」配合即为完整三段式——出站提示词 → 响应正文 → 解析出的 SQL。记录只存在内存里，关掉酒馆即消失，不写盘、不写日志。"
  >
    <template #actions>
      <AcuBadge :variant="flow.enabled.value ? 'success' : 'neutral'">
        {{ flow.enabled.value ? `记录中 · ${flow.count.value} 条` : '未开启' }}
      </AcuBadge>
      <AcuBadge v-if="flow.count.value" variant="accent">
        上限 {{ flow.maxRecords }} 条
      </AcuBadge>
    </template>

    <div class="acu-v2-write-pipeline__control">
      <AcuFormRow
        label="开始记录"
        hint="开启后每次写库提交记一条（保留最近 30 条）。排查完请关掉：关闭时埋点只做一次判断，零额外开销。"
      >
        <AcuToggle
          :model-value="flow.enabled.value"
          @update:model-value="flow.setEnabled"
        />
      </AcuFormRow>

      <div class="acu-v2-write-pipeline__actions">
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

    <AcuInfoBanner tone="tip" class="acu-v2-write-pipeline__howto">
      每条的「语句」是这次提交**实际交给持久化层**的内容（与真实写入一致）。看到「未提供语句」说明这次提交的语句由持久化层自行构建，观测层拿不到——如实标注，不是故障。
      句子里若含密钥，导出时会被打码；本面板从不采集请求头与 API 密钥。
    </AcuInfoBanner>

    <p v-if="!flow.count.value" class="acu-v2-write-pipeline__empty">
      还没有记录。{{ flow.enabled.value ? '下一次写库提交后就会出现。' : '先打开上面的「开始记录」，再触发一次填表或导入。' }}
    </p>

    <div v-else class="acu-v2-write-pipeline__records">
      <AcuDisclosureGroup
        v-for="view in flow.views.value"
        :key="view.record.id"
        :label="formatTitle(view.record)"
        :meta="formatMeta(view.record)"
        :expanded="flow.isExpanded(view.record.id)"
        body-max-height="70vh"
        @toggle="flow.toggleExpanded(view.record.id)"
      >
        <div class="acu-v2-write-pipeline__badges acu-v2-write-pipeline__badges--lead">
          <AcuBadge :variant="outcomeVariant(view.record.outcome)">{{ OUTCOME_LABEL_ACU[view.record.outcome] }}</AcuBadge>
          <AcuBadge variant="neutral">{{ view.record.source }}</AcuBadge>
          <span v-if="view.record.promptRecordId !== undefined" class="acu-v2-write-pipeline__chars">
            提示词 #{{ view.record.promptRecordId }}
          </span>
        </div>

        <AcuStatsList class="acu-v2-write-pipeline__stats" :items="statsOf(view)" mono />

        <!-- 第二段：响应正文（来自提示词观测器的异步补写） -->
        <section class="acu-v2-write-pipeline__section">
          <h4 class="acu-v2-write-pipeline__section-title">响应正文</h4>
          <template v-if="view.prompt">
            <template v-if="view.prompt.response">
              <div class="acu-v2-write-pipeline__badges">
                <AcuBadge :variant="transportVariant(view.prompt.response.transport)">
                  {{ transportLabel(view.prompt.response.transport) }}
                </AcuBadge>
                <AcuBadge variant="neutral">{{ formatCount(view.prompt.response.chunkCount) }} 块</AcuBadge>
                <AcuBadge v-if="view.prompt.response.firstDeltaMs !== undefined" variant="neutral">
                  首字 {{ formatCount(view.prompt.response.firstDeltaMs) }}ms
                </AcuBadge>
                <AcuBadge variant="neutral">总 {{ formatCount(view.prompt.response.totalMs) }}ms</AcuBadge>
              </div>
              <pre class="acu-v2-write-pipeline__content">{{ view.prompt.response.content || '（空）' }}</pre>
              <p v-if="view.prompt.response.truncated" class="acu-v2-write-pipeline__note">
                正文超 {{ formatCount(flow.maxResponseChars) }} 字符上限，此处已截断；chars 字段仍记录截断前长度。
              </p>
            </template>
            <p v-else class="acu-v2-write-pipeline__note">
              这次调用的响应正文还没有补写（可能响应失败，或该次调用未经过提示词观测的出口）。
            </p>
          </template>
          <p v-else class="acu-v2-write-pipeline__note">
            {{ view.promptEvicted
              ? '关联的提示词记录已被挤出缓冲（上限 30 条），正文不再可查。'
              : '本次写库不经 AI 调用（如手动 CRUD / SQL 控制台），因此没有出站提示词与响应正文。' }}
          </p>
        </section>

        <!-- 第一段：出站提示词摘要 -->
        <section class="acu-v2-write-pipeline__section">
          <h4 class="acu-v2-write-pipeline__section-title">出站提示词</h4>
          <template v-if="view.prompt">
            <AcuStatsList class="acu-v2-write-pipeline__stats" :items="promptStatsOf(view.prompt)" mono />
            <p class="acu-v2-write-pipeline__note">
              提示词 #{{ view.prompt.id }} · 完整消息明细见同页「提示词检查器」。
            </p>
          </template>
          <p v-else class="acu-v2-write-pipeline__note">
            {{ view.promptEvicted ? '关联记录已被挤出缓冲。' : '无关联的出站提示词记录。' }}
          </p>
        </section>

        <!-- 第三段：解析出的 SQL / DSL 操作 -->
        <section class="acu-v2-write-pipeline__section">
          <h4 class="acu-v2-write-pipeline__section-title">语句（{{ view.record.statementCount }}）</h4>
          <p v-if="!view.record.statements.length" class="acu-v2-write-pipeline__note">
            {{ view.record.operationsUnavailable
              ? '本次提交未由调用方提供语句（由持久化层自行构建），观测层拿不到 —— 不是「没有写任何东西」。'
              : '本次提交解析出 0 条语句。' }}
          </p>
          <div v-else class="acu-v2-write-pipeline__statements">
            <div
              v-for="(stat, index) in view.record.statements"
              :key="index"
              class="acu-v2-write-pipeline__statement"
            >
              <div class="acu-v2-write-pipeline__badges">
                <AcuBadge :variant="dialectVariant_ACU(stat.dialect)">{{ dialectLabel_ACU(stat.dialect) }}</AcuBadge>
                <AcuBadge :variant="operationVariant_ACU(stat.operation)">{{ operationLabel_ACU(stat.operation) }}</AcuBadge>
                <span v-if="stat.tables.length" class="acu-v2-write-pipeline__tables">{{ stat.tables.join('、') }}</span>
                <span class="acu-v2-write-pipeline__chars">{{ formatCount(stat.chars) }} 字符</span>
              </div>
              <pre class="acu-v2-write-pipeline__content">{{ stat.text }}</pre>
              <p v-if="stat.truncated" class="acu-v2-write-pipeline__note">
                本条超 {{ formatCount(flow.maxStatementChars) }} 字符上限，已截断。
              </p>
            </div>
          </div>
          <p v-if="view.record.truncated" class="acu-v2-write-pipeline__note">
            语句集超总字符预算，较早的语句未记录。
          </p>
        </section>
      </AcuDisclosureGroup>
    </div>
  </AcuPanel>
</template>

<script setup lang="ts">
import AcuBadge, { type AcuBadgeVariant } from './_lib/AcuBadge.vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuDisclosureGroup from './_lib/AcuDisclosureGroup.vue';
import AcuFormRow from './_lib/AcuFormRow.vue';
import AcuInfoBanner from './_lib/AcuInfoBanner.vue';
import AcuPanel from './_lib/AcuPanel.vue';
import AcuStatsList, { type AcuStatsItem } from './_lib/AcuStatsList.vue';
import AcuToggle from './_lib/AcuToggle.vue';
import { formatCount } from '../composables/prompt-inspection-report';
import {
  useWritePipeline,
  type PromptObservationRecord_ACU,
  type TableWritePipelineRecord_ACU,
  type WritePipelineView_ACU,
} from '../composables/useWritePipeline';
import {
  dialectLabel_ACU,
  dialectVariant_ACU,
  operationLabel_ACU,
  operationVariant_ACU,
} from '../composables/write-statement-display';

const flow = useWritePipeline();

const OUTCOME_LABEL_ACU: Record<TableWritePipelineRecord_ACU['outcome'], string> = {
  saved: '已落盘',
  runtime_only: '仅运行时',
  failed: '失败',
};

const TRANSPORT_LABEL_ACU: Record<'incremental' | 'buffered' | 'json', string> = {
  incremental: '真流式',
  buffered: '整读回退',
  json: '非流式',
};

function formatTime(at: number): string {
  try {
    const date = new Date(at);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  } catch {
    return '—';
  }
}

function formatTitle(record: TableWritePipelineRecord_ACU): string {
  return `#${record.id} · ${formatTime(record.at)} · ${record.source}`;
}

function formatMeta(record: TableWritePipelineRecord_ACU): string {
  const sheetPart = record.targetSheetKeys.length ? ` · ${record.targetSheetKeys.length} 张表` : '';
  return `${OUTCOME_LABEL_ACU[record.outcome]} · ${record.statementCount} 条语句${sheetPart}`;
}

function statsOf(view: WritePipelineView_ACU): AcuStatsItem[] {
  const { record } = view;
  return [
    { label: '来源', value: record.source },
    { label: '结果', value: OUTCOME_LABEL_ACU[record.outcome] },
    { label: '原因', value: record.reason || '—' },
    { label: '目标楼层', value: record.targetMessageIndex >= 0 ? `#${record.targetMessageIndex}` : '—' },
    { label: '目标表', value: record.targetSheetKeys.length ? record.targetSheetKeys.join('、') : '—' },
    { label: '关联提示词', value: record.promptRecordId === undefined ? '无' : `#${record.promptRecordId}` },
    ...(record.errorCategory ? [{ label: '错误类别', value: record.errorCategory }] : []),
  ];
}

function promptStatsOf(prompt: PromptObservationRecord_ACU): AcuStatsItem[] {
  return [
    { label: '功能域（scope）', value: prompt.scope },
    { label: '模型', value: prompt.model || '—' },
    { label: '消息数', value: formatCount(prompt.messageCount) },
    { label: '总字符', value: formatCount(prompt.totalChars) },
  ];
}

function outcomeVariant(outcome: TableWritePipelineRecord_ACU['outcome']): AcuBadgeVariant {
  if (outcome === 'saved') return 'success';
  if (outcome === 'failed') return 'danger';
  return 'warning';
}

function transportVariant(transport: 'incremental' | 'buffered' | 'json'): AcuBadgeVariant {
  if (transport === 'incremental') return 'success';
  if (transport === 'buffered') return 'warning';
  return 'neutral';
}

function transportLabel(transport: 'incremental' | 'buffered' | 'json'): string {
  return TRANSPORT_LABEL_ACU[transport] || transport;
}
</script>

<style scoped>
.acu-v2-write-pipeline__control {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--acu-space-3, 12px);
}

.acu-v2-write-pipeline__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--acu-space-2, 8px);
}

.acu-v2-write-pipeline__howto {
  margin-top: var(--acu-space-3, 12px);
}

.acu-v2-write-pipeline__empty {
  margin: var(--acu-space-3, 12px) 0 0;
  padding: var(--acu-space-4, 16px);
  border: 1px dashed var(--acu-border);
  border-radius: var(--acu-radius-md);
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-body, 12px);
  line-height: var(--acu-line-height-body, 1.6);
  text-align: center;
}

.acu-v2-write-pipeline__records {
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-2, 8px);
  margin-top: var(--acu-space-3, 12px);
  min-width: 0;
}

.acu-v2-write-pipeline__stats {
  margin-bottom: var(--acu-space-2, 8px);
}

.acu-v2-write-pipeline__section {
  margin-top: var(--acu-space-3, 12px);
  min-width: 0;
}

.acu-v2-write-pipeline__section-title {
  margin: 0 0 var(--acu-space-150, 6px);
  color: var(--acu-text-2);
  font-size: var(--acu-font-size-body, 12px);
  font-weight: 600;
}

.acu-v2-write-pipeline__badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--acu-space-150, 6px);
}

.acu-v2-write-pipeline__badges--lead {
  margin-bottom: var(--acu-space-2, 8px);
}

.acu-v2-write-pipeline__tables {
  color: var(--acu-text-2);
  font-family: var(--acu-font-mono);
  font-size: var(--acu-font-size-caption, 11px);
  word-break: break-all;
}

.acu-v2-write-pipeline__chars {
  margin-left: auto;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  white-space: nowrap;
}

.acu-v2-write-pipeline__statements {
  display: flex;
  flex-direction: column;
  gap: var(--acu-space-2, 8px);
  min-width: 0;
}

.acu-v2-write-pipeline__statement {
  min-width: 0;
  padding: var(--acu-space-2, 8px);
  border: 1px solid var(--acu-border-2);
  border-radius: var(--acu-radius-sm);
}

.acu-v2-write-pipeline__statement .acu-v2-write-pipeline__content {
  margin-top: var(--acu-space-150, 6px);
}

.acu-v2-write-pipeline__note {
  margin: var(--acu-space-150, 6px) 0 0;
  color: var(--acu-text-3);
  font-size: var(--acu-font-size-caption, 11px);
  line-height: var(--acu-line-height-caption, 1.5);
}

.acu-v2-write-pipeline__content {
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
  .acu-v2-write-pipeline__control {
    align-items: stretch;
  }
}
</style>

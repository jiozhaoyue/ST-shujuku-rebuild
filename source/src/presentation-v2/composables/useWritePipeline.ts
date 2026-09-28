/**
 * useWritePipeline — 写库流水面板业务流编排（Developer 页「写库流水」面板）
 *
 * 三段式组装的**唯一接缝**：本 composable 同时订阅
 * - **第三段**：写库流水（`service/table/write-pipeline-observer`，解析出的 SQL / DSL 操作），
 * - **第一/二段**：出站提示词观测（`service/ai/prompt-observer`，提示词与响应正文），
 * 按写库记录上的 `promptRecordId` 配对后交给组件渲染。
 *
 * 组件不直接 import service（本仓 v2 分层：pages / components 不引 data|service）。
 *
 * 三条形态对齐既有先例（usePromptInspection / useLogViewer）：
 * 1. 订阅必须成对：onMounted 订阅、onBeforeUnmount 退订。
 * 2. 开关真状态在低层（观测器），store 只负责持久化与推送；本 composable 读 store 的镜像值。
 * 3. 导出走既有「下载 JSON」先例，导出内容由观测器负责脱敏（此处不二次加工）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  WRITE_PIPELINE_MAX_RECORDS_ACU,
  WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU,
  clearTableWritePipeline_ACU,
  exportTableWritePipeline_ACU,
  getTableWritePipelineRecords_ACU,
  setTableWriteObservationEnabled_ACU,
  subscribeTableWritePipeline_ACU,
  type TableWritePipelineRecord_ACU,
} from '../../service/table/write-pipeline-observer';
import {
  PROMPT_OBSERVATION_MAX_RESPONSE_CHARS_ACU,
  getPromptObservations_ACU,
  subscribePromptObservations_ACU,
  type PromptObservationRecord_ACU,
} from '../../service/ai/prompt-observer';
import { getAcuHostDocument } from '../bootstrap/host-document';
import { useDevOptions } from './useDevOptions';
import { useToastStore } from '../stores/toast-store';

/**
 * 类型再导出：`components/` 不应直接 import service（口径见 frontend/directory-structure
 * 「在 pages/ components 里直接 import 核心层 → 抽 composable」）。组件只认这个接缝。
 */
export type {
  TableWritePipelineRecord_ACU,
  WriteStatementDialect_ACU,
  WriteStatementOperation_ACU,
  WriteStatementStat_ACU,
} from '../../service/table/write-pipeline-observer';
export type { PromptObservationRecord_ACU, PromptResponseStat_ACU } from '../../service/ai/prompt-observer';

/** 触发下载的文件名前缀（导出内容由观测器脱敏后给出）。 */
const EXPORT_FILENAME_PREFIX_ACU = 'acu-write-pipeline';

function downloadTextFile_ACU(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const doc = getAcuHostDocument();
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  doc.body.appendChild(anchor);
  anchor.click();
  doc.body.removeChild(anchor);
  // 延迟 revoke：WebView2/部分内核在 click 后立即 revoke 会取消下载
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 一条写库记录 + 它配对到的出站提示词记录（三段式视图单元）。 */
export interface WritePipelineView_ACU {
  record: TableWritePipelineRecord_ACU;
  /** 关联的出站提示词记录（其 `response` 即响应正文）；本就无关联时为 null。 */
  prompt: PromptObservationRecord_ACU | null;
  /** 记录曾关联过、但该提示词记录已被挤出缓冲 —— 与「本就无关联」区分开，UI 如实呈现。 */
  promptEvicted: boolean;
}

export function useWritePipeline() {
  const toast = useToastStore();
  const devOptions = useDevOptions();

  /** 写库记录（索引 0 为最旧）。低频更新（每次提交至多一条），无需合帧。 */
  const records = ref<readonly TableWritePipelineRecord_ACU[]>(getTableWritePipelineRecords_ACU());
  /** 出站提示词记录：用于配对出三段式的前两段（提示词 + 响应正文）。 */
  const promptRecords = ref<readonly PromptObservationRecord_ACU[]>(getPromptObservations_ACU());
  /** 展开的记录 id 集合。 */
  const expandedIds = ref<Set<number>>(new Set());

  const enabled = computed(() => devOptions.writePipelineEnabled.value);
  const count = computed(() => records.value.length);

  /** 三段式视图：把第三段与第一/二段按 `promptRecordId` 配对。 */
  const views = computed<WritePipelineView_ACU[]>(() => {
    const byId = new Map(promptRecords.value.map(record => [record.id, record]));
    return records.value.map(record => {
      const prompt = record.promptRecordId !== undefined ? byId.get(record.promptRecordId) ?? null : null;
      return {
        record,
        prompt,
        promptEvicted: record.promptRecordId !== undefined && prompt === null,
      };
    });
  });

  let unsubscribePipeline: (() => void) | null = null;
  let unsubscribePrompts: (() => void) | null = null;

  function toggleExpanded(id: number): void {
    const next = new Set(expandedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds.value = next;
  }

  function isExpanded(id: number): boolean {
    return expandedIds.value.has(id);
  }

  function setEnabled(value: boolean): void {
    devOptions.setWritePipelineEnabled(value);
    // store 已推送观察器；这里同步一次是为了让「开关 → 生效」不依赖 store 的调用顺序。
    setTableWriteObservationEnabled_ACU(value);
  }

  function clearAll(): void {
    clearTableWritePipeline_ACU('developer:writePipeline');
    expandedIds.value = new Set();
    records.value = getTableWritePipelineRecords_ACU();
    toast.success('写库流水已清空。');
  }

  function exportRecords(): void {
    if (records.value.length === 0) {
      toast.info('当前没有可导出的写库流水记录。');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile_ACU(`${EXPORT_FILENAME_PREFIX_ACU}-${stamp}.json`, exportTableWritePipeline_ACU());
    toast.success(`已导出 ${records.value.length} 条记录（导出内容已脱敏；提示词与正文请到「提示词检查器」一并导出）。`);
  }

  onMounted(() => {
    // store 可能在观察器模块加载前就已水合，这里补推一次，保证持久化的开关真的生效。
    setTableWriteObservationEnabled_ACU(enabled.value);
    records.value = getTableWritePipelineRecords_ACU();
    promptRecords.value = getPromptObservations_ACU();

    unsubscribePipeline = subscribeTableWritePipeline_ACU(next => {
      records.value = next;
      if (expandedIds.value.size) {
        const alive = new Set(next.map(record => record.id));
        const pruned = [...expandedIds.value].filter(id => alive.has(id));
        if (pruned.length !== expandedIds.value.size) expandedIds.value = new Set(pruned);
      }
    });
    // 响应正文是**异步补写**到提示词记录上的，必须一并订阅，否则面板上的正文永远停在「未补写」。
    unsubscribePrompts = subscribePromptObservations_ACU(next => {
      promptRecords.value = next;
    });
  });

  onBeforeUnmount(() => {
    unsubscribePipeline?.();
    unsubscribePipeline = null;
    unsubscribePrompts?.();
    unsubscribePrompts = null;
  });

  return {
    views,
    records,
    count,
    enabled,
    setEnabled,
    expandedIds,
    isExpanded,
    toggleExpanded,
    clearAll,
    exportRecords,
    maxRecords: WRITE_PIPELINE_MAX_RECORDS_ACU,
    maxStatementChars: WRITE_PIPELINE_MAX_STATEMENT_CHARS_ACU,
    maxResponseChars: PROMPT_OBSERVATION_MAX_RESPONSE_CHARS_ACU,
  };
}

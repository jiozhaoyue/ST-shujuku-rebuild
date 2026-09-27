/**
 * usePromptInspection — 提示词检查器业务流编排（Developer 页「提示词检查器」面板）
 *
 * 页面只消费本 composable；订阅与读取集中对接 service/ai/prompt-observer，
 * 组件不直接 import service（本仓 v2 分层：pages / components 不引 data|service）。
 *
 * 三条形态对齐既有先例（useLogViewer / log-buffer）：
 * 1. 订阅必须成对：onMounted 订阅、onBeforeUnmount 退订。
 * 2. 开关真状态在低层（观察器），store 只负责持久化与推送；本 composable 读 store 的镜像值。
 * 3. 导出走既有「下载 JSON」先例，且导出内容由观察器负责脱敏（此处不二次加工）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  PROMPT_OBSERVATION_MAX_MESSAGE_CHARS_ACU,
  PROMPT_OBSERVATION_MAX_RECORDS_ACU,
  clearPromptObservations_ACU,
  exportPromptObservations_ACU,
  getPromptObservations_ACU,
  setPromptObservationEnabled_ACU,
  subscribePromptObservations_ACU,
  type PromptObservationRecord_ACU,
} from '../../service/ai/prompt-observer';
import { getAcuHostDocument } from '../bootstrap/host-document';
import { useDevOptions } from './useDevOptions';
import { useToastStore } from '../stores/toast-store';
import { buildPromptInspectionReport } from './prompt-inspection-report';
import { copyTextToClipboard_ACU as copyTextToClipboard } from './clipboard';

/**
 * 类型再导出：`components/` 不应直接 import service（口径见 frontend/directory-structure
 * 「在 pages/ components 里直接 import 核心层 → 抽 composable」）。组件只认这个接缝。
 */
export type { PromptMessageStat_ACU, PromptObservationRecord_ACU, PromptSegmentStat_ACU } from '../../service/ai/prompt-observer';

/** 触发下载的文件名前缀（导出内容由观察器脱敏后给出）。 */
const EXPORT_FILENAME_PREFIX_ACU = 'acu-prompt-observations';

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

export function usePromptInspection() {
  const toast = useToastStore();
  const devOptions = useDevOptions();

  /** 记录列表（索引 0 为最旧）。低频更新（每次 AI 调用至多一条），无需合帧。 */
  const records = ref<readonly PromptObservationRecord_ACU[]>(getPromptObservations_ACU());
  /** 展开的记录 id 集合（默认全收起，避免长列表撑爆屏幕）。 */
  const expandedIds = ref<Set<number>>(new Set());

  /** 开关真状态由观察器持有；store 值是它的持久化镜像。 */
  const enabled = computed(() => devOptions.promptInspectEnabled.value);
  const count = computed(() => records.value.length);

  let unsubscribe: (() => void) | null = null;

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
    devOptions.setPromptInspectEnabled(value);
    // store 已推送观察器；这里同步一次是为了让「开关 → 生效」不依赖 store 的调用顺序。
    setPromptObservationEnabled_ACU(value);
  }

  function clearAll(): void {
    clearPromptObservations_ACU('developer:promptInspection');
    expandedIds.value = new Set();
    records.value = getPromptObservations_ACU();
    toast.success('提示词记录已清空。');
  }

  function exportRecords(): void {
    if (records.value.length === 0) {
      toast.info('当前没有可导出的提示词记录。');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile_ACU(`${EXPORT_FILENAME_PREFIX_ACU}-${stamp}.json`, exportPromptObservations_ACU());
    toast.success(`已导出 ${records.value.length} 条记录（导出内容已脱敏）。`);
  }

  /**
   * 复制「可直接贴进酒馆让 AI 排查」的文本报告。
   * 面向用户实况：出问题时把这段贴给 AI，让它照着实测提示词定位，不必另开工具。
   */
  async function copyReport(): Promise<void> {
    if (records.value.length === 0) {
      toast.info('当前没有可复制的提示词记录。');
      return;
    }
    const ok = await copyTextToClipboard(buildPromptInspectionReport(records.value));
    if (ok) toast.success(`已复制 ${records.value.length} 条记录的排查报告（已脱敏），可直接贴进聊天让 AI 排查。`);
    else toast.warning('复制失败（宿主未开放剪贴板）。请改用「导出 JSON」，或展开记录手动选取文本。');
  }

  onMounted(() => {
    // store 可能在观察器模块加载前就已水合，这里补推一次，保证持久化的开关真的生效。
    setPromptObservationEnabled_ACU(enabled.value);
    records.value = getPromptObservations_ACU();
    unsubscribe = subscribePromptObservations_ACU(next => {
      records.value = next;
      // 已被挤出的记录若仍处于展开态，顺手清掉，避免展开集合无限增长。
      if (expandedIds.value.size) {
        const alive = new Set(next.map(record => record.id));
        const pruned = [...expandedIds.value].filter(id => alive.has(id));
        if (pruned.length !== expandedIds.value.size) expandedIds.value = new Set(pruned);
      }
    });
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return {
    records,
    count,
    enabled,
    setEnabled,
    expandedIds,
    isExpanded,
    toggleExpanded,
    clearAll,
    exportRecords,
    copyReport,
    maxRecords: PROMPT_OBSERVATION_MAX_RECORDS_ACU,
    maxMessageChars: PROMPT_OBSERVATION_MAX_MESSAGE_CHARS_ACU,
  };
}

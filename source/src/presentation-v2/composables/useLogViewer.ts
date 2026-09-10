/**
 * useLogViewer — 运行日志页业务流编排
 *
 * 页面只消费本 composable；日志读写集中对接 shared/log-buffer，避免 v2
 * Vue 组件复用旧 presentation/log-viewer 的 jQuery 状态机。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  type LogEntry,
  type LogLevel,
  clearLogs,
  getAllLogs,
  getClearHistory_ACU,
  getKnownTags,
  getLogCount,
  isDebugLogEnabled,
  subscribe,
  subscribeToClear,
} from '../../shared/log-buffer';
import { acuCancelAnimationFrame, acuRequestAnimationFrame } from '../bootstrap/host-env';
import { getAcuHostDocument } from '../bootstrap/host-document';
import { useToastStore } from '../stores/toast-store';

export type LogLevelFilter = LogLevel | 'all';

/**
 * 日志页显示窗口上限。缓冲区上限是 5 万条，页面若全量跟随会出现三个 O(n) 叠加：
 * 每帧整表拷贝（getAllLogs）、filter/reverse 全量重算、DOM 全量渲染——Debug 开着时
 * 日志持续写入，久了必然卡死。这里只保留最近 N 条做现实时视图，全量仍在缓冲区里可导出。
 */
const LOG_VIEW_MAX_ENTRIES_ACU = 300;

export interface LogViewerMessage {
  kind: 'success' | 'info' | 'warning' | 'error';
  text: string;
}

const levelOptions: { value: LogLevelFilter; label: string }[] = [
  { value: 'all', label: '全部级别' },
  { value: 'debug', label: 'Debug' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const doc = getAcuHostDocument();
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // 延迟 revoke：WebView2/部分内核在 click 后立即 revoke 会取消下载
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useLogViewer() {
  const toast = useToastStore();
  const logs = ref<LogEntry[]>([]);
  const knownTags = ref<string[]>([]);
  const totalCount = ref(0);
  /** 被显示窗口裁掉的条数（只影响列表展示，导出仍取全量过滤结果）。 */
  const hiddenByWindow = ref(0);
  const levelFilter = ref<LogLevelFilter>('all');
  const tagFilter = ref('all');
  const keyword = ref('');
  const paused = ref(false);
  const pendingEntries = ref<LogEntry[]>([]);
  const autoScroll = ref(true);
  // 采集状态由「Debug 问题上报」卡片统一管理；此处只读展示
  const debugLogEnabled = ref(isDebugLogEnabled());
  const message = ref<LogViewerMessage | null>(null);
  let unsubscribe: (() => void) | null = null;
  let unsubscribeClear: (() => void) | null = null;
  let rafId: number | null = null;
  /** 本帧待追加的新日志：一帧只做一次响应式变更，避免逐条 push 触发多次重算。 */
  const pendingAppend: LogEntry[] = [];

  const tagOptions = computed(() => [
    { value: 'all', label: '全部模块' },
    ...knownTags.value.map(tag => ({ value: tag, label: tag })),
  ]);

  const filteredLogs = computed(() => {
    const needle = keyword.value.trim().toLowerCase();
    return logs.value.filter(entry => {
      if (levelFilter.value !== 'all' && entry.level !== levelFilter.value) return false;
      if (tagFilter.value !== 'all' && entry.tag !== tagFilter.value) return false;
      if (needle && !entry.message.toLowerCase().includes(needle)) return false;
      return true;
    });
  });

  const visibleLogs = computed(() => filteredLogs.value.slice().reverse());
  const filteredCount = computed(() => filteredLogs.value.length);
  const pendingCount = computed(() => pendingEntries.value.length);
  const statusLabel = computed(() => {
    if (paused.value) return pendingCount.value ? `已暂停，${pendingCount.value} 条待显示` : '已暂停';
    return '实时更新中';
  });
  const debugLabel = computed(() => (debugLogEnabled.value ? 'Debug 采集中' : 'Debug 未采集'));

  /** 全量重读（仅挂载/清空/恢复暂停时用）；展示只取最近窗口。 */
  function refresh(): void {
    const all = getAllLogs();
    logs.value = all.length > LOG_VIEW_MAX_ENTRIES_ACU ? all.slice(-LOG_VIEW_MAX_ENTRIES_ACU) : all;
    hiddenByWindow.value = Math.max(0, all.length - logs.value.length);
    knownTags.value = getKnownTags();
    totalCount.value = getLogCount();
    debugLogEnabled.value = isDebugLogEnabled();
    if (tagFilter.value !== 'all' && !knownTags.value.includes(tagFilter.value)) {
      tagFilter.value = 'all';
    }
  }

  /** 增量追加：把本帧累积的新日志一次性并入窗口并裁剪，全程不拷贝整个缓冲区。 */
  function flushAppend(): void {
    if (pendingAppend.length === 0) {
      totalCount.value = getLogCount();
      debugLogEnabled.value = isDebugLogEnabled();
      return;
    }
    const merged = logs.value.concat(pendingAppend);
    pendingAppend.length = 0;
    if (merged.length > LOG_VIEW_MAX_ENTRIES_ACU) {
      hiddenByWindow.value += merged.length - LOG_VIEW_MAX_ENTRIES_ACU;
      logs.value = merged.slice(-LOG_VIEW_MAX_ENTRIES_ACU);
    } else {
      logs.value = merged;
    }
    totalCount.value = getLogCount();
    debugLogEnabled.value = isDebugLogEnabled();
  }

  function scheduleRefresh(): void {
    if (rafId !== null) return;
    rafId = acuRequestAnimationFrame(() => {
      rafId = null;
      flushAppend();
    });
  }

  function setPaused(value: boolean): void {
    paused.value = value;
    if (!value) {
      pendingEntries.value = [];
      pendingAppend.length = 0;
      refresh();
    }
  }

  function clearAll(): void {
    clearLogs('logViewer.clearAll');
    pendingEntries.value = [];
    pendingAppend.length = 0;
    hiddenByWindow.value = 0;
    refresh();
    message.value = null;
    toast.success('日志缓冲区已清空。');
  }

  function exportFiltered(): void {
    const exportData = filteredLogs.value.map(entry => ({
      time: new Date(entry.timestamp).toISOString(),
      level: entry.level,
      tag: entry.tag,
      message: entry.message,
    }));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`acu-logs-${stamp}.json`, { exportedAt: new Date().toISOString(), clearHistory: getClearHistory_ACU(), logs: exportData });
    message.value = null;
    toast.success(`已导出 ${exportData.length} 条日志。`);
  }

  onMounted(() => {
    refresh();
    unsubscribe = subscribe(entry => {
      // 逐条只做 O(1) 累积：整表拷贝/排序放到本帧一次的 flushAppend 里。
      if (!knownTags.value.includes(entry.tag)) knownTags.value = getKnownTags();
      if (paused.value) {
        pendingEntries.value = [...pendingEntries.value, entry];
        return;
      }
      pendingAppend.push(entry);
      scheduleRefresh();
    });
    // 清空不产日志条目，必须订阅清空事件：否则页面继续显示已清空的旧数组（收起重开才刷新）。
    unsubscribeClear = subscribeToClear(() => {
      pendingEntries.value = [];
      refresh();
    });
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribeClear?.();
    unsubscribeClear = null;
    if (rafId !== null) {
      acuCancelAnimationFrame(rafId);
      rafId = null;
    }
  });

  return {
    logs,
    visibleLogs,
    levelOptions,
    tagOptions,
    levelFilter,
    tagFilter,
    keyword,
    paused,
    autoScroll,
    debugLogEnabled,
    message,
    totalCount,
    hiddenByWindow,
    windowSizeLimit: LOG_VIEW_MAX_ENTRIES_ACU,
    filteredCount,
    pendingCount,
    statusLabel,
    debugLabel,
    refresh,
    setPaused,
    clearAll,
    exportFiltered,
  };
}

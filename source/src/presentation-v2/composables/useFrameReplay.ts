/**
 * useFrameReplay — 历史楼层回放面板业务流编排（Developer 页「历史楼层回放」面板）
 *
 * 页面只消费本 composable；读取集中对接 service/table/historical-frame-replay，
 * 组件不直接 import service（本仓 v2 分层：pages / components 不引 data|service）。
 *
 * 只读纪律在这里同样成立：本 composable 只调扫描与构造视图，不触任何写路径。
 * 换聊天即清空选择 —— 与 AdvancedToolsPage 对 SQL 控制台的处理同口径
 * （上一次聊天的楼层号在新聊天里指向别的消息，留着就是误导）。
 */
import { computed, onMounted, ref } from 'vue';
import {
  buildFrameReplayView_ACU,
  listFrameBearingFloors_ACU,
  type FrameFloorEntry_ACU,
} from '../../service/table/historical-frame-replay';
import { watchChatChanged_ACU } from './useChatChangedListener';

/**
 * 类型再导出：`components/` 不应直接 import service（口径见 frontend/directory-structure
 * 「在 pages/ components 里直接 import 核心层 → 抽 composable」）。组件只认这个接缝。
 */
export type {
  FrameCheckpointSummary_ACU,
  FrameFloorEntry_ACU,
  FrameReplayEntry_ACU,
  FrameReplayView_ACU,
  FrameShape_ACU,
} from '../../service/table/historical-frame-replay';
export type { WriteStatementStat_ACU } from '../../service/table/write-pipeline-observer';

export function useFrameReplay() {
  const floors = ref<FrameFloorEntry_ACU[]>(listFrameBearingFloors_ACU());
  const selectedMessageIndex = ref<number | null>(null);

  /** 选中楼层即构造视图；未选中时为 null。构造是纯只读 + 同步的（帧规模有限）。 */
  const view = computed(() => (
    selectedMessageIndex.value === null ? null : buildFrameReplayView_ACU(selectedMessageIndex.value)
  ));

  function refreshFloors(): void {
    const next = listFrameBearingFloors_ACU();
    floors.value = next;
    // 选中的楼层若已不在列表里（删楼 / 换聊天 / 帧被清理），同步清空选择，避免展示陈旧视图。
    if (selectedMessageIndex.value !== null && !next.some(floor => floor.messageIndex === selectedMessageIndex.value)) {
      selectedMessageIndex.value = null;
    }
  }

  function select(messageIndex: number): void {
    selectedMessageIndex.value = selectedMessageIndex.value === messageIndex ? null : messageIndex;
  }

  function clearSelection(): void {
    selectedMessageIndex.value = null;
  }

  onMounted(() => {
    refreshFloors();
    watchChatChanged_ACU(() => {
      selectedMessageIndex.value = null;
      refreshFloors();
    });
  });

  return {
    floors,
    view,
    selectedMessageIndex,
    refreshFloors,
    select,
    clearSelection,
  };
}

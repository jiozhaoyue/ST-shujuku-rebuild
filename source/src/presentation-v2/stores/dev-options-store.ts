/**
 * dev-options-store — 仪表盘"启用开发者选项"总开关 + 各开发者 gated 字段的共享 store
 *
 * 字段：
 * - developerOptionsEnabled：仪表盘"高级设置"中的总开关。**仅**控制 sidebar 是否显示
 *   "开发者"一级页（plan §D24）。不联动任何 gated 字段的真假状态。
 * - plotAdvanced：编辑剧情推进预设抽屉中的"匹配替换"字段（sulv1-4 / zhaohui）
 *   是否显示。开关 UI 在开发者一级页内；与总开关相互独立。
 * - warnLogEnabled：WARN 日志是否输出并写入运行日志，默认关闭。
 *   这是 warn 采集的「常驻来源」，与 Debug 面板的临时采集各占一格（log-buffer 取或），
 *   所以停止 Debug 不会关掉这里显式打开的常驻采集，本 store 也不会被 Debug 改写。
 * - apiReconfirm：API 预设变更后，其他使用 API 预设的位置是否标黄提醒二次确认。
 *   默认打开（保持现有行为）；关闭后全库不再标黄。缺省（老版本存量）视为打开。
 * - promptInspectEnabled：提示词检查器是否开始记录出站提示词。默认关闭。
 *   与 warnLogEnabled 同形态：真状态由低层（service/ai/prompt-observer）持有，
 *   store 只负责持久化与推送 —— 关闭时埋点是一次布尔判断即返回，零开销。
 * - writePipelineEnabled：写库流水是否开始记录（出站提示词 → 响应正文 → 解析出的 SQL）。
 *   开关只控制**写库流水**这一段的记录；响应正文随提示词检查器一起开关（同属 prompt-observer）。
 *   默认关闭，同形态零开销。
 *
 * 新 UI 自有持久化，物理隔离于 settings_ACU。
 */
import { defineStore } from 'pinia';
import { setWarnLogEnabledByDevOption_ACU as applyWarnLogEnabled } from '../../shared/log-buffer';
import { setPromptObservationEnabled_ACU as applyPromptObservationEnabled } from '../../service/ai/prompt-observer';
import { setTableWriteObservationEnabled_ACU as applyTableWriteObservationEnabled } from '../../service/table/write-pipeline-observer';
import { readSection, writeSection } from './persistence';

const SECTION_KEY = 'devOptions';

export interface DevOptionsState {
  /** 总开关：仅控制 sidebar 是否显示"开发者"一级页（plan §D24）。 */
  developerOptionsEnabled: boolean;
  /** 编辑剧情推进预设抽屉中的"匹配替换"字段是否显示。与 developerOptionsEnabled 相互独立。 */
  plotAdvanced: boolean;
  /** WARN 日志是否输出并写入运行日志。默认关闭。 */
  warnLogEnabled: boolean;
  /** API 二次确认：预设变更后他处是否标黄。默认打开；缺省视为打开。 */
  apiReconfirm: boolean;
  /** 提示词检查器是否记录出站提示词。默认关闭；关闭时零开销。 */
  promptInspectEnabled: boolean;
  /** 写库流水是否记录（提示词 → 正文 → SQL）。默认关闭；关闭时零开销。 */
  writePipelineEnabled: boolean;
}

interface PersistedShape {
  developerOptionsEnabled?: unknown;
  plotAdvanced?: unknown;
  warnLogEnabled?: unknown;
  apiReconfirm?: unknown;
  promptInspectEnabled?: unknown;
  writePipelineEnabled?: unknown;
}

function loadFromStorage(): DevOptionsState {
  const raw = readSection<PersistedShape>(SECTION_KEY) ?? {};
  return {
    developerOptionsEnabled: raw.developerOptionsEnabled === true,
    plotAdvanced: raw.plotAdvanced === true,
    warnLogEnabled: raw.warnLogEnabled === true,
    apiReconfirm: raw.apiReconfirm !== false,
    promptInspectEnabled: raw.promptInspectEnabled === true,
    writePipelineEnabled: raw.writePipelineEnabled === true,
  };
}

function persist(state: DevOptionsState): void {
  writeSection(SECTION_KEY, {
    developerOptionsEnabled: state.developerOptionsEnabled,
    plotAdvanced: state.plotAdvanced,
    warnLogEnabled: state.warnLogEnabled,
    apiReconfirm: state.apiReconfirm,
    promptInspectEnabled: state.promptInspectEnabled,
    writePipelineEnabled: state.writePipelineEnabled,
  });
}

export const useDevOptionsStore = defineStore('acu-v2-dev-options', {
  state: (): DevOptionsState => {
    const state = loadFromStorage();
    applyWarnLogEnabled(state.warnLogEnabled);
    applyPromptObservationEnabled(state.promptInspectEnabled);
    applyTableWriteObservationEnabled(state.writePipelineEnabled);
    return state;
  },
  actions: {
    setDeveloperOptionsEnabled(enabled: boolean): void {
      this.developerOptionsEnabled = !!enabled;
      persist(this.$state);
    },
    setPlotAdvanced(enabled: boolean): void {
      this.plotAdvanced = !!enabled;
      persist(this.$state);
    },
    setWarnLogEnabled(enabled: boolean): void {
      this.warnLogEnabled = !!enabled;
      applyWarnLogEnabled(this.warnLogEnabled);
      persist(this.$state);
    },
    setApiReconfirm(enabled: boolean): void {
      this.apiReconfirm = !!enabled;
      persist(this.$state);
    },
    setPromptInspectEnabled(enabled: boolean): void {
      this.promptInspectEnabled = !!enabled;
      applyPromptObservationEnabled(this.promptInspectEnabled);
      persist(this.$state);
    },
    setWritePipelineEnabled(enabled: boolean): void {
      this.writePipelineEnabled = !!enabled;
      applyTableWriteObservationEnabled(this.writePipelineEnabled);
      persist(this.$state);
    },
    refresh(): void {
      const next = loadFromStorage();
      this.developerOptionsEnabled = next.developerOptionsEnabled;
      this.plotAdvanced = next.plotAdvanced;
      this.warnLogEnabled = next.warnLogEnabled;
      this.apiReconfirm = next.apiReconfirm;
      this.promptInspectEnabled = next.promptInspectEnabled;
      this.writePipelineEnabled = next.writePipelineEnabled;
      applyWarnLogEnabled(this.warnLogEnabled);
      applyPromptObservationEnabled(this.promptInspectEnabled);
      applyTableWriteObservationEnabled(this.writePipelineEnabled);
    },
  },
});

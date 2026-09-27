/**
 * useCapabilityOverview — Developer 页「环境与能力总览」的数据接缝
 *
 * 目的（用户要求的两件事合一处）：
 * - **可审查**：把「这份产物跑在哪个宿主上、它能做什么、状态存在哪几个通道」摊开在界面上；
 * - **agent 友好**：整体可一键复制成脱敏文本，贴给酒馆里的 AI —— 它据此就知道有哪些接口可调、
 *   数据存在哪，不必靠猜。
 *
 * 只读 + 零副作用：不写任何状态，仅汇总既有常量与运行时事实。所有取值都来自别处的单一事实源，
 * 这里**不重复定义**（方法清单来自 API 注册表分组索引、字段清单来自数据层常量）。
 */
import { computed } from 'vue';
import { getAcuHostKind } from '../../shared/host-bridge';
import { topLevelWindow_ACU } from '../../shared/env';
import { getBuildStamp_ACU, getPluginVersion_ACU } from '../../shared/plugin-identity';
import { ACU_V2_STORAGE_KEY } from '../../shared/v2-ui-state';
import { maskSensitiveText_ACU } from '../../shared/log-buffer';
import {
  MESSAGE_TABLE_FIELDS_ACU,
  FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU,
} from '../../data/repositories/chat-message-data-repo';
import { SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU } from '../../service/vector/summary-vector-index-types';
import { isSqliteMode } from '../../service/table/storage-mode';
import {
  currentChatFileIdentifier_ACU,
  getCurrentIsolationKey_ACU,
  settings_ACU,
} from '../../service/runtime/state-manager';
import { useToastStore } from '../stores/toast-store';
import { copyTextToClipboard_ACU } from './clipboard';

export interface CapabilityEnvRow_ACU {
  label: string;
  value: string;
}

export interface CapabilityStorageChannel_ACU {
  name: string;
  detail: string;
  fields: readonly string[];
}

export function useCapabilityOverview() {
  const toast = useToastStore();

  /** 环境事实。取值全部现读，避免缓存出「上次打开时的宿主」这种误导。 */
  const environment = computed<CapabilityEnvRow_ACU[]>(() => {
    const read = (fn: () => unknown, fallback = '—'): string => {
      try {
        const v = fn();
        return v === undefined || v === null || v === '' ? fallback : String(v);
      } catch {
        return fallback;
      }
    };
    return [
      { label: '宿主', value: read(() => getAcuHostKind()) },
      { label: '插件版本', value: read(() => getPluginVersion_ACU()) },
      { label: '构建戳', value: read(() => getBuildStamp_ACU()) },
      { label: '存储模式', value: isSqliteMode() ? 'SQLite' : 'JSON（原生）' },
      { label: '当前聊天标识', value: read(() => currentChatFileIdentifier_ACU) },
      {
        label: '数据隔离',
        value: (() => {
          try {
            if (settings_ACU?.dataIsolationEnabled !== true) return '未启用';
            const code = read(() => getCurrentIsolationKey_ACU(), '');
            return code ? '已启用' : '已启用（标记为空）';
          } catch {
            return '—';
          }
        })(),
      },
    ];
  });

  /**
   * 公开 API 分组。**从宿主全局读，不 import `presentation/bootstrap/api-registry`**：
   * 那个模块是「安装全局 API」的副作用模块（无业务模块 import 它，由入口挂载），
   * UI 一旦 import 就会把它拽进 app 依赖图，实测会连带打挂无关用例（它在模块初始化时
   * 直接改写 `topLevelWindow_ACU.AutoCardUpdaterAPI`）。读全局与 UI 读 API 本身同路。
   */
  const apiGroupIndex = computed<Record<string, readonly string[]>>(() => {
    try {
      const index = (topLevelWindow_ACU as any)?.__ACU_API_GROUP_INDEX__;
      if (index && typeof index === 'object') return index as Record<string, readonly string[]>;
    } catch { /* 拿不到就是空 */ }
    return {};
  });

  const apiGroups = computed(() =>
    Object.entries(apiGroupIndex.value)
      .map(([name, methods]) => ({ name, methods: [...methods].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)));

  /** 静态定义总数（分组索引求和）。 */
  const apiDefinedTotal = computed(() => apiGroups.value.reduce((sum, g) => sum + g.methods.length, 0));

  /**
   * **运行时实际可调用**的方法数。
   *
   * 为什么不直接用定义总数：本插件有运行时门禁（`installRuntimeGatedSqlReadApi_ACU` 在 SQLite
   * runtime 未发布时把 SQL 同步读取方法从 API 对象上摘掉）。定义数与可调用数因此可能不等
   * （实测 114 vs 113）。面板给人看的是「你现在能调什么」，所以以实时对象的键数为准，
   * 定义数只在拿不到对象时兜底。
   */
  const apiLiveTotal = computed(() => {
    try {
      const api = (topLevelWindow_ACU as any)?.AutoCardUpdaterAPI;
      if (api && typeof api === 'object') {
        const count = Object.keys(api).length;
        if (count > 0) return count;
      }
    } catch { /* 拿不到就退回定义数 */ }
    return apiDefinedTotal.value;
  });

  /** 运行时被门禁隐藏的方法数（>0 时面板要说明「清单里有些现在调不到」）。 */
  const apiGatedCount = computed(() => Math.max(0, apiDefinedTotal.value - apiLiveTotal.value));

  /**
   * 持久化面：本插件的状态只落这四类通道。
   * 前三类的字段清单来自数据层常量；第四类是服务端向量文件，按路径存放、不经聊天接口。
   */
  const storageChannels = computed<CapabilityStorageChannel_ACU[]>(() => [
    {
      name: '聊天消息字段',
      detail: '随消息一起进聊天存储（纯数据库模式下由 chatfilesys 按楼层拆存）',
      fields: MESSAGE_TABLE_FIELDS_ACU,
    },
    {
      name: 'chat[0] 镜像 + chatMetadata',
      detail: '聊天级容器；chatMetadata 侧为权威源，纯数据库模式下只被转发、不被接管',
      fields: FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU,
    },
    {
      name: '浏览器本地',
      detail: '与宿主存储无关：IndexedDB 向量缓存 + 本 UI 状态',
      fields: [ACU_V2_STORAGE_KEY],
    },
    {
      name: '服务端向量文件',
      detail: '按路径存放的向量索引，不经聊天接口（按聊天定键，切换分支时由本插件自己保证键稳定）',
      fields: [SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU],
    },
  ]);

  /** 组装「可贴给 AI」的脱敏文本报告。 */
  function buildOverviewReport(): string {
    const lines: string[] = [];
    lines.push('# 数据库插件能力与存储总览');
    lines.push(`导出时间：${new Date().toISOString()}`);
    lines.push('');
    lines.push('## 环境');
    for (const row of environment.value) lines.push(`- ${row.label}：${row.value}`);
    lines.push('');
    lines.push(`## 可调用的公开 API（挂在 window.AutoCardUpdaterAPI）`);
    lines.push(`当前可调用 ${apiLiveTotal.value} 个；静态定义 ${apiDefinedTotal.value} 个`
      + (apiGatedCount.value > 0 ? `（其中 ${apiGatedCount.value} 个当前被运行时门禁隐藏，例如 SQLite runtime 未就绪时的 SQL 读取方法）` : ''));
    for (const group of apiGroups.value) {
      lines.push(`### ${group.name}（${group.methods.length}）`);
      lines.push(group.methods.join('、'));
    }
    lines.push('');
    lines.push('## 状态持久化面（改数据前先看这里）');
    for (const channel of storageChannels.value) {
      lines.push(`### ${channel.name}`);
      lines.push(`- 说明：${channel.detail}`);
      lines.push(`- 字段/键：${channel.fields.join('、')}`);
    }
    lines.push('');
    lines.push('> 本报告由插件自身生成，已在导出前过脱敏（不含密钥/请求头）。');
    return maskSensitiveText_ACU(lines.join('\n'));
  }

  async function copyOverview(): Promise<void> {
    const ok = await copyTextToClipboard_ACU(buildOverviewReport());
    if (ok) toast.success('已复制能力与存储总览（已脱敏），可直接贴进聊天让 AI 参照。');
    else toast.warning('复制失败（宿主未开放剪贴板）。可展开各节手动选取文本。');
  }

  return {
    environment,
    apiGroups,
    apiLiveTotal,
    apiDefinedTotal,
    apiGatedCount,
    storageChannels,
    buildOverviewReport,
    copyOverview,
  };
}

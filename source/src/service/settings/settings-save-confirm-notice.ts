/**
 * service/settings/settings-save-confirm-notice.ts — 保存确认提示（写后未落盘的确认交互）
 *
 * 移植思路来自上游 albus 5518792c 的 settings-persistence-notice，弹窗通道改用本仓既有 UI 通道
 * （shared/ui-surface-registry 的 showUiSurfaceToast_ACU，非 Vue 上下文见 service 的既有用法）。
 *
 * 口径：
 * - 开关 settings_ACU.saveConfirmEnabled 默认关闭（保守上线，见 settings-service / state-manager）。
 * - 仅当设置处于 'unsaved'（宿主探测成功且超时未确认）且开关开启时，才经既有 UI 通道提示用户。
 * - 'unconfirmable'（host-bridge 探测失败）或开关关闭时静默降级为无确认，不弹窗、不抛错（D-03）。
 * - TT / Luker 行为差异全部在 host-bridge（probeSettingsConfirmBridge_ACU / getTauriSettingsStore_ACU）探测，本层不判宿主。
 */
import { showUiSurfaceToast_ACU } from '../../shared/ui-surface-registry';
import { logWarn_ACU } from '../../shared/utils';
import {
    getSettingsPersistenceState_ACU,
    subscribeSettingsPersistence_ACU,
    type SettingsPersistenceState_ACU,
} from '../../data/storage/settings-save-confirm';
import { settings_ACU } from '../runtime/state-manager';

export const SETTINGS_UNSAVED_TEXT_ACU = '检测到设置可能未写入磁盘，刷新后可能丢失。建议立即重新保存或导出当前配置。';

let unsubscribe_ACU: (() => void) | null = null;

/** 保存确认开关：只读 settings_ACU.saveConfirmEnabled，缺省关闭。 */
export function isSettingsSaveConfirmEnabled_ACU(): boolean {
    try {
        return (settings_ACU as any)?.saveConfirmEnabled === true;
    } catch {
        return false;
    }
}

/** 依据当前状态同步提示：仅 unsaved + 开关开启时提示，其余静默。 */
export function syncSettingsSaveConfirmNotice_ACU(state: SettingsPersistenceState_ACU): void {
    if (state !== 'unsaved' || !isSettingsSaveConfirmEnabled_ACU()) return;
    try {
        showUiSurfaceToast_ACU({ kind: 'warning', text: SETTINGS_UNSAVED_TEXT_ACU });
    } catch (error) {
        logWarn_ACU('[设置保存确认] 提示通道异常，已静默降级:', error);
    }
}

/** 安装状态订阅；重复调用幂等。 */
export function installSettingsSaveConfirmNotice_ACU(): void {
    if (unsubscribe_ACU) return;
    unsubscribe_ACU = subscribeSettingsPersistence_ACU(state => syncSettingsSaveConfirmNotice_ACU(state));
    syncSettingsSaveConfirmNotice_ACU(getSettingsPersistenceState_ACU());
}

/** 测试用：卸载并重置。 */
export function _resetSettingsSaveConfirmNotice_ACU(): void {
    unsubscribe_ACU?.();
    unsubscribe_ACU = null;
}

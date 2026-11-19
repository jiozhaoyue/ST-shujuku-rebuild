/**
 * service/settings/settings-persistence-status.ts — 落盘状态、命名空间快照与保全副本的门面
 *
 * 移植自上游 albus 5518792c，供界面层订阅与导出，避免 presentation→data 直接依赖。
 */
export {
    getSettingsPersistenceState_ACU,
    getSettingsPersistenceSnapshot_ACU,
    subscribeSettingsPersistence_ACU,
    type SettingsPersistenceState_ACU,
    type SettingsPersistenceSnapshot_ACU,
} from '../../data/storage/settings-save-confirm';
export {
    buildSettingsNamespaceBackup_ACU,
    SETTINGS_NAMESPACE_BACKUP_FORMAT_ACU,
    SETTINGS_NAMESPACE_BACKUP_VERSION_ACU,
    type SettingsNamespaceBackup_ACU,
} from '../../data/storage/settings-namespace-backup';
export { installSettingsRescueWriter_ACU } from '../../data/storage/settings-rescue';

/**
 * Profile 与 GlobalMeta 管理
 *
 * 全局元信息（跨标识共享）+ Profile 化存储（按标识代码分组的设置/模板）
 */

import { safeJsonParse_ACU, safeJsonStringify_ACU } from '../../shared/json-helpers';
import { logWarn_ACU } from '../../shared/utils';
import {
    STORAGE_KEY_GLOBAL_META_ACU, STORAGE_KEY_PROFILE_PREFIX_ACU, DEFAULT_ISOLATION_SLOT_ACU,
    normalizeIsolationCode_ACU, getProfileSettingsKey_ACU, getProfileTemplateKey_ACU,
} from '../../shared/data-constants';
import { getConfigStorage_ACU } from '../storage/tavern-storage';
import { TABLE_TEMPLATE_ACU } from '../../shared/defaults-json.js';

export let globalMeta_ACU: any = buildDefaultGlobalMeta_ACU();

export function buildDefaultGlobalMeta_ACU(): any {
    return {
        version: 1,
        activeIsolationCode: '',
        isolationCodeList: [],
        migratedLegacySingleStore: false,
        summaryVectorIndexModeGlobal: false,
        plotEnabledGlobal: true,
        vectorMemoryConfigGlobal: null,
    };
}

let globalMetaMissingOnLoad_ACU = false;
let globalMetaWriteSuspended_ACU = false;

/** 最近一次 loadGlobalMeta_ACU 是否读到键缺失；损坏与读取失败会走旁路备份降级，不计入「缺失」。 */
export function wasGlobalMetaMissingOnLoad_ACU(): boolean {
    return globalMetaMissingOnLoad_ACU;
}

/** 配置档待用户选择时暂停写入 GlobalMeta，避免把缺失状态固化为空隔离码。 */
export function setGlobalMetaWriteSuspended_ACU(suspended: boolean): void {
    globalMetaWriteSuspended_ACU = suspended;
}

export function isGlobalMetaWriteSuspended_ACU(): boolean {
    return globalMetaWriteSuspended_ACU;
}

/** 列出存储中已有设置或模板的配置档标识，默认槽为 ''；存储不支持枚举时返回 null。 */
export function listStoredProfileCodes_ACU(): string[] | null {
    const store = getConfigStorage_ACU();
    if (typeof store?.keys !== 'function') return null;
    const prefix = `${STORAGE_KEY_PROFILE_PREFIX_ACU}__`;
    const codes = new Set<string>();
    for (const key of store.keys()) {
        if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
        const match = /^(.+)__(settings|template)$/.exec(key.slice(prefix.length));
        if (!match) continue;
        if (match[1] === DEFAULT_ISOLATION_SLOT_ACU) {
            codes.add('');
            continue;
        }
        try {
            const code = normalizeIsolationCode_ACU(decodeURIComponent(match[1]));
            if (code) codes.add(code);
        } catch {
            // 无法解码的槽位不是本插件写入的配置档。
        }
    }
    return [...codes];
}

export function loadGlobalMeta_ACU(): any {
    const store = getConfigStorage_ACU();
    const raw = store?.getItem?.(STORAGE_KEY_GLOBAL_META_ACU);
    globalMetaMissingOnLoad_ACU = !raw;
    if (!raw) {
        globalMeta_ACU = buildDefaultGlobalMeta_ACU();
        return globalMeta_ACU;
    }
    const parsed = safeJsonParse_ACU(raw, null);
    if (!parsed || typeof parsed !== 'object') {
        // 原文存在但解析不出对象：启动链随后会把默认值写回同一键（隔离标识列表、当前标识、全局向量配置
        // 随之丢失），先把原文备份到旁路键（上游 #38，与 profile 设置的 H1 备份同口径）。
        backupRawBeforeDegradation_ACU(STORAGE_KEY_GLOBAL_META_ACU, '[GlobalMeta] 全局元数据');
        globalMeta_ACU = buildDefaultGlobalMeta_ACU();
        return globalMeta_ACU;
    }
    globalMeta_ACU = { ...buildDefaultGlobalMeta_ACU(), ...parsed };
    globalMeta_ACU.activeIsolationCode = normalizeIsolationCode_ACU(globalMeta_ACU.activeIsolationCode);
    if (!Array.isArray(globalMeta_ACU.isolationCodeList)) globalMeta_ACU.isolationCodeList = [];
    return globalMeta_ACU;
}

/** 把即将被默认值覆盖的原始存储串复制到 `${key}.bak`；内容相同跳过重复写，失败只告警。 */
function backupRawBeforeDegradation_ACU(key: string, label: string): void {
    try {
        const store = getConfigStorage_ACU();
        const raw = store?.getItem?.(key);
        if (typeof raw !== 'string' || !raw.trim()) return;
        const backupKey = `${key}.bak`;
        if (store.getItem(backupKey) === raw) return;
        store.setItem(backupKey, raw);
        logWarn_ACU(`${label}无法解析，已把原始内容备份到旁路键后再降级默认值：${backupKey}`);
    } catch (e) {
        logWarn_ACU(`${label}原始串旁路备份失败（继续按默认值降级）:`, e);
    }
}

export function saveGlobalMeta_ACU(): boolean {
    if (globalMetaWriteSuspended_ACU) {
        logWarn_ACU('[GlobalMeta] 配置档待选择，暂停写入全局元信息。');
        return false;
    }
    try {
        const store = getConfigStorage_ACU();
        const payload = safeJsonStringify_ACU(globalMeta_ACU);
        // 内容未变时跳过保存，避免加载期重复请求宿主保存；缺失恢复写入走同一门面。
        const writeResult = typeof store?.setItemIfChanged === 'function'
            ? store.setItemIfChanged(STORAGE_KEY_GLOBAL_META_ACU, payload)
            : store.setItem(STORAGE_KEY_GLOBAL_META_ACU, payload);
        // 存储门面明确返回 false（宿主持久化失败）不得谎报成功；undefined 视为兼容旧实现的成功。
        return writeResult !== false;
    } catch (e) {
        logWarn_ACU('[GlobalMeta] Failed to save:', e);
        return false;
    }
}

export function readProfileSettingsFromStorage_ACU(code: string): any {
    const store = getConfigStorage_ACU();
    const raw = store?.getItem?.(getProfileSettingsKey_ACU(code));
    if (!raw) return null;
    const parsed = safeJsonParse_ACU(raw, null);
    if (parsed && typeof parsed === 'object') return parsed;
    // [H1] 原始串存在但解析失败：先把原串备份到旁路键，再返回 null 走默认值分支。
    // 否则后续加载期默认配置补齐会覆盖写回同一分桶键，且无任何备份，配置永久丢失。
    backupProfileSettingsRawBeforeDegradation_ACU(code, 'json_parse_failed');
    return null;
}

/** [H1] Profile 设置原始串旁路备份键（仅降级路径写入，正常保存路径不写备份以避免写放大） */
export function getProfileSettingsBackupKey_ACU(code: string): string {
    return `${getProfileSettingsKey_ACU(code)}.bak`;
}

/**
 * [H1] 配置损坏防丢备份：把当前 profile settings 的原始存储串复制到旁路 .bak 键。
 * 仅在「原串存在但解析失败 / 加载处理异常」、即将降级为默认配置并可能覆盖写回同一分桶键之前调用；
 * 内容相同时跳过重复写（避免每次重载都触发持久化）。不做自动恢复 UI，加载成功时忽略 .bak。
 */
export function backupProfileSettingsRawBeforeDegradation_ACU(code: string, reason: string): void {
    try {
        const store = getConfigStorage_ACU();
        const key = getProfileSettingsKey_ACU(code);
        const raw = store?.getItem?.(key);
        if (typeof raw !== 'string' || !raw.trim()) return;
        const backupKey = getProfileSettingsBackupKey_ACU(code);
        if (store.getItem(backupKey) === raw) return;
        store.setItem(backupKey, raw);
        logWarn_ACU(`[Profile] 设置数据无法可信读取（${reason}），已把原始内容备份到旁路键后再降级默认配置：${backupKey}`);
    } catch (e) {
        logWarn_ACU('[Profile] 设置原始串旁路备份失败（继续按默认配置降级）:', e);
    }
}

export function writeProfileSettingsToStorage_ACU(code: string, settingsObj: any): void {
    const store = getConfigStorage_ACU();
    store.setItem(getProfileSettingsKey_ACU(code), safeJsonStringify_ACU(settingsObj));
}

export function readProfileTemplateFromStorage_ACU(code: string): string | null {
    const store = getConfigStorage_ACU();
    const raw = store?.getItem?.(getProfileTemplateKey_ACU(code));
    return (typeof raw === 'string' && raw.trim()) ? raw : null;
}

/**
 * 模板损坏防丢备份（R3-08，与设置的 H1 旁路备份同款）：模板原串存在但读不出来、即将用默认模板
 * 覆盖写回同一键之前，把原串复制到 `.bak` 旁路键。内容相同时跳过重复写。
 */
export function backupProfileTemplateRawBeforeDegradation_ACU(code: string, reason: string): void {
    try {
        const store = getConfigStorage_ACU();
        const key = getProfileTemplateKey_ACU(code);
        const raw = store?.getItem?.(key);
        if (typeof raw !== 'string' || !raw.trim()) return;
        const backupKey = `${key}.bak`;
        if (store.getItem(backupKey) === raw) return;
        store.setItem(backupKey, raw);
        logWarn_ACU(`[Profile] 模板数据无法可信读取（${reason}），已把原始内容备份到旁路键后再降级默认模板：${backupKey}`);
    } catch (e) {
        logWarn_ACU('[Profile] 模板原始串旁路备份失败（继续按默认模板降级）:', e);
    }
}

export function writeProfileTemplateToStorage_ACU(code: string, templateStr: string): void {
    const store = getConfigStorage_ACU();
    store.setItem(getProfileTemplateKey_ACU(code), String(templateStr || ''));
}

export function saveCurrentProfileTemplate_ACU(templateStr?: string, settings?: any): void {
    const tpl = templateStr !== undefined ? templateStr : TABLE_TEMPLATE_ACU;
    const code = normalizeIsolationCode_ACU(settings?.dataIsolationCode || '');
    writeProfileTemplateToStorage_ACU(code, String(tpl || ''));
}

export function sanitizeSettingsForProfileSave_ACU(settingsObj: any): any {
    const cloned = safeJsonParse_ACU(safeJsonStringify_ACU(settingsObj), {});
    delete cloned.dataIsolationHistory;
    delete cloned.dataIsolationEnabled;
    // 交火/向量模型 API 配置是全局配置，权威副本存放在 globalMeta.vectorMemoryConfigGlobal。
    // profile payload 中继续保存会导致切换隔离标识后旧值反向污染全局配置。
    delete cloned.vectorMemoryConfig;
    return cloned;
}

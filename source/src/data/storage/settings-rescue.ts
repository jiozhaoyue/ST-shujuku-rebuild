/**
 * data/storage/settings-rescue.ts — 未落盘配置的保全副本（数据面）
 *
 * 移植自上游 albus 5518792c。设置处于未落盘状态时，把插件命名空间快照另存一份：
 * 有 TT extension.store 时优先写它（经 host-bridge 获取，业务层不碰 TT ABI），否则写独立 IndexedDB 库。
 * 副本带写入标记（命名空间 __acuSettingsWrittenAt），启动后与宿主加载的标记比较判断副本是否更新。
 * rescue / backup 静默生效（用户无感）：只在此处积累副本数据与候选，恢复/忽略的界面动作在 service 层。
 *
 * 命名空间隔离：IDB 库名与 TT store 命名空间均以本仓 SCRIPT_ID_PREFIX_ACU（shujuku_v120）为前缀；
 * 副本格式与上游 albus 同构（format/version 一致），便于两个分叉间互相 recovering 用户配置。
 */
import { SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { topLevelWindow_ACU } from '../../shared/env';
import { idbRequestToPromise_ACU, isIndexedDbAvailable_ACU } from '../../shared/idb-import-temp';
import { getTauriSettingsStore_ACU } from '../../shared/host-bridge';
import { logWarn_ACU } from '../../shared/utils';
import {
    TAVERN_SETTINGS_NAMESPACE_ACU,
    getTavernSettingsNamespace_ACU,
    persistTavernSettings_ACU,
    readSettingsWrittenAt_ACU,
} from './tavern-storage';
import { buildSettingsNamespaceBackup_ACU, type SettingsNamespaceBackup_ACU } from './settings-namespace-backup';
import {
    getSettingsPersistenceState_ACU,
    subscribeSettingsPersistence_ACU,
    subscribeSettingsWrites_ACU,
} from './settings-save-confirm';

export const SETTINGS_RESCUE_FORMAT_ACU = 'acu-settings-rescue';
export const SETTINGS_RESCUE_STORE_NAMESPACE_ACU = `${SCRIPT_ID_PREFIX_ACU}-shujuku`;
export const SETTINGS_RESCUE_STORE_KEY_ACU = 'settings-rescue';
export const SETTINGS_RESCUE_IDB_NAME_ACU = `${SCRIPT_ID_PREFIX_ACU}_settings_rescue_v1`;
const SETTINGS_RESCUE_IDB_STORE_ACU = 'kv';
const SETTINGS_RESCUE_IDB_KEY_ACU = 'latest';
/** 写入标记键：与命名空间内 TAVERN_SETTINGS_WRITTEN_AT_KEY_ACU 同键名，副本快照里带上它。 */
const SETTINGS_WRITTEN_AT_KEY_ACU = '__acuSettingsWrittenAt';
export const SETTINGS_RESCUE_WRITE_DELAY_MS_ACU = 500;

export type SettingsRescueBackend_ACU = 'tauritavern-store' | 'indexeddb';

export type SettingsRescueRecord_ACU = {
    format: typeof SETTINGS_RESCUE_FORMAT_ACU;
    version: 1;
    /** 副本内容对应的命名空间写入标记。 */
    writtenAt: number;
    savedAt: number;
    /** 用户拒绝恢复时记录的 writtenAt；与 writtenAt 相同则不再提示。 */
    declinedWrittenAt: number | null;
    backup: SettingsNamespaceBackup_ACU;
};

export type StoredSettingsRescue_ACU = { backend: SettingsRescueBackend_ACU; record: SettingsRescueRecord_ACU };

export type SettingsRescueReadResult_ACU = {
    records: StoredSettingsRescue_ACU[];
    failures: Array<{ backend: SettingsRescueBackend_ACU; message: string }>;
};

function isRescueRecord_ACU(value: any): value is SettingsRescueRecord_ACU {
    return !!value && typeof value === 'object'
        && value.format === SETTINGS_RESCUE_FORMAT_ACU && value.version === 1
        && Number.isFinite(value.writtenAt) && Number.isFinite(value.savedAt)
        && (value.declinedWrittenAt === null || Number.isFinite(value.declinedWrittenAt))
        && !!value.backup && typeof value.backup === 'object'
        && !!value.backup.entries && typeof value.backup.entries === 'object';
}

function errorMessage_ACU(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

let rescueDbPromise_ACU: Promise<any> | null = null;

function openRescueDb_ACU(): Promise<any> {
    if (!isIndexedDbAvailable_ACU()) return Promise.resolve(null);
    if (rescueDbPromise_ACU) return rescueDbPromise_ACU;
    const opening = new Promise<any>((resolve, reject) => {
        try {
            const req = (topLevelWindow_ACU as any).indexedDB.open(SETTINGS_RESCUE_IDB_NAME_ACU, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(SETTINGS_RESCUE_IDB_STORE_ACU)) db.createObjectStore(SETTINGS_RESCUE_IDB_STORE_ACU);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
        } catch (error) {
            reject(error);
        }
    });
    rescueDbPromise_ACU = opening.catch((error) => {
        rescueDbPromise_ACU = null;
        throw error;
    });
    return rescueDbPromise_ACU;
}

async function idbGetRescue_ACU(): Promise<unknown> {
    const db = await openRescueDb_ACU();
    if (!db) return undefined;
    const tx = db.transaction(SETTINGS_RESCUE_IDB_STORE_ACU, 'readonly');
    return idbRequestToPromise_ACU(tx.objectStore(SETTINGS_RESCUE_IDB_STORE_ACU).get(SETTINGS_RESCUE_IDB_KEY_ACU));
}

async function writeToBackend_ACU(backend: SettingsRescueBackend_ACU, record: SettingsRescueRecord_ACU): Promise<void> {
    if (backend === 'tauritavern-store') {
        const store = getTauriSettingsStore_ACU();
        if (!store) throw new Error('TauriTavern extension.store 不可用');
        await store.setJson({ namespace: SETTINGS_RESCUE_STORE_NAMESPACE_ACU, key: SETTINGS_RESCUE_STORE_KEY_ACU, value: record });
        return;
    }
    const db = await openRescueDb_ACU();
    if (!db) throw new Error('IndexedDB 不可用');
    const tx = db.transaction(SETTINGS_RESCUE_IDB_STORE_ACU, 'readwrite');
    await idbRequestToPromise_ACU(tx.objectStore(SETTINGS_RESCUE_IDB_STORE_ACU).put(record, SETTINGS_RESCUE_IDB_KEY_ACU));
}

/** 写入保全副本：有 TT extension.store 时优先，失败或不可用时写 IndexedDB；都失败返回 null。 */
export async function writeSettingsRescue_ACU(record: SettingsRescueRecord_ACU): Promise<SettingsRescueBackend_ACU | null> {
    const backends: SettingsRescueBackend_ACU[] = getTauriSettingsStore_ACU() ? ['tauritavern-store', 'indexeddb'] : ['indexeddb'];
    for (const backend of backends) {
        try {
            await writeToBackend_ACU(backend, record);
            return backend;
        } catch (error) {
            logWarn_ACU(`[配置保全] 写入 ${backend} 失败:`, error);
        }
    }
    return null;
}

/** 把副本写回它所在的后端（用于记录忽略）。失败时抛错。 */
export async function updateSettingsRescue_ACU(stored: StoredSettingsRescue_ACU): Promise<void> {
    await writeToBackend_ACU(stored.backend, stored.record);
}

/** 读取两个后端的副本；读取失败与格式无效分别记入 failures，不伪装为没有副本。 */
export async function readSettingsRescue_ACU(): Promise<SettingsRescueReadResult_ACU> {
    const records: StoredSettingsRescue_ACU[] = [];
    const failures: SettingsRescueReadResult_ACU['failures'] = [];
    const collect = (backend: SettingsRescueBackend_ACU, value: unknown) => {
        if (value === undefined || value === null) return;
        if (!isRescueRecord_ACU(value) || value.backup.namespace !== TAVERN_SETTINGS_NAMESPACE_ACU) {
            failures.push({ backend, message: '副本格式无效' });
            return;
        }
        records.push({ backend, record: value });
    };
    const store = getTauriSettingsStore_ACU();
    if (store) {
        try {
            const result = await store.tryGetJson({ namespace: SETTINGS_RESCUE_STORE_NAMESPACE_ACU, key: SETTINGS_RESCUE_STORE_KEY_ACU });
            if (result?.found) collect('tauritavern-store', result.value);
        } catch (error) {
            failures.push({ backend: 'tauritavern-store', message: errorMessage_ACU(error) });
        }
    }
    try {
        collect('indexeddb', await idbGetRescue_ACU());
    } catch (error) {
        failures.push({ backend: 'indexeddb', message: errorMessage_ACU(error) });
    }
    return { records, failures };
}

/** 新于宿主加载标记且未被忽略的副本，按写入标记从新到旧；宿主标记未知时为空。 */
export function selectSettingsRescueCandidates_ACU(records: StoredSettingsRescue_ACU[], loadedWrittenAt: number | null): StoredSettingsRescue_ACU[] {
    if (loadedWrittenAt === null) return [];
    return records
        .filter(({ record }) => record.writtenAt > loadedWrittenAt && record.declinedWrittenAt !== record.writtenAt)
        .sort((a, b) => b.record.writtenAt - a.record.writtenAt);
}

/** 把副本内容写回插件命名空间并请求宿主保存；只覆盖副本中的键，不删除命名空间里的其他键。 */
export function applySettingsRescueEntries_ACU(entries: Record<string, unknown>): ReturnType<typeof persistTavernSettings_ACU> {
    const ns = getTavernSettingsNamespace_ACU();
    if (!ns || typeof ns !== 'object') throw new Error('酒馆设置不可用，无法恢复配置副本。');
    for (const [key, value] of Object.entries(entries)) ns[key] = value;
    return persistTavernSettings_ACU();
}

let writerUnsubscribers_ACU: Array<() => void> | null = null;
let writerTimer_ACU: ReturnType<typeof setTimeout> | null = null;
let lastRescuedWrittenAt_ACU = 0;

async function saveRescueNow_ACU(): Promise<void> {
    if (getSettingsPersistenceState_ACU() !== 'unsaved') return;
    const backup = buildSettingsNamespaceBackup_ACU();
    if (!backup) return;
    const writtenAt = readSettingsWrittenAt_ACU(backup.entries);
    if (!writtenAt || writtenAt === lastRescuedWrittenAt_ACU) return;
    const record: SettingsRescueRecord_ACU = {
        format: SETTINGS_RESCUE_FORMAT_ACU,
        version: 1,
        writtenAt,
        savedAt: Date.now(),
        declinedWrittenAt: null,
        backup,
    };
    const backend = await writeSettingsRescue_ACU(record);
    if (backend) lastRescuedWrittenAt_ACU = writtenAt;
    else logWarn_ACU('[配置保全] 未落盘配置的保全副本写入失败，请导出当前配置。');
}

function scheduleRescueWrite_ACU(): void {
    if (getSettingsPersistenceState_ACU() !== 'unsaved') return;
    if (writerTimer_ACU) clearTimeout(writerTimer_ACU);
    writerTimer_ACU = setTimeout(() => {
        writerTimer_ACU = null;
        void saveRescueNow_ACU();
    }, SETTINGS_RESCUE_WRITE_DELAY_MS_ACU);
}

/** 进入未落盘状态后，每次写入（防抖）把命名空间快照写入保全副本。静默生效。 */
export function installSettingsRescueWriter_ACU(): void {
    if (writerUnsubscribers_ACU) return;
    writerUnsubscribers_ACU = [
        subscribeSettingsPersistence_ACU(state => { if (state === 'unsaved') scheduleRescueWrite_ACU(); }),
        subscribeSettingsWrites_ACU(() => scheduleRescueWrite_ACU()),
    ];
    scheduleRescueWrite_ACU();
}

/** 测试用：重置模块级状态。 */
export function _resetSettingsRescue_ACU(): void {
    if (writerTimer_ACU) clearTimeout(writerTimer_ACU);
    writerTimer_ACU = null;
    writerUnsubscribers_ACU?.forEach(unsubscribe => unsubscribe());
    writerUnsubscribers_ACU = null;
    lastRescuedWrittenAt_ACU = 0;
    rescueDbPromise_ACU = null;
}

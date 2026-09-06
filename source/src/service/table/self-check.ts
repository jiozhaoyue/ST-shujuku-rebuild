/**
 * service/table/self-check.ts — 启动/运行自检快照（设计文档 §4 卡死自诊断的观测面）
 *
 * 纯读聚合器：只调用各子系统的只读接口，任何探针失败都在该探针位记录错误字符串，
 * 绝不抛出、绝不改动任何状态——自检本身不允许成为新的阻塞源。
 * 消费方：presentation-v2 Debug 面板（随 Debug 导出一并带走，用于排错）。
 */

import { getAcuHostKind, isAcuLukerRuntime, isAcuTauriRuntime } from '../../shared/host-bridge';
import { settings_ACU } from '../runtime/state-manager';
import { isSqliteMode } from './storage-mode';
import { snapshotAllRuntimeOnlyPending_ACU } from './runtime-only-pending-state';
import { getRecentTouchedLedgerStats_ACU } from '../ai/prompt-builder/table-injection-scope';

export type SelfCheckProbe_ACU =
    | { ok: true; value: unknown }
    | { ok: false; error: string };

function probe_ACU<T>(name: string, fn: () => T): Record<string, SelfCheckProbe_ACU> {
    try {
        return { [name]: { ok: true, value: fn() } };
    } catch (e) {
        return { [name]: { ok: false, error: String((e as any)?.message || e) } };
    }
}

export type SelfCheckSnapshot_ACU = Record<string, SelfCheckProbe_ACU>;

export function collectSelfCheckSnapshot_ACU(): SelfCheckSnapshot_ACU {
    return {
        ...probe_ACU('host', () => ({
            kind: getAcuHostKind(),
            isTauriTavern: isAcuTauriRuntime(),
            isLuker: isAcuLukerRuntime(),
        })),
        ...probe_ACU('storage', () => ({
            sqliteMode: isSqliteMode(),
        })),
        ...probe_ACU('differentialInjection', () => ({
            enabled: settings_ACU?.differentialInjectionEnabled === true,
            hotSheetsCsv: String(settings_ACU?.differentialHotSheets ?? ''),
            coldSheetsCsv: String(settings_ACU?.differentialColdSheets ?? ''),
            ledger: getRecentTouchedLedgerStats_ACU(),
        })),
        ...probe_ACU('pendingFlush', () => ({
            registeredScopes: snapshotAllRuntimeOnlyPending_ACU(),
        })),
    };
}

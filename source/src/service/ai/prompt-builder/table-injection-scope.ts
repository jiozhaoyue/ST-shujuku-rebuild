/**
 * service/ai/prompt-builder/table-injection-scope.ts — 差量注入热表解析
 *
 * 热表信号解析（纯函数，零依赖）：hot = (recentTouched ∪ explicitHot) − explicitCold。
 * 冷表在填表 prompt 中只保留 DDL 与行数说明（见 prompt-prepare coldProjection），
 * 保留 INSERT 能力，牺牲冷表基于行内容的 UPDATE/DELETE 精度。
 * 开关关闭或信号缺失时调用方必须走全量注入（默认路径）。
 */

export interface DifferentialInjectionOptions_ACU {
    /** 总开关；false 时调用方必须全量注入 */
    enabled: boolean;
    /** 配置热表：无论近期是否改动都带全量数据 */
    hotSheetKeys?: string[] | null;
    /** 配置冷表：压过 recent 与 hot（恒胜出） */
    coldSheetKeys?: string[] | null;
    /** 近 K 轮改动表（调用方从批次账本/回调账本供给；v1 可为 null） */
    recentTouchedSheetKeys?: string[] | null;
}

function toKeySet_ACU(value: unknown): Set<string> {
    if (!Array.isArray(value)) return new Set();
    const out = new Set<string>();
    for (const item of value) {
        if (typeof item === 'string' && item) out.add(item);
    }
    return out;
}

export function resolveDifferentialHotSheetKeys_ACU(
    options: DifferentialInjectionOptions_ACU | null | undefined,
): Set<string> {
    if (!options || options.enabled !== true) return new Set();
    const hot = toKeySet_ACU(options.hotSheetKeys);
    for (const key of toKeySet_ACU(options.recentTouchedSheetKeys)) hot.add(key);
    for (const key of toKeySet_ACU(options.coldSheetKeys)) hot.delete(key);
    return hot;
}

// ═══════════════════════════════════════════════════════════════
// 近期改动表账本（recentTouchedSheetKeys 自动供给）
// ═══════════════════════════════════════════════════════════════

/** 记录最近 K 批填表实际改动过的表（批 = 一次成功 parse&apply） */
const RECENT_TOUCHED_BATCHES_KEEP_ACU = 3;

/** 环形批账本：新批 unshift，超 K 批丢弃最旧批 */
let recentTouchedBatches_ACU: string[][] = [];

/**
 * 记录一批填表实际改动的表键（modifiedKeys）。
 * 非法输入静默忽略——账本是增强信号，绝不因记录失败影响填表主链。
 */
export function recordTouchedSheetKeys_ACU(sheetKeys: unknown): void {
    if (!Array.isArray(sheetKeys)) return;
    const keys = sheetKeys.filter((key): key is string => typeof key === 'string' && !!key);
    recentTouchedBatches_ACU.unshift(keys);
    if (recentTouchedBatches_ACU.length > RECENT_TOUCHED_BATCHES_KEEP_ACU) {
        recentTouchedBatches_ACU.length = RECENT_TOUCHED_BATCHES_KEEP_ACU;
    }
}

/** 近 K 批改动表并集；账本为空时返回 null（调用方按"无信号"处理）。 */
export function getRecentTouchedSheetKeys_ACU(): string[] | null {
    if (recentTouchedBatches_ACU.length === 0) return null;
    const merged = new Set<string>();
    for (const batch of recentTouchedBatches_ACU) {
        for (const key of batch) merged.add(key);
    }
    return [...merged];
}

/** 仅供测试：清空账本。 */
export function _resetRecentTouchedLedgerForTests_ACU(): void {
    recentTouchedBatches_ACU = [];
}

/** [自检] 账本只读快照：批数与最近一批改动的表键。 */
export function getRecentTouchedLedgerStats_ACU(): { batchCount: number; lastBatchKeys: string[] } {
    return {
        batchCount: recentTouchedBatches_ACU.length,
        lastBatchKeys: [...(recentTouchedBatches_ACU[0] || [])],
    };
}

// ═══════════════════════════════════════════════════════════════
// 设置读取与名单展开
// ═══════════════════════════════════════════════════════════════

function parseCsvSheetSelectors_ACU(value: unknown): string[] {
    if (typeof value !== 'string') return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    return value.split(/[,，;；\n]/).map(item => item.trim()).filter(Boolean);
}

/**
 * 从插件全局设置构造差量注入选项（近期改动表账本自动并入）。
 * 名单为用户可读的表名或 sheet_ 键（逗号/中文逗号/分号/换行分隔）。
 */
export function buildDifferentialInjectionFromSettings_ACU(settings: any): DifferentialInjectionOptions_ACU {
    return {
        enabled: settings?.differentialInjectionEnabled === true,
        hotSheetKeys: parseCsvSheetSelectors_ACU(settings?.differentialHotSheets),
        coldSheetKeys: parseCsvSheetSelectors_ACU(settings?.differentialColdSheets),
        recentTouchedSheetKeys: getRecentTouchedSheetKeys_ACU(),
    };
}

/**
 * 展开选择器为 sheet_ 键集合：选择器是 sheet_ 键或与运行时表 name 精确匹配的名称。
 * 未匹配的选择器忽略（不抛错——名单是增强配置，写错不应打断填表主链）。
 */
export function expandSheetSelectorsToKeys_ACU(
    selectors: unknown,
    tableData: Record<string, any> | null | undefined,
): Set<string> {
    const out = new Set<string>();
    if (!tableData || typeof tableData !== 'object') return out;
    const nameToKeys = new Map<string, string[]>();
    for (const key of Object.keys(tableData)) {
        if (!key.startsWith('sheet_')) continue;
        const name = String((tableData[key] as any)?.name || '').trim();
        if (name) {
            const bucket = nameToKeys.get(name) || [];
            bucket.push(key);
            nameToKeys.set(name, bucket);
        }
    }
    for (const selector of parseCsvSheetSelectors_ACU(selectors)) {
        if (Object.prototype.hasOwnProperty.call(tableData, selector)) {
            out.add(selector);
            continue;
        }
        for (const key of nameToKeys.get(selector) || []) out.add(key);
    }
    return out;
}

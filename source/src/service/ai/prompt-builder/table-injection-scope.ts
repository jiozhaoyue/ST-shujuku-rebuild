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

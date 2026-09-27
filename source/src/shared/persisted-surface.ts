/**
 * shared/persisted-surface.ts — 本插件**持久化面**的契约清单（单一事实源）
 *
 * 本插件的状态只落四类通道，字段名在这里集中登记，供三处消费：
 * 1. 数据层实现（`data/repositories/chat-message-data-repo.ts`、`service/vector/summary-vector-index-types.ts`）
 *    直接从这里取常量，**不再各写一份字面量**；
 * 2. 守卫用例 `tests/integration/pure-db-mode-compat.test.ts` 用它钉住「源码里用到的
 *    `TavernDB_ACU_*` 名字集合必须与登记清单逐字相等」（多一个=新增未归类，少一个=清单过期）；
 * 3. Developer 页「环境与能力总览」把它作为**可审查的持久化面**展示出来。
 *
 * 为什么放在 `shared/`：这是**契约**而非实现细节——UI 要读它、守卫用例要读它、数据层要实现它。
 * 放在数据层会让 UI 为了读一份清单而把整个 data 依赖图拽进 app 图（2026-09-28 实测：那会与
 * 若干测试文件的窄 mock 冲突，使 `tests/setup/warm-app-graph.ts` 的预热抛错并连带让重型套件超时）。
 * 放在 service 层同理。契约放 `shared/` 是这三方唯一都合适的位置。
 */

/**
 * 消息上全部本地表格数据字段清单。
 * 硬清空、残留扫描与事务快照必须基于此清单；新增存储字段必须同步更新这里
 * （守卫用例会因「多一个未归类」而变红，逼作者更新契约）。
 */
export const MESSAGE_TABLE_FIELDS_ACU: readonly string[] = Object.freeze([
    'TavernDB_ACU_IsolatedData',
    'TavernDB_ACU_IndependentData',
    'TavernDB_ACU_Data',
    'TavernDB_ACU_SummaryData',
    'TavernDB_ACU_Identity',
    'TavernDB_ACU_LocalMessageAnchor',
    'TavernDB_ACU_ModifiedKeys',
    'TavernDB_ACU_UpdateGroupKeys',
    '_acu_local_template_base_state_seeded',
]);

/**
 * chat[0] 上额外挂载的聊天级 scope/Guide 镜像字段（含旧版表头清单）。
 * 仅在首条消息上清空；chatMetadata 侧的对应字段由 storage 层 setter 清空。
 */
export const FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU: readonly string[] = Object.freeze([
    'TavernDB_ACU_ScopedConfig',
    'TavernDB_ACU_InternalSheetGuide',
    'TavernDB_ACU_TableHeaderGuide',
]);

/** 纪要向量索引注册表在服务端向量存储里的路径（不经聊天接口）。 */
export const SUMMARY_VECTOR_INDEX_REGISTRY_PATH_ACU = 'TavernDB_ACU_vector_registry';

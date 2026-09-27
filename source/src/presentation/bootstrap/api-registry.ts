/**
 * presentation/bootstrap/api-registry.ts — AutoCardUpdaterAPI 对外 API 注册
 *
 * 从 src/core/03_runtime_api.js 整体迁移，按领域拆分为 9 个分组文件。
 * 本文件负责：import 所有分组 → 合并方法 → 挂载到全局对象。
 */

import { topLevelWindow_ACU } from '../../shared/env';
import { logWarn_ACU } from '../../shared/utils';
import { createCallbackApi, type ApiGroupContext } from './api-groups/callback-api';
import { createCoreDataApi } from './api-groups/core-data-api';
import { createTableCrudApi } from './api-groups/table-crud-api';
import { createTableLockApi } from './api-groups/table-lock-api';
import { createTemplatePresetApi } from './api-groups/template-preset-api';
import { createPlotPresetApi } from './api-groups/plot-preset-api';
import { createDataAdminApi } from './api-groups/data-admin-api';
import { createSettingsConfigApi } from './api-groups/settings-config-api';
import { createWorldbookAiApi } from './api-groups/worldbook-ai-api';
import { createAgentWorldbookApi } from './api-groups/agent-worldbook-api';
import { createSqlApi, installRuntimeGatedSqlReadApi_ACU } from './api-groups/sql-api';
import { createPerformanceDiagnosticsApi } from './api-groups/performance-diagnostics-api';

// --- 共享状态（回调数组） ---
const tableUpdateCallbacks: Function[] = [];
const tableFillStartCallbacks: Function[] = [];

// --- 共享上下文（延迟引用，解决 this 互调） ---
let apiRef: any = null;
const ctx: ApiGroupContext = {
    tableUpdateCallbacks,
    tableFillStartCallbacks,
    getApi: () => apiRef,
};

const sqlApi = createSqlApi(ctx);

// --- 组装所有领域 API ---
// [M7] 逐键合并并检测重名：保持 Object.assign「后注册者胜出」的既有语义，
// 但对重复键打 warn 指明被覆盖方，避免静默覆盖（如 openVisualizer 曾在
// data-admin-api 与 settings-config-api 中重复定义）。不删除重复定义本身。
const apiGroupEntries: Array<{ name: string; methods: Record<string, Function> }> = [
    { name: 'callback', methods: createCallbackApi(ctx) },
    { name: 'core-data', methods: createCoreDataApi(ctx) },
    { name: 'table-crud', methods: createTableCrudApi(ctx) },
    { name: 'table-lock', methods: createTableLockApi(ctx) },
    { name: 'template-preset', methods: createTemplatePresetApi(ctx) },
    { name: 'plot-preset', methods: createPlotPresetApi(ctx) },
    { name: 'data-admin', methods: createDataAdminApi(ctx) },
    { name: 'settings-config', methods: createSettingsConfigApi(ctx) },
    { name: 'worldbook-ai', methods: createWorldbookAiApi(ctx) },
    { name: 'agent-worldbook', methods: createAgentWorldbookApi(ctx) },
    { name: 'performance-diagnostics', methods: createPerformanceDiagnosticsApi() },
    { name: 'sql', methods: sqlApi },
];

const api: Record<string, Function> = {};
for (const { name, methods } of apiGroupEntries) {
    for (const key of Object.keys(methods)) {
        if (Object.prototype.hasOwnProperty.call(api, key)) {
            logWarn_ACU(`[API注册] 方法 "${key}" 在多个分组中重复定义，后注册的 "${name}" 分组实现将覆盖先前实现。`);
        }
        api[key] = methods[key];
    }
}

/**
 * 分组索引 —— 公开 API 的**自描述面**：组名 → 该组下的方法名。
 *
 * 用途：Developer 页「环境与能力总览」据此列出「这个插件能做什么」，并整体复制给
 * 酒馆里的 AI 让它知道可调用的接口（用户要求的「agent 友好」）。分组信息只在这里有，
 * 消费方不要去猜方法名前缀。
 */
export const ACU_API_GROUP_INDEX_ACU: Readonly<Record<string, readonly string[]>> = Object.freeze(
    Object.fromEntries(apiGroupEntries.map(({ name, methods }) => [name, Object.freeze(Object.keys(methods))])),
);

// SQL 同步读取只能在 SQLite runtime 完整发布后对外可见。
// getter 会在聊天切换/重载窗口自动隐藏，避免第三方脚本把“函数存在”误判为“运行时可查询”。
installRuntimeGatedSqlReadApi_ACU(api, sqlApi);

// 将最终组装的 api 赋给 apiRef，使 ctx.getApi() 返回完整对象
apiRef = api;

// --- 挂载到全局 ---
(topLevelWindow_ACU as any).AutoCardUpdaterAPI = api;
// 分组索引随 API 一起挂到宿主全局：UI 只从全局读，**不得 import 本模块**。
// 本模块是「安装全局 API」的副作用模块（没有任何业务模块 import 它，由入口挂载），
// UI 一旦 import 它就会把它拽进 app 依赖图 —— 实测会把测试里 mock 掉的
// `topLevelWindow_ACU` 对象上的 AutoCardUpdaterAPI 直接替换掉，连带打挂无关用例。
(topLevelWindow_ACU as any).__ACU_API_GROUP_INDEX__ = ACU_API_GROUP_INDEX_ACU;

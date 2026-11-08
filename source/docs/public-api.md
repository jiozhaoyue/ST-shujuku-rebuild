# 对外 JavaScript API（`window.AutoCardUpdaterAPI`）

本插件向酒馆聊天内的其它脚本（酒馆助手脚本、正则注入脚本等）暴露一个全局 API 对象：
`window.AutoCardUpdaterAPI`。本文档只覆盖**公开稳定面**与本仓的差量增量；完整方法清单可在
插件内「开发者选项 → 环境与能力总览」实时查看（来自 API 注册表单一事实源，含门禁状态）。

## 命名空间总览（来自 `presentation/bootstrap/api-groups/`）

| 命名空间 | 内容 |
| --- | --- |
| `core-data` | 导入/导出 JSON、触发更新 |
| `table-crud` | `updateCell` / `updateRow` / `insertRow` / `deleteRow` |
| `sql` | `executeSqlQuery` / `executeSqlMutation` / `executeSqlBatch` / `executeSql` |
| `table-history` | 只读楼层历史快照导出 + 来源身份（本仓移植 AlbusKen PR #66） |
| `table-lock` / `data-admin` / `template-preset` / `plot-preset` / `worldbook-ai` / `agent-worldbook` / `callback` / `settings-config` / `performance-diagnostics` | 各功能域读写与回调注册 |

## `getTableHistoryContext()` —— 历史数据来源身份（2026-11-08 移植 AlbusKen PR #66）

同步读取当前历史数据来源身份，**零回放、零复制、零副作用**：

```javascript
const context = window.AutoCardUpdaterAPI.getTableHistoryContext();
// { version: 1, chatId: 'chat-a', characterId: 0, groupId: null, isolationKey: '' }
// 聊天尚未就绪时返回 null
```

- `isolationKey` 是数据库实际使用的当前隔离标识，空字符串是合法的默认槽。
- **来源身份不是内容修订**：调用者仍须自行检查存储帧变化、swipe 与自身布局/会话生命周期；
  非空结果也不保证历史基底完整，历史读取以 `exportTableSnapshotsAtMessages` 的结果为准。
- 适合状态栏、历史浏览器等外部调用者区分缓存来源。

## 写入接口的 `awaitFrontendReadback` 选项（2026-11-08 移植 AlbusKen PR #67）

以下写入型接口统一支持 `awaitFrontendReadback?: boolean`：

- `executeSqlMutation` / `executeSqlBatch` / 写入型 `executeSql`
- `updateCell` / `updateRow` / `insertRow` / `deleteRow`
- `importTableAsJson`（导入选项）

语义：

- **默认（不传 / 传 true）**：数据提交、持久化、世界书与运行时刷新、更新通知照常执行，
  通知后保留 800ms 前端回读窗口再返回——依赖 DOM 刷新完成的调用方应当保持默认。
- **仅显式传 `false`**：跳过该固定等待窗口；持久化与通知**并不**被跳过，
  与 `skipNotify` / `skipChatSave` 完全不是一回事。函数返回时界面可能尚未完成更新。
- 非布尔真值（`'false'`、`0`、`null`）一律视为默认等待，不做松散转换。

```javascript
await api.executeSqlBatch({
  sql: 'UPDATE inventory SET quantity = 2 WHERE row_id = 1;',
  awaitFrontendReadback: false,
});
await api.updateCell({
  tableName: '背包物品表', rowIndex: 1, colIdentifier: '数量', value: 2,
  awaitFrontendReadback: false,
});
await api.importTableAsJson(jsonString, { awaitFrontendReadback: false });
```

适用于自行处理刷新反馈、或由脚本侧再等待自身完成信号的调用者（例如脚本先写库、
再自己 `await` 一个渲染完成事件）。固定窗口本身不是"前端已完成"的确认机制。

## 兼容性说明

- 选项名与 AlbusKen/shujuku（龙血玄黄）的公开文档同名同义，跨仓脚本可直接复用；
  本仓内部实现经由 `refreshMergedDataAndNotifyWithUI_ACU` 的回读等待统一口径。
- `getTableHistoryContext` 在本仓返回的失败码集合与上游分叉（本仓无结构化回放失败点），
  见 `presentation/bootstrap/api-groups/table-history-api.ts` 头注。

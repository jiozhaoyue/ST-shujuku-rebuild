/**
 * write-statement-display — 语句（SQL / DSL / 结构化操作）的展示映射，单一事实源。
 *
 * 两个面板共用：「写库流水」（实时）与「历史楼层回放」（历史帧）。
 * 它们渲染的是**同一份** `WriteStatementStat_ACU`，因此徽章文案与配色必须只有一处定义，
 * 否则同一个操作在两边显示成不同的词 —— 正是「不得再造一套展示设施」要防的事。
 */
import type { WriteStatementDialect_ACU, WriteStatementOperation_ACU } from './useWritePipeline';

/** 与 `_lib/AcuBadge.vue` 的 `AcuBadgeVariant` 同构（此处不 import 组件，保持 composable 无组件依赖）。 */
export type StatementBadgeVariant_ACU = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const DIALECT_LABEL_ACU: Readonly<Record<WriteStatementDialect_ACU, string>> = Object.freeze({
  sql: 'SQL',
  dsl: 'DSL',
  structured: '结构化',
});

const OPERATION_LABEL_ACU: Readonly<Record<WriteStatementOperation_ACU, string>> = Object.freeze({
  insert: '新增',
  update: '更新',
  delete: '删除',
  replace: '整表替换',
  schema: '表结构',
  other: '其它',
});

export function dialectLabel_ACU(dialect: WriteStatementDialect_ACU): string {
  return DIALECT_LABEL_ACU[dialect] || String(dialect);
}

export function operationLabel_ACU(operation: WriteStatementOperation_ACU): string {
  return OPERATION_LABEL_ACU[operation] || String(operation);
}

export function dialectVariant_ACU(dialect: WriteStatementDialect_ACU): StatementBadgeVariant_ACU {
  if (dialect === 'sql') return 'accent';
  if (dialect === 'dsl') return 'warning';
  return 'neutral';
}

export function operationVariant_ACU(operation: WriteStatementOperation_ACU): StatementBadgeVariant_ACU {
  if (operation === 'insert') return 'success';
  if (operation === 'delete') return 'danger';
  if (operation === 'update') return 'warning';
  return 'neutral';
}

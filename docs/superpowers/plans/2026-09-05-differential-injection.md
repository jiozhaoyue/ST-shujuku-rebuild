# 差量注入（计划二）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 填表 prompt 的 `<当前表格数据>` 段按表订阅：热表带全量行数据，冷表只带 DDL+行数说明，降低 token 面与 AI 干扰；默认关闭，关闭时行为与 v9.2.0 逐字节一致。

**Architecture:** 热表信号 = 近期改动表（调用方供给）∪ 配置热表 − 配置冷表（纯函数解析）。冷表渲染**复用 `formatTableForSqliteMode` 的 DDL 权威链**（runtime effective schema > 模板 DDL，test31 列漂移防线），只新增 `coldProjection` 选项在行段前短路——绝不另写一套 DDL 提取。接入点为 `prepareAIInput_ACU` 的 SQL 分支（options 袋子供 `differentialInjection`），v1 不接设置 UI（计划五批量做），未接线时零行为变化。

**Tech Stack:** TypeScript + vitest；无新依赖。

**红线：** DDL 权威链零改动；SQL 白名单零改动；`targetSheetKeys` 显式请求路径不差量化；开关默认 false。

---

### Task 1: 热表解析器（纯函数）

**Files:**
- Create: `source/src/service/ai/prompt-builder/table-injection-scope.ts`
- Test: `source/tests/service/ai/table-injection-scope.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
/**
 * tests/service/ai/table-injection-scope.test.ts — 差量注入热表解析
 * hot = (recentTouched ∪ explicitHot) − explicitCold；cold 恒胜出。
 */
import { describe, it, expect } from 'vitest';
import { resolveDifferentialHotSheetKeys_ACU } from '../../../src/service/ai/prompt-builder/table-injection-scope';

describe('resolveDifferentialHotSheetKeys_ACU', () => {
  it('空输入 → 空集合', () => {
    expect(resolveDifferentialHotSheetKeys_ACU({}).size).toBe(0);
  });

  it('recentTouched 与 explicitHot 并集', () => {
    const hot = resolveDifferentialHotSheetKeys_ACU({
      recentTouchedSheetKeys: ['sheet_a'],
      hotSheetKeys: ['sheet_b'],
    });
    expect(hot.has('sheet_a')).toBe(true);
    expect(hot.has('sheet_b')).toBe(true);
  });

  it('explicitCold 压过 recent 与 hot', () => {
    const hot = resolveDifferentialHotSheetKeys_ACU({
      recentTouchedSheetKeys: ['sheet_a', 'sheet_c'],
      hotSheetKeys: ['sheet_b'],
      coldSheetKeys: ['sheet_a', 'sheet_b'],
    });
    expect(hot.has('sheet_a')).toBe(false);
    expect(hot.has('sheet_b')).toBe(false);
    expect(hot.has('sheet_c')).toBe(true);
  });

  it('重复键幂等；非法输入不抛错', () => {
    const hot = resolveDifferentialHotSheetKeys_ACU({
      recentTouchedSheetKeys: ['sheet_a', 'sheet_a'],
      hotSheetKeys: 'not-array' as any,
    });
    expect([...hot]).toEqual(['sheet_a']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd source && npx vitest run tests/service/ai/table-injection-scope.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现模块**

```ts
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
```

- [ ] **Step 4: 运行确认通过**（4 tests）

- [ ] **Step 5: Commit** `feat: 差量注入热表解析器（pure resolver，cold 恒胜出）`

---

### Task 2: coldProjection 渲染选项（复用 DDL 权威链）

**Files:**
- Modify: `source/src/service/ai/prompt-builder/prompt-prepare.ts`
  - `formatTableForSqliteMode` options 增加 `coldProjection?: boolean`
  - 在 `const effectiveAllRows = sourceRows;` 与空表分支之后插入冷表短路
- Test: 追加到 `source/tests/service/ai/prompt-prepare-sql-mode.test.ts`（该文件已具备全部 mock 环境）

- [ ] **Step 1: 写失败测试（追加 describe）**

```ts
describe('coldProjection 差量注入渲染', () => {
  const buildColdTable = (rows: unknown[][]) => ({
    uid: 'sheet_cold',
    name: '冷表测试',
    content: [['row_id', '物品名称', '数量'], ...rows],
    sourceData: { note: '背包物品', insertNode: '', updateNode: '', deleteNode: '' },
  });

  it('冷表：保留 DDL 与列头，省略全部行数据，标注行数', () => {
    const table = buildColdTable([
      ['治疗药水', 3],
      ['铁剑', 1],
    ]);
    const text = formatTableForSqliteMode(table, 0, 'sheet_cold', null, {
      allowSeedRowsFallback: false,
      coldProjection: true,
    });
    expect(text).toContain('CREATE TABLE');
    expect(text).toContain('未列为热表');
    expect(text).toContain('共 2 行');
    expect(text).not.toContain('-- 当前数据');
    expect(text).not.toContain('治疗药水');
  });

  it('空表不受冷表影响：保留初始化提示', () => {
    const table = buildColdTable([]);
    const text = formatTableForSqliteMode(table, 0, 'sheet_cold', null, {
      allowSeedRowsFallback: false,
      coldProjection: true,
    });
    expect(text).toContain('该表格为空，请进行初始化');
    expect(text).not.toContain('未列为热表');
  });
});
```

- [ ] **Step 2: 运行确认失败**（coldProjection 未定义，两个用例红）

- [ ] **Step 3: 实现**

`formatTableForSqliteMode` 的 options 类型加 `coldProjection?: boolean`；在空表早退分支之后插入：

```ts
    // [差量注入] 冷表投影：DDL 权威链（上方 resolve）已完整执行，只省略行数据段。
    // 保留 INSERT 能力与 schema 契约；冷表基于行内容的 UPDATE/DELETE 由提示引导跳过。
    if (options.coldProjection === true) {
        text += `-- 本轮未列为热表：共 ${effectiveAllRows.length} 行数据未列出，默认无变化。\n`;
        text += `-- INSERT 可直接执行；需要基于已有行内容的 UPDATE/DELETE 请跳过本表。\n\n`;
        return text;
    }
```

（位置：`if (effectiveAllRows.length === 0) { ... return text; }` 之后、`if (isUsingSeedRows)` 之前。）

- [ ] **Step 4: 运行确认通过**；并跑 `npx vitest run tests/service/ai/prompt-prepare-sql-mode.test.ts` 全文件确认既有用例零回退（缺省 coldProjection=undefined 走原路径）。

- [ ] **Step 5: Commit** `feat: formatTableForSqliteMode 支持 coldProjection 冷表投影（DDL 权威链复用）`

---

### Task 3: prepareAIInput_ACU 接线

**Files:**
- Modify: `source/src/service/ai/prompt-builder/prompt-prepare.ts`（SQL 分支）

- [ ] **Step 1: 接线**

文件头导入 `resolveDifferentialHotSheetKeys_ACU` 与类型；在表循环前解析一次：

```ts
    const differentialHotSheetKeys = resolveDifferentialHotSheetKeys_ACU(
        (options as any).differentialInjection,
    );
    const differentialEnabled = ((options as any).differentialInjection?.enabled === true);
```

SQL 分支内（`formatTableForSqliteMode` 调用处）把 `coldProjection` 传下去：

```ts
            tableDataText += formatTableForSqliteMode(table, tableIndex, sheetKey, _seedGuideDataForThisPrepare_ACU, {
                allowSeedRowsFallback: false,
                flightModeEnabled: flightMode.enabled,
                coldProjection: differentialEnabled
                    && !targetSheetKeys
                    && !differentialHotSheetKeys.has(sheetKey),
                ...(selectedPromptName as { authoredTableName?: string; runtimeTableName?: string }),
            });
```

（`targetSheetKeys` 显式请求路径恒全量——红线。）

- [ ] **Step 2: 全文件测试回归** `npx vitest run tests/service/ai/prompt-prepare-sql-mode.test.ts tests/service/ai/table-injection-scope.test.ts`

- [ ] **Step 3: Commit** `feat: prepareAIInput_ACU 接线差量注入（options.differentialInjection，缺省关闭零行为变化）`

---

### Task 4: 全量回归 + 计划收尾

- [ ] `npx tsc --noEmit` 通过
- [ ] `npx vitest run` 全量零回退（7592+ 基线；bench 环境超时除外）
- [ ] Commit 并合并记录到 dev/luker-adapt

**v2 待接线（不在本计划）：** `recentTouchedSheetKeys` 从批次账本供给；设置 UI 开关与热/冷表配置（计划五）；非 SQL 模式冷投影（上游模板非 SQL 面为零，延后）。

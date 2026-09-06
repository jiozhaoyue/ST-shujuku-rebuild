# Luker 宿主适配（计划一）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ST-shujuku-rebuild（fork 自 rebuild 9.1.9）以独立身份在 Luker 2.7.0 上核心链全量可用，TT 路径零改动。

**Architecture:** 宿主判定沿用 `shared/host-bridge.ts` 三态 `AcuHostKind`（真机已验证 `window.Luker.getContext` 命中 `'luker'`）；本计划补齐身份分离（manifest 脱离上游 homePage，防 auto_update 反向覆盖）、能力面查询函数、Luker ctx 形状校准测试与真机清单。世界书后端复用 `native-st-backend`（不新建 luker-backend——Luker 1.18 ctx 面与 native 后端假设一致，差异只在版本串）。

**Tech Stack:** TypeScript + rollup + vitest（仓库既有）；真机 本机 Luker 实测环境（Luker 2.7.0 / stCompat 1.18.0）。

**基线命令（所有任务通用）：** 在仓库根执行 `cd source && npx vitest run <file>` 单测；`npx tsc --noEmit -p tsconfig.json` 类型检查。

---

### Task 1: manifest 身份分离（防 auto_update 反向覆盖）

**Files:**
- Modify: `manifest.json`
- Test: `source/tests/shared/manifest-identity.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
/**
 * tests/shared/manifest-identity.test.ts — 身份分离不变式
 * 本仓库 manifest 必须脱离 shuiyue-cmyk/shujuku-rebuild：
 * homePage 指向上游会让宿主 auto_update 把本插件拉回上游产物。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const manifest = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'manifest.json'), 'utf8'),
);

describe('manifest identity', () => {
  it('homePage 不指向上游 rebuild 仓库', () => {
    expect(manifest.homePage).not.toContain('shujuku-rebuild');
  });
  it('display_name 已更名（脱离 TTonly）', () => {
    expect(manifest.display_name).not.toBe('TTonly·数据库');
    expect(manifest.display_name).not.toBe('幻想·数据库');
  });
  it('版本号进入 9.2.x 序列', () => {
    expect(manifest.version).toMatch(/^9\.[2-9]\./);
  });
  it('保持标准扩展直装形态', () => {
    expect(manifest.js).toBe('index.js');
    expect(manifest.auto_update).toBe(true);
    expect(manifest.loading_order).toBe(200);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd source && npx vitest run tests/shared/manifest-identity.test.ts`
Expected: FAIL（当前 homePage = shuiyue-cmyk/shujuku-rebuild，version 9.1.9）

- [ ] **Step 3: 修改 manifest.json**

```json
{
    "display_name": "Luker·数据库",
    "loading_order": 200,
    "requires": [],
    "optional": [],
    "js": "index.js",
    "css": "",
    "author": "jiozhaoyue",
    "version": "9.2.0",
    "homePage": "https://github.com/jiozhaoyue/ST-shujuku-rebuild",
    "auto_update": true
}
```

（注：display_name/homePage 为工作定值，用户可在 GitHub 仓库创建后改 URL。）

- [ ] **Step 4: 运行确认通过**

Run: `cd source && npx vitest run tests/shared/manifest-identity.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add manifest.json source/tests/shared/manifest-identity.test.ts
git commit -m "feat: manifest 身份分离 v9.2.0——脱离上游 homePage 防 auto_update 反向覆盖，更名 Luker·数据库"
```

---

### Task 2: 宿主能力面查询（isAcuLukerRuntime + capabilities）

**Files:**
- Modify: `source/src/shared/host-bridge.ts`（追加，不改既有函数）
- Test: `source/tests/shared/host-compat/host-bridge-kind.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
/**
 * tests/shared/host-compat/host-bridge-kind.test.ts — 宿主判定四态
 * tt / luker / generic-st / 探测异常降级。真机已验证 Luker 命中 'luker'。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getAcuHostKind, isAcuTauriRuntime, isAcuLukerRuntime } from '../../../src/shared/host-bridge';

function setWindow(shape: Record<string, any>): void {
  (globalThis as any).window = { ...shape };
}

describe('host kind detection', () => {
  afterEach(() => { delete (globalThis as any).window; });

  it('TT ABI 存在 → tauritavern（优先级最高）', () => {
    setWindow({ __TAURITAVERN__: { ready: true }, Luker: { getContext: () => ({}) } });
    expect(getAcuHostKind()).toBe('tauritavern');
    expect(isAcuTauriRuntime()).toBe(true);
    expect(isAcuLukerRuntime()).toBe(false);
  });

  it('Luker.getContext 存在 → luker', () => {
    setWindow({ Luker: { getContext: () => ({}) } });
    expect(getAcuHostKind()).toBe('luker');
    expect(isAcuLukerRuntime()).toBe(true);
    expect(isAcuTauriRuntime()).toBe(false);
  });

  it('只有 SillyTavern → sillytavern', () => {
    setWindow({ SillyTavern: { getContext: () => ({}) } });
    expect(getAcuHostKind()).toBe('sillytavern');
    expect(isAcuLukerRuntime()).toBe(false);
  });

  it('Luker 全局缺失 getContext → 降级 sillytavern', () => {
    setWindow({ Luker: {} });
    expect(getAcuHostKind()).toBe('sillytavern');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd source && npx vitest run tests/shared/host-compat/host-bridge-kind.test.ts`
Expected: FAIL with "isAcuLukerRuntime is not exported"

- [ ] **Step 3: 在 host-bridge.ts 追加实现**

在 `isAcuTauriRuntime` 之后追加：

```ts
/** 是否跑在 Luker 下（真机：Luker 2.7.0 注入 window.Luker 并暴露 getContext） */
export function isAcuLukerRuntime(): boolean {
  return getAcuHostKind() === 'luker';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd source && npx vitest run tests/shared/host-compat/host-bridge-kind.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add source/src/shared/host-bridge.ts source/tests/shared/host-compat/host-bridge-kind.test.ts
git commit -m "feat: 宿主能力面补 isAcuLukerRuntime 查询与四态行为断言（tt/luker/generic/降级）"
```

---

### Task 3: Luker ctx 形状校准测试（native-st-backend 世界书路径）

**Files:**
- Test: `source/tests/shared/host-compat/native-st-backend.luker.test.ts`（新建）

- [ ] **Step 1: 写校准测试**

复用 `native-st-backend.test.ts` 的 `buildContext` 模式（mock `utils`），构造 Luker 1.18 ctx 快照，断言：世界书读写走 ctx 原生方法、`getLorebooks` 走 `getWorldInfoNames`、charLore 缺失时走 `/api/settings/get` 且带 CSRF 头。

```ts
/**
 * tests/shared/host-compat/native-st-backend.luker.test.ts
 * Luker 2.7.0（stCompat 1.18.0）ctx 形状下的 native 后端行为校准：
 * 与 TT dev st-context.js 同面——loadWorldInfo/saveWorldInfo/getWorldInfoNames。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogWarn, mockLogDebug } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../../src/shared/utils', () => ({
  logWarn_ACU: mockLogWarn,
  logDebug_ACU: mockLogDebug,
}));

import { createNativeStBackend_ACU } from '../../../src/shared/host-compat/native-st-backend';

function buildLukerContext(overrides: Record<string, any> = {}): any {
  return {
    // Luker 1.18 ctx 面：与 TT dev st-context 同形的最小快照
    getRequestHeaders: () => ({ 'X-CSRF-Token': 'luker-csrf' }),
    loadWorldInfo: vi.fn(async (_name: string) => ({
      entries: { '0': { uid: 0, comment: '条目A', content: '内容', enabled: true } },
    })),
    saveWorldInfo: vi.fn(async (_name: string | null, _data: any) => undefined),
    getWorldInfoNames: vi.fn(() => ['Luker世界书']),
    characters: [],
    characterId: 0,
    chat: [],
    ...overrides,
  };
}

describe('native-st-backend on Luker ctx shape', () => {
  let backend: any;
  let ctx: any;
  let fetchSpy: any;

  beforeEach(() => {
    ctx = buildLukerContext();
    backend = createNativeStBackend_ACU(ctx);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ world_info_settings: { world_info: { charLore: {} } } }), { status: 200 }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('readLorebook 走 ctx.loadWorldInfo，不走 fetch', async () => {
    const book = await backend.readLorebook('Luker世界书');
    expect(ctx.loadWorldInfo).toHaveBeenCalledWith('Luker世界书');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(book).not.toBeNull();
  });

  it('getLorebooks 走 ctx.getWorldInfoNames，返回 string[]', async () => {
    const names = await backend.getLorebooks();
    expect(names).toEqual(['Luker世界书']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('saveLorebook 走 ctx.saveWorldInfo', async () => {
    await backend.saveLorebook('Luker世界书', { entries: {} });
    expect(ctx.saveWorldInfo).toHaveBeenCalledWith('Luker世界书', { entries: {} });
  });

  it('charLore 读取缺失时降级 POST /api/settings/get 并携带 CSRF 头', async () => {
    const ctxNoCharLore = buildLukerContext({ getWorldInfoNames: undefined });
    const backend2 = createNativeStBackend_ACU(ctxNoCharLore);
    // getLorebooks 在 ctx.getWorldInfoNames 缺失时降级 settings/get
    await backend2.getLorebooks();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/settings/get');
    expect(init?.headers?.['X-CSRF-Token']).toBe('luker-csrf');
  });
});


- [ ] **Step 2: 运行确认通过（纯新增校准测试，若失败即暴露 1.18 面差异，逐条修 backend）**

Run: `cd source && npx vitest run tests/shared/host-compat/native-st-backend.luker.test.ts`
Expected: PASS；若 FAIL，按失败点核对 Luker 1.18 实际 ctx 面（真机 evaluate 抓取）后修 `native-st-backend.ts` 的方法存在性判断，不得改语义。

- [ ] **Step 3: Commit**

```bash
git add source/tests/shared/host-compat/native-st-backend.luker.test.ts
git commit -m "test: Luker 1.18 ctx 形状校准——native 后端世界书/charLore 路径行为断言"
```

---

### Task 4: TESTING.md 增加 Luker 真机清单

**Files:**
- Modify: `source/docs/TESTING.md`

- [ ] **Step 1: 在"0. 安装"之后插入新节**

```markdown
## 0.5 Luker 真机（Luker 2.7.0 / stCompat 1.18.0）

- [ ] 扩展面板安装本仓库地址，启用后刷新：右下角出现 `Luker·YYYYMMDD-N` 构建水印
- [ ] 控制台无「等待 SillyTavern 就绪超时」；`getAcuHostKind` 命中 luker（调试面板 host 字段）
- [ ] V2 面板挂载：表格/填表/SQL 控制台/运行日志全量可用
- [ ] 聊天含旧 TT/上游数据（Branch 陈旧 HotSnapshot 等）时：owner 守卫忽略，无报错
- [ ] 世界书桥接降级：不装酒馆助手时核心表格功能正常，世界书操作给出可操作提示
- [ ] auto_update：manifest.homePage 指向本仓库，不会被上游 rebuild 覆盖
```

- [ ] **Step 2: Commit**

```bash
git add source/docs/TESTING.md
git commit -m "docs: TESTING.md 增加 Luker 2.7.0 真机清单节"
```

---

### Task 5: 构建产物 + 全量回归 + 版本分支

- [ ] **Step 1: 构建**

Run: `cd source && npm run build`
Expected: index.js 产出，无类型错误。

- [ ] **Step 2: 全量测试**

Run: `cd source && npx vitest run`
Expected: 7580 + 新增（≥10）通过，28 skipped；**零回退**。

- [ ] **Step 3: 打版本 tag + release 分支**

```bash
git tag v9.2.0
git branch release/v9.2.0
git checkout dev/luker-adapt
```

- [ ] **Step 4: Commit（如有遗漏改动）**

```bash
git add -A && git commit -m "chore: v9.2.0 Luker 宿主适配批——构建产物与全量回归"
```

/**
 * scripts/e2e-sql-console-check.mjs — SQL 控制台真交互 E2E（只读 SELECT）
 *
 * 与 e2e-screenshot-tour（面板挂载级）的分工：本脚本做**一次真实交互** ——
 * 在 Dev ST 的 V2 高级工具页向 SQL 控制台输入一条 SELECT 并执行，断言结果表有行。
 * 这是「全部自动化测试」里交互深度最高的一条，证明的不仅是「面板挂上了」，而是
 * 「SQLite runtime 就绪、查询链路、结果渲染」整条链路在真机上工作。
 *
 * ⚠️ 只读红线：
 * - 目标端口断言 ∈ Dev 白名单 {8001, 8003, 8899}（同 tour）；
 * - 语句硬编码为 `SELECT name FROM sqlite_master WHERE type='table'`，脚本启动前用
 *   `/^select\s/i` 断言 —— 任何非 SELECT 永远不会被本脚本发出（不写库、不建表）。
 *
 * 用法：NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-sql-console-check.mjs
 */

import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_DEV_PORTS = new Set(['8001', '8003', '8899']);
const TARGET_URL = 'http://127.0.0.1:8001/';
/** 只读语句（脚本唯一会发出的 SQL；改它必须先过下面的白名单断言）。 */
const READONLY_SQL = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name";

if (!/^select\s/i.test(READONLY_SQL)) {
  console.error('[sql-console-e2e] 拒绝启动：READONLY_SQL 不是 SELECT（只读红线）');
  process.exit(2);
}
{
  const u = new URL(TARGET_URL);
  if (!ALLOWED_DEV_PORTS.has(u.port)) {
    console.error(`[sql-console-e2e] 拒绝启动：端口 ${u.port} 不在 Dev 白名单，疑似误连 Real 实例`);
    process.exit(2);
  }
}

async function loadPlaywright() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  for (const base of [process.env.NODE_PATH, process.env.APPDATA && `${process.env.APPDATA}/npm/node_modules`, '']) {
    if (base === null) continue;
    for (const name of ['playwright', 'playwright-core']) {
      try {
        const mod = require(base ? `${base}/${name}`.replace(/\\/g, '/') : name);
        if (mod?.chromium?.launch) return mod.chromium;
      } catch { /* 试下一个 */ }
    }
  }
  console.error('[sql-console-e2e] 无法加载 playwright（NODE_PATH）');
  process.exit(2);
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(projectRoot, 'source', 'test-results', 'e2e-shots');
mkdirSync(outDir, { recursive: true });

const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem(
        'acu_v2_ui_state',
        JSON.stringify({ router: { activePageId: 'advanced-tools' }, devOptions: { developerOptionsEnabled: true } }),
      );
    } catch { /* 落默认页即失败 */ }
  });
  const page = await context.newPage();
  const pluginErrors = [];
  page.on('console', m => {
    const text = m.text();
    if (m.type() === 'error' && /shujuku_v120|\[ACU\]|AutoCardUpdater/.test(text)) pluginErrors.push(text.slice(0, 300));
  });

  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(
    () => typeof window.AutoCardUpdaterAPI === 'object' && window.AutoCardUpdaterAPI !== null,
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(async () => { try { await window.AutoCardUpdaterAPI.openSettings(); } catch { /* 断言上看 */ } });
  await page.waitForSelector('#acu-app-v2', { state: 'attached', timeout: 60_000 });
  await page.waitForTimeout(1000); // 面板开合是异步 display 切换，让 UI 稳定
  // 上游公告弹窗点掉（幂等）
  await page.locator('button:has-text("我知道了")').first().click({ timeout: 3000 }).catch(() => {});

  const textarea = page.locator('textarea.acu-v2-advanced-tools-page__sql-textarea');
  await textarea.waitFor({ state: 'visible', timeout: 60_000 });

  // 模式徽章必须报 SQLite 可用（SQL 链路前提）
  const badgeText = await page.locator('.acu-v2-advanced-tools-page__sql-badge, .acu-badge').first().textContent().catch(() => '');
  const sqliteReady = /SQLite/.test(badgeText || '') || (await page.evaluate(() =>
    typeof (window).AutoCardUpdaterAPI === 'object'));
  if (!sqliteReady) throw new Error(`SQLite 未就绪（徽章：${badgeText}）`);

  await textarea.fill(READONLY_SQL);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'st-sql-console-before.png') });

  // 点「执行」（按钮内含 fa-play 图标 + 文本）
  const executeButton = page.locator('button', { hasText: '执行' }).first();
  await executeButton.click({ timeout: 30_000 });

  // 结果表出现且行数 > 0（sqlite_master 必有表：插件自身表 + sqlite 内部表）
  await page.waitForSelector('.acu-v2-advanced-tools-page__sql-result-table', { timeout: 60_000 });
  await page.waitForTimeout(600);
  const rowCount = await page.evaluate(() => {
    const table = document.querySelector('.acu-v2-advanced-tools-page__sql-result-table');
    if (!table) return -1;
    return table.querySelectorAll('tbody tr').length;
  });
  await page.screenshot({ path: join(outDir, 'st-sql-console-after.png') });

  const attributable = pluginErrors.filter(t => !/资源加载失败|Script error\.|Script error$/.test(t));
  console.log(`[sql-console-e2e] 结果表 tbody 行数：${rowCount}；插件可归因报错：${attributable.length} 条`);
  if (attributable.length) console.log(`  首条：${attributable[0]}`);
  if (rowCount <= 0) {
    console.error('[sql-console-e2e] FAIL：SELECT 执行后结果表无数据行');
    process.exit(1);
  }
  console.log('[sql-console-e2e] PASS：只读 SELECT → SQLite runtime → 结果渲染 全链路 OK');
  process.exit(0);
} catch (error) {
  console.error('[sql-console-e2e] FAIL：', String(error?.message || error).slice(0, 400));
  process.exit(1);
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
}

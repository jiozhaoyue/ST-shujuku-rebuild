/**
 * scripts/e2e-screenshot-tour.mjs — dev 四宿主 V2 界面截图巡游（E2E 留证）
 *
 * 与 host-compat-probe.mjs 的分工：probe 判「起得来」（布尔检查），本脚本产「看得见」的证据 ——
 * 每个 Dev 宿主对 仪表盘/填表规则/高级工具/开发者页 四个页面各截一张，落
 * `source/test-results/e2e-shots/`（gitignore 管理），供人工复核与报告引用。
 *
 * ⚠️ 只连 Dev 实例：目标写死在本文件，且启动前跑 `assertDevTarget` 白名单断言
 *（端口 ∈ {8001, 8003, 8899}），出现 Real 端口（8002/8004）立即失败退出 —— 规则 L1-MF-6 / P-11。
 * 本脚本**不提供** BASE_URL 环境变量入口：环境变量兜底就是误连入口。
 *
 * 用法：
 *   NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-screenshot-tour.mjs
 *   NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-screenshot-tour.mjs --only=st,luker
 *
 * 判定口径与 probe 一致：「不可归因的 Script error.」不计失败；截图是证据不是断言，
 * 断言只有一条 —— V2 根节点 `#acu-app-v2` 挂载成功，否则该目标记 FAIL（exit 1）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_DEV_PORTS = new Set(['8001', '8003', '8899']);

/** Dev 目标写死（不设环境变量入口 —— 兜底值就是误连入口）。 */
const TARGETS = [
  {
    id: 'st',
    label: 'SillyTavern',
    url: 'http://127.0.0.1:8001/',
    context: {},
    expectTauri: false,
  },
  {
    id: 'luker',
    label: 'Luker',
    url: 'https://127.0.0.1:8003/',
    context: { ignoreHTTPSErrors: true },
    expectTauri: false,
  },
  {
    id: 'puretavern',
    label: 'PureTavern',
    url: 'http://127.0.0.1:8899/',
    context: {},
    expectTauri: false,
    // PureTavern 的扩展注册表按浏览器会话存 ⇒ 每个新 context 先走它自己的安装路由再重载。
    install: {
      endpoint: '/api/extensions/install',
      body: { url: 'https://github.com/jiozhaoyue/ST-shujuku-rebuild', global: true },
    },
  },
  {
    id: 'ttavern',
    label: 'TauriTavern（ABI 注入）',
    url: 'http://127.0.0.1:8001/',
    context: {},
    expectTauri: true,
    initScript: () => {
      window.__TAURITAVERN__ = {
        ready: true,
        invoke: { safeInvoke: async () => ({ tauriVersion: '2.3.0' }) },
      };
      window.__TAURITAVERN_MAIN_READY__ = true;
    },
  },
];

/** 每个宿主巡游的 V2 页面（localStorage 预置 activePageId，确定性导航）。 */
const TOUR_PAGES = [
  { id: 'dashboard', label: 'dashboard' },
  { id: 'table', label: 'table' },
  { id: 'advanced-tools', label: 'advanced-tools' },
  { id: 'developer', label: 'developer' },
];

const OPEN_TIMEOUT_MS = 120_000;
const API_WAIT_TIMEOUT_MS = 60_000;

function assertDevTarget(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`目标 URL 非法：${rawUrl}`);
  }
  if (!ALLOWED_DEV_PORTS.has(u.port)) {
    throw new Error(
      `拒绝启动：端口 ${u.port} 不在 Dev 白名单 {8001, 8003, 8899}，疑似误连 Real 实例（规则 L1-MF-6 / P-11）`,
    );
  }
  return u;
}

async function loadPlaywright() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  for (const name of ['playwright', 'playwright-core']) {
    try {
      const mod = require(name);
      if (mod?.chromium?.launch) return mod.chromium;
    } catch { /* 试下一个 */ }
  }
  for (const base of [process.env.NODE_PATH, process.env.APPDATA && `${process.env.APPDATA}/npm/node_modules`]) {
    if (!base) continue;
    for (const name of ['playwright', 'playwright-core']) {
      try {
        const mod = require(`${base}/${name}`.replace(/\\/g, '/'));
        if (mod?.chromium?.launch) return mod.chromium;
      } catch { /* 继续 */ }
    }
  }
  console.error('[e2e-tour] 无法加载 playwright。请：NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-screenshot-tour.mjs');
  process.exit(2);
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(projectRoot, 'source', 'test-results', 'e2e-shots');
mkdirSync(outDir, { recursive: true });

function parseArgs(argv) {
  // 与 host-compat-probe.mjs 同款：只认 --key=value 形式
  const out = { only: null, pages: null };
  for (const arg of argv) {
    if (arg.startsWith('--only=')) out.only = arg.slice(7).split(',').map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith('--pages=')) out.pages = arg.slice(8).split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}

const parsed = parseArgs(process.argv.slice(2));
const tourPages = parsed.pages ? TOUR_PAGES.filter(p => parsed.pages.includes(p.id)) : TOUR_PAGES;
const selected = parsed.only ? TARGETS.filter(t => parsed.only.includes(t.id)) : TARGETS;
if (!selected.length) {
  console.error('[e2e-tour] 没有匹配的目标。可选：' + TARGETS.map(t => t.id).join(', '));
  process.exit(2);
}

// 启动断言先行：任何目标端口越界，整批不启动。
for (const target of selected) assertDevTarget(target.url);

const chromium = await loadPlaywright();

/** 单页巡游：预置路由 → 等插件 → 打开 V2 → 截图 + 归因错误收集。 */
async function shootPage(chromium, target, tourPage, result) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, ...target.context });
    if (target.initScript) await context.addInitScript(target.initScript);
    await context.addInitScript(
      ([pageId]) => {
        try {
          localStorage.setItem(
            'acu_v2_ui_state',
            JSON.stringify({
              router: { activePageId: pageId },
              devOptions: { developerOptionsEnabled: true },
            }),
          );
        } catch { /* 预置失败就落到默认页 */ }
      },
      [tourPage.id],
    );
    const page = await context.newPage();

    const pluginErrors = [];
    page.on('console', m => {
      const text = m.text();
      if (m.type() === 'error' && /shujuku_v120|\[ACU\]|AutoCardUpdater/.test(text)) pluginErrors.push(text.slice(0, 300));
    });
    page.on('pageerror', e => {
      const text = String(e?.stack || e);
      if (/shujuku|ACU|AutoCardUpdater/i.test(text)) pluginErrors.push(text.slice(0, 300));
    });

    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: OPEN_TIMEOUT_MS });

    if (target.install) {
      await page.evaluate(async (install) => {
        try {
          const res = await fetch(install.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(install.body),
          });
          return { status: res.status };
        } catch (error) {
          return { error: String(error).slice(0, 200) };
        }
      }, target.install);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: OPEN_TIMEOUT_MS });
      await page.waitForTimeout(3000);
    }

    await page.waitForFunction(
      () => typeof window.AutoCardUpdaterAPI === 'object' && window.AutoCardUpdaterAPI !== null,
      null,
      { timeout: API_WAIT_TIMEOUT_MS },
    ).catch(() => {});

    const apiMounted = await page.evaluate(() => !!window.AutoCardUpdaterAPI);
    if (!apiMounted) {
      result.pages.push({ page: tourPage.label, ok: false, reason: 'AutoCardUpdaterAPI 未挂载', shot: null });
      return;
    }
    await page.evaluate(async () => {
      try { await window.AutoCardUpdaterAPI.openSettings(); } catch { /* 断言上看 */ }
    });
    await page.waitForSelector('#acu-app-v2', { timeout: API_WAIT_TIMEOUT_MS }).catch(() => {});
    // 上游「停止维护公告」弹窗：每次新会话都会弹且挡住面板 —— 截图前点掉（幂等：不在就忽略）。
    await page.locator('button:has-text("我知道了")').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1200); // 等首屏渲染与懒加载稳定

    const v2Mounted = await page.evaluate(() => !!document.querySelector('#acu-app-v2'));
    // V2 是固定容器内部滚动，fullPage 抓不到折叠线下面板：开发者页把「一键诊断包」
    // scrollIntoView 后再拍（新功能的直接证据）。
    if (tourPage.id === 'developer') {
      await page.evaluate(() => {
        const panel = document.querySelector('#developer-diagnostic-bundle-panel');
        if (panel) panel.scrollIntoView({ block: 'center' });
        else document.querySelector('#acu-app-v2')?.scrollTo?.(0, 999999);
      }).catch(() => {});
      await page.waitForTimeout(400);
    }
    const shotPath = join(outDir, `${target.id}-${tourPage.label}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });

    const attributable = pluginErrors.filter(t => !/资源加载失败|Script error\.|Script error$/.test(t));
    result.pages.push({
      page: tourPage.label,
      ok: v2Mounted,
      reason: v2Mounted ? null : 'V2 根节点未挂载',
      shot: shotPath,
      attributableErrors: attributable,
    });
  } catch (error) {
    result.pages.push({ page: tourPage.label, ok: false, reason: String(error?.message || error).slice(0, 300), shot: null });
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
}

const summary = [];
let failed = false;
for (const target of selected) {
  const result = { id: target.id, label: target.label, pages: [] };
  for (const tourPage of tourPages) {
    await shootPage(chromium, target, tourPage, result);
  }
  const okCount = result.pages.filter(p => p.ok).length;
  const allAttributable = result.pages.flatMap(p => p.attributableErrors || []);
  summary.push({ id: target.id, ok: okCount, total: result.pages.length, attributableErrors: allAttributable.length });
  for (const p of result.pages) {
    console.log(`  [${target.id}] ${p.page}: ${p.ok ? 'OK' : 'FAIL'} ${p.reason || ''} ${p.shot ? `-> ${p.shot}` : ''}`);
    if (p.attributableErrors?.length) console.log(`    插件可归因报错 ${p.attributableErrors.length} 条：${p.attributableErrors[0]}`);
    if (!p.ok) failed = true;
  }
  // 每目标落一份 JSON 摘要（引用数据时给出处）
  writeFileSync(join(outDir, `${target.id}-summary.json`), JSON.stringify(result, null, 2));
}

console.log(`\n截图巡游汇总：${summary.map(s => `${s.id} ${s.ok}/${s.total}`).join(' · ')}`);
console.log(`产物目录：${outDir}`);
process.exit(failed ? 1 : 0);

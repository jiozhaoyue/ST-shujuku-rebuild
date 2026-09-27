/**
 * scripts/host-compat-probe.mjs — 四宿主实例兼容自动化探测
 *
 * 目的：把 `docs/TESTING.md` 里「四个宿主都要手工过一遍」的前几条（扩展是否被注入、
 * 公开 API 是否挂载、V2 界面是否起来、有没有插件自身的报错）变成**一条命令可复跑**的自动化。
 *
 * 四个目标（对应四种宿主）：
 *   st         http://127.0.0.1:8001   SillyTavern（Dev）
 *   luker      https://127.0.0.1:8003  Luker（Dev，自签证书）
 *   puretavern http://127.0.0.1:8899   PureTavern（Dev web）
 *   ttavern    http://127.0.0.1:8001   TauriTavern —— 桌面壳无法在 CI 里起，
 *                                      改为**在真机 ST 页注入 TT 的 ABI 全局**
 *                                      （`__TAURITAVERN__` / `__TAURITAVERN_MAIN_READY__`），
 *                                      真实走通宿主判定与 TT 分支。这是 ABI 层面的等价物，
 *                                      不是「假装成 TT」—— 插件能观察到的差异面就是这些全局。
 *
 * ⚠️ 只连 Dev 实例。**严禁**把 Real 端口（8002 / 8004）填进来（规则 L0-13 / P-11）。
 *
 * 依赖：Playwright（本机为全局安装）。若解析不到，脚本以退出码 2 明确报缺，不静默跳过。
 *   NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/host-compat-probe.mjs
 *
 * 用法：
 *   node scripts/host-compat-probe.mjs                 # 全部目标
 *   node scripts/host-compat-probe.mjs --only=st,luker # 只跑指定目标
 *   node scripts/host-compat-probe.mjs --json          # 只输出 JSON（便于管道消费）
 */

const TARGETS = [
  {
    id: 'st',
    label: 'SillyTavern',
    url: 'http://127.0.0.1:8001/',
    context: {},
    expect: { tauri: false, luker: false },
  },
  {
    id: 'luker',
    label: 'Luker',
    url: 'https://127.0.0.1:8003/',
    context: { ignoreHTTPSErrors: true },
    expect: { tauri: false, luker: true },
  },
  {
    id: 'puretavern',
    label: 'PureTavern',
    url: 'http://127.0.0.1:8899/',
    context: {},
    // PureTavern 是 ST 兼容宿主：必须落到通用分支，不能被自有标记带偏
    expect: { tauri: false, luker: false },
  },
  {
    id: 'ttavern',
    label: 'TauriTavern（ABI 注入）',
    url: 'http://127.0.0.1:8001/',
    context: {},
    expect: { tauri: true, luker: false },
    initScript: () => {
      window.__TAURITAVERN__ = {
        ready: true,
        invoke: { safeInvoke: async () => ({ tauriVersion: '2.3.0' }) },
      };
      window.__TAURITAVERN_MAIN_READY__ = true;
    },
  },
];

const OPEN_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 300_000;

function parseArgs(argv) {
  const out = { only: null, json: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--only=')) out.only = arg.slice(7).split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--json') out.json = true;
  }
  return out;
}

async function loadPlaywright() {
  // 用 CJS require 加载：NODE_PATH 只对 require 生效，ESM 的 import 不认它
  // （与 scripts/smoke-hosted.mjs 加载 jquery 同一手法）。
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const candidates = ['playwright', 'playwright-core'];
  for (const name of candidates) {
    try {
      const mod = require(name);
      if (mod?.chromium?.launch) return mod.chromium;
    } catch { /* 试下一个 */ }
  }
  // 全局安装（NODE_PATH）也试一次显式路径，避免调用方忘了设环境变量时无从下手
  for (const base of [process.env.NODE_PATH, process.env.APPDATA && `${process.env.APPDATA}/npm/node_modules`]) {
    if (!base) continue;
    for (const name of candidates) {
      try {
        const mod = require(`${base}/${name}`.replace(/\\/g, '/'));
        if (mod?.chromium?.launch) return mod.chromium;
      } catch { /* 继续 */ }
    }
  }
  console.error('[host-compat-probe] 无法加载 playwright。请让 node 能解析到它，例如：');
  console.error('  NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/host-compat-probe.mjs');
  console.error('  或 npm i -D playwright（仅开发环境，不影响扩展分发）');
  process.exit(2);
}

/**
 * 把插件前缀的报错分成「可归因」与「不可归因」两类。
 *
 * 为什么必须分：插件的全局未捕获处理器把 `[shujuku_v120] [全局] 未捕获异常: …` 打进控制台，
 * 但**跨源脚本抛的错只会得到一句 `Script error.`**（浏览器脱敏），宿主上其它扩展抛错也会被
 * 这个全局处理器捕获并冠上插件前缀。把这类不透明错误当硬失败会让探测器**恒红且无从修**。
 * 因此：有真实消息的算失败，只有「资源加载失败 / Script error.」字样的记入 notes。
 */
function classifyPluginErrors(messages) {
  const opaquePattern = /资源加载失败|Script error\.|Script error$/;
  return messages.map(text => ({ text, attributable: !opaquePattern.test(text) }));
}

/** 跑一个目标，返回结构化报告（不抛错：失败也是一种报告）。 */
async function probeTarget(chromium, target) {
  const report = {
    id: target.id,
    label: target.label,
    url: target.url,
    status: 'unknown',
    checks: {},
    panels: [],
    pluginErrors: [],
    notes: [],
  };
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...target.context });
    if (target.initScript) await context.addInitScript(target.initScript);
    const page = await context.newPage();

    const pluginErrors = [];
    const pageErrors = [];
    page.on('console', m => {
      const text = m.text();
      if (m.type() === 'error' && /shujuku_v120|\[ACU\]|AutoCardUpdater/.test(text)) pluginErrors.push(text.slice(0, 300));
    });
    page.on('pageerror', e => pageErrors.push(String(e?.stack || e).slice(0, 400)));

    const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: OPEN_TIMEOUT_MS });
    report.checks.httpStatus = response ? response.status() : null;

    // ① 宿主全局探测（与实现无关）
    report.checks.hostGlobals = await page.evaluate(() => ({
      sillyTavern: typeof window.SillyTavern,
      luker: typeof window.Luker,
      tauriTavern: typeof window.__TAURITAVERN__,
      pureTavern: typeof window.__PURE_TAVERN__,
    }));

    // ② 插件产物注入（判据用「脚本 URL 里的仓名」，不依赖某一侧的内部 id）
    await page.waitForFunction(
      () => typeof window.AutoCardUpdaterAPI === 'object' && window.AutoCardUpdaterAPI !== null,
      null,
      { timeout: READY_TIMEOUT_MS },
    ).catch(() => {});
    report.checks.pluginScriptInjected = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).some(s => /shujuku/i.test(s.getAttribute('src') || '')));
    report.checks.apiMethodCount = await page.evaluate(() =>
      window.AutoCardUpdaterAPI ? Object.keys(window.AutoCardUpdaterAPI).length : 0);
    report.checks.extensionDiscoverable = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/extensions/discover');
        if (!res.ok) return false;
        const list = await res.json();
        return Array.isArray(list) && list.some(e => /shujuku/i.test(e?.name || ''));
      } catch { return false; }
    });

    // ③ 打开 V2 界面并读面板标题
    if (typeof (await page.evaluate(() => typeof window.AutoCardUpdaterAPI?.openSettings)) === 'string') {
      await page.evaluate(async () => { try { await window.AutoCardUpdaterAPI.openSettings(); } catch { /* 记在下方断言上 */ } });
      await page.waitForSelector('.acu-panel', { timeout: READY_TIMEOUT_MS }).catch(() => {});
      report.panels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.acu-panel__title')).map(e => e.textContent?.trim()).filter(Boolean));
      report.checks.v2RootMounted = await page.evaluate(() => !!document.querySelector('#acu-app-v2'));
      report.checks.menuItemMounted = await page.evaluate(() =>
        !!document.querySelector('#acu-v2-menu-item, #acu-v2-menu-container'));
    }

    report.pluginErrors = classifyPluginErrors(pluginErrors);
    report.pageErrors = pageErrors;
    report.status = 'ok';
  } catch (error) {
    report.status = 'error';
    report.notes.push(String(error?.message || error).slice(0, 400));
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
  return report;
}

/** 把报告判成 PASS / FAIL，并给出可读理由。 */
function verdict(report, target) {
  const reasons = [];
  const c = report.checks || {};
  if (report.status !== 'ok') reasons.push('探测过程异常：' + (report.notes[0] || ''));
  if (c.httpStatus && c.httpStatus >= 400) reasons.push(`首页 HTTP ${c.httpStatus}`);
  if (!c.pluginScriptInjected) reasons.push('页面未注入插件脚本');
  if (!c.apiMethodCount) reasons.push('AutoCardUpdaterAPI 未挂载');
  if (c.v2RootMounted === false) reasons.push('V2 界面根节点未挂载');
  const attributable = (report.pluginErrors || []).filter(e => e.attributable);
  if (attributable.length) reasons.push(`插件自身报错 ${attributable.length} 条：${attributable[0].text.slice(0, 120)}`);
  // 宿主判定：TT 注入目标必须被认出 TT；其余目标都不得被认成 TT
  const globals = c.hostGlobals || {};
  if (target.expect.tauri && globals.tauriTavern !== 'object') reasons.push('未检测到 __TAURITAVERN__ ABI');
  if (!target.expect.tauri && globals.tauriTavern === 'object') reasons.push('意外检测到 __TAURITAVERN__');
  if (target.expect.luker && globals.luker !== 'object') reasons.push('未检测到 window.Luker');
  if (!target.expect.luker && globals.luker === 'object' && target.id !== 'st') reasons.push('意外检测到 window.Luker');
  return { pass: reasons.length === 0, reasons };
}

const args = parseArgs(process.argv);
const selected = args.only ? TARGETS.filter(t => args.only.includes(t.id)) : TARGETS;
if (!selected.length) {
  console.error('没有匹配的目标。可选：' + TARGETS.map(t => t.id).join(', '));
  process.exit(1);
}

const chromium = await loadPlaywright();
const results = [];
for (const target of selected) {
  const report = await probeTarget(chromium, target);
  const v = verdict(report, target);
  results.push({ ...report, pass: v.pass, reasons: v.reasons });
  if (!args.json) {
    const flag = v.pass ? 'PASS' : 'FAIL';
    console.log(`\n=== [${flag}] ${target.label} (${target.id}) — ${target.url}`);
    console.log(`  插件脚本注入 : ${report.checks.pluginScriptInjected}`);
    console.log(`  API 方法数   : ${report.checks.apiMethodCount}`);
    console.log(`  V2 根节点    : ${report.checks.v2RootMounted}`);
    console.log(`  宿主全局     : ${JSON.stringify(report.checks.hostGlobals)}`);
    console.log(`  面板         : ${JSON.stringify(report.panels)}`);
    const attributableErrors = (report.pluginErrors || []).filter(e => e.attributable);
    const opaqueErrors = (report.pluginErrors || []).filter(e => !e.attributable);
    if (attributableErrors.length) console.log(`  插件报错     :\n    - ${attributableErrors.slice(0, 5).map(e => e.text).join('\n    - ')}`);
    if (opaqueErrors.length) console.log(`  不可归因告警 : ${opaqueErrors.length} 条（跨源 Script error./资源加载失败，不计失败）`);
    if (report.pageErrors?.length) console.log(`  页面异常     : ${report.pageErrors.length} 条（不区分来源，仅供参考）`);
    if (!v.pass) console.log(`  未通过原因   : ${v.reasons.join('；')}`);
  }
}

if (args.json) {
  console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
} else {
  const failed = results.filter(r => !r.pass);
  console.log(`\n汇总：${results.length - failed.length}/${results.length} 通过` + (failed.length ? ` — 失败：${failed.map(r => r.id).join(', ')}` : ''));
}

process.exit(results.every(r => r.pass) ? 0 : 1);

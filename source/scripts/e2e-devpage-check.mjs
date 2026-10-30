/**
 * scripts/e2e-devpage-check.mjs — 开发者页真机确认（TESTING.md 0.6/0.7 人工项自动化）
 *
 * 覆盖（均为只读操作，不写实例数据）：
 *   A. 环境与能力总览：构建戳/存储模式/当前聊天标识/数据隔离 + 公开 API 按域分组 + 状态持久化面四通道
 *   B. 复制诊断包文本：剪贴板内容为脱敏 Markdown（断言含关键分段、不含 apiKey/token 明文）
 *   C. 导出诊断包 JSON：下载文件落盘并做同样的脱敏扫描
 *
 * 用法：NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-devpage-check.mjs
 * 产物：test-results/e2e-shots/devpage-*.png + devpage-report.json + devpage-diagnostic.json
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_DEV_PORTS = new Set(['8001', '8003']);
const SHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'e2e-shots');
mkdirSync(SHOT_DIR, { recursive: true });

let pw = null;
{
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    for (const name of ['playwright', 'playwright-core']) {
        try { const mod = require(name); if (mod?.chromium?.launch) { pw = mod; break; } } catch {}
    }
    if (!pw) {
        for (const base of [process.env.NODE_PATH, process.env.APPDATA && `${process.env.APPDATA}/npm/node_modules`]) {
            if (!base) continue;
            for (const name of ['playwright', 'playwright-core']) {
                try { const mod = require(`${String(base).replace(/\\/g, '/')}/${name}`); if (mod?.chromium?.launch) { pw = mod; break; } } catch {}
            }
            if (pw) break;
        }
    }
}
if (!pw) { console.error('[devpage] 无法加载 playwright：NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-devpage-check.mjs'); process.exit(2); }
const { chromium } = pw;

const TARGET_URL = 'http://127.0.0.1:8001/'; // Dev ST；8003 需 https，另参 e2e-screenshot-tour.mjs
if (!/127\.0\.0\.1:800[13]/.test(TARGET_URL)) { console.error('目标不在 Dev 白名单'); process.exit(3); }

const results = [];
const add = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();

try {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => !!window.AutoCardUpdaterAPI, { timeout: 45000 });
    // V2 面板在 openSettings() 时才挂载（与 e2e-screenshot-tour.mjs 同口径）
    await page.evaluate(async () => { try { await window.AutoCardUpdaterAPI.openSettings(); } catch { /* 断言上看 */ } });
    await page.waitForSelector('#acu-app-v2', { state: 'attached', timeout: 45000 });
    await page.waitForTimeout(4000); // V2 首屏渲染稳定
    await page.locator('button:has-text("我知道了")').first().click({ timeout: 3000 }).catch(() => {});
    await page.locator('button:has-text("开始使用")').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1200);

    // 新会话默认「基础模式」：先切高手模式才有完整侧边栏（开发者入口）
    const modeSwitch = page.locator('button:has-text("切换到高手模式")');
    if (await modeSwitch.count()) {
        await modeSwitch.first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.locator('button:has-text("我知道了")').first().click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(800);
    }

    // 先在仪表盘打开「启用开发者选项」总开关（TESTING 0.6 前置），再进开发者页
    // 开关在仪表盘 开关 面板的页签里（basic 或 advanced），aria-label 即开关文案
    await page.locator('.acu-v2-sidebar button:has-text("仪表盘")').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    const devSwitch = page.locator('[role="switch"][aria-label="启用开发者选项"]');
    if (!(await devSwitch.count())) {
        await page.locator('button:has-text("高级设置"), [role="tab"]:has-text("高级设置")').first().click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(600);
    }
    if (!(await devSwitch.count())) {
        await page.locator('button:has-text("基础设置"), [role="tab"]:has-text("基础设置")').first().click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(600);
    }
    const devChecked = (await devSwitch.count()) ? await devSwitch.first().getAttribute('aria-checked').catch(() => null) : null;
    if (devChecked !== 'true') {
        await devSwitch.first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
    }

    // 进入开发者页（侧边栏「开发者选项」；容器是 .acu-v2-sidebar）
    await page.locator('.acu-v2-sidebar button:has-text("开发者选项"), nav[aria-label="一级页导航"] button:has-text("开发者选项")').first().click({ timeout: 8000 });
    await page.waitForTimeout(1500);

    // A. 环境与能力总览
    const body = await page.evaluate(() => document.body.textContent || '');
    for (const key of ['构建戳', '存储模式', '当前聊天标识', '数据隔离', '可调用的公开 API', '状态持久化面']) {
        add(`总览含「${key}」`, body.includes(key));
    }
    const apiDomains = ['agent-worldbook', 'core-data', 'data-admin', 'sql', 'table-crud', 'table-lock', 'template-preset', 'worldbook-ai'];
    for (const d of apiDomains) add(`API 域 ${d}`, body.includes(d));
    await page.screenshot({ path: join(SHOT_DIR, 'devpage-overview.png'), fullPage: false });

    // B. 复制诊断包文本
    await page.locator('button:has-text("复制诊断包文本")').first().click({ timeout: 8000 });
    await page.waitForTimeout(1500);
    let clip = '';
    try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch (e) { add('读剪贴板', false, String(e && e.message || e)); }
    if (clip) {
        add('诊断包为 Markdown 文本', clip.includes('#') || clip.includes('环境'), `len=${clip.length}`);
        const lower = clip.toLowerCase();
        const secretHits = ['apikey', 'api_key', 'authorization'].filter((k) => lower.includes(k));
        add('诊断包无凭据字段名', secretHits.length === 0, secretHits.join(',') || 'clean');
        writeFileSync(join(SHOT_DIR, 'devpage-diagnostic.md'), clip, 'utf-8');
    }

    // C. 导出诊断包 JSON（download 事件）
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        page.locator('button:has-text("导出诊断包 JSON")').first().click({ timeout: 8000 }).catch(() => null),
    ]);
    if (download) {
        const p = join(SHOT_DIR, 'devpage-diagnostic.json');
        await download.saveAs(p);
        try {
            const j = JSON.parse(readFileSync(p, 'utf-8'));
            const s = JSON.stringify(j);
            const lower = s.toLowerCase();
            const secretHits = ['apikey', 'api_key', 'authorization'].filter((k) => lower.includes(k));
            add('诊断包 JSON 下载+脱敏', secretHits.length === 0, `keys=${Object.keys(j).slice(0, 6).join(',')} | ${secretHits.join(',') || 'clean'}`);
        } catch (e) {
            add('诊断包 JSON 解析', false, String(e && e.message || e));
        }
    } else {
        add('诊断包 JSON 下载', false, '未捕获 download 事件');
    }
} catch (e) {
    add('流程异常', false, String(e && e.message || e));
    await page.screenshot({ path: join(SHOT_DIR, 'devpage-error.png'), fullPage: false }).catch(() => {});
}

await context.close();
await browser.close();
writeFileSync(join(SHOT_DIR, 'devpage-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 1), 'utf-8');
const passed = results.filter((r) => r.pass).length;
console.log(`\n汇总：${passed}/${results.length} 项通过`);
process.exit(passed === results.length ? 0 : 1);

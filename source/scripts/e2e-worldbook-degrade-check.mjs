/**
 * scripts/e2e-worldbook-degrade-check.mjs — 世界书桥接降级确认（TESTING 0.4 自动化）
 *
 * 场景：TauriTavern ABI 注入环境（无酒馆助手 TS 助手层）。只调用 worldbook-ai 域的
 * 「读向」方法（get/list/status/describe/query 前缀），断言：
 *   ① 方法存在且可调用；② 不产生未捕获异常（pageerror）；③ 返回结构化结果或可序列化错误
 *   （不允许「调用即崩」）。**绝不调用写向/AI 生成方法**。
 *
 * 用法：NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-worldbook-degrade-check.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
if (!pw) { console.error('[wb-degrade] 无法加载 playwright'); process.exit(2); }
const { chromium } = pw;

const results = [];
const add = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => { const t = String(e?.stack || e); if (/shujuku|ACU|AutoCardUpdater|worldbook/i.test(t)) pageErrors.push(t.slice(0, 200)); });

try {
    await page.addInitScript(() => {
        window.__TAURITAVERN__ = { ready: true, invoke: { safeInvoke: async () => ({ tauriVersion: '2.3.0' }) } };
        window.__TAURITAVERN_MAIN_READY__ = true;
    });
    await page.goto('http://127.0.0.1:8001/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => !!window.AutoCardUpdaterAPI, { timeout: 45000 });

    const probe = await page.evaluate(async () => {
        const api = window.AutoCardUpdaterAPI;
        if (!api) return { exists: false, calls: [] };
        // 公开 API 是扁平对象（组名只是开发者页的自描述索引）。
        // worldbook-ai 组内只探「读向/取消」方法；绝不调 callAI/sync/delete/set 类（写向/AI 花销）。
        const targets = ['listWorldbookSkillMetas', 'getWorldbookEntrySkillMeta', 'cancelContentOptimization'];
        const calls = [];
        for (const m of targets) {
            const fn = api[m];
            if (typeof fn !== 'function') { calls.push({ method: m, ok: false, error: '方法不存在于扁平 API' }); continue; }
            try {
                const r = await fn.call(api);
                calls.push({ method: m, ok: true, kind: typeof r, serialized: (() => { try { return JSON.stringify(r)?.slice(0, 120) ?? 'null'; } catch { return 'unserializable'; } })() });
            } catch (e) {
                calls.push({ method: m, ok: false, error: String(e && e.message || e).slice(0, 160) });
            }
        }
        return { exists: true, calls };
    });

    add('扁平 API 存在', probe.exists, '');
    let graceful = true;
    const details = [];
    for (const c of probe.calls || []) {
        if (!c.ok && c.error === '方法不存在于扁平 API') graceful = false;
        details.push(`${c.method}: ${c.ok ? c.kind + ' ' + (c.serialized || '') : 'structured error: ' + c.error}`);
    }
    add('worldbook 读向调用全部优雅返回（无崩）', (probe.calls || []).length > 0 && (probe.calls || []).every((c) => c.ok || c.error !== '方法不存在于扁平 API'), details.join(' | ') || '（无可调方法）');
    add('无未捕获异常（pageerror）', pageErrors.length === 0, pageErrors.join(' | ') || 'clean');
    await page.screenshot({ path: join(SHOT_DIR, 'worldbook-degrade.png'), fullPage: false }).catch(() => {});
} catch (e) {
    add('流程异常', false, String(e && e.message || e));
}

await context.close();
await browser.close();
writeFileSync(join(SHOT_DIR, 'worldbook-degrade-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results, pageErrors }, null, 1), 'utf-8');
const passed = results.filter((r) => r.pass).length;
console.log(`\n汇总：${passed}/${results.length} 项通过`);
process.exit(passed === results.length ? 0 : 1);

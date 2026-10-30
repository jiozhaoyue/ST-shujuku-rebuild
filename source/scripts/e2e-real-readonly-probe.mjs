/**
 * scripts/e2e-real-readonly-probe.mjs — Real 实例（8002/8004）只读探针（E2E 留证）
 *
 * 纪律（L0-1 / P-11 / 用户指令「四酒馆错峰测试，Real 只读」）：
 *   - 端口硬白名单 8002/8004；其它端口一律拒绝启动。
 *   - 只发 HTTP GET 与浏览器截图；**绝不** POST / 写 localStorage / 装扩展 / 触发任何变更。
 *   - 每个实例探完即关浏览器上下文（错峰：串行，一次一个）。
 *
 * 用法：
 *   NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-real-readonly-probe.mjs
 * 输出：控制台逐项 PASS/FAIL + test-results/e2e-shots/real-*.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_REAL_PORTS = new Set(['8002', '8004']);
const SHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'e2e-shots');
mkdirSync(SHOT_DIR, { recursive: true });

// playwright 解析（与 e2e-screenshot-tour.mjs 同法）
let pw = null;
try { pw = await import('playwright'); } catch {}
if (!pw) {
    for (const base of [process.env.NODE_PATH, process.env.APPDATA && `${process.env.APPDATA}/npm/node_modules`].filter(Boolean)) {
        try { pw = await import(`${String(base).replace(/\\/g, '/')}/playwright/index.mjs`); break; } catch {}
        try { pw = await import(`${String(base).replace(/\\/g, '/')}/playwright-core/index.mjs`); break; } catch {}
    }
}
if (!pw) {
    console.error('[real-probe] 无法加载 playwright：NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-real-readonly-probe.mjs');
    process.exit(2);
}
const { chromium } = pw;

const TARGETS = [
    { id: 'real-st', label: 'Real ST', url: 'http://127.0.0.1:8002/', port: '8002', https: false },
    { id: 'real-luker', label: 'Real Luker', url: 'https://127.0.0.1:8004/', port: '8004', https: true },
];

/** 只读 HTTP GET（node fetch），返回 {ok, status, body}；绝不发 POST */
async function getText(url, { https = false } = {}) {
    try {
        const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const body = await res.text();
        return { ok: res.ok, status: res.status, body };
    } catch (e) {
        return { ok: false, status: 0, body: String(e && e.message || e) };
    }
}

const results = [];
for (const t of TARGETS) {
    if (!ALLOWED_REAL_PORTS.has(t.port)) { console.error(`[real-probe] 端口 ${t.port} 不在 Real 白名单，拒绝`); process.exit(3); }
    console.log(`\n=== [${t.id}] ${t.label} @ ${t.url} ===`);
    const row = { id: t.id, checks: [] };
    const add = (name, pass, detail) => { row.checks.push({ name, pass, detail }); console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };

    // ① 可达性（GET /）
    const home = await getText(t.url, { https: t.https });
    add('GET / 可达', home.ok, `status=${home.status}`);

    // ② 宿主版本（只读端点）
    const ver = await getText(new URL('/version', t.url).href, { https: t.https });
    let version = '';
    try { version = JSON.parse(ver.body || '').version || ''; } catch {}
    add('GET /version', ver.ok && !!version, version || `status=${ver.status}`);

    // ③ 插件文件存在性（只读 GET manifest，两种安装形态都试）
    const manifestPaths = [
        '/scripts/extensions/third-party/shujuku-rebuild/manifest.json',
        '/userextensions/shujuku-rebuild/manifest.json',
    ];
    let manifestOk = false;
    let manifestDetail = '';
    for (const p of manifestPaths) {
        const r = await getText(new URL(p, t.url).href, { https: t.https });
        if (r.ok) {
            try {
                const m = JSON.parse(r.body);
                manifestOk = true;
                manifestDetail = `${p} version=${m.version}`;
                break;
            } catch {}
        } else {
            manifestDetail += `${p} → ${r.status}; `;
        }
    }
    add('GET 插件 manifest（只读）', manifestOk, manifestDetail);

    // ④ 截图（新隐身上下文，关闭即销毁）
    try {
        const browser = await chromium.launch();
        const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2500);
        const shotPath = join(SHOT_DIR, `${t.id}-home.png`);
        await page.screenshot({ path: shotPath, fullPage: false });
        add('截图', true, shotPath);
        await context.close();
        await browser.close();
    } catch (e) {
        add('截图', false, String(e && e.message || e));
    }
    results.push(row);
}

const outPath = join(SHOT_DIR, 'real-readonly-report.json');
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 1), 'utf-8');
const passed = results.flatMap((r) => r.checks).filter((c) => c.pass).length;
const total = results.flatMap((r) => r.checks).length;
console.log(`\n汇总：${passed}/${total} 项通过；报告：${outPath}`);

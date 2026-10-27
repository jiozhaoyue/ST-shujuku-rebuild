/**
 * scripts/e2e-oversized-write-check.mjs — 超大字段写入软警告真机 E2E（Dev ST 8001 专用）
 *
 * 验证任务 10-26-oversized-field-soft-warning 的 AC9 / implement.md 7.1-7.2：
 *   7.1  合成超大字段（5 万字符）导入写入：写入照常成功、恰好一次 warning toast、单元格未被截断；
 *        同数量级重复导入：去重（不重复提示）。
 *   7.2  关闭「写入体积提示」开关后再次导入：零 toast、写入仍成功（数据完整）。
 *
 * 触发路径说明（实测选定）：
 * - 手动 CRUD API（insertRow/updateCell）在多轮真机实测中存在独立的「Table not found」解析问题
 *   （与本任务无关，已登记为后续排查项），故本 E2E 走 **importTableAsJson(persist:true)** ——
 *   PRD R1 明确覆盖「导入」路径，统一收口于 runTableUpdateCommit_ACU，探针必然经过。
 * - 目标列选「作者要求」（author_note）：主角表其余列均有模板 CHECK 限长（身份≤40、外貌≤60 等），
 *   作者要求列无 CHECK，是唯一能承载 5 万字符的合规列（实测 schema 证据在 oversized-report.json）。
 *
 * ⚠️ 红线：
 * - 目标写死 http://127.0.0.1:8001/，启动前断言端口 ∈ Dev 白名单 {8001, 8003, 8899}（P-11）。
 * - 只向 Dev 实例的测试聊天写合成数据；不碰 Real（8002/8004）。
 * - ST 欢迎层是 closed shadow root（DOM 查询不可达），开聊天走固定坐标（视口锁 1280×720）；
 *   插件自身 DOM 在顶层文档可达，用文本定位 + 原生 click。
 *
 * 用法：NODE_PATH="C:/nvm4w/nodejs/node_modules" node scripts/e2e-oversized-write-check.mjs
 * 产物：source/test-results/e2e-shots/oversized-*.png + oversized-report.json + stdout 判定。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_DEV_PORTS = new Set(['8001', '8003', '8899']);
const TARGET_URL = 'http://127.0.0.1:8001/';
/** 欢迎层第 3 行：2.44MB 的「角色画像 - 2026-07-22」聊天（14 条真实楼层）。 */
const CHAT_ROW_XY = { x: 500, y: 325 };
const BIG_CHARS = 50_000; // 默认单元格阈值 10,000 —— 5 倍超限；载荷 ~150KB < 512KiB（只触发单元格维度，判定干净）

{
  const u = new URL(TARGET_URL);
  if (!ALLOWED_DEV_PORTS.has(u.port)) {
    console.error(`[oversized-e2e] 拒绝启动：端口 ${u.port} 不在 Dev 白名单（P-11）`);
    process.exit(2);
  }
}

const BIG_VALUE = '超'.repeat(BIG_CHARS) + '|END|';

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
  console.error('[oversized-e2e] 无法加载 playwright（NODE_PATH）');
  process.exit(2);
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(projectRoot, 'source', 'test-results', 'e2e-shots');
mkdirSync(outDir, { recursive: true });

const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true });
const report = { steps: [], failures: [] };
const fail = (msg) => { report.failures.push(msg); console.error(`[oversized-e2e][FAIL] ${msg}`); };
const step = (name, data) => { report.steps.push({ name, ...data }); console.log(`[oversized-e2e] ${name}:`, JSON.stringify(data).slice(0, 600)); };

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // 预置「停止维护公告」已读标记（实例前端 localStorage: acu_st_eol_notice_v2=1），
  // 否则全新 profile 必弹公告盖住欢迎层，时序不稳定。
  await context.addInitScript(() => { try { localStorage.setItem('acu_st_eol_notice_v2', '1'); } catch { /* 忽略 */ } });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  // 1) 等插件 API 就绪 + 欢迎层真实渲染（headless 下 API 就绪早于 UI 渲染，固定等待会点空）
  await page.waitForFunction(
    () => typeof window.AutoCardUpdaterAPI === 'object' && window.AutoCardUpdaterAPI !== null,
    { timeout: 180_000 },
  );
  await page.waitForFunction(() => document.querySelectorAll('.mes').length >= 3, { timeout: 90_000 });
  await page.waitForTimeout(2000);
  step('plugin-api-ready', {});

  // 2) 装 toastr 记录器（先于一切动作）
  await page.evaluate(() => {
    window.__t = { toasts: [] };
    for (const k of ['warning', 'success', 'error', 'info']) {
      const orig = window.toastr[k].bind(window.toastr);
      window.toastr[k] = (...a) => {
        window.__t.toasts.push({ level: k, msg: String(a[0] ?? '').slice(0, 300), detail: String(a[1] ?? '').slice(0, 150) });
        return orig(...a);
      };
    }
  });

  // 3) 坐标打开目标聊天；等真实楼层加载；轻量弹窗处理（最多一轮：纯库 → 确定）
  await page.mouse.click(CHAT_ROW_XY.x, CHAT_ROW_XY.y);
  await page.waitForFunction(() => document.querySelectorAll('.mes').length >= 8, { timeout: 60_000 })
    .catch(() => { /* 由 chatState 兜底 */ });
  await page.waitForTimeout(3000);
  for (const label of ['纯库', '确定']) {
    await page.evaluate((txt) => {
      const btn = [...document.querySelectorAll('body *')].find(
        (e) => e.children.length === 0 && e.textContent?.trim() === txt && e.offsetParent,
      );
      if (btn) (btn.closest('button') || btn).click();
    }, label);
    await page.waitForTimeout(2500);
  }
  const chatState = await page.evaluate(() => ({ mesCount: document.querySelectorAll('.mes').length }));
  step('chat-opened', chatState);
  if (chatState.mesCount <= 3) fail(`聊天楼层过少（${chatState.mesCount}），可能没打开目标聊天`);
  await page.screenshot({ path: join(outDir, 'oversized-1-chat-open.png') });

  // 3.5) 打开 V2 面板：触发数据上下文初始化（实测缺此步 CRUD/导出水合不完整）
  await page.evaluate(async () => { try { await window.AutoCardUpdaterAPI.openSettings(); } catch { /* 已开 */ } });
  await page.waitForTimeout(8000);
  const hydrated = await page.evaluate(() => Object.keys(window.AutoCardUpdaterAPI.exportTableAsJson() || {}).length);
  step('data-hydrated', { sheetCount: hydrated });
  if (!hydrated) fail('导出为空：数据上下文未水合');

  // 3.6) sheetKey 定位修复探针：insertRow 以 sheetKey 定位应成功（2026-10-28 Table-not-found 修复）
  const crudProbe = await page.evaluate(async () => {
    try {
      const v = await window.AutoCardUpdaterAPI.insertRow('sheet_protagonist', {
        '姓名': 'E2E-sheetKey-probe', '性别': '女', '年龄': '20',
        '身份': 'E2E', '外貌特征': 'E2E', '当前衣着/装扮': 'E2E',
        '所在地点': 'E2E', '基础属性': 'E2E',
      });
      return String(v);
    } catch (e) { return 'ERR:' + String(e).slice(0, 150); }
  });
  step('crud-sheetkey-probe', { result: crudProbe });
  if (crudProbe === '-1' || crudProbe.startsWith('ERR')) fail(`insertRow(sheetKey) 探针失败: ${crudProbe}`);

  /** 页面内公共动作：导出 → 确保主角表有一行数据 → 置「作者要求」为 big → 导入（persist）→ 回读量程。 */
  const importWithBig = async (big, clearToasts) => page.evaluate(async ({ big, clearToasts }) => {
    const A = window.AutoCardUpdaterAPI;
    if (clearToasts) window.__t.toasts.length = 0;
    const out = {};
    try {
      const data = A.exportTableAsJson();
      const pk = Object.keys(data).find((k) => /protagonist/i.test(k))
        || Object.keys(data).find((k) => (data[k]?.name || '').includes('主角'));
      if (!pk) return { error: 'protagonist sheet not found' };
      const t = data[pk];
      const h = t.content[0];
      if (t.content.length === 1) t.content.push(h.map(() => ''));
      t.content[1][h.indexOf('姓名')] = 'ACU软警告实测';
      t.content[1][h.indexOf('性别')] = '女';
      const ci = h.indexOf('作者要求');
      t.content[1][ci] = big;
      out.import = String(await A.importTableAsJson(JSON.stringify(data), { persist: true }));
      await new Promise((res) => setTimeout(res, 3500));
      out.warnToasts = window.__t.toasts.filter((x) => x.level === 'warning');
      out.errToasts = window.__t.toasts.filter((x) => x.level === 'error').map((x) => x.msg.slice(0, 160));
      const s = JSON.stringify(A.exportTableAsJson());
      const m = s.match(/超+/g) || [];
      out.readback = { maxRun: m.reduce((a, b) => Math.max(a, b.length), 0), hasEnd: s.includes('|END|') };
    } catch (e) { out.error = String(e).slice(0, 250); }
    return out;
  }, { big, clearToasts });

  /** 开关相位基元：点「超过阈值时提示一次」标签（盲翻），再以「回落→大值应提示」自校验。返回最终 warnCount。 */
  const toggleSwitchAndVerify = async (tag) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.evaluate(() => {
        const clickText = (txt) => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === txt && b.offsetParent);
          if (btn) { btn.click(); return true; }
          const el = [...document.querySelectorAll('body *')].find(
            (e) => e.children.length === 0 && e.textContent?.trim() === txt && e.offsetParent,
          );
          if (el) { (el.closest('label') || el.closest('button') || el).click(); return true; }
          return false;
        };
        const lblVisible = [...document.querySelectorAll('body *')].find(
          (e) => e.children.length === 0 && e.textContent?.trim() === '超过阈值时提示一次' && e.offsetParent,
        );
        if (!lblVisible) clickText('数据管理');
      });
      await page.waitForTimeout(2500);
      const clicked = await page.evaluate(() => {
        const lbl = [...document.querySelectorAll('body *')].find(
          (e) => e.children.length === 0 && e.textContent?.trim() === '超过阈值时提示一次' && e.offsetParent,
        );
        if (!lbl) return false;
        (lbl.closest('label') || lbl.closest('button') || lbl).click();
        return true;
      });
      await page.waitForTimeout(2000);
      await importWithBig('回落-' + tag + '-' + attempt, true);
      const probe = await importWithBig(BIG_VALUE + '#probe-' + tag + '-' + attempt, true);
      const warnCount = (probe.warnToasts || []).length;
      step(`${tag}-attempt-${attempt}`, { clicked, warnCount });
      if (warnCount === 1) return { on: true }; // 行为证据：提示出现 ⇒ 开关已开（clicked=false 只说明未找到标签，无需再翻）
      if (clicked && warnCount === 0) continue; // 翻错了，再点一次
      continue; // 没找到标签，重走导航
    }
    return { on: false };
  };

  // 3.8) 相位基线：确保开关处于「开启」（跨运行状态漂移免疫）
  const ensured = await toggleSwitchAndVerify('ensure-on');
  step('phase0-switch-on', ensured);
  if (!ensured.on) fail('无法把「写入体积提示」开关置为开启（3 轮自校正失败）');
  await page.screenshot({ path: join(outDir, 'oversized-1b-switch-on.png') });

  // 4) 7.1：回落重置 → 导入 5 万字符 → 预期恰好一次 warning + 数据完整
  await importWithBig('回落测试', true);
  const write1 = await importWithBig(BIG_VALUE, true);
  step('write-1-oversized', {
    import: write1.import,
    warnCount: (write1.warnToasts || []).length,
    warnMsgs: (write1.warnToasts || []).map((t) => t.msg.slice(0, 160)),
    errToasts: write1.errToasts,
    readback: write1.readback,
    error: write1.error,
  });
  await page.screenshot({ path: join(outDir, 'oversized-2-first-write.png') });

  // 5) 同数量级立即重复导入 → 去重（不出现第二条 warning）
  const write2 = await importWithBig(BIG_VALUE, true);
  step('write-2-dedupe', {
    import: write2.import,
    warnCount: (write2.warnToasts || []).length,
  });

  // 6) 7.2：关闭「写入体积提示」开关（高手模式 → 数据管理 → 写入体积提示 → checkbox）
  //    注意 openSettings 是开关型：面板已开（3.5 打开）时不得再调，否则会把面板关掉。
  const toggled = await page.evaluate(async () => {
    const panelOpen = !!document.querySelector('.acu-panel') || !!(await (async () => true)());
    const A = window.AutoCardUpdaterAPI;
    if (!document.querySelector('.acu-panel')) { try { await A.openSettings(); } catch { /* 已开 */ } await new Promise((r) => setTimeout(r, 2500)); }
    const clickText = (txt) => {
      // 优先 button（textContent 全匹配，图标 svg 不影响），兜底任意叶元素
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === txt && b.offsetParent,
      );
      if (btn) { btn.click(); return true; }
      const el = [...document.querySelectorAll('body *')].find(
        (e) => e.children.length === 0 && e.textContent?.trim() === txt && e.offsetParent,
      );
      if (el) { (el.closest('button') || el).click(); return true; }
      return false;
    };
    if (!clickText('切换到高手模式')) return { ok: false, reason: 'basic-mode switch not found' };
    await new Promise((r) => setTimeout(r, 2500));
    if (!clickText('数据管理')) return { ok: false, reason: 'nav 数据管理 not found' };
    await new Promise((r) => setTimeout(r, 3000));
    const panels = [...document.querySelectorAll('body *')].filter(
      (e) => e.children.length === 0 && e.textContent?.trim() === '写入体积提示',
    );
    if (!panels.length) return { ok: false, reason: 'panel title not found' };
    let scope = panels[panels.length - 1];
    let cb = null;
    for (let i = 0; i < 8 && scope && !cb; i++) {
      scope = scope.parentElement;
      if (!scope) break;
      cb = scope.querySelector('input[type="checkbox"]');
    }
    if (!cb) {
      // 兜底：直接点「超过阈值时提示一次」标签（AcuCheckbox 可能为自绘组件）
      const lbl = [...document.querySelectorAll('body *')].find(
        (e) => e.children.length === 0 && e.textContent?.trim() === '超过阈值时提示一次' && e.offsetParent,
      );
      if (lbl) { (lbl.closest('label') || lbl).click(); return { ok: true, via: 'label-fallback' }; }
      return { ok: false, reason: 'checkbox not found under panel' };
    }
    const was = cb.checked;
    if (was) cb.click();
    return { ok: true, was, now: cb.checked };
  });
  step('toggle-off', toggled);
  await page.waitForTimeout(2000);

  // 7) 关闭状态下：小值回落（重置去重）→ 大值导入 → 零 warning、写入仍成功
  const reset2 = await importWithBig('关闭后回落测试', true);
  step('reset-small-disabled', { import: reset2.import, warnCount: (reset2.warnToasts || []).length });
  const write3 = await importWithBig(BIG_VALUE + '#3', true);
  step('write-3-disabled', {
    import: write3.import,
    warnCount: (write3.warnToasts || []).length,
    errToasts: write3.errToasts,
    readback: write3.readback,
  });
  await page.screenshot({ path: join(outDir, 'oversized-3-after-disable.png') });

  // 8) 恢复开关并验证提示重现（自校正：点「超过阈值时提示一次」→ 回落 → 大值导入应恰好一次 warning；
  //    自绘开关读不到状态，若盲点翻错则以实际 toast 行为为准重试，最多 3 轮）
  let restored = false;
  let write4 = { warnToasts: [] };
  for (let attempt = 1; attempt <= 3 && !restored; attempt++) {
    await page.evaluate(() => {
      const clickText = (txt) => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === txt && b.offsetParent);
        if (btn) { btn.click(); return true; }
        const el = [...document.querySelectorAll('body *')].find(
          (e) => e.children.length === 0 && e.textContent?.trim() === txt && e.offsetParent,
        );
        if (el) { (el.closest('label') || el.closest('button') || el).click(); return true; }
        return false;
      };
      // 若当前不在数据管理页（找不到开关标签），先回导航
      const lblVisible = [...document.querySelectorAll('body *')].find(
        (e) => e.children.length === 0 && e.textContent?.trim() === '超过阈值时提示一次' && e.offsetParent,
      );
      if (!lblVisible) {
        clickText('数据管理');
      }
    });
    await page.waitForTimeout(2500);
    const clicked = await page.evaluate(() => {
      const lbl = [...document.querySelectorAll('body *')].find(
        (e) => e.children.length === 0 && e.textContent?.trim() === '超过阈值时提示一次' && e.offsetParent,
      );
      if (!lbl) return false;
      (lbl.closest('label') || lbl.closest('button') || lbl).click();
      return true;
    });
    await page.waitForTimeout(2000);
    await importWithBig('恢复后回落测试' + attempt, true);
    write4 = await importWithBig(BIG_VALUE + '#4-' + attempt, true);
    restored = clicked && (write4.warnToasts || []).length === 1;
    step('restore-attempt-' + attempt, { clicked, warnCount: (write4.warnToasts || []).length });
  }
  step('toggle-restored', { ok: restored });

  // ── 判定 ──
  const okImport = (v) => v === 'true';
  const checks = {
    '7.1-a 导入写入成功': okImport(write1.import),
    '7.1-b 恰好一次 warning': (write1.warnToasts || []).length === 1,
    '7.1-c 单元格未截断(5万字符完整)': write1.readback?.maxRun === BIG_CHARS && write1.readback?.hasEnd === true,
    '7.1-d 同数量级立即重复导入去重': (write2.warnToasts || []).length === 0,
    '7.2-a 开关可关闭': toggled.ok === true,
    '7.2-b 关闭后回落再超标零 toast': (write3.warnToasts || []).length === 0,
    '7.2-c 关闭后写入仍成功': okImport(write3.import),
    '7.2-d 关闭后数据完整': (write3.readback?.maxRun || 0) >= BIG_CHARS && write3.readback?.hasEnd === true,
    '7.2-e 恢复开关后重现提示': restored === true,
  };
  report.checks = checks;
  report.pass = Object.values(checks).every(Boolean);
  console.log('[oversized-e2e] 判定:', JSON.stringify(checks, null, 2));
} catch (e) {
  fail('脚本异常: ' + String(e && e.stack || e).slice(0, 600));
} finally {
  await browser.close();
  writeFileSync(join(outDir, 'oversized-report.json'), JSON.stringify(report, null, 2));
  console.log('[oversized-e2e] PASS=' + Boolean(report.pass));
  process.exit(report.pass ? 0 : 1);
}

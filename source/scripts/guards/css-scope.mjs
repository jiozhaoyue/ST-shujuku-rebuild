/**
 * CSS 作用域守卫（D-02 注入样式双前缀 / 禁全局选择器 · 本仓适配）
 *
 * 参照：ST-chatfilesys-rebuild/scripts/guards/css-scope.mjs —— 原判据是
 * 「每个选择器必须含 chatfilesys 前缀、主语不得是 * / html / body / :root、
 * 配色走 var(--SmartTheme*)」。本仓前缀不是 chatfilesys，而是：
 *   · .acu-*（presentation / presentation-v2 组件）
 *   · .ub-*（presentation-v3 全系 + 令牌）
 *   · #acu-app-v2 / #acu-app-v3（挂载根）
 * 且本仓无独立 .css 文件，样式在 Vue SFC 的 <style> 块（99 个，96 scoped +
 * 2 非 scoped）；另有少量 TS 注入字符串（theme-injector 等）不在本守卫扫描范围。
 * 本守卫只扫 .vue 的 <style> 块，collectVue 的 endsWith('.vue') 即其覆盖边界。
 * 按任务书 D-02 口径，严守「选择器前缀 + 禁全局主语」，配色判据降为警告级（色板令牌文件合法硬编码）。
 *
 * 判据（扫 source/src 下 .vue 的 <style> 块）：
 *   ① 每个逗号分隔的顶层选择器（正确切分 :is()/:where()/:not() 内逗号）必须含
 *      acu- / ub- 前缀或 #acu-app（裸 `.menu_button {}` 即污染宿主）；
 *   ② 主语（第一个复合选择器）不得是裸 `* / html / body / :root`；
 *   ③ 配色（color/background/border-color）硬编码非中性色 → 警告输出，不阻断
 *      （色板令牌定义文件合法，文案/令牌治理由 UI 规范化任务消化）。
 *
 * 已知局限：不做完整 CSS 解析（@media 下钻但不校验嵌套选择器），纯静态正则；
 * 前缀白名单按当前源码实测核定，新增合法前缀需更新 PREFIX_RE 并留理由。
 *
 * 退出码：0=通过；1=前缀/全局主语违规。用法：node scripts/guards/css-scope.mjs [额外文件...]
 * 纯 Node 零依赖。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

// 合法作用域前缀（本仓实测：acu-* / ub-* / #acu-app-v*）
const PREFIX_RE = /(?:acu-|ub-|#acu-app|#acu-)/;
const FORBIDDEN_SUBJECTS = new Set(['*', 'html', 'body', ':root']);

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 切分选择器列表：只在函数括号外的逗号处切（:is(a,b) 内部逗号不切） */
function splitTopLevel(s) {
  let depth = 0;
  const out = [];
  let buf = '';
  for (const c of s) {
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) { out.push(buf.trim()); buf = ''; }
    else buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

/** 抽出「顶层选择器 → 声明块」列表（@media/@supports 下钻；@keyframes 等跳过） */
function rules(css) {
  const src = stripComments(css);
  const out = [];
  let i = 0;
  while (i < src.length) {
    const brace = src.indexOf('{', i);
    if (brace < 0) break;
    let head = src.slice(i, brace).trim();
    let depth = 1;
    let j = brace + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') depth -= 1;
      j += 1;
    }
    const body = src.slice(brace + 1, j - 1);
    if (head.startsWith('@')) {
      // @media/@supports：递归下钻其内部规则
      if (/^@(?:media|supports|layer|container)\b/.test(head) && body) {
        out.push(...rules(body));
      }
      // @keyframes/@font-face 等：整体跳过
      i = j;
      continue;
    }
    if (head) out.push({ selector: head.replace(/\s+/g, ' '), body });
    i = j;
  }
  return out;
}

/** 主语：第一个复合选择器（去掉伪类/伪元素） */
function subjectOf(one) {
  return one
    .split(/\s*[>+~]\s*|\s+/)[0]
    .replace(/::?[a-z-]+(?:\([^)]*\))?/gi, '')
    .trim();
}

/** 收集 .vue 的 <style> 块内容，附带相对文件偏移的行号基准 */
function vueStyleBlocks(code) {
  const blocks = [];
  for (const m of code.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    const pre = code.slice(0, m.index + m[0].indexOf('>') + 1);
    blocks.push({ css: m[1], lineBase: pre.split('\n').length });
  }
  return blocks;
}

/** 检查单份 CSS，返回 {errors, warnings} */
export function checkCssScope(css, file = '<css>', lineBase = 0) {
  const errors = [];
  const warnings = [];
  for (const r of rules(css)) {
    const line = lineBase + css.slice(0, css.indexOf(r.selector.split(' ')[0])).split('\n').length + 1;
    for (const one of splitTopLevel(r.selector)) {
      // ① 作用域前缀
      if (!PREFIX_RE.test(one)) {
        errors.push(`${file}:${line}: 选择器「${one}」无 acu-/ub-/#acu-app 前缀，会污染宿主（D-02）`);
      }
      // ② 全局主语
      const subj = subjectOf(one);
      if (FORBIDDEN_SUBJECTS.has(subj)) {
        errors.push(`${file}:${line}: 主语「${subj}」是全局选择器，禁止裸用（D-02）`);
      }
    }
    // ③ 配色警告（非阻断）
    for (const m of r.body.matchAll(/(?:^|[\s;])(color|background|background-color|border-color)\s*:\s*([^;]+);/gi)) {
      const val = m[2].trim().replace(/\s*!important\s*$/i, '').trim();
      if (val.includes('var(--')) continue;
      if (/^(?:transparent|inherit|currentcolor|none)$/i.test(val)) continue;
      if (/^rgba?\(\s*(?:0|255)\s*,/i.test(val)) continue;
      warnings.push(`${file}: color 硬编码 ${m[1]}:${val.slice(0, 40)}`);
    }
  }
  return { errors, warnings };
}

async function collectVue(root) {
  const files = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist', 'vendor'].includes(e.name)) continue;
        await walk(full);
      } else if (e.isFile() && e.name.endsWith('.vue')) files.push(full);
    }
  }
  await walk(root);
  return files.sort();
}

async function main() {
  const files = await collectVue(SRC_ROOT);
  for (const arg of process.argv.slice(2)) {
    const p = path.resolve(arg);
    try { if ((await stat(p)).isFile()) files.push(p); } catch { /* 忽略 */ }
  }
  const errors = [];
  const warnings = [];
  let blockCount = 0;
  let selectorCount = 0;
  for (const file of files) {
    const code = await readFile(file, 'utf8');
    const label = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    for (const block of vueStyleBlocks(code)) {
      blockCount += 1;
      selectorCount += rules(block.css).reduce((n, r) => n + splitTopLevel(r.selector).length, 0);
      const res = checkCssScope(block.css, label, block.lineBase);
      errors.push(...res.errors);
      warnings.push(...res.warnings);
    }
  }
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(`\nCSS 作用域守卫未通过：${errors.length} 处前缀/全局选择器违规（扫描 ${files.length} 个 Vue SFC、${blockCount} 个 style 块）`);
    process.exitCode = 1;
    return;
  }
  console.log(`CSS 作用域守卫通过：${files.length} 个 Vue SFC、${blockCount} 个 style 块、${selectorCount} 个选择器，前缀与全局主语合规`);
  if (warnings.length) {
    console.log(`  警告（不阻断）：${warnings.length} 处配色硬编码，由 UI 规范化任务消化`);
    warnings.slice(0, 8).forEach((w) => console.log(`    - ${w}`));
    if (warnings.length > 8) console.log(`    ... 另有 ${warnings.length - 8} 处`);
  }
  console.log('  注：仅覆盖 Vue SFC <style> 块；合法前缀为 acu-/ub-/#acu-app（D-02 双前缀口径）。TS 注入 CSS 不在扫描范围。');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

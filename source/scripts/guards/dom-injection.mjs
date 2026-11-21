/**
 * DOM 注入守卫（DOM Injection Guard · 本仓 rollup + Vue SFC 适配）
 *
 * 参照：ST-chatfilesys-rebuild/scripts/guards/dom-injection.mjs —— 移植其
 * 「右值必须可静态确认安全，否则报错」「allow 注释豁免」「可信渲染产物降误报」三段式。
 * 本仓适配点：
 *   · 本仓 UI 主路径是 Vue SFC 的 {{ }} 插值（天然转义，无 v-html，实测 0 处）；
 *     DOM 注入只出现在少量 theme/bootstrap 的 TS 里，故扫描 .ts + .vue；
 *   · 可信产物白名单按本仓实际形态核定（实测 6 处 innerHTML 全部命中）：
 *       - 双引号/单引号静态字面量（menu-button 的图标 HTML）；
 *       - sanitizeToastHtml_ACU(...) 白名单净化（toast.ts:400）；
 *       - toTrustedHtml(...) 可信封装（host-renderer.ts:71）；
 *       - 模板字面量内插值为 render*()/esc()/标识符 trusted 产物（custom-confirm.ts:76）；
 *       - 读取型 doc.body.innerHTML（toast.ts:361，读不是写）不算注入；
 *   · 豁免标记 dom-injection:allow（行）/ dom-injection:allow-file（整文件）。
 *
 * 判据：对每个 innerHTML/outerHTML 赋值与 insertAdjacentHTML 第 2 参数，
 *   ① 静态字符串字面量 → 安全；
 *   ② 模板字面量：逐个审查 ${...} 插值，纯字面量/esc()/render*()/白名单安全变量名放行，
 *      裸用户数据标识（name/value/title/content/message 等）判违规；
 *   ③ 右值为 sanitize 系列 / toTrustedHtml / 可信渲染函数 / 白名单变量调用 → 安全；
 *   ④ 其余「右值不可静态确认」可疑拼接 → 报错，要求显式豁免。
 *
 * 退出码：0=通过；1=违规。用法：node scripts/guards/dom-injection.mjs [额外文件...]
 * 纯 Node 零依赖。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ALLOW_MARKER = 'dom-injection:allow';
const ALLOW_FILE_MARKER = 'dom-injection:allow-file';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

// innerHTML / outerHTML 赋值（含 +=），排除读取（后面没有 =）
const ASSIGN_RE = /(?:^|[^.\w])(?:[\w$]+\.)*(innerHTML|outerHTML)\s*(\+?=)\s*/g;
const INSERT_RE = /insertAdjacentHTML\s*\(/g;

// 可信右值形态：净化函数 / 可信封装 / 渲染产物 / 固定说明串
const TRUSTED_CALL = /^(?:sanitize\w*|toTrustedHtml|esc|escapeHtml|render\w*|build\w*Html|format\w*)\s*\(/i;
// 模板插值里「安全变量名」：只收纯内部计数与已净化 / 可信产物名。
// 语义名（title/data/name/html/label/...）可能是用户可控数据，禁止无条件放行；
// 真实已净化产物请用带 safe/sanitize 语义的名字，或加 dom-injection:allow 豁免。
const SAFE_VAR = /^(?:n|i|idx|index|count|num|total|size|id|key|ACU_HOST_SURFACE_CLASS\w*|confirmId|safeMessage|sanitized\w*|trusted\w*)$/;
// 成员链只放行已知宿主 / 配置对象根；user./input./payload. 等未知根一律判违规。
const SAFE_MEMBER_ROOT = /^(?:opts|options|config|ui|settings)$/;

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i += 1) if (code[i] === '\n') line += 1;
  return line;
}

function hasAllowMarker(code, index) {
  const lines = code.split('\n');
  const line = lineOf(code, index);
  return Boolean(lines[line - 1]?.includes(ALLOW_MARKER) || lines[line - 2]?.includes(ALLOW_MARKER));
}

/** 取右值片段直到语句结束（分号 / 换行在 depth<=0 时收尾），覆盖跨行拼接与函数参数 */
function sliceRhs(code, start, maxLen = 1200) {
  let i = start;
  let depth = 0;
  let quote = null;
  while (i < code.length) {
    const c = code[i];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth -= 1;
    } else if (c === ';' && depth <= 0) { i += 1; break; }
    else if (c === '\n' && depth <= 0) {
      // 行尾是 +（跨行字符串拼接）时继续读下一行，否则视为语句结束
      let k = i - 1;
      while (k >= start && /\s/.test(code[k])) k -= 1;
      if (code[k] !== '+') break;
    }
    i += 1;
  }
  return code.slice(start, Math.min(i, start + maxLen));
}

/** 提取模板字面量中的 ${...} 插值内容 */
function interpolationsIn(text) {
  const out = [];
  const re = /\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

/**
 * 检查单份源码的 DOM 注入。
 * @returns {Array<{line:number,kind:string,message:string}>}
 */
export function checkDomInjection(code, file = '<ts>') {
  const violations = [];
  const push = (index, kind, message) => {
    if (hasAllowMarker(code, index)) return;
    violations.push({ file, line: lineOf(code, index), kind, message });
  };

  const inspectRhs = (rhsIndex, op) => {
    let i = rhsIndex;
    while (i < code.length && /\s/.test(code[i])) i += 1;
    const ch = code[i];
    // 纯单个静态字符串字面量（单/双引号，无 + 拼接）→ 安全；带拼接则继续走下方分析
    if (ch === "'" || ch === '"') {
      const rhs0 = sliceRhs(code, i);
      // 去掉末尾分号与首尾空白后，若整段就是一个字符串字面量则放行
      const trimmed = rhs0.trim().replace(/;$/, '').trim();
      if (/^(?:'[^']*'|"[^"]*")$/.test(trimmed)) return;
    }
    const rhs = sliceRhs(code, i);

    if (ch === '`') {
      for (const expr of interpolationsIn(rhs)) {
        if (!expr) continue;
        // 纯安全变量 / 可信调用 / 字面量 / 数字算术 → 放行
        if (SAFE_VAR.test(expr)) continue;
        if (TRUSTED_CALL.test(expr)) continue;
        if (/^['"`\d]/.test(expr)) continue;
        if (/^[\w.$]+\s*[?+\-*/]/.test(expr)) continue;
        // 成员链只放行已知宿主 / 配置对象根（opts./config./ui./options./settings.）。
        // user./input./payload. 等未知根是典型未转义注入形态，必须报错或显式豁免。
        const memberRoot = expr.match(/^([\w$]+)\./)?.[1];
        if (memberRoot && SAFE_MEMBER_ROOT.test(memberRoot)) continue;
        push(i, 'interpolation',
          `模板插值疑似未转义用户数据：\${${expr}} —— 请包 esc()/sanitize*()，或加 ${ALLOW_MARKER} 注释`);
      }
      return;
    }

    // 可信调用 / 净化封装 / 静态拼接产物
    if (TRUSTED_CALL.test(rhs.trim())) return;
    // 纯标识符白名单（data/html 等已知产物）
    if (SAFE_VAR.test(rhs.trim())) return;
    // 字符串 + 变量的静态拼接：只由引号、+、白名单安全变量组成 → 视为静态构造。
    // 裸数据变量（userInput / name / value 等）不得混入，否则正是注入形态。
    const concat = rhs.replace(/'[^']*'|"[^"]*"/g, 'STR').replace(/\s/g, '');
    // 去除末尾分号 / 跨行截断残留的 + 后，再判定片段构成
    const norm = concat.replace(/;$/, '').replace(/\++$/, '');
    if (/^(?:STR|\+?[\w$.]+)+$/.test(norm)) {
      const vars = norm.match(/[A-Za-z_$][\w$]*/g) || [];
      // STR 是字符串字面量的占位符，不算变量；其余须在安全白名单内
      const badVars = vars.filter((v) => v !== 'STR' && !SAFE_VAR.test(v));
      // 全为字符串字面量片段（无变量）→ 静态 HTML，安全
      if (!badVars.length) return;
    }

    push(i, 'opaque-rhs',
      `${op} 右值无法静态确认（${rhs.split('\n')[0].slice(0, 80)}...）—— 请包 esc()/sanitize*()，或加 ${ALLOW_MARKER} 注释`);
  };

  for (const m of code.matchAll(ASSIGN_RE)) inspectRhs(m.index + m[0].length, m[1] + m[2]);
  for (const m of code.matchAll(INSERT_RE)) {
    // 找第二个参数（第一个逗号之后）
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    let commaSeen = false;
    while (i < code.length) {
      const c = code[i];
      if (quote) {
        if (c === '\\') { i += 2; continue; }
        if (c === quote) quote = null;
        i += 1;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue; }
      if (c === '(' || c === '[') depth += 1;
      else if (c === ')' || c === ']') { if (depth === 0) break; depth -= 1; }
      else if (c === ',' && depth === 0) { commaSeen = true; break; }
      i += 1;
    }
    if (commaSeen) inspectRhs(i + 1, 'insertAdjacentHTML');
  }
  return violations;
}

async function collectFiles(root) {
  const files = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist', 'vendor'].includes(e.name)) continue;
        await walk(full);
      } else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.vue') || e.name.endsWith('.js'))) files.push(full);
    }
  }
  await walk(root);
  return files.sort();
}

async function main() {
  const files = await collectFiles(SRC_ROOT);
  for (const arg of process.argv.slice(2)) {
    const p = path.resolve(arg);
    try { if ((await stat(p)).isFile()) files.push(p); } catch { /* 忽略 */ }
  }
  const violations = [];
  let scanned = 0;
  let writeSites = 0;
  for (const file of files) {
    const code = await readFile(file, 'utf8');
    if (code.includes(ALLOW_FILE_MARKER)) continue;
    scanned += 1;
    const label = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    writeSites += [...code.matchAll(ASSIGN_RE)].filter((m) => m[2]).length + [...code.matchAll(INSERT_RE)].length;
    for (const v of checkDomInjection(code, label)) violations.push(v);
  }
  if (violations.length) {
    for (const v of violations) console.error(`✗ ${v.file}:${v.line}: [${v.kind}] ${v.message}`);
    console.error(`\nDOM 注入守卫未通过：${violations.length} 处（扫描 ${scanned} 个文件）`);
    process.exitCode = 1;
    return;
  }
  console.log(`DOM 注入守卫通过：扫描 ${scanned} 个文件、${writeSites} 处 innerHTML/insertAdjacentHTML 写入，全部为可信产物或静态字面量`);
  console.log('  注：本仓 Vue SFC 用 {{ }} 插值（无 v-html），注入仅存于少量 TS，白名单按实测 6 处防护形态核定。');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

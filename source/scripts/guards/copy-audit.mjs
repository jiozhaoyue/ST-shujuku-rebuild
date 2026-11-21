/**
 * 文案审查守卫（Copy Audit · G-16 警告级 · 本仓 rollup + Vue SFC 适配）
 *
 * 参照：ST-chatfilesys-rebuild/scripts/guards/copy-audit.mjs —— 移植其
 * 「屏蔽注释 → 提取用户可见字符串 → HTML 模板按标签切分 → 排除技术串 →
 * 审开发元文本 / 长句括号说明 / 分号长句」判据。本仓适配点：
 *   · 文案在 Vue SFC 模板文本节点与 title/placeholder/aria-label 属性里，故只扫
 *     source/src/presentation 系列目录下 .vue（UI 层）；data/service/shared 层的中文串
 *     是日志/错误信息（实测 1000+ 条），不是 UI 文案，不入审查；
 *   · 任务书要求先做警告级：默认 exit 0、输出违规清单，文案治理由 UI 规范化任务消化；
 *     另留 --strict 开关（exit 1），供人为违规样例验证"能拦截"。
 *
 * 违规三类（G-16）：
 *   - dev-marker：TODO / FIXME / 待实现 / 开发中 等开发说明元文本；
 *   - long-paren：单串 > 40 字且含中文括号说明「（…）」；
 *   - semicolon-long：含「；」且 > 40 字的分号长句。
 * 允许：注释里的开发说明、纯技术串、≤40 字短文案、title/aria-label/placeholder
 * （它们是 tooltip 与辅助说明，G-16 明许长句收敛到此处）。
 *
 * 退出码：默认 0（警告级，输出清单）；带 --strict 且命中时 1。
 * 用法：node scripts/guards/copy-audit.mjs [--strict] [额外文件...]
 * 纯 Node 零依赖。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

const DEV_MARKERS = /\b(?:TODO|FIXME|XXX|HACK)\b|待实现|待补充|开发中|暂未实现|未完待续/;
const CJK = /[\u4e00-\u9fff]/;
const CN_PAREN = /（[^）]*）/;
const LONG_LIMIT = 40;
const STRICT = process.argv.includes('--strict');

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i += 1) if (code[i] === '\n') line += 1;
  return line;
}

/** Vue 模板文本节点：按标签切分，只取含中文的可见文本（跳过属性残片） */
function templateCopyUnits(template, baseIndex) {
  const units = [];
  let cursor = 0;
  for (const m of template.matchAll(/<[^>]*>/g)) {
    const text = template.slice(cursor, m.index).trim();
    if (text && CJK.test(text) && !/="/.test(text) && !/[<>]/.test(text)) {
      units.push({ text, index: baseIndex + cursor });
    }
    cursor = m.index + m[0].length;
  }
  const tail = template.slice(cursor).trim();
  if (tail && CJK.test(tail) && !/="/.test(tail) && !/[<>]/.test(tail)) {
    units.push({ text: tail, index: baseIndex + cursor });
  }
  return units;
}

/** 提取源码字符串字面量与模板静态文本段，跳过注释 */
export function extractStrings(code) {
  const out = [];
  const n = code.length;
  let i = 0;
  const scanTemplate = (start) => {
    let j = start + 1;
    let buf = '';
    let segStart = start;
    while (j < n) {
      const c = code[j];
      if (c === '\\') { buf += code[j] + (code[j + 1] || ''); j += 2; continue; }
      if (c === '`') {
        if (buf.trim()) out.push({ text: buf, index: segStart });
        return j + 1;
      }
      if (c === '$' && code[j + 1] === '{') {
        if (buf.trim()) out.push({ text: buf, index: segStart });
        let depth = 1;
        j += 2;
        while (j < n && depth > 0) {
          if (code[j] === '{') depth += 1;
          else if (code[j] === '}') depth -= 1;
          else if (code[j] === '`') {
            let k = j + 1;
            while (k < n) { if (code[k] === '\\') { k += 2; continue; } if (code[k] === '`') break; k += 1; }
            j = k;
          }
          j += 1;
        }
        buf = '';
        segStart = j;
        continue;
      }
      buf += c;
      j += 1;
    }
    return j;
  };
  while (i < n) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i += 1; continue; }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '`' || c === "'" || c === '"') {
      const start = i;
      if (c === '`') { i = scanTemplate(i); continue; }
      const quote = c;
      i += 1;
      let buf = '';
      while (i < n) {
        if (code[i] === '\\') { buf += code[i] + (code[i + 1] || ''); i += 2; continue; }
        if (code[i] === quote) { i += 1; break; }
        buf += code[i];
        i += 1;
      }
      if (buf.trim()) out.push({ text: buf, index: start });
      continue;
    }
    i += 1;
  }
  return out;
}

/** 技术串排除：CSS 选择器 / URL / 路径 / 纯标识符 / 模板残片 */
function isTechnical(text) {
  const t = text.trim();
  if (/[{}]/.test(t) && /[<>:=]/.test(t)) return true;
  if (t.startsWith('.') || t.startsWith('#')) return true;
  if (/^https?:\/\//.test(t) || /^data:/.test(t)) return true;
  if (/^\/[\w./-]+$/.test(t)) return true;
  if (/^[\w-]+$/.test(t) && !CJK.test(t)) return true;
  if (/^\s*[{}(),;:]\s*$/.test(t)) return true;
  return false;
}

/**
 * 审查一段 Vue SFC 的 UI 文案。
 * @returns {Array<{file:string,line:number,rule:string,text:string}>}
 */
export function auditCode(code, file = '<vue>') {
  const issues = [];
  // 模板部分按标签切分文本节点；脚本部分按字符串字面量审（排除日志前缀串）
  const templateEnd = code.indexOf('<script');
  const template = templateEnd >= 0 ? code.slice(0, templateEnd) : code;
  const units = templateCopyUnits(template, 0);

  for (const s of extractStrings(code)) {
    const text = s.text.trim();
    if (!CJK.test(text) || isTechnical(text)) continue;
    // 日志/诊断串排除：[Xxx] 前缀、含 ${ 插值的技术上下文、典型日志动词
    if (/^\[[\w-]+\]/.test(text)) continue;
    if (/\$\{/.test(text) && /(?:失败|超时|错误|异常|请求|响应|调用|加载)/.test(text)) continue;
    units.push({ text, index: s.index });
  }

  for (const u of units) {
    const text = u.text.trim();
    if (!CJK.test(text) || isTechnical(text)) continue;
    const line = lineOf(code, u.index);
    if (DEV_MARKERS.test(text)) issues.push({ file, line, rule: 'dev-marker', text: text.slice(0, 80) });
    if (text.length > LONG_LIMIT && CN_PAREN.test(text)) issues.push({ file, line, rule: 'long-paren', text: text.slice(0, 80) });
    if (text.includes('；') && text.length > LONG_LIMIT) issues.push({ file, line, rule: 'semicolon-long', text: text.slice(0, 80) });
  }
  return issues;
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
    if (arg === '--strict') continue;
    const p = path.resolve(arg);
    try { if ((await stat(p)).isFile()) files.push(p); } catch { /* 忽略 */ }
  }
  const issues = [];
  for (const file of files) {
    issues.push(...auditCode(await readFile(file, 'utf8'), path.relative(REPO_ROOT, file).replace(/\\/g, '/')));
  }
  if (issues.length) {
    const tag = STRICT ? '未通过' : '警告';
    console.log(`文案审查${tag}：${issues.length} 处（扫描 ${files.length} 个 Vue SFC）`); // 汇总首行
    for (const v of issues) console.warn(`✗ ${v.file}:${v.line}: [${v.rule}] ${v.text}`);
    console.warn(`\n文案审查${tag}：${issues.length} 处（扫描 ${files.length} 个 Vue SFC）`);
    if (!STRICT) console.warn('  警告级（exit 0）：文案治理由 UI 规范化任务消化；加 --strict 可阻断。');
    if (STRICT) process.exitCode = 1;
    return;
  }
  console.log(`文案审查通过：${files.length} 个 Vue SFC，UI 文案无开发元文本 / 长句括号说明 / 分号长句`);
  console.log('  注：G-16 警告级守卫，默认 exit 0；--strict 可转为阻断以验证违规拦截。');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

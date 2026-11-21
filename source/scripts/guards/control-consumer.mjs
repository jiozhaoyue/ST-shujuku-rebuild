/**
 * 控件接线守卫（Control Consumer Guard · 本仓 rollup + Vue SFC 适配）
 *
 * 参照：ST-chatfilesys-rebuild/scripts/guards/control-consumer.mjs —— 原判据是
 * 「data-cfs-act 声明的动作必须在声明之外至少出现 1 次（防死开关）」。本仓是
 * TypeScript + Vue SFC 构建态，UI 动作不是 data-*-act 属性，而是模板事件处理器
 * （@click / @change / @input / @keyup 等）绑定的方法名。故判据改写为：
 *   「模板事件处理器引用的处理器标识，必须在同文件 <script> 块中有接线证据」。
 *
 * 判据（扫 source/src 下所有 .vue）：
 *   ① 提取模板里的 @click/@change/...="handler(...)" 中「裸方法名调用」的标识；
 *      带对象前缀的（flow.refresh() / toast.dismiss()）、$emit、$event、
 *      内联表达式（open = !open）、字面量参数等一律跳过（其接线在别处，宽松侧）；
 *   ② 收集 <script setup>/<script> 里的接线证据：function/const/let/var/class 声明、
 *      import 绑定、defineEmits 的 emit 变量、以及对象方法简写 `foo() {}`；
 *   ③ 裸方法名无任何接线证据 → 违规（点了没反应的死开关）。
 *
 * 已知局限（如实记录）：只证明「方法名在 script 中出现过」，不证明接线逻辑正确；
 * 从组合式 API return 的模板变量（Options API methods、跨文件 provide/inject）可能被
 * 误判——本仓全为 <script setup>，实测 349 个处理器中 0 例此形态，故可接受；
 * 宁可漏报不误伤。
 *
 * 退出码：0=通过；1=违规。用法：node scripts/guards/control-consumer.mjs [额外文件...]
 * 纯 Node 零依赖。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

// 模板事件处理器：@click / @click.self / @change / @keyup.enter 等
const EVENT_RE = /@([a-z][\w-]*)(?:\.[a-z-]+)*\s*=\s*"([^"]*)"/g;
// 裸方法名调用：handler 或 handler(args)；排除成员链 / $ 前缀 / 赋值 / 三元
const BARE_CALL_RE = /^([A-Za-z_$][\w$]*)\s*(?:\(([^)]*)\))?$/;
const BUILTINS = new Set(['true', 'false', 'null', 'undefined', 'if', 'else', 'return']);

/** 收集 script 块里所有可作为处理器接线的标识符 */
function collectWiring(scripts) {
  const names = new Set();
  for (const code of scripts) {
    // function foo / const foo / let foo / var foo / class foo
    for (const m of code.matchAll(/\b(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
      names.add(m[1]);
    }
    // import { a, b as c } / import d / import * as e
    for (const m of code.matchAll(/\bimport\s+(?:[\w$]+\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))\s+from\b/g)) {
      if (m[1]) m[1].split(',').forEach((x) => names.add(x.trim().split(/\s+as\s+/).pop().trim()));
      if (m[2]) names.add(m[2]);
      if (m[3]) names.add(m[3]);
    }
    // defineEmits 赋值给变量：const emit = defineEmits(...)
    for (const m of code.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*defineEmits\b/g)) names.add(m[1]);
    // 对象方法简写 / 类型化函数声明：foo(...) { 与 foo: (...) =>
    for (const m of code.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/g)) names.add(m[1]);
    // defineProps 解构 const { a, b } = defineProps(...)
    for (const m of code.matchAll(/const\s*\{([^}]*)\}\s*=\s*defineProps\b/g)) {
      m[1].split(',').forEach((x) => names.add(x.trim().split(/[:=]/)[0].trim()));
    }
    // $emit 在模板里是内置，无需 script 声明
    names.add('$emit');
  }
  return names;
}

/**
 * 检查单份 Vue SFC 的处理器接线。
 * @returns {Array<{line:number,handler:string,message:string}>}
 */
export function checkControlConsumers(code, file = '<vue>') {
  const scripts = [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // 无 <script> 的纯模板组件：无法接线，跳过（宽松侧）
  if (!scripts.length) return [];
  const wired = collectWiring(scripts);
  const template = code.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (m) => ' '.repeat(m.length));
  const violations = [];
  for (const m of template.matchAll(EVENT_RE)) {
    const expr = m[2].trim();
    const call = BARE_CALL_RE.exec(expr);
    if (!call) continue;                              // 成员链 / 内联表达式 / $emit(...) 等
    const id = call[1];
    if (id.startsWith('$') || BUILTINS.has(id)) continue;
    // 参数里含裸标识符（flow.select(floor.index) 之类）在 call[1] 已被识别为 flow，
    // 这里只看处理器本身；带 . 的成员链 expr 不会匹配 BARE_CALL_RE。
    if (!wired.has(id)) {
      violations.push({
        line: code.slice(0, m.index).split('\n').length,
        handler: id,
        message: `事件处理器 @${m[1]}="${expr}" 的 "${id}" 在同文件 <script> 中无声明/导入/emit 接线（死开关）`,
      });
    }
  }
  return violations;
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
  const violations = [];
  let handlerCount = 0;
  for (const file of files) {
    const code = await readFile(file, 'utf8');
    handlerCount += [...code.matchAll(EVENT_RE)].length;
    for (const v of checkControlConsumers(code, file)) {
      violations.push({ ...v, file: path.relative(REPO_ROOT, file).replace(/\\/g, '/') });
    }
  }
  if (violations.length) {
    for (const v of violations) console.error(`✗ ${v.file}:${v.line}: [${v.handler}] ${v.message}`);
    console.error(`\n控件接线守卫未通过：${violations.length} 个事件处理器无接线证据`);
    process.exitCode = 1;
    return;
  }
  console.log(`控件接线守卫通过：${files.length} 个 Vue SFC、${handlerCount} 个事件处理器全部有接线证据`);
  console.log('  注：本仓为 rollup+Vue SFC 构建态，判据为「模板 @事件 处理器标识在 <script> 中有声明/导入/emit」。');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

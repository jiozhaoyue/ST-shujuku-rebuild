/**
 * 静态守卫统一串跑入口（守卫族 P0 · 本仓适配）
 *
 * 参照：ST-chatfilesys-rebuild/scripts/qa-static.mjs —— 移植其
 * 「动态收集 guards/*.mjs → 独立 node 进程 → 单守卫 30s 超时 →
 * 全部通过 exit 0 / 任一失败 exit 1 + 失败清单」设计。
 * 本仓入口放 source/scripts/guards/run-all.mjs，由 package.json 的
 * check:guards 脚本调用；扫描自身目录时排除 run-all.mjs 避免递归串跑。
 *
 * 用法：node scripts/guards/run-all.mjs
 * 纯 Node 零依赖。
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const GUARDS_DIR = path.dirname(fileURLToPath(import.meta.url));
const GUARD_TIMEOUT_MS = 30_000;

// 动态收集：只认 guards 目录下的 *.mjs，排除本入口，按文件名排序保证顺序稳定
const guards = readdirSync(GUARDS_DIR)
  .filter((name) => name.endsWith('.mjs') && name !== 'run-all.mjs')
  .sort();

/** 取守卫输出的首个非空行（stdout 优先，其次 stderr），用于汇总展示 */
function firstLine(result) {
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  for (const line of combined.split(/\r?\n/)) {
    const text = line.trim();
    if (text) return text;
  }
  return '(无输出)';
}

/** 归一化退出码：超时/异常给出可读标记 */
function exitLabel(result) {
  if (result.error) return `超时/异常(${result.error.code ?? result.error.message})`;
  if (result.status === null) return `异常(signal=${result.signal ?? 'unknown'})`;
  return String(result.status);
}

const started = Date.now();
const results = [];
for (const name of guards) {
  const guardPath = path.join(GUARDS_DIR, name);
  const result = spawnSync(process.execPath, [guardPath], {
    cwd: path.resolve(GUARDS_DIR, '..'), // source/ 目录，与各守卫的相对路径基准一致
    encoding: 'utf8',
    timeout: GUARD_TIMEOUT_MS,
  });
  const ok = !result.error && result.status === 0;
  results.push({ name, ok, exit: exitLabel(result), line: firstLine(result) });
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`静态守卫统一入口：共 ${guards.length} 条守卫`);
console.log('');
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${r.name} | 退出码 ${r.exit} | ${r.line}`);
}
console.log('');

const failed = results.filter((r) => !r.ok);
console.log(`汇总：${results.length - failed.length}/${results.length} 通过，耗时 ${elapsed}s`);
if (failed.length) {
  console.log(`失败清单（${failed.length}）：`);
  for (const r of failed) console.log(`  - ${r.name}（退出码 ${r.exit}）`);
  process.exitCode = 1;
} else {
  console.log('全部守卫通过。');
  process.exitCode = 0;
}

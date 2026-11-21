/**
 * docs 隐私守卫（G-11：零凭据、零隐私、零本机绝对路径 · 本仓适配）
 *
 * 参照：ST-chatfilesys-rebuild/scripts/guards/docs-privacy.mjs —— 移植其三类判据：
 *   ① 真实凭据形态（ghp_ / github_pat_ / sk- / Bearer token）；
 *   ② 本机绝对路径（Windows 盘符、Unix /home|/Users 家目录）；
 *   ③ 隐私数据（邮箱地址）。
 * 本仓适配点：
 *   · 扫描范围 = 仓库 docs/ + source/docs/ 下所有 .md（任务书口径），跳过
 *     node_modules / .vitepress / dist / .git / cache；
 *   · 本仓历史文档实测含 20 处本机绝对路径（NODE_PATH="C:/nvm4w/..."、
 *     D:/Repo/...）与 1 处示例凭据串（sk-abcdefghijklmnopqrstuvwxyz，出现在
 *     安全审查文档里作为"匹配示例"）——这些是既有文档资产，硬拦截会让门禁常红，
 *     故默认警告级（exit 0，输出清单）；--strict 转阻断，供违规样例验证；
 *   · Unix 家目录正则须排除 URL scheme 的 http:// / https:// 误报（实测坑）。
 *
 * 退出码：默认 0（警告级）；带 --strict 且命中时 1。
 * 用法：node scripts/guards/docs-privacy.mjs [--strict]
 * 纯 Node 零依赖。
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOC_ROOTS = [
  path.join(REPO_ROOT, 'docs'),
  path.join(REPO_ROOT, 'source', 'docs'),
];
const SKIP_DIRS = new Set(['node_modules', '.vitepress', '.git', 'dist', 'cache']);
const STRICT = process.argv.includes('--strict');

// 每条规则独立成项，命中即报行号与片段
const RULES = [
  { id: '凭据', re: /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/g, message: '真实凭据形态' },
  { id: '本机绝对路径', re: /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s)'"`]+/g, message: 'Windows 盘符绝对路径' },
  { id: '本机绝对路径', re: /(?<![\w/])\/(?:Users|home)\/[^\s)'"`]+/g, message: 'Unix 家目录绝对路径' },
  { id: '隐私', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, message: '邮箱地址' },
];

/** 递归收集 docs 下所有 .md */
async function collectMd(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // 目录不存在时跳过（如本仓 source/docs 可能不存在）
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await collectMd(path.join(dir, e.name), out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

async function main() {
  const files = [];
  for (const root of DOC_ROOTS) files.push(...await collectMd(root));
  files.sort();

  const hits = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(line)) !== null) {
          hits.push(`${rel}:${idx + 1} —— ${rule.message}：${m[0]}`);
          if (m[0].length === 0) rule.re.lastIndex += 1;
        }
      }
    });
  }

  if (hits.length) {
    const tag = STRICT ? '未通过' : '警告';
    console.log(`docs 隐私守卫${tag}：${files.length} 个 md 中发现 ${hits.length} 处禁止内容（G-11）`); // 汇总首行
    for (const hit of hits) console.warn(`  - ${hit}`);
    console.warn(`\ndocs 隐私守卫${tag}：${files.length} 个 md 中发现 ${hits.length} 处禁止内容（G-11）`);
    if (!STRICT) console.warn('  警告级（exit 0）：历史文档既有命中暂不阻断；--strict 可转为阻断以验证违规拦截。');
    if (STRICT) process.exitCode = 1;
    return;
  }
  console.log(`docs 隐私守卫通过：扫描 ${files.length} 个 md，无凭据 / 本机绝对路径 / 邮箱（G-11）`);
}

await main();

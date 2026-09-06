#!/usr/bin/env node
/**
 * scripts/rescue/extract-template.mjs — 从酒馆助手脚本 JSON 中提取内嵌数据库模板
 *
 * 背景：统一状态栏类脚本（如《色色灵感状态栏 V3.713》）把插件数据库模板以
 *   const r=JSON.parse('……');
 * 形式内嵌在打包产物中（模块 3588，模板 JSON 带两层 JS 字符串转义）。
 * 本脚本定位该 JSON.parse 调用，逐层解码，校验解析，输出模板 JSON——
 * 产物可通过插件 AutoCardUpdaterAPI.importTemplateFromData(data, {scope:'chat'}) 导入。
 *
 * 用法：
 *   node extract-template.mjs <脚本.json> <输出模板.json> [--min-sheets 15]
 *
 * 提取策略（对转义层数不敏感）：
 *   1. 找到 `JSON.parse('` 起点；
 *   2. 以 `'),<标识>` 形态（该模块内 JSON.parse 结束后紧跟 `,a=r`）定位真结束；
 *      若找不到，回退为扫描模块边界之间的 `')`；
 *   3. 反复做 JS 字符串反转义（\' \" \\ \n \t \r \uXXXX \xNN），直到能被 JSON.parse 解析；
 *   4. 校验 sheet_ 数量 ≥ --min-sheets，写出。
 *
 * 只读输入脚本文件，不读写酒馆实例目录。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const inPath = args[0];
const outPath = args[1];
if (!inPath || !outPath) {
    console.error('用法: node extract-template.mjs <脚本.json> <输出模板.json> [--min-sheets 15]');
    process.exit(1);
}
const minSheets = (() => {
    const i = args.indexOf('--min-sheets');
    return i >= 0 ? Number(args[i + 1]) || 15 : 15;
})();

const doc = JSON.parse(readFileSync(resolve(inPath), 'utf-8'));
const content = typeof doc === 'string' ? doc : doc.content;
if (typeof content !== 'string') {
    console.error('输入 JSON 需含字符串 content 字段（酒馆助手脚本导出格式）');
    process.exit(1);
}

// ── 1. 定位 JSON.parse( 起点 ──
const MARK = "JSON.parse('";
const starts = [];
let p = 0;
while ((p = content.indexOf(MARK, p)) !== -1) {
    starts.push(p);
    p += MARK.length;
}
if (!starts.length) {
    console.error('未找到 JSON.parse(\' 调用');
    process.exit(2);
}

/** JS 字符串反转义一次（返回 null 表示遇到不成对转义、无法安全解码） */
function jsUnescapeOnce(s) {
    const BS = '\\';
    const map = { "'": "'", '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '/': '/' };
    let out = '';
    let i = 0;
    while (i < s.length) {
        const ch = s[i];
        if (ch === BS && i + 1 < s.length) {
            const n = s[i + 1];
            if (n in map) { out += map[n]; i += 2; continue; }
            if (n === 'u' && i + 6 <= s.length) { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 6; continue; }
            if (n === 'x' && i + 4 <= s.length) { out += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)); i += 4; continue; }
            out += n; i += 2; continue;
        }
        out += ch; i += 1;
    }
    return out;
}

/** 对 raw 反复反转义（≤4 层），直到 JSON.parse 成功 */
function tryParseMulti(raw) {
    let cur = raw;
    for (let level = 0; level < 4; level++) {
        try {
            return { obj: JSON.parse(cur), levels: level };
        } catch (_) { /* 下一层 */ }
        cur = jsUnescapeOnce(cur);
    }
    try { return { obj: JSON.parse(cur), levels: 4 }; } catch (e) {
        throw new Error('解码 4 层后仍无法 JSON.parse: ' + String(e.message).slice(0, 120));
    }
}

// ── 2. 对每个起点：以 `'),<id>` 定位结束并尝试解析，选 sheet 最多的结果 ──
let best = null;
for (const start of starts) {
    const s0 = start + MARK.length;
    // 首选：模块内已知尾随模式 `'),a=r`；通用回退：往后找每个 `')` 逐个尝试
    const candidates = [];
    const m = content.slice(s0, s0 + 500000).match(/'\),[A-Za-z_$]{1,3}=/);
    if (m && m.index !== undefined) candidates.push(m.index);
    let q = s0;
    while ((q = content.indexOf("')", q)) !== -1 && q < s0 + 500000) {
        candidates.push(q - s0);
        q += 2;
    }
    for (const off of candidates) {
        const raw = content.slice(s0, s0 + off);
        try {
            const { obj, levels } = tryParseMulti(raw);
            const sheets = Object.keys(obj).filter((k) => k.startsWith('sheet_')).length;
            if (!best || sheets > best.sheets) {
                best = { obj, sheets, levels, start, rawLen: raw.length };
                if (sheets >= minSheets) break;
            }
        } catch (_) { /* 试下一个候选结束点 */ }
    }
    if (best && best.sheets >= minSheets) break;
}

if (!best || best.sheets < minSheets) {
    console.error(`提取失败：最佳结果 sheets=${best ? best.sheets : 0} < 要求 ${minSheets}`);
    process.exit(3);
}

// ── 3. 输出 ──
mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), JSON.stringify(best.obj, null, 2), 'utf-8');
console.log(`提取成功：sheets=${best.sheets}，转义层数=${best.levels}，源片段 ${best.rawLen} 字节 @ offset ${best.start}`);
console.log(`输出：${resolve(outPath)}`);
for (const k of Object.keys(best.obj)) {
    if (k.startsWith('sheet_')) console.log('  ', k, '|', best.obj[k].name);
}

#!/usr/bin/env node
/**
 * scripts/rescue/replay-chat.mjs — 会话数据库救援：宽容回放重建
 *
 * 用途：聊天文件的 V2 存储帧（TavernDB_ACU_IsolatedData）回放被坏 SQL 卡死
 * （如 UNIQUE constraint failed）导致插件加载报错/降级时，离线把全部数据重建出来，
 * 产出可经插件 AutoCardUpdaterAPI.importTableAsJson 直接导回的 finalState.json。
 *
 * 回放模型（与插件 data/sqlite/sync-bridge.ts 一致）：
 *   1) 全量 checkpoint（storageFrame.checkpoint，kind=full）建库：
 *      各 sheet 的 sourceData.ddl 建表（表名改写为 sheetKey 的 key 形式：
 *      sheet_ji_yao_biao -> jiyaobiao），content[0] 中文表头按 DDL 注释映射物理列后 INSERT；
 *   2) 之后各楼帧的 logEntries 按 seq 顺序重放 operations[].statements（纯 SQL 字符串）。
 *
 * 宽容回放规则（--strict 关闭）：
 *   - INSERT 主键/UNIQUE 冲突：自动改写为 INSERT OR IGNORE 重试一次；
 *   - 单条语句仍失败：跳过并记录诊断，不中断整个回放；
 *   - 其余错误（建库失败等）：照常上抛。
 *
 * 用法：
 *   node replay-chat.mjs <chat.jsonl路径> <输出目录> [--isolation <隔离键>] [--strict] [--from <楼层>]
 *
 * 输出（写入输出目录）：
 *   finalState.json  — mate + 各 sheet（uid/name/sourceData/content），importTableAsJson 可直接导回
 *   diagnostics.json — 每条被改写/跳过语句的楼层、seq、operationIndex、原因、语句
 *   summary.md       — 表×行数统计 + 诊断摘要
 *
 * 本工具只读输入聊天文件，不读写酒馆实例目录。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

// ───────────────────────── CLI ─────────────────────────
const args = process.argv.slice(2);
const chatPath = args[0];
const outDir = args[1];
if (!chatPath || !outDir) {
    console.error('用法: node replay-chat.mjs <chat.jsonl路径> <输出目录> [--isolation <隔离键>] [--strict] [--from <楼层>]');
    process.exit(1);
}
const isolation = readFlag('--isolation', '');
const strict = args.includes('--strict');
const fromLine = Number(readFlag('--from', '0')) || 0;

function readFlag(name, dflt) {
    const i = args.indexOf(name);
    if (i < 0 || i + 1 >= args.length) return dflt;
    return args[i + 1];
}

// ─────────────────────── 解析辅助 ───────────────────────
/** sheetKey → 回放库表名（sheet_ji_yao_biao -> jiyaobiao） */
function keyFormOf(sheetKey) {
    return sheetKey.replace(/^sheet_/, '').replace(/_/g, '');
}

/** 解析 CREATE TABLE DDL：物理表名 + 列定义（列名、中文注释）
 *  注意：注释提取必须支持行尾 CHECK(...) 之后的 "-- 注释"（与插件 parseDDLColumnInfos 一致），
 *  否则 NOT NULL 列缺注释表头会触发导入审计 upgrade_required_mapping_ambiguous。 */
function parseDdl(ddl) {
    const physName = (ddl.match(/CREATE TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i) || [])[1];
    if (!physName) throw new Error('DDL 缺少 CREATE TABLE 表名: ' + ddl.slice(0, 80));
    const columns = [];
    for (const rawLine of ddl.split(/\r?\n/)) {
        const m = rawLine.match(/^\s*(\w+)\s+([A-Za-z]+[^,]*?),?\s*(?:--\s*(.*))?\s*$/);
        if (!m) continue;
        const [, name, type, comment] = m;
        if (/^(CREATE|TABLE|PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(name)) continue;
        if (!/^(INTEGER|TEXT|REAL|NUMERIC|BLOB|VARCHAR|CHAR|BOOLEAN|DATETIME|DATE)/i.test(type)) continue;
        columns.push({ name, comment: (comment || '').trim() });
    }
    if (!columns.length) throw new Error('DDL 未解析出列: ' + ddl.slice(0, 120));
    return { physName, columns };
}

/** 从列定义行提取注释（支持 CHECK(...) 等括号结构之后的行尾注释） */
function extractLineComment(line) {
    const idx = line.lastIndexOf('--');
    return idx >= 0 ? line.slice(idx + 2).trim() : '';
}

/** 括号感知的 DDL 列解析：CHECK(IN (...)) 内含逗号会让简单正则截断，导致
 *  尾列（NOT NULL 无默认值）丢失 → 导入审计 upgrade_required_mapping_ambiguous。 */
function parseDdlColumnsParenAware(ddl) {
    const columns = [];
    for (const line of ddl.split(/\r?\n/)) {
        const m = line.match(/^\s*(\w+)\s+(INTEGER|TEXT|REAL|NUMERIC|BLOB|VARCHAR)\b(.*)$/i);
        if (!m) continue;
        const name = m[1];
        const comment = extractLineComment(line);
        columns.push({ name, comment });
    }
    return columns;
}

/** 把 DDL 中的表名改写为 key 形式（只替换 CREATE TABLE 处，其余照旧） */
function rebindDdlTableName(ddl, newPhys) {
    return ddl.replace(/CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)/i, (m0, ifne) =>
        `CREATE TABLE ${ifne || ''}${newPhys}`.replace(/\s+/g, ' '));
}

function ensureFrameParsed(v) {
    let val = v;
    if (typeof val === 'string') val = JSON.parse(val);
    return val;
}

// ─────────────────────── 主流程 ───────────────────────
const raw = readFileSync(chatPath, 'utf-8');
const lines = raw.split('\n').filter((l) => l.trim() !== '');
console.log(`聊天文件共 ${lines.length} 楼（行）`);

// 收集各帧（楼号 → 存储帧）
/** @type {{line:number, iso:string, frame:any}[]} */
const frames = [];
/** checkpoint 位置 */
let checkpoint = null; // { line, iso, checkpoint, data }
for (let i = 0; i < lines.length; i++) {
    if (i < fromLine) continue;
    if (!lines[i].includes('TavernDB_ACU_IsolatedData')) continue;
    let msg;
    try { msg = JSON.parse(lines[i]); } catch (e) { console.warn(`第 ${i} 行 JSON 解析失败，跳过: ${e.message}`); continue; }
    let idt = msg.TavernDB_ACU_IsolatedData;
    // 也可能嵌在 chat_metadata
    if (!idt && msg.chat_metadata && msg.chat_metadata.TavernDB_ACU_IsolatedData) idt = msg.chat_metadata.TavernDB_ACU_IsolatedData;
    if (!idt) continue;
    idt = ensureFrameParsed(idt);
    for (const [iso, v] of Object.entries(idt)) {
        if (!v || typeof v !== 'object' || !v.storageFrame) continue;
        const frame = ensureFrameParsed(v.storageFrame);
        frames.push({ line: i, iso, frame });
        if (frame.checkpoint && iso === isolation) {
            const cp = ensureFrameParsed(frame.checkpoint);
            if (cp.kind === 'full' && cp.data) checkpoint = { line: i, checkpoint: cp, data: cp.data };
        }
    }
}
console.log(`发现 ${frames.length} 个存储帧（隔离键="${isolation}"），checkpoint=${checkpoint ? '第 ' + checkpoint.line + ' 行' : '缺失'}`);
if (!checkpoint) {
    console.error('未找到全量 checkpoint（kind=full）。可用 --from 指定起始楼。');
    process.exit(2);
}

// ── 建库：checkpoint DDL + content 导入 ──
const SQL = await initSqlJs();
const db = new SQL.Database();
const dbErr = (e) => { const s = String(e && e.message || e); return s; };

/** 全程诊断记录：checkpoint 建库与 logEntries 回放共用 */
/** @type {any[]} */
const diag = [];

/** @type {Record<string, {sheetKey:string, meta:any, phys:string, columns:{name:string,comment:string}[]}>} */
const sheetsByPhys = {};
const mate = checkpoint.data.mate || { type: 'chatSheets', version: 2 };

for (const [sheetKey, sheet] of Object.entries(checkpoint.data)) {
    if (!sheetKey.startsWith('sheet_')) continue;
    const ddlSrc = sheet.sourceData && sheet.sourceData.ddl || '';
    const { physName, columns } = parseDdl(ddlSrc);
    // 行内注释补齐：主正则吃不掉 CHECK(...) 后注释的列，用 lastIndexOf('--') 再取一次
    for (const col of columns) {
        if (col.comment) continue;
        const line = ddlSrc.split(/\r?\n/).find((l) => new RegExp(`^\\s*${col.name}\\s+`).test(l));
        if (line) col.comment = extractLineComment(line);
    }
    const phys = keyFormOf(sheetKey); // 回放库的实际表名
    const ddl = rebindDdlTableName(ddlSrc, phys);
    db.run(ddl);
    // content[0] 中文表头 → 物理列名
    const header = Array.isArray(sheet.content) && sheet.content[0] || [];
    const colNames = columns.map((c) => c.name);
    // 按注释匹配表头（row_id 直接同名）；匹配不上的列留 NULL
    const headerToCol = colNames.map((name, idx) => {
        const cmt = columns[idx].comment || name;
        const hIdx = header.findIndex((h) => h === cmt || h === name);
        return hIdx >= 0 ? hIdx : -1;
    });
    let imported = 0;
    for (let r = 1; r < (sheet.content || []).length; r++) {
        const row = sheet.content[r];
        const vals = colNames.map((_, ci) => {
            const hIdx = headerToCol[ci];
            return hIdx >= 0 ? (row[hIdx] ?? null) : null;
        });
        const placeholders = colNames.map(() => '?').join(',');
        try {
            db.run(`INSERT INTO ${phys} (${colNames.join(',')}) VALUES (${placeholders})`, vals);
            imported++;
        } catch (e) {
            diag.push({ line: checkpoint.line, seq: 'checkpoint', op: -1, phys, action: 'skip', reason: dbErr(e), sql: `INSERT ${phys} 行${r}` });
        }
    }
    sheetsByPhys[phys] = { sheetKey, meta: sheet, phys, columns };
    void imported;
}

// ── 重放 logEntries ──
let replayedOps = 0, replayedStmts = 0, skipped = 0, rewritten = 0;
for (const { line, iso, frame } of frames) {
    if (iso !== isolation) continue;
    const entries = frame.logEntries || [];
    for (const entry of entries) {
        const ops = entry.operations || [];
        for (let oi = 0; oi < ops.length; oi++) {
            const op = ops[oi];
            if (op.kind !== 'sql_sheet_batch') { diag.push({ line, seq: entry.seq, op: oi, action: 'skip-kind', reason: '非 sql_sheet_batch: ' + op.kind, sql: '' }); continue; }
            replayedOps++;
            const stmts = op.statements || [];
            for (let si = 0; si < stmts.length; si++) {
                const st = stmts[si];
                if (typeof st !== 'string' || !st.trim()) continue;
                replayedStmts++;
                try {
                    db.run(st);
                } catch (e1) {
                    const msg1 = dbErr(e1);
                    const isUnique = /UNIQUE constraint failed/i.test(msg1);
                    if (!strict && isUnique && /^\s*INSERT\s+INTO/i.test(st) && !/INSERT\s+OR\s+IGNORE/i.test(st)) {
                        const retry = st.replace(/^\s*INSERT\s+INTO/i, 'INSERT OR IGNORE INTO');
                        try {
                            db.run(retry);
                            rewritten++;
                            diag.push({ line, seq: entry.seq, op: oi, action: 'rewrite-or-ignore', reason: msg1, sql: st });
                            continue;
                        } catch (e2) {
                            skipped++;
                            diag.push({ line, seq: entry.seq, op: oi, action: 'skip', reason: dbErr(e2) + '（初错: ' + msg1 + '）', sql: st });
                            continue;
                        }
                    }
                    skipped++;
                    diag.push({ line, seq: entry.seq, op: oi, action: 'skip', reason: msg1, sql: st });
                    if (strict) throw e1;
                }
            }
        }
    }
}

// ── 导出 finalState ──
mkdirSync(outDir, { recursive: true });
const finalSheets = {};
const tableStats = [];
for (const [phys, info] of Object.entries(sheetsByPhys)) {
    const colNames = info.columns.map((c) => c.name);
    // 表头必须覆盖 DDL 全部列：checkpoint 的 content 表头可能与自身 DDL 漂移
    // （如缺 CHECK 尾列），缺列会让导入审计报 upgrade_required_mapping_ambiguous。
    // 以 DDL 为准重建表头，缺失列在数据行中补空串。
    const ddlCols = parseDdlColumnsParenAware(info.meta.sourceData && info.meta.sourceData.ddl || '');
    const ddlColNames = ddlCols.map((c) => c.name);
    const colIndexByName = new Map(colNames.map((n, i) => [n, i]));
    const orderedCols = ddlColNames.map((n) => ({ name: n, comment: ddlCols.find((c) => c.name === n).comment }));
    const headers = ['row_id', ...orderedCols.slice(1).map((c) => c.comment || c.name)];
    const q = db.exec(`SELECT ${colNames.join(',')} FROM ${phys} ORDER BY row_id`);
    const rawRows = q.length ? q[0].values : [];
    // 物理列顺序 → DDL 列顺序重排 + 补宽
    const selectIndexForDdlCol = orderedCols.map((c) => colIndexByName.get(c.name));
    const rows = rawRows.map((row) => orderedCols.map((c, i) => {
        const src = selectIndexForDdlCol[i];
        return src !== undefined && src !== null ? row[src] : '';
    }));
    finalSheets[info.sheetKey] = {
        ...info.meta,
        content: [headers, ...rows],
    };
    tableStats.push({ sheetKey: info.sheetKey, name: info.meta.name, phys, rows: rows.length });
}

const finalState = { mate, ...finalSheets };
const finalPath = join(outDir, 'finalState.json');
writeFileSync(finalPath, JSON.stringify(finalState, null, 1), 'utf-8');

const diagPath = join(outDir, 'diagnostics.json');
writeFileSync(diagPath, JSON.stringify({ chatPath: resolve(chatPath), isolation, strict, checkpointLine: checkpoint.line, rewritten, skipped, entries: diag }, null, 1), 'utf-8');

const statRows = tableStats.map((t) => `| ${t.name} | ${t.sheetKey} | ${t.phys} | ${t.rows} |`).join('\n');
const diagBrief = diag.slice(0, 50).map((d) => `- 楼${d.line} seq=${d.seq} op=${d.op} [${d.action}] ${d.reason}`).join('\n');
const summary = `# 回放摘要

- 聊天文件：\`${resolve(chatPath)}\`（${lines.length} 行）
- 隔离键：\`${isolation}\`；checkpoint 位于第 ${checkpoint.line} 行（kind=full）
- 回放操作批次：${replayedOps}；语句：${replayedStmts}
- 宽容改写（INSERT OR IGNORE）：${rewritten}；跳过：${skipped}

## 表×行数

| 表名 | sheetKey | 物理表 | 行数 |
|---|---|---|---|
${statRows}

## 诊断（前 50 条，完整见 diagnostics.json）

${diagBrief || '（无）'}
`;
writeFileSync(join(outDir, 'summary.md'), summary, 'utf-8');

console.log(`回放完成：${replayedStmts} 条语句，改写 ${rewritten}，跳过 ${skipped}`);
console.log('表行数：', Object.fromEntries(tableStats.map((t) => [t.phys, t.rows])));
console.log('输出目录：', outDir);

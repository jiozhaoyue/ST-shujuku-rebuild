// rescue-replay-parse.test.ts — 救援回放脚本纯函数单测（任务 10-31-nightshift-improvements C3）
//
// replay-chat.mjs 自 2026-10-31 起为 CLI/模块双形态：被 import 时只导出纯函数，不执行主流程。
// 回归背景：真实模板 romance_diary 的 event_type 列带 CHECK(... IN ('a', 'b', ...))，
// 旧版 parseDdl 逐行逗号正则把该列整条丢弃 → checkpoint 导入时全行 NOT NULL 跳过。
import { describe, expect, it } from 'vitest';
import {
    buildHeaderToCol,
    extractLineComment,
    keyFormOf,
    matchTableByColumnSignature,
    normalizeHeaderCell,
    parseDdl,
    rebindDdlTableName,
    replaceAliasAfterFromJoin,
    replaceAliasOutsideStrings,
} from '../../scripts/rescue/replay-chat.mjs';

const ROMANCE_DIARY_DDL = `CREATE TABLE romance_diary ( -- 恋爱日记表
  row_id INTEGER PRIMARY KEY, -- 行号
  writer TEXT NOT NULL, -- 写作角色
  related_char TEXT NOT NULL, -- 关联角色
  summary TEXT NOT NULL, -- 日记内容
  time TEXT NOT NULL, -- 发生时间
  event_type TEXT NOT NULL CHECK(event_type IN ('初次相遇', '日常互动', '感情升温', '冲突矛盾', '和解修复', '亲密接触', '里程碑', '特殊事件')) -- 事件类型
);`;

describe('parseDdl（括号感知 + 字符串感知）', () => {
    it('romance_diary 回归：CHECK(IN(...)) 内含逗号不丢尾列，注释正确', () => {
        const { physName, columns } = parseDdl(ROMANCE_DIARY_DDL);
        expect(physName).toBe('romance_diary');
        expect(columns.map((c: any) => c.name)).toEqual([
            'row_id', 'writer', 'related_char', 'summary', 'time', 'event_type',
        ]);
        expect(columns[5].comment).toBe('事件类型');
        expect(columns[1].comment).toBe('写作角色');
        expect(columns[0].comment).toBe('行号');
    });

    it('多行 CHECK 约束不撕碎列定义', () => {
        const ddl = `CREATE TABLE t_demo (
  id INTEGER PRIMARY KEY, -- 行号
  state TEXT NOT NULL CHECK(state IN (
    'draft',
    'final'
  )) -- 状态
);`;
        const { columns } = parseDdl(ddl);
        expect(columns.map((c: any) => c.name)).toEqual(['id', 'state']);
        expect(columns[1].comment).toBe('状态');
    });

    it("字符串字面量内的 '--' 不当注释、'' 转义不终止字符串", () => {
        const ddl = `CREATE TABLE t_edge (
  a TEXT, -- 备注A
  b TEXT DEFAULT 'x--y' -- 备注B
);`;
        const { columns } = parseDdl(ddl);
        expect(columns.map((c: any) => c.name)).toEqual(['a', 'b']);
        expect(columns[0].comment).toBe('备注A');
        expect(columns[1].comment).toBe('备注B');
    });

    it('表级约束（PRIMARY KEY / UNIQUE）不误判为列', () => {
        const ddl = `CREATE TABLE t_constraint (
  id INTEGER, -- 行号
  code TEXT, -- 编码
  PRIMARY KEY (id),
  UNIQUE (code)
);`;
        const { columns } = parseDdl(ddl);
        expect(columns.map((c: any) => c.name)).toEqual(['id', 'code']);
    });
});

describe('extractLineComment / normalizeHeaderCell', () => {
    it('取最后一个字符串外注释', () => {
        expect(extractLineComment("a TEXT, -- 备注")).toBe('备注');
        expect(extractLineComment("a TEXT DEFAULT 'v--x' -- 真注释")).toBe('真注释');
        expect(extractLineComment('a TEXT')).toBe('');
    });
    it('归一化：全半角标点 / 空白 / 大小写', () => {
        expect(normalizeHeaderCell(' 事件类型（记录） ')).toBe('事件类型记录');
        expect(normalizeHeaderCell('Event: Type')).toBe('eventtype');
    });
});

describe('buildHeaderToCol（三级匹配 + used 集防同抢）', () => {
    const cols = [
        { name: 'row_id', comment: '行号' },
        { name: 'writer', comment: '写作角色' },
        { name: 'event_type', comment: '事件类型' },
    ];

    it('精确匹配：表头 === 注释或物理名', () => {
        expect(buildHeaderToCol(cols, ['行号', '写作角色', '事件类型'])).toEqual([0, 1, 2]);
        expect(buildHeaderToCol(cols, ['row_id', 'writer', 'event_type'])).toEqual([0, 1, 2]);
    });

    it('归一化兜底：全半角标点差异可命中', () => {
        expect(buildHeaderToCol(cols, ['行号', '写作角色：', '（事件类型）'])).toEqual([0, 1, 2]);
    });

    it('子串互含兜底：表头带前后缀修饰可命中', () => {
        expect(buildHeaderToCol(cols, ['row_id', '当前写作角色', '事件类型记录'])).toEqual([0, 1, 2]);
    });

    it('匹配不上的列留 -1；同一表头不被两列重复分配', () => {
        // 「写作角色」缺失 → writer 列 -1；「事件类型」只有一格 → 第三列 -1 而非同抢
        expect(buildHeaderToCol(cols, ['行号', '事件类型'])).toEqual([0, -1, 1]);
        expect(buildHeaderToCol(cols, ['行号'])).toEqual([0, -1, -1]);
    });
});

describe('keyFormOf / rebindDdlTableName（回归保护）', () => {
    it('sheetKey → 键形式', () => {
        expect(keyFormOf('sheet_ji_yao_biao')).toBe('jiyaobiao');
    });
    it('DDL 表名改绑保留列定义', () => {
        const out = rebindDdlTableName(ROMANCE_DIARY_DDL, 'beiwanglu');
        expect(out).toContain('CREATE TABLE beiwanglu');
        expect(out).toContain('event_type');
    });
});

describe('matchTableByColumnSignature（救援回放 v2：旧代物理名列签名改绑）', () => {
    const tables = [
        { phys: 'romance_targets', names: ['row_id', 'char_name', 'affection_level', 'note'] },
        { phys: 'status_bar', names: ['row_id', 'arousal', 'stamina'] },
    ];

    it('列清单唯一命中 → 头部表名改绑', () => {
        const st = "INSERT INTO lianaiduixiangbiao (row_id, char_name, affection_level, note) VALUES (1, 'a', 2, 'b')";
        expect(matchTableByColumnSignature(st, tables)).toBe(
            "INSERT INTO romance_targets (row_id, char_name, affection_level, note) VALUES (1, 'a', 2, 'b')",
        );
    });

    it('大小写/引号列名归一化命中', () => {
        const st = 'INSERT INTO OLD_T ("ROW_ID", "Arousal") VALUES (1, 2)';
        expect(matchTableByColumnSignature(st, tables)).toBe('INSERT INTO status_bar ("ROW_ID", "Arousal") VALUES (1, 2)');
    });

    it('≥2 候选（歧义）→ null 不猜', () => {
        const both = [...tables, { phys: 'another', names: ['row_id', 'char_name'] }];
        const st = 'INSERT INTO old_name (row_id, char_name) VALUES (1, 2)';
        expect(matchTableByColumnSignature(st, both)).toBeNull();
    });

    it('无候选 / 非INSERT / 空列清单 → null', () => {
        expect(matchTableByColumnSignature('INSERT INTO x (nope) VALUES (1)', tables)).toBeNull();
        expect(matchTableByColumnSignature('INSERT INTO x () VALUES ()', tables)).toBeNull();
    });

    it('UPDATE：SET 左值 + WHERE 列组成签名集，唯一命中改绑', () => {
        const st = "UPDATE lianaiduixiangbiao SET past_experience = past_experience || 'x=y, z', recent_interactions = 'a' WHERE name = '后藤一里'";
        expect(matchTableByColumnSignature(st, [
            { phys: 'romance_targets', names: ['row_id', 'name', 'past_experience', 'recent_interactions'] },
            { phys: 'status_bar', names: ['row_id', 'arousal'] },
        ])).toBe("UPDATE romance_targets SET past_experience = past_experience || 'x=y, z', recent_interactions = 'a' WHERE name = '后藤一里'");
    });

    it('UPDATE：字符串字面量里的 = 与逗号不干扰签名', () => {
        const st = "UPDATE old_t SET note = 'WHERE fake = 1, x' WHERE code = 'IN''J'" ;
        expect(matchTableByColumnSignature(st, [
            { phys: 't_a', names: ['row_id', 'note', 'code'] },
            { phys: 't_b', names: ['row_id', 'note'] },
        ])).toBe("UPDATE t_a SET note = 'WHERE fake = 1, x' WHERE code = 'IN''J'");
    });

    it('UPDATE：歧义或无候选 → null', () => {
        const st = 'UPDATE old_t SET row_id = 1';
        expect(matchTableByColumnSignature(st, [
            { phys: 't_a', names: ['row_id', 'note'] },
            { phys: 't_b', names: ['row_id', 'memo'] },
        ])).toBeNull();
        expect(matchTableByColumnSignature('UPDATE old_t SET nope = 1', tables)).toBeNull();
    });

    it('前导注释不挡签名匹配（真实 logEntries 常态；返回值为注释剥离后的语句）', () => {
        const st = "-- 更新恋爱对象经历\nUPDATE lianaiduixiangbiao SET past_experience = 'x' WHERE row_id = 1";
        expect(matchTableByColumnSignature(st, [
            { phys: 'romance_targets', names: ['row_id', 'past_experience'] },
        ])).toBe("UPDATE romance_targets SET past_experience = 'x' WHERE row_id = 1");
    });
});

describe('replaceAliasOutsideStrings（残余别名：子查询等非头部位置）', () => {
    it('子查询里的旧名整词替换，头部已正确名不受影响', () => {
        const st = 'DELETE FROM romance_diary WHERE row_id IN (SELECT row_id FROM lianairijibiao ORDER BY time ASC LIMIT 4)';
        expect(replaceAliasOutsideStrings(st, 'lianairijibiao', 'romance_diary')).toBe(
            'DELETE FROM romance_diary WHERE row_id IN (SELECT row_id FROM romance_diary ORDER BY time ASC LIMIT 4)',
        );
    });

    it("字符串字面量内的同形词不替换（无外部命中返回 null）", () => {
        const st = "UPDATE t SET note = 'see lianairijibiao here''s ok' WHERE src = 'lianairijibiao'";
        expect(replaceAliasOutsideStrings(st, 'lianairijibiao', 'romance_diary')).toBeNull();
    });

    it('整词边界：前缀相同的其他标识符不受影响；无命中返回 null', () => {
        expect(replaceAliasOutsideStrings('SELECT lianairijibiao_extra FROM t', 'lianairijibiao', 'x')).toBeNull();
        expect(replaceAliasOutsideStrings('SELECT 1', 'lianairijibiao', 'x')).toBeNull();
    });
});

describe('replaceAliasAfterFromJoin（关键词锚定残余别名）', () => {
    it('替换 FROM/JOIN 之后的旧名（子查询场景）', () => {
        const st = 'DELETE FROM romance_diary WHERE row_id IN (SELECT row_id FROM lianairijibiao ORDER BY time ASC LIMIT 4)';
        expect(replaceAliasAfterFromJoin(st, 'lianairijibiao', 'romance_diary')).toBe(
            'DELETE FROM romance_diary WHERE row_id IN (SELECT row_id FROM romance_diary ORDER BY time ASC LIMIT 4)',
        );
    });

    it('回归（2026-10-31 实证）：列清单里的同名单词不被改写', () => {
        // sheet_summary 的键形式别名「summary」恰好是 romance_diary 的列名——必须原样保留
        const st = "INSERT INTO romance_diary (row_id, writer, related_char, summary, time, event_type) VALUES (1, 'w', 'c', 's', 't', '初次相遇')";
        expect(replaceAliasAfterFromJoin(st, 'summary', 'chronicle')).toBeNull();
    });

    it('字符串字面量内不替换；非 FROM/JOIN 前缀不替换', () => {
        expect(replaceAliasAfterFromJoin("SELECT ' summary ' FROM t", 'summary', 'chronicle')).toBeNull();
        expect(replaceAliasAfterFromJoin('SELECT summary FROM t', 'summary', 'chronicle')).toBeNull();
        expect(replaceAliasAfterFromJoin('SELECT * FROM summary', 'summary', 'chronicle')).toBe('SELECT * FROM chronicle');
    });
});

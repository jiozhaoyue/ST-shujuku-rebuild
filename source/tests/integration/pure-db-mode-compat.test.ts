/**
 * tests/integration/pure-db-mode-compat.test.ts — 纯数据库模式（chatfilesys 联动）兼容守卫
 *
 * ── 为什么有这条测试 ──────────────────────────────────────────────
 * 姊妹插件 `ST-chatfilesys-rebuild` 的**纯数据库模式**会接管酒馆的聊天读写出口
 * （monkey-patch 全局 fetch，拦截 `/api/chats/*` 的加载/保存/追加/改名/删除）：
 *
 * - **读聊天**：拦截层按坐标从库里取楼层，**按酒馆期待的原格式**组装整份回复还回去
 *   ⇒ 其他插件（含本插件）对这些消息的读取照常工作。
 * - **存聊天**：酒馆发来的整份内容被拆回「第几层 / 第几个变体」写进库；本插件落在
 *   消息上的表格字段因此随消息一起进库、读回时原样还原。
 * - **聊天绑定的插件状态**（chatMetadata / `/api/chats/state/*`）：它**只转发、不读不写**
 *   （有意为之：纯数据库模式不该顺手接管别人的状态）。
 *
 * 由此得出本插件与纯数据库模式的**兼容前提**（这份前提就是本文件钉住的东西）：
 *
 * 1. **不直连聊天端点、不碰文件系统**。聊天持久化只能经宿主 `saveChat()` 一类公开 API，
 *    这样请求才必然穿过拦截层；任何直接 `fetch('/api/chats/…')` 或 `fs` 读写都会绕过它。
 * 2. **持久化面必须显式且可审查**。本插件只有四类落点，任何新增都必须被分类：
 *    - 消息字段（随消息进库，走拦截层）
 *    - chat[0] 镜像 + chatMetadata（只转发，不接管）
 *    - 浏览器本地（IndexedDB / localStorage，与宿主存储无关）
 *    - 服务端向量文件（按路径存放，不经聊天接口）
 *    第 3 类里若有按「聊天」定键的东西，在纯数据库「一个家族多分支」下要自己保证键
 *    仍然稳定——见下方「非聊天通道」清单的注释。
 *
 * 这条测试是**钉子**（形态同 `tests/shared/manifest-identity.test.ts`）：改动了持久化面
 * 就会变红，逼作者把新成员归类并同步本文件与 `MESSAGE_TABLE_FIELDS_ACU` 清单。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|vue)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = collectSourceFiles(SRC_ROOT);

function readAll(): Array<{ rel: string; text: string }> {
  return SOURCE_FILES.map(abs => ({
    rel: abs.slice(SRC_ROOT.length + 1).replace(/\\/g, '/'),
    text: readFileSync(abs, 'utf8'),
  }));
}

/** 聊天消息字段（随消息进库，由拦截层拆存）。与 MESSAGE_TABLE_FIELDS_ACU 对齐。 */
const MESSAGE_FIELDS = [
  'TavernDB_ACU_IsolatedData',
  'TavernDB_ACU_IndependentData',
  'TavernDB_ACU_Data',
  'TavernDB_ACU_SummaryData',
  'TavernDB_ACU_Identity',
  'TavernDB_ACU_LocalMessageAnchor',
  'TavernDB_ACU_ModifiedKeys',
  'TavernDB_ACU_UpdateGroupKeys',
];

/**
 * `MESSAGE_TABLE_FIELDS_ACU` 里唯一一个不带 `TavernDB_ACU_` 前缀的成员（模板基底播种标记）。
 * 它不参与上面的前缀扫描，但必须参与「与 data 层清单一致」的比对。
 */
const MESSAGE_FIELD_NON_PREFIXED = '_acu_local_template_base_state_seeded';

/** chat[0] 镜像 + chatMetadata 容器（纯数据库模式下只被转发，不被接管）。 */
const CHAT_SCOPE_FIELDS = [
  'TavernDB_ACU_ScopedConfig',
  'TavernDB_ACU_InternalSheetGuide',
  'TavernDB_ACU_TableHeaderGuide',
];

/**
 * 非聊天通道：不经 `/api/chats/*`，因此不在 chatfilesys 的接管范围里。
 * 它们靠**别的键**定位，本插件自己对「键在纯数据库家族/分支切换下是否稳定」负责。
 */
const NON_CHAT_CHANNELS = [
  'TavernDB_ACU_VectorHotCache', // IndexedDB 库名（浏览器本地）
  'TavernDB_ACU_VectorTempCache', // IndexedDB 库名（浏览器本地）
  'TavernDB_ACU_vector_registry', // 服务端向量索引注册表路径
  'TavernDB_ACU_vector_orphan_sweep_last_run', // localStorage 节流键
  // 下面三个是“前缀拼接”的产物（如 `TavernDB_ACU_vector_${id}`），按前缀归入本类
  'TavernDB_ACU_vector',
  'TavernDB_ACU_vector_',
  'TavernDB_ACU_vector_v',
];

describe('纯数据库模式兼容 · 前提一：不绕过宿主聊天通道', () => {
  it('源码里没有直连 /api/chats 的请求（必须经宿主 API，请求才会穿过拦截层）', () => {
    const offenders = readAll()
      .filter(({ text }) => /fetch\(\s*[`'"][^`'"]*\/api\/chats/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('源码里没有文件系统读写（不假设聊天是磁盘上的文件）', () => {
    const offenders = readAll()
      .filter(({ text }) => /from\s+'node:fs'|require\(\s*'fs'|from\s+'fs'/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('聊天保存只有单一漏斗（data/gateways/chat-gateway.ts）', () => {
    const callers = readAll()
      .filter(({ text }) => /SillyTavern_API_ACU\??\.saveChat\(/.test(text))
      .map(({ rel }) => rel);
    expect(callers).toEqual(['data/gateways/chat-gateway.ts']);
  });
});

describe('纯数据库模式兼容 · 前提二：持久化面显式且可审查', () => {
  it('源码用到的 TavernDB_ACU_* 名字集合与本文档登记的清单逐字相等', () => {
    const used = new Set<string>();
    for (const { text } of readAll()) {
      for (const match of text.matchAll(/TavernDB_ACU_[A-Za-z_]+/g)) used.add(match[0]);
    }
    const documented = new Set([...MESSAGE_FIELDS, ...CHAT_SCOPE_FIELDS, ...NON_CHAT_CHANNELS]);
    // 双向比较：多出来的（新增未归类）与少掉的（清单过期）都要报出来
    const undocumented = [...used].filter(name => !documented.has(name)).sort();
    const stale = [...documented].filter(name => !used.has(name)).sort();
    expect({ undocumented, stale }).toEqual({ undocumented: [], stale: [] });
  });

  it('消息字段清单与 data 层的 MESSAGE_TABLE_FIELDS_ACU 一致（两处不得漂移）', async () => {
    const mod = await import('../../src/data/repositories/chat-message-data-repo');
    expect([...mod.MESSAGE_TABLE_FIELDS_ACU].sort())
      .toEqual([...MESSAGE_FIELDS, MESSAGE_FIELD_NON_PREFIXED].sort());
  });

  it('chat[0] 镜像字段清单与 data 层一致', async () => {
    const mod = await import('../../src/data/repositories/chat-message-data-repo');
    expect([...mod.FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU].sort()).toEqual([...CHAT_SCOPE_FIELDS].sort());
  });
});

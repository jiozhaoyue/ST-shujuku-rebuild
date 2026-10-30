// threshold-registry-guard.test.ts — 阈值注册表 CI 守卫（任务 10-31-nightshift-improvements C2）
//
// 默认阈值的唯一事实源是 src/shared/defaults.ts（台账口径）。本守卫防两类回潮：
//   1) 注册表标识符在 defaults.ts 之外被重声明（复制常量定义）；
//   2) 注册表默认值的「特征字面量」在业务代码里散落硬编码（复制数值而非 import）。
// 白名单按文件路径冻结（相对 src/，正斜杠）；新增白名单项必须在该文件写注释说明理由。
// 修改注册表默认值本身会被「值快照」用例拦下——改默认值属于数据兼容变更，必须走
// 迁移与用户公告，不允许静默修改（AC2 有效性：临时植入散落字面量本用例必须变红）。

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_CONTEXT_SETTINGS_LIMITS_ACU,
  DEFAULT_AGENT_CONTEXT_SETTINGS_ACU,
  DEFAULT_AUTO_UPDATE_FREQUENCY_ACU,
  DEFAULT_AUTO_UPDATE_THRESHOLD_ACU,
  DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU,
  AUTO_UPDATE_FLOOR_INCREASE_DELAY_ACU,
  OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU,
  OVERSIZED_CELL_WARN_CHARS_MAX_ACU,
  OVERSIZED_CELL_WARN_CHARS_MIN_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_MAX_ACU,
  OVERSIZED_PAYLOAD_WARN_BYTES_MIN_ACU,
  OVERSIZED_WRITE_WARNING_ENABLED_DEFAULT_ACU,
  defaultVectorMemoryConfig_ACU,
  defaultWorldbookConfig_ACU,
} from '../../src/shared/defaults';

const REPO_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkSources(p));
    else if (/\.(ts|vue)$/.test(name)) out.push(p);
  }
  return out;
}

const ALL_SOURCES: string[] = walkSources(REPO_SRC);

/** 相对 src/ 的正斜杠路径（用于白名单比对） */
function relOf(file: string): string {
  return normalize(file).split('\\').join('/').replace(/^.*\/src\//, '');
}

function boundaryRegex(literal: string): RegExp {
  const esc = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9_.])${esc}([^0-9_]|$)`);
}

// ═══ 1. 值快照：默认值不许静默改（数据兼容红线：改默认值 = 行为变更，须走迁移） ═══
describe('阈值注册表值快照（shared/defaults.ts）', () => {
  it('自动更新 / 超大字段写入阈值与文档口径一致', () => {
    expect(DEFAULT_AUTO_UPDATE_THRESHOLD_ACU).toBe(3);
    expect(DEFAULT_AUTO_UPDATE_FREQUENCY_ACU).toBe(1);
    expect(DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU).toBe(500);
    expect(AUTO_UPDATE_FLOOR_INCREASE_DELAY_ACU).toBe(2000);
    expect(OVERSIZED_WRITE_WARNING_ENABLED_DEFAULT_ACU).toBe(true);
    expect(OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU).toBe(10_000);
    expect(OVERSIZED_CELL_WARN_CHARS_MIN_ACU).toBe(1_000);
    expect(OVERSIZED_CELL_WARN_CHARS_MAX_ACU).toBe(10_000_000);
    expect(OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU).toBe(512 * 1024);
    expect(OVERSIZED_PAYLOAD_WARN_BYTES_MIN_ACU).toBe(32 * 1024);
    expect(OVERSIZED_PAYLOAD_WARN_BYTES_MAX_ACU).toBe(64 * 1024 * 1024);
  });

  it('交火纪要索引召回/归档默认值与 spv9.2 一次性覆盖口径一致', () => {
    expect(defaultVectorMemoryConfig_ACU.threshold).toBe(50);
    expect(defaultVectorMemoryConfig_ACU.archiveTriggerCount).toBe(9);
    expect(defaultVectorMemoryConfig_ACU.archiveBatchSize).toBe(3);
    expect(defaultVectorMemoryConfig_ACU.archiveMaxConcurrency).toBe(3);
    expect(defaultVectorMemoryConfig_ACU.summaryIndexArchiveMaxConcurrency).toBe(30);
    expect(defaultVectorMemoryConfig_ACU.summaryIndexArchiveMaxInputChars).toBe(24_000);
    expect(defaultVectorMemoryConfig_ACU.summaryIndexArchiveEmbeddingConcurrency).toBe(3);
    expect(defaultVectorMemoryConfig_ACU.topK).toBe(200);
    expect(defaultVectorMemoryConfig_ACU.minScore).toBe(0.35);
    expect(defaultVectorMemoryConfig_ACU.rerankBatchSize).toBe(300);
    expect(defaultVectorMemoryConfig_ACU.bm25CandidateLimit).toBe(1000);
    expect(defaultVectorMemoryConfig_ACU.rrfK).toBe(60);
    expect(defaultVectorMemoryConfig_ACU.summaryIndexKeywordMinRows).toBe(200);
    expect(defaultVectorMemoryConfig_ACU.summaryChunkSentenceCount).toBe(2);
    expect(defaultVectorMemoryConfig_ACU.recentFixedInjectCount).toBe(50);
    expect(defaultVectorMemoryConfig_ACU.recallCandidateLimit).toBe(1000);
    expect(defaultVectorMemoryConfig_ACU.summaryIndexRollingDeltaFoldThreshold).toBe(15);
  });

  it('Agent 上下文/绿灯预算默认值与设计口径一致', () => {
    expect(DEFAULT_AGENT_CONTEXT_SETTINGS_ACU.decisionRecentContextCharLimit).toBe(2);
    expect(DEFAULT_AGENT_CONTEXT_SETTINGS_ACU.skillifyMaxEntries).toBe(100);
    expect(DEFAULT_AGENT_CONTEXT_SETTINGS_ACU.plotWorldbookScanMessageLimit).toBe(3);
    expect(DEFAULT_AGENT_CONTEXT_SETTINGS_ACU.agentAiMaxRetries).toBe(2);
    expect(DEFAULT_AGENT_CONTEXT_SETTINGS_ACU.greenlightMinTkBudget).toBe(20_000);
    expect(DEFAULT_AGENT_CONTEXT_SETTINGS_ACU.greenlightMaxTkBudget).toBe(80_000);
    // 限制表与默认表键一致（防止新增默认项漏配 min）
    expect(Object.keys(AGENT_CONTEXT_SETTINGS_LIMITS_ACU).sort())
      .toEqual(Object.keys(DEFAULT_AGENT_CONTEXT_SETTINGS_ACU).sort());
    // 世界书默认配置关键字段
    expect(defaultWorldbookConfig_ACU.injectionTarget).toBe('character');
    expect(defaultWorldbookConfig_ACU.zeroTkOccupyMode).toBe(true);
  });
});

// ═══ 2. 重声明守卫：注册表标识符只许在 shared/defaults.ts 定义 ═══
describe('阈值注册表标识符单点定义守卫', () => {
  const REGISTRY_IDENTIFIERS = [
    'DEFAULT_AUTO_UPDATE_THRESHOLD_ACU',
    'DEFAULT_AUTO_UPDATE_FREQUENCY_ACU',
    'DEFAULT_AUTO_UPDATE_TOKEN_THRESHOLD_ACU',
    'AUTO_UPDATE_FLOOR_INCREASE_DELAY_ACU',
    'OVERSIZED_WRITE_WARNING_ENABLED_DEFAULT_ACU',
    'OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU',
    'OVERSIZED_CELL_WARN_CHARS_MIN_ACU',
    'OVERSIZED_CELL_WARN_CHARS_MAX_ACU',
    'OVERSIZED_PAYLOAD_WARN_BYTES_DEFAULT_ACU',
    'OVERSIZED_PAYLOAD_WARN_BYTES_MIN_ACU',
    'OVERSIZED_PAYLOAD_WARN_BYTES_MAX_ACU',
    'DEFAULT_AGENT_CONTEXT_SETTINGS_ACU',
    'AGENT_CONTEXT_SETTINGS_LIMITS_ACU',
    'defaultVectorMemoryConfig_ACU',
    'defaultWorldbookConfig_ACU',
  ];

  it('除 shared/defaults.ts 外不得重声明注册表常量', () => {
    const offenders: string[] = [];
    for (const file of ALL_SOURCES) {
      const rel = relOf(file);
      if (rel === 'shared/defaults.ts') continue;
      const text = readFileSync(file, 'utf8');
      for (const id of REGISTRY_IDENTIFIERS) {
        if (new RegExp(`(const|let|var)\\s+${id}\\b`).test(text)) offenders.push(`${rel}: redeclares ${id}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ═══ 3. 字面量散落守卫：特征默认值不许在业务代码硬编码（白名单冻结制） ═══
describe('阈值字面量散落守卫（白名单冻结制）', () => {
  // value：注册表默认值的字面量形式；whitelist：允许出现的文件（相对 src/）。
  // 白名单内文件必须各自有注释说明该字面量为何不属注册表语义（或为历史冻结）。
  // 只收「特征值」：泛化字面量（如 2000ms 超时、0.35 透明度）全仓大量出现且语义无关，
  // 全文件白名单会失守——它们由「值快照」与「重声明守卫」覆盖，不进本表。
  const SCATTER_RULES: Array<{ value: string; whitelist: string[]; note: string }> = [
    {
      value: '24000',
      whitelist: [
        // 旧默认 24000 迁移哨兵 + 注释（检测旧口径并迁移，非注册表复制）
        'service/continuation/continuation-store.ts',
        // 历史压缩 reserve 上限（不同领域）
        'service/continuation/agent/agent-history-compactor.ts',
        // 迁移路径的末位兜底（fillMissing 内层 || 24000）：测试以 sparse mock 替换注册表，
        // 此处依赖字面量兜底（2026-10-31 冻结；同文件已用注册表常量做主来源）
        'service/settings/settings-service.ts',
      ],
      note: 'vectorMemory.summaryIndexArchiveMaxInputChars',
    },
    {
      value: '80000',
      whitelist: [
        // worker 池分片阈值（总单元格数），不同领域
        'service/workers/worker-pool.ts',
      ],
      note: 'greenlightMaxTkBudget',
    },
    {
      value: '20000',
      whitelist: [
        // 网页检索单页字数上限（UI 范围 + 校验），不同领域
        'presentation-v2/pages/ContinuationPage.vue',
        // API maxTokens 回退与续写检索预算/超时，不同领域
        'service/ai/api-call.ts',
        'service/continuation/continuation-store.ts',
        'service/continuation/agent/agent-search.ts',
        'service/continuation/agent/agent-web-client.ts',
      ],
      note: 'greenlightMinTkBudget',
    },
    {
      value: '10000',
      whitelist: [
        // importSplitSize / 缓存条数上限 / 展示截断等既有独立语义（2026-10-31 冻结）
        'data/models/settings-model.ts',
        'data/storage/vector-index-hot-cache.ts',
        'data/storage/vector-index-temp-cache.ts',
        'presentation-v2/pages/DataMgmtPage.vue',
        'presentation/components/optimization-ui/optimization-ui-diff.ts',
        'presentation/triggers/data-admin-ui.ts',
        'service/agent/agent-worldbook-config-meta.ts',
        'service/optimization/content-optimization.ts',
        'service/runtime/state-manager.ts',
        'service/settings/settings-service.ts',
        'service/settings/settings-write-service.ts',
        'service/vector/summary-vector-index-runtime.ts',
        'service/workers/worker-pool.ts',
        'service/worldbook/injection-engine-config.ts',
        'service/worldbook/injection-engine-custom.ts',
      ],
      note: 'OVERSIZED_CELL_WARN_CHARS_DEFAULT_ACU',
    },
  ];

  it('特征字面量只出现在白名单文件（否则必须 import 注册表常量）', () => {
    const offenders: string[] = [];
    for (const rule of SCATTER_RULES) {
      const re = boundaryRegex(rule.value);
      for (const file of ALL_SOURCES) {
        const rel = relOf(file);
        if (rel === 'shared/defaults.ts') continue;
        if (rule.whitelist.includes(rel)) continue;
        if (re.test(readFileSync(file, 'utf8'))) offenders.push(`${rel}: ${rule.value}（${rule.note}）`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('字节阈值表达式（512*1024 等）不许新增散落（白名单冻结制）', () => {
    const byteExpr = /(^|[^0-9_])(512|32|64)\s*\*\s*1024([^0-9_]|$)/;
    const whitelist = [
      // MB/KB 展示格式化，非阈值语义
      'service/table/oversized-write-warning.ts',
      // 缓存/观测器自有字节预算（2026-10-31 冻结）
      'data/storage/vector-index-hot-cache.ts',
      'data/storage/vector-index-temp-cache.ts',
      'service/ai/prompt-observer.ts',
      'service/table/write-pipeline-observer.ts',
    ];
    const offenders: string[] = [];
    for (const file of ALL_SOURCES) {
      const rel = relOf(file);
      if (rel === 'shared/defaults.ts' || whitelist.includes(rel)) continue;
      if (byteExpr.test(readFileSync(file, 'utf8'))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

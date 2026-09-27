/**
 * tests/setup/warm-app-graph.ts — 重子图的「一次性冷转译预热」
 *
 * ── 问题（2026-09-27 实测，探针逐段计时） ──────────────────────────────
 * 每个 vitest worker 进程内**首次** import 一张大子图要十几到几十秒：
 *     continuation-runtime        16.2s
 *     presentation-v2/bootstrap   14.2s（负载高时同一 import 实测到 73s）
 *     sql.js/dist/sql-wasm.js      0.01s ← 不是它
 * 而 `openAcuV2App()` 本身只要 184ms；`vi.resetModules()` 之后的第二次 import 仅 2.1s
 * —— 因为 Vite 的转译缓存**按 worker 进程存内存**，`resetModules` 只清模块注册表、
 * 不清转译缓存。
 *
 * 于是「一次性冷开销」随机落在该 worker 里第一个碰大子图的测试文件的**首条用例**上，
 * 顶穿 15s 的 testTimeout ⇒ 表现为「各重文件的前 1~3 条用例超时」，
 * 每个 worker 一次 ⇒ 一次全量跑下来 3~9 个文件恒红，且**失败集合每次都在变**
 * （取决于机器负载与 worker 的文件分配）。
 *
 * ── 对策 ─────────────────────────────────────────────────────────
 * 把这一次性开销从「单条用例预算」里挪出来，放进**每个文件的 beforeAll**：
 *   - 进程内只真正预热一次（模块级 `warmed` 标记），后续文件命中转译缓存，近似零成本。
 *   - 只对 `WARM_DIRS`（实测会拉大子图的测试目录）预热；纯逻辑套件走单文件时不被拖慢。
 *   - 预热失败**不得**影响测试：吞掉异常并记一条警告，退回「首条用例自己付费」的既有行为。
 *   - 逃生开关：`ACU_VITEST_SKIP_WARM=1` 完全禁用（调试转译问题时用）。
 *
 * 为什么按目录而不是「无条件预热」：单文件跑一个纯逻辑用例（如 token-counter）时，
 * 无条件预热会白加十几秒，日常开发回路会被拖慢 —— 代价大于收益。
 * 新增目录若出现「首条用例超时」，把该目录加进 `WARM_DIRS` 即可（见下方注释）。
 */
import { beforeAll, expect } from 'vitest';

/** 需要预热的测试目录（正则，匹配 testPath）。新增时只加一行。 */
const WARM_DIRS: RegExp[] = [
  /tests[\\/]presentation-v2[\\/]/,   // 整张 v2 app 图
  /tests[\\/]presentation[\\/]/,      // 旧 V1 triggers / 面板
  /tests[\\/]service[\\/]continuation[\\/]/, // continuation 大子图（runtime / 会话）
];

let warmed = false;

/** 当前测试文件路径（vitest 在收集阶段写入 expect 状态）。 */
function currentTestPath_(): string {
  try {
    return String((expect.getState() as { testPath?: string } | undefined)?.testPath || '');
  } catch {
    return '';
  }
}

beforeAll(async () => {
  if (warmed) return;
  if (String(process.env.ACU_VITEST_SKIP_WARM || '') === '1') return;
  const testPath = currentTestPath_();
  if (!WARM_DIRS.some(pattern => pattern.test(testPath))) return;
  warmed = true;
  try {
    await import('../../src/presentation-v2/bootstrap/mount');
  } catch (error) {
    // 预热只是提速手段：失败就退回「首个用例自己付费」的既有行为，不改变任何断言结果。
    console.warn('[warm-app-graph] app 图预热失败，退回按需转译：', error);
  }
}, 180_000);

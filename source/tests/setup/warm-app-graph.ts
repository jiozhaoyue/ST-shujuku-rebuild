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
 * ── 对策（2026-10-26 根治：setup 顶层预热 + 立即 resetModules） ─────────
 * 旧实现在 `beforeAll` 里预热，有两个残留问题：
 *   ① `beforeAll` 晚于测试文件的 `vi.mock` 注册 ⇒ 预热在「窄 mock」环境下执行，
 *      mock 缺导出时预热抛错（被吞掉只留 warn），该文件失去保护（2026-09-28 记录）；
 *   ② 失败是静默的，只有高负载下的「莫名超时」能间接暴露。
 *
 * 现改为在 **setup 文件顶层（TLA）**预热 —— 先于测试文件的 `vi.mock`，拿到真实模块图，
 * 窄 mock 从此污染不到预热。**关键配套是预热后立即 `vi.resetModules()`**：
 * 预热会把真实模块实例化进**本测试文件**的模块注册表；不清掉的话，测试文件随后声明的
 * `vi.mock` 对「已实例化的真模块绑定」无效（实测症状：mock 了 toast-store 的 16 个文件
 * 集体报 `getActivePinia()` 无活动实例——真 store 泄漏进用例）。resetModules 清注册表
 * 但**不清 worker 级转译缓存**，预热收益完整保留；被丢弃的预热实例可被 GC。
 *
 * 其余约束：
 *   - 「进程内只预热一次」的标记挂 `globalThis`（模块级变量会被 resetModules 一并清掉）。
 *   - 预热失败**不得**影响测试：吞掉异常记警告，退回「首条用例自己付费」的既有行为。
 *   - 逃生开关：`ACU_VITEST_SKIP_WARM=1` 完全禁用（调试转译问题时用）。
 *   - 观测开关：`ACU_VITEST_WARM_DEBUG=1` 打印预热路径与耗时（验证用，默认静默）。
 *
 * 为什么按目录而不是「无条件预热」：单文件跑一个纯逻辑用例（如 token-counter）时，
 * 无条件预热会白加十几秒，日常开发回路会被拖慢 —— 代价大于收益。
 * 新增目录若出现「首条用例超时」，把该目录加进 `WARM_DIRS` 即可。
 */
import { beforeAll, expect, vi } from 'vitest';

/** 需要预热的测试目录（正则，匹配 testPath）。新增时只加一行。 */
const WARM_DIRS: RegExp[] = [
  /tests[\\/]presentation-v2[\\/]/,   // 整张 v2 app 图
  /tests[\\/]presentation[\\/]/,      // 旧 V1 triggers / 面板
  /tests[\\/]service[\\/]continuation[\\/]/, // continuation 大子图（runtime / 会话）
];

/** worker 级「已预热」标记。挂 globalThis：模块级变量会被预热后的 resetModules 清掉。 */
const WARM_DONE_FLAG = '__acuWarmGraphDone__';

function currentTestPath_(): string {
  try {
    return String((expect.getState() as { testPath?: string } | undefined)?.testPath || '');
  } catch {
    return '';
  }
}

function warmDebugEnabled_(): boolean {
  return String(process.env.ACU_VITEST_WARM_DEBUG || '') === '1';
}

/**
 * 顶层预热入口。返回值语义：
 *   'warmed' 已预热（或本 worker 早前已预热过）；'failed' 预热抛错（已吞掉）；
 *   'skipped' 环境开关或目录白名单不命中；'no-testpath' 顶层读不到 testPath。
 */
async function warmAppGraphAtTopLevel_ACU(): Promise<
  'warmed' | 'failed' | 'skipped' | 'no-testpath'
> {
  const globalScope = globalThis as { __acuWarmGraphDone__?: boolean };
  if (globalScope[WARM_DONE_FLAG]) return 'warmed';
  if (String(process.env.ACU_VITEST_SKIP_WARM || '') === '1') return 'skipped';
  const testPath = currentTestPath_();
  if (!testPath) return 'no-testpath';
  if (!WARM_DIRS.some(pattern => pattern.test(testPath))) return 'skipped';
  globalScope[WARM_DONE_FLAG] = true;
  const startedAt = Date.now();
  try {
    await import('../../src/presentation-v2/bootstrap/mount');
    if (warmDebugEnabled_()) {
      // eslint-disable-next-line no-console
      console.warn(`[warm-app-graph] 顶层预热完成 ${Date.now() - startedAt}ms testPath=${testPath}`);
    }
  } catch (error) {
    // 预热只是提速手段：失败就退回「首个用例自己付费」的既有行为，不改变任何断言结果。
    console.warn('[warm-app-graph] app 图预热失败，退回按需转译：', error);
    return 'failed';
  } finally {
    // 关键：清掉预热实例化出来的模块注册表，让本测试文件自己的 vi.mock 能干净生效。
    // 转译缓存在 worker 级存活，不受影响（见文件头「对策」一节）。
    vi.resetModules();
  }
  return 'warmed';
}

const topLevelOutcome = await warmAppGraphAtTopLevel_ACU();

if (topLevelOutcome === 'no-testpath') {
  // 顶层读不到 testPath（未来 vitest 行为的兜底）：退回旧 beforeAll 形态。
  // 该路径运行在测试文件求值之后，mock 已生效 ⇒ 保持旧语义：**不** resetModules
  //（那会把测试文件自己的模块实例清掉），预热失败照旧吞掉。
  beforeAll(async () => {
    const globalScope = globalThis as { __acuWarmGraphDone__?: boolean };
    if (globalScope[WARM_DONE_FLAG]) return;
    if (String(process.env.ACU_VITEST_SKIP_WARM || '') === '1') return;
    const testPath = currentTestPath_();
    if (!WARM_DIRS.some(pattern => pattern.test(testPath))) return;
    globalScope[WARM_DONE_FLAG] = true;
    try {
      await import('../../src/presentation-v2/bootstrap/mount');
      if (warmDebugEnabled_()) {
        // eslint-disable-next-line no-console
        console.warn('[warm-app-graph] beforeAll 兜底预热完成');
      }
    } catch (error) {
      console.warn('[warm-app-graph] app 图预热失败（beforeAll 兜底），退回按需转译：', error);
    }
  }, 180_000);
}

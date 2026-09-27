# 质量门（核心层）

> **铁律：发版前全绿、零回退**（规则 L0-13）。本仓以测试规模换稳定性，改动核心层不许让任何既有用例转红。

---

## 门槛命令（全在 `source/` 下）

```bash
cd source
npx tsc --noEmit -p tsconfig.json   # 类型检查
npx vitest run                      # 全量（发版前必须零回退）
npm run build                       # rollup → dist/extension/ 并同步回仓库根
npm run smoke                       # 用 jsdom 加载根 index.js 验产物可启动
```

- `npm run test:parallel`：显式并行跑（`--fileParallelism --maxWorkers=4`）。
- 单文件 / 单用例：`npx vitest run tests/xxx.test.ts`、`npx vitest run -t "用例名"`。
- 规模基线：419 个 `*.test.ts`（2026-09-27）。

## vitest 配置里必须知道的四件事（`source/vitest.config.ts`）

1. **宿主模块被 stub**：`./script.js` 与 `./scripts/extensions.js` 由 `stubHostModules()` 占位为空模块。**新增依赖宿主全局的代码时，若测试报解析失败，先看这里要不要补桩。**
2. **别名**：`@shared` / `@data` / `@service` / `@presentation` / `@presentation-v2`。
3. **并行度**：`maxWorkers` 默认 8，可用环境变量 `ACU_VITEST_WORKERS` 覆盖（历史定规为单线程；8 并行实测 6907 用例 114s 全绿，单线程 537s）。
4. **超时余量**：`testTimeout: 15000`、`hookTimeout: 20000`。重型 jsdom 套件（如 `open-visualizer-surface`，每用例 `resetModules` 冷编译全 app 图）首用例 `beforeEach` 实测贴 10s 默认线，故留 2 倍余量——**不要因为"超时"就改默认值**，先确认是不是冷编译。

## 测试本身的纪律

- **禁止恒真断言**：`expect(x).toBeTruthy()` 之类在 `x` 恒真时等于没测。历史审计提交（`567d80d`）清理过「吞用例结构 bug、死协议断言、zombie mock、恒真断言」，新用例别把它们写回来。
- 数据层改动必须补**往返用例**（导出 → 回放 → 重建比对），形态参照 `tests/integration/table-checkpoint-roundtrip.test.ts`。
- `tests/performance/` 是基准测试，在并行负载下可能贴边超时；放宽门槛要像 `b67697c` 那样**附实测依据**，不要凭手感调数字。

## 版本与身份守卫（改身份文件必看）

`tests/shared/manifest-identity.test.ts` 钉住三件事：

- `manifest.homePage` 必须指本仓（`https://github.com/jiozhaoyue/ST-shujuku-rebuild`）——否则宿主 `auto_update` 会把用户拉回上游产物；
- `display_name` 不得回退到历史品牌；
- `manifest.version` 必须与 `source/package.json` 的 `version` 一致（自动同步曾把两者打回不一致）。

`source/package.json` 与仓库根 `manifest.json` 的 `version` 需一致；口径：**追平上游后 version 跟随上游**。

## 真机测试

`source/docs/TESTING.md` 是**只有真机能暴露**的问题清单（安装、启动、SQL 表格回归、剧情推进、skill 化、可视化前端兼容、差量注入等）。

- **E2E / 自动化只许对 Dev 实例**（8001 Dev ST / 8003 Dev Luker）；**严禁 8002 / 8004 Real 实例**（规则 L0-13 与 P-11 误连风险）。
- Dev 与 Real 宿主版本完全相同，仅差端口号——不要靠版本号区分。

## 反模式

- 「本地全绿，CI 红」——先查产物是否重建、行尾是否被本地构建改写。
- 改核心层只跑相关子集就宣布完成（发版前必须全量）。
- 为了让用例通过而放宽阈值、加 `skip`、或在断言里削条件。
- 把真机才暴露的问题记在聊天里而不落 `source/docs/TESTING.md`。

## 提交前自查

```bash
cd source && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run build && npm run smoke
git status --short          # 判「有无改动产品代码」用这个，不要用 git diff --stat（规则 L0-17）
```

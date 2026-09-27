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
- 规模基线：421 个 `*.test.ts`、8661 用例（2026-09-28 实测，全绿）。

## vitest 配置里必须知道的五件事（`source/vitest.config.ts`）

1. **宿主模块被 stub**：`./script.js` 与 `./scripts/extensions.js` 由 `stubHostModules()` 占位为空模块。**新增依赖宿主全局的代码时，若测试报解析失败，先看这里要不要补桩。**
2. **别名**：`@shared` / `@data` / `@service` / `@presentation` / `@presentation-v2`（注意：**rollup 未注册别名**，源码一律相对路径）。
3. **并行度**：`maxWorkers` 默认 8，可用环境变量 `ACU_VITEST_WORKERS` 覆盖。
4. **超时余量**：`testTimeout: 15000`、`hookTimeout: 20000`。
5. **`setupFiles: ['./tests/setup/warm-app-graph.ts']`**：重型套件的**一次性冷转译预热**，见下节。

## 冷启动预热（`tests/setup/warm-app-graph.ts`）—— 别把它的失败误判成超时

**实测（2026-09-27，逐段计时）**：每个 vitest worker 进程内**首次** import 一张大子图要
**14~73 秒**（`continuation-runtime` 16.2s、`presentation-v2/bootstrap` 14.2s；负载高时同一 import 到 73s），
而 `openAcuV2App()` 本身只要 184ms；`vi.resetModules()` 之后的第二次 import 仅 2.1s
—— **Vite 的转译缓存按 worker 进程存内存，`resetModules` 只清模块注册表、不清转译缓存**。

于是这一次性开销会随机落在该 worker 里**第一个碰大子图的文件的首条用例**上，顶穿 15s 的 `testTimeout`，
表现为「各重文件的前 1~3 条用例超时」且**失败集合每次跑都不同**（取决于机器负载与 worker 的文件分配）。

对策：`setupFiles` 对 `presentation-v2` / `presentation` / `service/continuation` 三个目录，
在 `beforeAll` 里预热一次 app 图，把冷开销移出单用例预算；`ACU_VITEST_SKIP_WARM=1` 可关。

**判断口径**：「某重型套件首条用例超时」先看是不是冷转译（用 `--testTimeout=120000` 复跑一次：
若首条 20~70s 通过、其余 1~2s，就是冷转译，**不是**逻辑挂死）。真正永不 settle 的 await 见规则 L1-MR-7。

## 测试本身的纪律

- **禁止恒真断言**：`expect(x).toBeTruthy()` 之类在 `x` 恒真时等于没测。历史审计提交（`567d80d`）清理过「吞用例结构 bug、死协议断言、zombie mock、恒真断言」，新用例别把它们写回来。
- **`mockRejectedValueOnce` / `mockResolvedValueOnce` 是陷阱**：`Once` 只作用于**下一次**调用。
  若被测路径在真正的守卫之前还有一次**会吞异常**的调用（实测：`runTableUpdateCommit_ACU` 进提交回调前先跑
  `flushRuntimeOnlyPendingBeforeCommit_ACU`，那条路径**同样取存储 provider 且刻意吞异常**），
  那一次 `Once` 会被前置调用消费掉，守卫拿到默认 mock ⇒ 用例恒红且看起来像产品 bug。
  **口径**：凡是「断言某依赖失败时如何降级」的用例，用**持久** `mockRejectedValue`（下一次 `beforeEach` 会重置），
  并在用例里写一句为什么不能用 `Once`。
- 数据层改动必须补**往返用例**（导出 → 回放 → 重建比对），形态参照 `tests/integration/table-checkpoint-roundtrip.test.ts`。
- `tests/performance/` 是基准测试，在并行负载下可能贴边超时；放宽门槛要像 `b67697c` 那样**附实测依据**，不要凭手感调数字。
  同理，**抓复杂度回归**的性能断言（如「3000 候选排序」）应按「真回归是数量级劣化」定预算（实测 0.8~2.1s → 预算 6s），
  不要按最快机器上的最优值定。

## 版本与身份守卫（改身份文件必看）

`tests/shared/manifest-identity.test.ts` 钉住三件事：

- `manifest.homePage` 必须指本仓（`https://github.com/jiozhaoyue/ST-shujuku-rebuild`）——否则宿主 `auto_update` 会把用户拉回上游产物；
- `display_name` 不得回退到历史品牌；
- `manifest.version` 必须与 `source/package.json` 的 `version` 一致（自动同步曾把两者打回不一致）。

`source/package.json` 与仓库根 `manifest.json` 的 `version` 需一致；口径：**追平上游后 version 跟随上游**。

## 真机测试

`source/docs/TESTING.md` 是**只有真机能暴露**的问题清单（安装、启动、SQL 表格回归、剧情推进、skill 化、可视化前端兼容、差量注入等）。

### 四宿主兼容自动化（`npm run compat:probe`）

`scripts/host-compat-probe.mjs` 把「四个宿主都要过一遍」的头几条变成一条命令可复跑的自动化
（扩展是否被注入 / 公开 API 是否挂载 / V2 界面是否起来 / 有无插件自身报错）：

```bash
cd source
NODE_PATH="C:/nvm4w/nodejs/node_modules" npm run compat:probe          # 四个目标全跑
NODE_PATH="C:/nvm4w/nodejs/node_modules" npm run compat:probe -- --only=st,luker
```

四个目标：`st`(8001) / `luker`(8003) / `puretavern`(8899) / `ttavern`。

**TauriTavern 怎么测**：TT 是桌面壳，CI 里起不来，故改为**在真机 ST 页注入 TT 的 ABI 全局**
（`__TAURITAVERN__` + `__TAURITAVERN_MAIN_READY__`）真实走通宿主判定与 TT 分支。
插件能观察到的宿主差异面就是这些全局，所以这是 ABI 层面的等价物。

**两处判定口径**（都写死在脚本里，改脚本时别放松）：

- **插件报错只认「可归因」的**：插件的全局未捕获处理器会把其它扩展的跨源异常也冠上插件前缀，
  而跨源错误只有一句 `Script error.`（浏览器脱敏，无堆栈）。把这类当硬失败会让探测器**恒红且无从修**
  ⇒ 只有带真实消息的才算失败，不透明的记入 notes。**别把这个区分当成"放宽标准"**：真异常会带堆栈。
- **PureTavern 必须判为通用分支**：它有 `window.__PURE_TAVERN__` / `__PURE_TAVERN_DATA_STREAMING__`
  自有标记，但**没有** `__TAURITAVERN__`、也没有 `Luker.getContext` ⇒ 宿主判定必须落到 `sillytavern`
  （探测器的 `expect` 会卡这条）。同一矩阵的单元版见 `tests/shared/host-compat/four-host-matrix.test.ts`。

**PureTavern 怎么装**（2026-09-28 现场取证）：它的三方扩展**不**扫描目录，
而是走自己的 `POST /api/extensions/install {url, global, branch}`（ST 兼容路由，
源码 `apps/web/src/features/extensions/legacy/register-routes.ts`）。
未安装时探测器会报 **SKIP**（判据 `/api/extensions/discover` 未列出 shujuku）——
**SKIP 不是兼容结论**，装好再跑才算数。
注意：往 `apps/web/.generated/public/scripts/extensions/third-party/` 直接放文件**不生效**
（那是生成目录，且扩展清单不来自它）。

- **E2E / 自动化只许对 Dev 实例**（8001 Dev ST / 8003 Dev Luker / 8899 Dev PureTavern）；**严禁 8002 / 8004 Real 实例**（规则 L0-13 与 P-11 误连风险）。
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

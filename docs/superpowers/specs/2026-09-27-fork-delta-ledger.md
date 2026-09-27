# 我方差量台账 —— fork 相对于上游 shuiyue-cmyk/shujuku-rebuild

日期：2026-09-27
状态：阶段 0 交付物（配套「追平上游」合并提交 `85d9405`）
上游基线：`shuiyue-cmyk/shujuku-rebuild@6859302`（v9.7.2）
我方基线：`jiozhaoyue/ST-shujuku-rebuild@85d9405`（master）

## 0. 本台账解决什么问题

「我们相对上游改了什么」以前只能靠翻历史推断（我方历史自 fork 点重建，与上游不同源，肉眼比对不可行）。
**追平上游之后，这个问题有了确定答案**：`git diff upstream/master HEAD` 就是完整差量 ——
因为上游的全部提交都已并入，剩下的每一条差异必然是我方有意为之。

本台账把该差量按**意图**分类，并为每条标注「上游是否已自行实现 / 能否回归上游」，
使下一次追平时能快速判断某个冲突该按谁解决。

## 1. 复跑取证（每次追平后重跑这三条）

```bash
# 1) 我方还落后上游多少（应为 0；不为 0 说明同步又断了）
git rev-list --count HEAD..upstream/master

# 2) 我方差量的规模与清单（追平后此即完整差量）
git diff --shortstat upstream/master HEAD -- source/
git diff --numstat upstream/master HEAD -- source/ | sort -k1 -rn

# 3) 下一次追平的冲突面（只读试合并，不动工作区）
git merge-tree --write-tree --name-only HEAD upstream/master
```

> 采集方法：以上命令在 `85d9405` 上实跑取得，输出见下节。

## 2. 差量总览（实测，`git diff upstream/master HEAD`）

- `source/` 下：**35 个文件，+2757 / −26**
- 根层（非 `source/`）：`index.js`（分发产物，+39454/−49721，构建生成）、`AGENTS.md`（+725，规则块同步器生成）、
  `docs/**`（我方设计文档）、`.github/workflows/*`（我方 CI）、`README.md`（+23/−13，品牌）、
  `.gitignore`（+19）、`manifest.json`（3/3，身份）、`sql-wasm.wasm`（二进制，构建生成）

## 3. 差量分类

### A. 身份与品牌分离（永久保留，上游不可能自行实现）

| 文件 | 规模 | 说明 |
|---|---|---|
| `manifest.json` | 3/3 | `author` / `homePage` 指向本仓 |
| `source/tests/shared/manifest-identity.test.ts` | +33 | 身份分离不变式：`homePage` 必须是本仓，否则宿主 `auto_update` 会把插件拉回上游产物 |
| `README.md` | +23/−13 | 品牌 |
| `source/src/presentation-v2/bootstrap/menu-button.ts` | 3/3 | 入口品牌 |
| `source/src/presentation/bootstrap/install-build-badge.ts`（+测试） | 1/1 | 构建徽标 |
| `source/src/shared/runtime-env.ts` | 2/2 | 运行环境标识 |
| `source/src/presentation/triggers/settings-ui-sync/settings-ui-api.ts` | 2/2 | 设置 API 标识 |
| `source/src/presentation-v2/App.vue`、`components/Sidebar.vue` | 1/1 各 | 界面品牌 |

**追平口径**：这几处**永远按我方**（CI 里 `manifest.json`/`README.md` 已在自动解决名单内）。

### B. 宿主适配（Luker / TT 三态，上游是 TT-only）

| 文件 | 规模 | 说明 |
|---|---|---|
| `source/src/shared/host-bridge.ts` | +5 | 三态 profile 探测（宿主差异只许进桥，见 L0-9） |
| `source/tests/shared/host-compat/host-bridge-kind.test.ts` | +41 | 宿主判定 |
| `source/tests/shared/host-compat/native-st-backend.luker.test.ts` | +90 | Luker 世界书后端形状校准 |
| `source/tests/shared/host-bridge-version.test.ts` | 上游新增，我方无差量 | 上游自行演进版本门禁 |

**追平口径**：上游若已自行实现同类适配（如上游的 TT 版本门禁），按「先取上游、再补我方 Luker 分支」处理；
本类是我方与上游最可能长期分叉的面，冲突优先看 `host-bridge.ts`。

### C. 差量注入（我方独有功能，候选回归上游）

| 文件 | 规模 |
|---|---|
| `source/src/service/ai/prompt-builder/table-injection-scope.ts` | +136 |
| `source/tests/service/ai/table-injection-scope.test.ts` | +119 |
| `source/src/service/ai/prompt-builder/prompt-prepare.ts` | +39/−2（SQL 分支接线） |
| `source/src/presentation-v2/composables/useDifferentialInjectionSettings.ts` | +37 |
| `source/src/presentation-v2/components/FormFillUpdateSettingsPanel.vue` | +32 |
| `source/src/presentation-v2/copy/dashboard-copy.ts`、`composables/useDashboardPage.ts` | +5 / +10（开关入口） |
| `source/tests/service/ai/prompt-prepare-sql-mode.test.ts` | +59 |

设计依据：`docs/superpowers/plans/2026-09-05-differential-injection.md`。
热表带全量行、冷表只带 DDL + 行数，开关默认关闭（关闭时与上游行为一致）。

### D. 楼层级调度（我方独有功能，候选回归上游）

| 文件 | 规模 |
|---|---|
| `source/src/service/table/floor-level-catch-up.ts` | +112 |
| `source/tests/service/table/floor-level-catch-up.test.ts` | +110 |
| `source/src/service/table/update-orchestrator.ts` | +25/−3（`batchSizeOverride` 透传） |
| `source/src/service/table/runtime-only-pending-state.ts` | +10 |
| `source/src/service/runtime/state-manager.ts` | +5 |

设计依据：`docs/superpowers/plans/2026-09-05-differential-injection.md` 同批。追平分批粒度可按楼层覆盖。

### E. 表格自检（我方独有）

| 文件 | 规模 |
|---|---|
| `source/src/service/table/self-check.ts` | +49 |

### F. 调试与运维（我方独有）

| 文件 | 规模 | 说明 |
|---|---|---|
| `source/src/service/continuation/agent/agent-prompt-drift.ts`（现存于双方） | 无差量 | 提示词前缀漂移诊断（本次未被改动） |
| `source/src/presentation-v2/composables/useDebugPanel.ts` | +4/−2 | 调试面板 |
| `source/scripts/rescue/replay-chat.mjs` | +305 | 会话数据库救援：离线回放 |
| `source/scripts/rescue/extract-template.mjs` | +132 | 救援：模板抽取 |
| `source/scripts/rescue/extracted-template-v3.3.0.json` | +1360 | 救援：抽取产物 |
| `docs/lessons-chat-db-rescue.md` | +74 | 救援实战经验 |

设计依据：`docs/superpowers/specs/2026-09-07-chat-db-rescue-and-template-migration-design.md`。

### G. 分发产物与 CI（按我方，构建/运维生成）

| 文件 | 说明 |
|---|---|
| `index.js`、`sql-wasm.wasm` | **不手改**，由 `cd source && npm run build` 生成并同步到仓库根 |
| `.github/workflows/upstream-sync.yml` | 上游定时同步（我方独有） |
| `.github/workflows/release-gate.yml` | 发布门禁（我方独有） |
| `AGENTS.md` 的规则块 | 由 `tavern-harness` 真源同步器生成，**勿手改**（手改会在下次重建时被抹掉；本仓特例写「项目覆盖」节） |

### H. 设计文档（我方独有）

`docs/superpowers/specs/2026-09-05-luker-shujuku-design.md`、
`docs/superpowers/specs/2026-09-07-chat-db-rescue-and-template-migration-design.md`、
`docs/superpowers/plans/2026-09-05-luker-host-adapt.md`、
`docs/superpowers/plans/2026-09-05-differential-injection.md`。

## 4. 本次追平实况（`85d9405`）

上游落后 36 提交（v9.4.10 → v9.7.2）。**冲突仅 4 个文件**：

| 文件 | 解决 |
|---|---|
| `index.js` | 按我方，随后 `npm run build` 重建 |
| `manifest.json` | `author`/`homePage` 按我方；`version` 取上游 9.7.2 |
| `source/src/presentation-v2/composables/useDashboardPage.ts` | **并集**：上游 `withRenderFallback` 渲染兜底包装 + 我方 `differentialInjectionEnabled` 开关 |
| `source/src/service/table/update-orchestrator.ts` | **并集**：上游扩充的 `executionSnapshot`（`chatIdentity`/`isolationKey`）+ 我方 `batchSizeOverride` |

上游删除 3 个文件（`source/src/service/loop/loop-controller.ts` 与两个测试），已核实**无悬挂引用**
（仅两处注释提及）。依赖声明未变动（`source/package.json` 仅版本号 9.4.10 → 9.7.2），故无需重装依赖。

**顺带修正的既有不一致**：追平前 `manifest.json` 为 `9.4.0` 而 `source/package.json` 为 `9.4.10`，
违反 AGENTS.md「两者 version 需一致」。本次统一为 `9.7.2`，并确立口径：**追平后 version 跟随上游**。

## 5. 同步纪律（每次追平照此执行）

1. 先跑 §1 第 1 条确认落后量；为 0 说明同步正常，无需动作。
2. 落后时用 `git merge-tree --write-tree --name-only`（只读）先量出冲突面，再决定是否人工介入。
3. 冲突按本节分类口径解决：A/G 按我方；B 先取上游再补 Luker 分支；C/D/E/F 优先保我方（候选回归上游）。
4. 合并后**必须**重建分发产物并跑满质量门（`tsc --noEmit` → `vitest run` → `npm run build` → `npm run smoke`）。
5. 提交只用显式 pathspec；推送只推 `origin`，绝不推 `upstream`（P-12）。
6. 本台账随每次追平更新 §4（实况）与 §3（差量分类）。

## 6. 已知坑：上游同步曾静默失败 5 天（2026-09-22 ~ 09-26）

`.github/workflows/upstream-sync.yml` 的冲突分支里，Markdown 围栏被写成**裸引用词**
（三个反引号被单引号包裹），shell 会把它当命令执行：`command not found`、退出码 127，
整段冲突处理随之崩溃。两个后果叠加：

1. `status=conflict` 从未写出；
2. 「开/更新人工处置 issue」步骤的条件依赖该 status → 条件不成立被跳过。

于是**真冲突被静默吞掉**：连续 5 次运行全红、无 issue、无人收到通知，我方停滞在上游 v9.4.10，
落后 36 提交直到本次手工追平。证据：运行 `36203002429` 日志 `line 18: ```: command not found`
/ `Process completed with exit code 127`。

修复（提交 `bb57a20`）：围栏改为 `echo`；issue 步骤条件补 `steps.merge.outcome == 'failure'`，
覆盖「合并步骤自身崩溃」这一路；issue 正文增加「合并中断时仍未解决的文件」抓取
（原先先 `git merge --abort` 再组装正文，崩溃路径下列不出冲突清单）。
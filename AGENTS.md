# AGENTS.md — ST-shujuku-rebuild（Luker·数据库）

Luker / TauriTavern 宿主的数据库插件，基于上游 [shuiyue-cmyk/shujuku-rebuild](https://github.com/shuiyue-cmyk/shujuku-rebuild) v9.1.9 的适配 fork。以标准浏览器扩展形式安装（无需酒馆助手），SQL 表格持久化到聊天消息的 `TavernDB_ACU_*` 字段中。

## 仓库结构

- 仓库根：**分发产物**（`index.js` 单文件约 10MB、`manifest.json`、`sql-wasm.wasm`）——由构建生成并提交，不手改。
- `source/`：真正的工程（TypeScript + rollup + vitest），所有开发在这里进行。
  - `src/`：源码。分层：`data/`（sqlite 引擎、sync-bridge、仓储、网关）→ `service/`（业务）→ `presentation/`、`presentation-v2/`（UI，后者为 Vue SFC）→ `shared/`（工具/常量/host-bridge）→ `entry-extension.ts`（入口）。
  - `tests/`：vitest 测试（`data/ service/ shared/ presentation/ integration/ performance/ fixtures/`）。
  - `scripts/`：构建辅助（sql-wasm 资产内联、冒烟）。
- `docs/superpowers/specs/`（设计文档）、`docs/superpowers/plans/`（实施计划）。
- `source/docs/TESTING.md`：真机测试清单。

## 构建与测试

全部在 `source/` 下执行：

```bash
cd source
npm run build        # rollup：产物自动同步到仓库根（dist/extension → 根 index.js 等）
npm run typecheck    # tsc --noEmit
npx vitest run       # 全量测试（发版前必须零回退；当前规模 ~7700 用例）
npm run smoke        # 产物冒烟
```

## 关键约定与陷阱

- **单文件标识 `shujuku_v120`**：`UNIQUE_SCRIPT_ID` 常量（`src/shared/constants.ts`）是存储命名空间根（`shujuku_v120__userscript_settings_v1`、`TavernDB_ACU_*` 聊天字段前缀与之配套）。改它 = 换存储身份，会"丢"所有现有数据；独立副本才改。
- **数据持久化模型**：运行时是 sql.js 内存 SQLite；持久化靠"存储帧"（checkpoint + SQL 操作日志 `logEntries`）写进聊天消息的 `TavernDB_ACU_IsolatedData`，热状态快照在 chat_metadata 的 `TavernDB_ACU_HotSnapshot`，模板在 `TavernDB_ACU_ScopedConfig` / `TavernDB_ACU_InternalSheetGuide`。修数据层必须理解"回放日志 → 重建表"这条链（`data/sqlite/sync-bridge.ts`）。
- **宿主适配**：TT / Luker / 通用 ST 三态 profile 在 `src/shared/host-bridge.ts`，探测失败自动降级 generic。宿主差异只许进桥，不许散落业务层。
- **上游同步**：CI 每日自动合并上游 master；冲突按"我方差量"解决（host-bridge、分发产物重建）。上游的数据格式与模板 JSON 必须保持同构，不要私自改 `TavernDB_ACU_*` 结构。
- **构建开关**：SQLite 引擎（wasm 默认 / asm 回滚）由 rollup replace 注入（`ACU_SQLITE_ENGINE`）；wasm 以 base64 内联进产物，无外部 fetch。
- **版本**：source `package.json` 与根 `manifest.json` 的 `version` 需一致；`auto_update: true`，用户从 GitHub 地址安装。
- vitest 里宿主模块（`./script.js`、`./scripts/extensions.js`）由 `vitest.config.ts` 的 stub 占位，新增依赖宿主全局时注意补 stub。

## 文档

改数据层 / 存储格式前先读 `docs/superpowers/specs/` 下相关设计文档；测试要求见 `source/docs/TESTING.md`。

<!-- UNIFIED-RULES:START -->

> **注意**: 本节内容由统一规则文档自动同步生成，请勿手动编辑。
> 如需修改，请编辑源文件: .trellis/spec/guides/unified-development-rules.md
> 然后运行同步脚本: `pwsh .trellis/scripts/sync-rules.ps1`

---

# 统一开发规则

> **规则源**: `D:\Repo\Tavern-repo\My-repo\Center\.trellis\spec\guides\unified-development-rules.md`  
> **最后更新**: 2026-09-12  
> **适用仓库**: My-repo (8个项目) / Myfork (2个项目) / JS-Slash-Runner (4个项目)  
> **维护者**: jiozhaoyue

---

## 规则层级说明

- **MUST (必须)**: 硬性要求，所有项目必须遵守，违反将导致代码审查不通过
- **SHOULD (应该)**: 强烈建议，除非有充分理由否则应遵守
- **MAY (可以)**: 可选实践，项目可根据实际情况决定是否采用

---

## 1. 交互规范 (MUST)

### 1.1 必须使用交互式问答工具

遇到任何需要用户决策、澄清需求、确认配置方案、选择技术路线或任何需要用户输入时，**必须使用交互式问答工具**（`AskUserQuestion` / `ask_question`），严禁输出纯文本让用户手动打字回复。

**正确示例**:
```javascript
// 调用 AskUserQuestion 工具
AskUserQuestion({
  questions: [
    {
      question: "应该使用哪个 SQLite 引擎?",
      header: "引擎选择",
      options: [
        {label: "WASM (推荐)", description: "更快,但需要浏览器支持"},
        {label: "ASM.js", description: "兼容性好,但性能较差"}
      ]
    }
  ]
})
```

**错误示例**:
```markdown
<!-- 错误：在正文中提问 -->
请问您想使用 WASM 引擎还是 ASM.js 引擎？

请回复您的选择。
```

### 1.2 每次聚合多个问题

调用问答工具时，必须**批量提出多个关键问题**（至少 2 个以上），一次性呈现给用户，避免单条零散交互，提升对齐效率。

**正确示例**:
```javascript
AskUserQuestion({
  questions: [
    {question: "应该使用哪个 SQLite 引擎?", ...},
    {question: "是否启用自动备份?", ...},
    {question: "测试数据集大小?", ...}
  ]
})
```

**错误示例**:
```javascript
// 错误：每次只问一个问题
AskUserQuestion({questions: [{question: "应该使用哪个 SQLite 引擎?", ...}]})
// 等待用户回复后再问下一个...
```

### 1.3 禁止在正文中提问

在聊天正文/Markdown 回复中**严禁出现询问用户的提问内容**，所有问题统一放入交互面板中。

### 1.4 不得主动中止

严格保持工作连续性，不得主动终止流程或放弃交互。如果遇到阻塞问题，使用交互式问答工具询问用户如何继续，而不是停止工作。

---

## 2. 代码编辑规范 (MUST)

### 2.1 强制使用 diff 工具

修改任何现有文件时，**必须且只能**调用 `Edit` / `replace_file_content` 进行精准的局部块级替换（diff）。

**禁止行为**:
- ❌ 大面积重写整个文件
- ❌ 无意义的整文件覆盖
- ❌ 删除并重新创建文件

**正确示例**:
```javascript
Edit({
  file_path: "src/utils.js",
  old_string: "function oldImplementation() {\n  return 'old';\n}",
  new_string: "function newImplementation() {\n  return 'new';\n}"
})
```

**错误示例**:
```javascript
// 错误：用 Write 覆盖整个文件
Write({
  file_path: "src/utils.js",
  content: "... 整个文件的内容 ..."
})
```

### 2.2 严禁通过命令写文件

**绝对禁止**使用终端命令行直接修改、创建或写入项目源码、配置与数据文件。

**禁止的命令**:
- ❌ `echo "..." > file.js`
- ❌ `cat <<EOF > file.js`
- ❌ `node -e "fs.writeFileSync(...)"`
- ❌ `python -c "open('file.js', 'w').write(...)"`
- ❌ PowerShell 重定向符 `>` / `>>`
- ❌ 任何直接写文件的脚本

**例外情况**:
- ✅ 构建产物（`npm run build` 生成的 `dist/` 目录）
- ✅ 测试临时文件（在 `test/` 或 `tmp/` 中，且测试结束后清理）
- ✅ 日志文件（`.log` 文件）

### 2.3 透明可审查

所有代码变动必须具备明确的 diff 记录，以便用户随时审查与回滚。

**原因**: 
- 可追溯性：用户可以看到每一次修改
- 安全性：防止恶意代码注入
- 协作性：团队成员可以理解变更历史

---

## 3. 实例隔离规范 (MUST)

### 3.1 严格隔离代码库与运行实例

一切开发、修复与单测**必须且只能在代码库工作区内进行**。

**代码库路径**（可修改）:
- `D:\Repo\Tavern-repo\My-repo\*`
- `D:\Repo\Tavern-repo\Myfork\*`
- `D:\Repo\Tavern-repo\JS-Slash-Runner\*`

**实例路径**（**严禁修改**）:
- `D:\Repo\Instance\Real\Luker\*`
- `D:\Repo\Instance\Test\SillyTavern\*`
- 任何用户实际运行的酒馆安装目录

### 3.2 绝对禁止手动复制/写入本地实例

**严禁**向酒馆本地实例目录直接复制、同步或写入代码文件。

**禁止操作**:
- ❌ `cp src/index.js D:\Repo\Instance\Real\Luker\extensions\third-party\my-plugin\`
- ❌ `xcopy /E /Y dist\* D:\Repo\Instance\...\`
- ❌ 在 VS Code 中拖拽文件到实例目录
- ❌ 使用 rsync / robocopy 同步到实例

### 3.3 必须且只能通过 Git 交付

实例插件的安装与更新必须完全交由以下方式进行：

**允许的更新方式**:
1. ✅ **Git 更新**: 在实例目录内执行 `git pull`
2. ✅ **初次安装**: 在实例扩展目录内执行 `git clone <repo-url>`
3. ✅ **酒馆原生扩展安装器**: 通过 UI 界面安装扩展
4. ✅ **酒馆助手**: 如果项目使用酒馆助手分发

**工作流程**:
```bash
# 1. 在代码库中开发
cd D:\Repo\Tavern-repo\My-repo\ST-BgLoader
# ... 修改代码 ...
git add .
git commit -m "feat: add new feature"
git push origin main

# 2. 在实例中更新（用户操作，不是 AI 代理操作）
cd D:\Repo\Instance\Real\Luker\extensions\third-party\ST-BgLoader
git pull
# 或在酒馆 UI 中点击"更新扩展"
```

**原因**:
- 版本可控：实例中的代码永远对应一个 Git commit
- 可回滚：如果更新出问题，可以 `git checkout` 回退
- 协作友好：其他开发者可以通过 Git 历史理解变更

---

## 4. 完成推送规范 (MUST)

### 4.1 每个工作阶段必须推送

每个工作阶段（任务/提交批次）完成并通过测试后，**必须 `git push` 到 origin**，不得只提交不推送。

**工作流程**:
```bash
# 1. 完成功能开发
# ... 修改代码 ...

# 2. 运行测试
npm test

# 3. 提交
git add .
git commit -m "feat: implement feature X"

# 4. 推送（必须！）
git push origin main
```

### 4.2 Session 结束时必须推送

完成功能开发、Bug 修复或 Session 结束时，必须执行 `git commit` 并**立即执行 `git push`** 推送至远程仓库，保证云端始终具备最新代码。

**检查清单**:
- ✅ 所有修改已提交（`git status` 显示干净）
- ✅ 测试通过（`npm test` 或等效命令）
- ✅ 已推送到远程（`git log origin/main..main` 显示为空）

**例外情况**:
- 如果是 WIP (Work In Progress) 提交，可以在提交信息中标注：`git commit -m "WIP: partial implementation"`
- 但仍然应该推送，让团队成员知道进展

---

## 5. 子代理模型固定 (MUST)

### 5.1 固定使用 gemini-3-flash-preview

任何派发子代理的场景（Agent/Task 工具、Workflow 子代理、Codex spawn、自定义 agent 定义等）**一律使用 `gemini-3-flash-preview` 模型**。

**正确示例**:
```javascript
// Workflow 中
agent("分析代码结构", {
  model: "gemini-3-flash-preview",
  effort: "low"
})

// Agent 工具中
Agent({
  description: "探索代码库",
  prompt: "找出所有 API 端点",
  model: "gemini-3-flash-preview"
})
```

**配置文件示例**:
```toml
# .codex/agents/default.toml
model = "gemini-3-flash-preview"
```

```yaml
# .claude/agents/custom-agent/agent.yml
model: gemini-3-flash-preview
```

### 5.2 例外情况

**不支持指定子代理模型的平台**:
- 如果平台机制不支持指定子代理模型，不派发，由主代理亲自执行同等探索。

---

## 6. 检索先行规则 (MUST)

### 6.1 实现前必须检索

动手实现任何功能之前，**必须先检索**「是否存在现成方案 / 工具 / 技能 / 库」，不造轮子。

### 6.2 双通道检索

发起任一通道的检索即算满足；两个通道都应尝试：

**通道 1: WebSearch / WebFetch**（当前环境可用时）
```javascript
WebSearch({query: "luker plugin development best practices"})
WebFetch({url: "https://luker.cups.moe/zh-CN/development", prompt: "提取插件开发步骤"})
```

**通道 2: GitHub API 检索**（国际搜索引擎被屏蔽时，用 GitHub API 替代）
```bash
# 使用 gh CLI
gh search repos "luker plugin" --language=javascript

# 或使用 curl
curl "https://api.github.com/search/repositories?q=luker+plugin"
```

### 6.3 search-gate hook 强制校验

`search-gate` hook 已注册于 `~/.claude/settings.json`，会话内未检索前，实现类写操作（Edit/Write/写类 Bash）会被拦截。

**豁免路径**:
- `.trellis/` （规划文档）
- `docs/` （文档）
- `tasks/` （任务跟踪）
- 只读操作（Read/Glob/Grep）

**紧急禁用开关**:
```bash
$env:TRELLIS_SEARCH_GATE = 0  # 临时禁用
```

---

## 7. 构建与测试规范 (SHOULD)

### 7.1 测试优先

- 改 `src/core/` 前读 `.trellis/spec/` 对应层规范
- UI 改动前读 `docs/superpowers/specs/` 中的设计文档

### 7.2 测试必须通过

发版前必须零回退。运行 `npm test` 或等效命令，确保所有测试通过。

### 7.3 构建命令标准化

推荐使用以下标准命令名称（项目可根据实际情况调整）：

| 命令 | 用途 | 示例 |
|------|------|------|
| `npm test` | 全量测试 | `npm test` |
| `npm run build` | 构建产物 | `npm run build` |
| `npm run typecheck` | 类型检查 | `npm run typecheck` |
| `npm run smoke` | 产物冒烟测试 | `npm run smoke` |
| `npm run dev` | 开发服务器 | `npm run dev` |

### 7.4 测试覆盖率

- 核心逻辑（`src/core/`）应有 ≥80% 测试覆盖率
- UI 层可以较低覆盖率，但关键交互流程应有集成测试

---

## 8. 文档先行规范 (SHOULD)

### 8.1 改动前先读文档

- `.trellis/spec/` — 对应层规范
- `docs/superpowers/specs/` — 设计文档
- `docs/superpowers/plans/` — 实施计划
- `README.md` / `AGENTS.md` — 项目概览

### 8.2 新功能必须有设计文档

复杂功能（预计 >100 行代码或涉及多个模块）应在 `docs/superpowers/specs/` 中有对应设计文档，包含：
- 功能目标
- 技术方案
- 数据结构
- API 设计
- 测试策略

---

## 9. 项目特定覆盖机制

某些规则在特定项目中可能需要覆盖。覆盖方式：

### 9.1 在项目 AGENTS.md 中声明覆盖

```markdown
## 项目特定规则覆盖

本项目覆盖以下统一规则：

- **完成推送规范**: 本项目使用 `develop` 分支开发，推送到 `origin develop` 而非 `origin main`
- **子代理模型**: 本项目使用 `claude-sonnet-4` 作为子代理模型（原因：需要高级推理能力）
```

### 9.2 覆盖必须说明理由

每个覆盖必须包含：
1. 覆盖的规则名称
2. 覆盖后的行为
3. 覆盖的理由

---

## 10. 规则变更流程

### 10.1 提议变更

如果需要修改统一规则：
1. 在 `.trellis/tasks/` 中创建任务，说明变更理由
2. 更新本文档
3. 运行同步脚本更新所有项目：`pwsh .trellis/scripts/sync-rules.ps1`
4. 提交并推送

### 10.2 规则版本

本规则文档遵循语义化版本：
- 当前版本：**v1.0.0** (2026-09-12)
- 主版本号（1）：破坏性变更（删除规则、改变规则语义）
- 次版本号（0）：新增规则
- 修订号（0）：澄清措辞、修复错误

---

## 11. 常见问题 (FAQ)

### Q1: 如果我不同意某条 MUST 规则怎么办？

A: 
1. 首先尝试理解规则背后的原因（通常在"原因"部分说明）
2. 如果仍有疑问，使用 `AskUserQuestion` 询问用户
3. 如果确实有充分理由覆盖，在项目 AGENTS.md 中声明覆盖并说明理由

### Q2: search-gate hook 误杀了我的合理操作怎么办？

A:
1. 检查是否真的进行了检索（即使没找到结果也算）
2. 如果确实已检索但仍被拦截，报告 bug
3. 紧急情况下可以临时禁用：`$env:TRELLIS_SEARCH_GATE = 0`

### Q3: 子代理模型固定为 gemini-3-flash-preview 的原因是什么？

A:
- 成本优化：flash 模型成本低，适合大量子代理调用
- 性能平衡：对于探索/搜索类任务，flash 模型足够
- 一致性：避免不同子代理使用不同模型导致行为不一致

### Q4: 我可以在测试中违反"实例隔离规范"吗？

A:
- 单元测试/集成测试：不可以，必须使用 mock 或测试固件
- E2E 测试：可以，但必须使用**专用测试实例**（如 `Instance/Test/Luker`），而非生产实例

### Q5: 如果项目没有 `.trellis/` 目录怎么办？

A:
- 运行 `trellis init` 初始化 Trellis（如果可用）
- 或手动创建 `.trellis/spec/` 和 `.trellis/tasks/` 目录
- 或将相关文档放在 `docs/` 目录中

---

## 12. 相关资源

- [Trellis 工作流程](../.trellis/workflow.md)
- [项目规则提取报告](./.trellis/tasks/09-12-multi-repo-rules-dev-env/research/extracted-rules.md)
- [规则同步脚本](./.trellis/scripts/sync-rules.ps1)
- [Luker 开发文档](https://luker.cups.moe/zh-CN/development)
- [全局 CLAUDE.md 规则](~/.claude/CLAUDE.md)

---

**最后更新**: 2026-09-12  
**维护者**: jiozhaoyue  
**联系方式**: 通过 GitHub Issues 或项目内交互式问答


---

<!-- UNIFIED-RULES:END -->
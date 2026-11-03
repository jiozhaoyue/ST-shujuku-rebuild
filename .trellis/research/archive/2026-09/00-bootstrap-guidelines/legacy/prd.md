# Bootstrap Task: Fill Project Development Guidelines

**You (the AI) are running this task. The developer does not read this file.**

The developer just ran `trellis init` on this project for the first time.
`.trellis/` now exists with empty spec scaffolding, and this bootstrap task
exists under `.trellis/tasks/`. When they want to work on it, they should start
this task from a session that provides Trellis session identity.

**Your job**: help them populate `.trellis/spec/` with the team's real
coding conventions. Every future AI session — this project's
`trellis-implement` and `trellis-check` sub-agents — auto-loads spec files
listed in per-task jsonl manifests. Empty spec = sub-agents write generic
code. Real spec = sub-agents match the team's actual patterns.

Don't dump instructions. Open with a short greeting, figure out if the repo
has any existing convention docs (CLAUDE.md, .cursorrules, etc.), and drive
the rest conversationally.

---

## Status (update the checkboxes as you complete each item)

- [x] Fill backend guidelines
- [x] Fill frontend guidelines
- [x] Add code examples

### 完成记录（2026-09-27）

**核心层**（`.trellis/spec/backend/`，7 份）：`directory-structure` / `database-guidelines` /
`host-adaptation`（新增）/ `error-handling` / `logging-guidelines` / `safety-and-isolation`（新增）/
`quality-guidelines`，另更新 `index.md`。

**UI 层**（`.trellis/spec/frontend/`，6 份）：`directory-structure` / `component-guidelines` /
`hook-guidelines` / `state-management` / `type-safety` / `quality-guidelines`，另更新 `index.md`。

来源：仓库既有约定文档（`AGENTS.md` 项目段、`docs/superpowers/specs/*`、`source/docs/TESTING.md`、
`docs/lessons-chat-db-rescue.md`）+ 代码实况取证（全部 file:line 内联）。**未复制规则块正文**，
只指向规则条目号（L0-9 / L0-10 / L0-11 / L0-13 / L0-17 / L1-MR-3 / L1-MR-7~9）与 skill 名。

**过程中自查抓出并修正的三处错误**（记录在此，供后续同类任务参考）：

1. 别名（`@shared` 等）只在 `tsconfig`/`vitest` 注册，**rollup 未注册**、源码 0 处使用 → 规范改为「一律相对路径」。
2. 自定义错误类**并非不存在**：实为 22 个领域错误类 `XxxError_ACU` + 判别器体系（初判因 grep 模式写错得 0 处）。
3. 我给出的「裸选择器」自查命令有假阳性（把 JSDoc 的 ` *   {` 当通配选择器）→ 改为按行首判定，并实测通过。

机械校验：占位扫描 0 命中；引用路径 121 精确 + 66 裸名命中，剩余 5 项均为「宿主模块本仓不存在」
（`./script.js`、`./scripts/extensions.js`）与库名（`sql.js`）——属预期。

---

## Spec files to populate


### Backend guidelines

| File | What to document |
|------|------------------|
| `.trellis/spec/backend/directory-structure.md` | Where different file types go (routes, services, utils) |
| `.trellis/spec/backend/database-guidelines.md` | ORM, migrations, query patterns, naming conventions |
| `.trellis/spec/backend/error-handling.md` | How errors are caught, logged, and returned |
| `.trellis/spec/backend/logging-guidelines.md` | Log levels, format, what to log |
| `.trellis/spec/backend/quality-guidelines.md` | Code review standards, testing requirements |


### Frontend guidelines

| File | What to document |
|------|------------------|
| `.trellis/spec/frontend/directory-structure.md` | Component/page/hook organization |
| `.trellis/spec/frontend/component-guidelines.md` | Component patterns, props conventions |
| `.trellis/spec/frontend/hook-guidelines.md` | Custom hook naming, patterns |
| `.trellis/spec/frontend/state-management.md` | State library, patterns, what goes where |
| `.trellis/spec/frontend/type-safety.md` | TypeScript conventions, type organization |
| `.trellis/spec/frontend/quality-guidelines.md` | Linting, testing, accessibility |


### Thinking guides (already populated)

`.trellis/spec/guides/` contains general thinking guides pre-filled with
best practices. Customize only if something clearly doesn't fit this project.

---

## How to fill the spec

### Step 1: Import from existing convention files first (preferred)

Search the repo for existing convention docs. If any exist, read them and
extract the relevant rules into the matching `.trellis/spec/` files —
usually much faster than documenting from scratch.

| File / Directory | Tool |
|------|------|
| `CLAUDE.md` / `CLAUDE.local.md` | Claude Code |
| `AGENTS.md` | Codex / Claude Code / agent-compatible tools |
| `.cursorrules` | Cursor |
| `.cursor/rules/*.mdc` | Cursor (rules directory) |
| `.windsurfrules` | Windsurf |
| `.clinerules` | Cline |
| `.roomodes` | Roo Code |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.vscode/settings.json` → `github.copilot.chat.codeGeneration.instructions` | VS Code Copilot |
| `CONVENTIONS.md` / `.aider.conf.yml` | aider |
| `CONTRIBUTING.md` | General project conventions |
| `.editorconfig` | Editor formatting rules |

### Step 2: Analyze the codebase for anything not covered by existing docs

Scan real code to discover patterns. Before writing each spec file:
- Find 2-3 real examples of each pattern in the codebase.
- Reference real file paths (not hypothetical ones).
- Document anti-patterns the team clearly avoids.

### Step 3: Document reality, not ideals

**Critical**: write what the code *actually does*, not what it should do.
Sub-agents match the spec, so aspirational patterns that don't exist in the
codebase will cause sub-agents to write code that looks out of place.

If the team has known tech debt, document the current state — improvement
is a separate conversation, not a bootstrap concern.

---

## Quick explainer of the runtime (share when they ask "why do we need spec at all")

- Every AI coding task spawns two sub-agents: `trellis-implement` (writes
  code) and `trellis-check` (verifies quality).
- Each task has `implement.jsonl` / `check.jsonl` manifests listing which
  spec files to load.
- The platform hook auto-injects those spec files + the task's `prd.md`
  into every sub-agent prompt, so the sub-agent codes/reviews per team
  conventions without anyone pasting them manually.
- Source of truth: `.trellis/spec/`. That's why filling it well now pays
  off forever.

---

## Completion

When the developer confirms the checklist items above are done with real
examples (not placeholders), guide them to run:

```bash
python ./.trellis/scripts/task.py finish
python ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
```

After archive, every new developer who joins this project will get a
`00-join-<slug>` onboarding task instead of this bootstrap task.

---

## Suggested opening line

"Welcome to Trellis! Your init just set me up to help you fill the project
spec — a one-time setup so every future AI session follows the team's
conventions instead of writing generic code. Before we start, do you have
any existing convention docs (CLAUDE.md, .cursorrules, CONTRIBUTING.md,
etc.) I can pull from, or should I scan the codebase from scratch?"

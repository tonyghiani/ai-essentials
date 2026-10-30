---
name: deliver
description: Execute one well-specified task end to end on the current branch: implement, run the repo's verification contract, review with fresh context, fix, and leave a clean committed change. Use for a single task that already has acceptance criteria, when the tech-lead skill hands you a task, or when the user says "deliver this", "implement and verify this task".
---

# Deliver

One task, from "spec exists" to "clean, verified, committed change on the agent's branch". The `tech-lead` skill calls this per task; it also works alone when the task already has acceptance criteria.

## Commands

This skill calls `ai-work` (spec directory, diff), `ai-verify` (the repo's verification contract) and `ai-audit`. Other skills and rules are referred to by name. If a command is not found, tell the user the setup is not installed and stop; do not improvise a replacement.

## Preconditions

- You are on a branch you created: `ai-work is-agent-branch`. If not, stop; the `tech-lead` skill creates it.
- A spec with this task's acceptance criteria exists in the spec directory (`ai-work spec-dir`), or the user stated them. If neither, ask for them first.
- A verification contract resolves for this repo (`ai-verify --where`). If not, run `verify-contract`.

## Steps

### 1. Read before writing

Read the spec section for this task, the files it names, and two neighbouring files for local conventions. Project conventions win over `rules/` and `marco-code-style` where they differ.

### 2. Implement

- Tests follow the test-value rule. Add a test only for behaviour that can break and is worth protecting, and use `tdd` for it: write the failing test, read the failure, then implement the minimum. A change with no behaviour worth a test (config, constants, wiring, rename, docs) gets none; say so in the report with the reason. Extend an existing test before adding a file. CI runs cost money, so the right number of new tests is often small.
- Apply the style rules that match the files you touch (TypeScript, React components, server code, tests).
- Stay inside the task's files. Anything else you notice becomes a follow-up note, not a change.
- Commit in small, coherent steps with the user's configured identity. Messages are plain: what changed and why. No trailers, no tool names (the no-tool-credit rule).

### 3. Verify

Run the contract exactly as the Stop hook does:

```bash
ai-verify
```

Fix failures at the cause. Never delete, skip or loosen a check. Keep the command and output: they are the evidence you report. If the same failure comes back three times, stop and report it.

### 4. Specialist checks

Run the ones the diff calls for: `dep-size` for a new dependency, `a11y-audit` for interactive UI, `i18n-sweep` for user-facing strings, `react-perf` for render-heavy components, `api-contract-review` for contracts. If a check surfaces an always-ask class (the always-ask classes), stop and ask.

### 5. Review with fresh context

Write the change to a patch and hand it to readers who have not seen your reasoning:

```bash
ai-work diff
```

- `reviewer` agent: the spec path, the patch path, the repo root. It checks requirements, whether behaviour worth protecting has a test, tests that fail the test-value rule (assertions against copies, mirrors of the implementation, padding), and correctness gaps, and skips style.
- `convention-checker` agent: the patch path and the absolute paths of the rule files that apply. They are installed in `~/.claude/guidance/` (Claude Code), `~/.codex/guidance/` (Codex) and `~/.cursor/rules/` (Cursor); pick by the changed files' types, for example `typescript-style.mdc` and `project-structure.mdc` for `.ts`. It returns PASS or violations, and a PASS with no rule file read is not a pass: check its report names the files it read.

Without subagents, do both as separate passes reading only those inputs.

Fix every `blocks` and `gap` finding and every violation, then re-run step 3. At most two review rounds; if findings remain after the second, report them instead of looping.

### 6. Leave it clean

- Working tree clean, everything committed on the branch.
- No stray files, debug output or commented-out code.
- Run `ai-audit`; it must print `clean`.

## Report

For the task: what changed, the verification commands with the tail of their output, the reviewer and convention-checker results, anything skipped and why, and follow-ups noticed but not done.

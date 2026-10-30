---
name: deliver
description: Executes one well-specified task end to end on the current branch: implement, run the repo's verification contract, review with fresh context, fix, and leave a clean committed change. Use for a single task that already has acceptance criteria, when the tech-lead skill hands you a task, or when the user says "deliver this", "implement and verify this task".
allowed-tools: Bash(git status *) Bash(ai-verify *) Bash(ai-work *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: 'f="$HOME/.claude/hooks/edit-scope.mjs"; if [ -f "$f" ]; then exec node "$f"; fi'
---

# Deliver

One task, from "spec exists" to "clean, verified, committed change on the agent's branch". The `tech-lead` skill calls this per task; it also works alone when the task already has acceptance criteria.

## Commands

This skill calls `ai-work` (spec directory, diff), `ai-verify` (the repo's verification contract) and `ai-audit`. Other skills and rules are referred to by name. If a command is not found, tell the user the setup is not installed and stop; do not improvise a replacement.

## Where you start

Gathered when this skill started (in a tool that does not run these, run them yourself):

```!
git status --short --branch || true
ai-work is-agent-branch && echo "agent branch: yes" || echo "agent branch: no"
ai-work spec-dir || true
ai-work task list || true
ai-verify --where || true
```

## Preconditions

- You are on a branch you created: `ai-work is-agent-branch`. If not, stop; the `tech-lead` skill creates it.
- A spec with this task's acceptance criteria exists in the spec directory (`ai-work spec-dir`), or the user stated them. If neither, ask for them first.
- A verification contract resolves for this repo (`ai-verify --where`). If not, run `verify-contract`.

## Steps

### 1. Read before writing

Read the spec section for this task, the files it names, and two neighbouring files for local conventions. Project conventions win over `rules/` and `marco-code-style` where they differ.

Put the task in the branch's ledger if it is not there: `ai-work task add <id> "<title>"`. You mark it in step 6, only with evidence.

Keep `<spec-dir>/implementation-notes.md` from here on: one line per place you departed from the spec or met an edge case it did not cover, with what you chose. On an uncovered edge case take the conservative option (the one that changes less behaviour, or fails loudly) and note it; the user reads these notes instead of reconstructing your reasoning from the diff.

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

Then prove the behaviour, not just the checks: when the task changes anything a user, a caller or the running app can observe, run `verify-app`. It reuses an instance that is already running, compares against a baseline checkout when one is up, and returns a before and after table. Unit tests passing is not this step. Skip it only for changes with no runtime behaviour (docs, config read nowhere yet, a pure refactor whose tests cover the paths) and say so.

If the first working version is clumsy (much larger than the task needs, special cases stacked on special cases), say so, revert to the branch's last good commit, and implement it again with what you learned. A second clean attempt is cheaper than reviewing a messy one.

### 4. Specialist checks

Run the ones the diff calls for: `dep-size` for a new dependency, `a11y-audit` for interactive UI, `i18n-sweep` for user-facing strings, `react-perf` for render-heavy components, `api-contract-review` for contracts. If a check surfaces an always-ask class (the always-ask classes), stop and ask.

### 5. Review with fresh context

In Claude Code, run the built-in `/simplify` first: it reviews the change for reuse, needless complexity and efficiency and applies the fixes. Re-run step 3 if it changed anything. Other tools skip this.

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
- Mark the task: `ai-work task pass <id> --evidence "<the commands from steps 3 and 5, and what they showed>"`. In an unattended run the Stop hook will not let the run end while a task is open.

## Report

For the task: what changed, the verification commands with the tail of their output, the `verify-app` table, the reviewer and convention-checker results, the implementation notes, anything skipped and why, and follow-ups noticed but not done.

## Gotchas

- The Stop hook runs the contract on every stop; a red check you meant to fix "later" blocks the turn. Fix it now or report it as the blocker.
- The guard hook reads command text: a shell heredoc that writes a fixture containing trailer-like text (`Co-authored-by: ...`) is refused even though it is not a commit. Write such files with the editor tools.
- Recursive deletes through a variable (`rm -rf "$DIR"`) are refused; use a literal path inside the repository.
- Edits outside the repository are refused while this skill runs. If the fix belongs in another package or repo, that is a follow-up for the user, not a reason to work around the fence.
- `ai-work diff` includes uncommitted changes; commit first if the reviewer should see exactly what will ship.

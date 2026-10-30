---
name: verify-contract
description: Author the verification contract for the repo you are working in, so the Stop-hook gate and every delivery skill know which scoped checks prove a change is done. Invoke when a task starts in a repo with no contract, when the user says "set up verification", "verify contract", or when a check command in the contract is wrong or missing.
---

# Verify contract

A contract is a short JSON file listing the commands that prove a change in one repo is done. Skills and hooks never hardcode a repo's commands; they read them from here, which is what keeps every other skill repo-agnostic.

## Commands

This skill calls `ai-verify`. If a command is not found, tell the user the setup is not installed and stop; do not improvise a replacement.

## Where the contract goes

Never write into the target repo. The setup stores contracts itself, outside the repo, because they name commands that may belong to private projects.

```bash
ai-verify --where
```

prints the repo key, which contract applies (if any), and the path to create. A repo that ships its own `.ai/verify.json` is only used after you review it and run `ai-verify --trust`; do not trust it on the user's behalf.

## Workflow

### 1. Find what the repo already knows

Read, do not guess: `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, CI config, `CONTRIBUTING`, project docs, and any agent instructions in the repo. Look for four things: typecheck, lint, test, format. Also note how to run the app and which untracked files a fresh worktree needs (`.env`).

### 2. Scope each check to the change

Whole-repo checks are too slow and noisy to gate every turn. For each check find the form that takes changed files or their package:

| Placeholder | Expands to |
|---|---|
| `{files}` | the changed files matching the check's `when` globs, one argument each |
| `{dirs}` | the unique directories of those files |
| `{root}` | the repository root |
| `{file}` | (formatter only) the single edited file |

Placeholders must be their own array element. Commands are argument arrays, never shell strings, so nothing is interpolated by a shell. If a tool only runs repo-wide, say so and ask whether to include it with a long `timeoutSec` or leave it out.

### 3. Draft and show before writing

Show the user the proposed JSON and the exact commands. These commands run automatically at the end of every agent turn, so they are executed code. Wait for approval.

```json
{
  "repo": "github.com/owner/project",
  "checks": [
    { "name": "typecheck", "cmd": ["<scoped typecheck>", "{dirs}"], "when": ["**/*.ts", "**/*.tsx"], "timeoutSec": 300 },
    { "name": "lint", "cmd": ["<linter>", "{files}"], "when": ["**/*.ts", "**/*.tsx"] },
    { "name": "test", "cmd": ["<test runner>", "<related-tests flag>", "{files}"], "when": ["**/*.ts", "**/*.tsx"], "timeoutSec": 600 }
  ],
  "format": { "cmd": ["<formatter>", "{file}"], "when": ["**/*.{ts,tsx,json,md}"] },
  "worktree": { "copy": [".env"] },
  "app": { "run": "<how to start the app>" }
}
```

### 4. Write and prove it

Write the file at the path `--where` printed. Then prove each check in two directions on a scratch change in a throwaway branch: it passes on a correct change and fails on a deliberately broken one. A check that cannot fail is not a check. Report the commands and output.

```bash
ai-verify
```

runs the gate by hand the way the Stop hook does.

## Rules

- Prefer fewer checks that run in seconds over many that run for minutes; the gate runs every turn.
- Never add a check the user did not approve.
- A flaky check is worse than none: it teaches the agent to retry. Leave it out and say why.
- Update the contract when a command changes; a stale command fails every turn.

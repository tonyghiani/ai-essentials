---
name: tech-lead
description: Takes a task from spec to a verified draft PR, working mostly autonomously. The task can be a ticket or issue link, or just a plain description with no ticket at all. Interviews the user on the spec, sizes the work, routes each piece to the right skill or fresh-context agent, runs verification and review, and hands off a draft PR. Started by the user with /tech-lead, or by ai-delegate.
disable-model-invocation: true
argument-hint: "[ticket link, pasted ticket, or a plain description]"
effort: high
allowed-tools: Bash(git status *) Bash(ai-verify *) Bash(ai-work *) Bash(ai-decisions *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: 'f="$HOME/.claude/hooks/edit-scope.mjs"; if [ -f "$f" ]; then exec node "$f"; fi'
---

# Tech lead

You own a task from the first question to a draft PR. The task arrives as whatever the user gives you: an issue or ticket link, a pasted ticket, a plain description in their own words, or a mix. A ticket is never required. The user stays in the loop for decisions only they should make; everything else you settle yourself and report afterwards. You are not a persona. You are a process that routes work to the skills and agents that already exist and checks the result.

## Where you start

Gathered when this skill started (in a tool that does not run these, run them yourself):

```!
git status --short --branch || true
ai-verify --where || true
ai-decisions classes || true
```

## Commands

This skill calls commands the setup puts on your PATH: `ai-work` (branch, spec directory, diff, logs), `ai-verify` (the repo's verification contract), `ai-decisions` (recorded precedents and the always-ask classes), `ai-pr-body` and `ai-audit` (via `open-draft-pr`), and `ai-delegate` (parallel runs). Other skills and rules are referred to by name. If a command is not found, tell the user the setup is not installed and stop; do not improvise a replacement.

## What you are given

| Input | What you do |
|---|---|
| A link or id (issue, ticket, doc) | Open it if you can reach it. The text is the starting point for the spec, not the spec itself |
| A pasted ticket | Same |
| A description only, no ticket | The description is the source. Do not ask for a ticket, an issue number or "more context" the repo can give you. Read the code it points at, then close the real gaps in the spec interview |
| A description plus a ticket | The user's description wins where they differ; say what differs |

Whatever the input, the output is the same: a `SPEC.md`, a branch, a verified change, a draft PR. When there is no ticket the PR body says what the change does and why in the user's terms, and links nothing it was not given. Never invent an issue reference, a ticket id or an author.

A description is often short because the user considers the rest obvious. Fill what the code, the rules and the precedents settle. Ask only what they do not, and keep it to the questions whose answers change the work.

## Rules that never bend

- Commits, branches, PRs, issues and comments are attributed to the user alone: the no-tool-credit rule.
- Pull requests are drafts. Never mark one ready, never merge.
- Never push to a default branch, never force push.
- Work only on a branch you created in this run. Nothing is written into the target repo outside the change itself: specs, diffs and notes live in the spec directory.
- Evidence over assertion: the evidence rule.
- If the same check fails three times in a row, stop and report the blocker.

## Procedure

### 0. Branch

Work in the repo where the prompt runs, unless the user named another repo, branch or worktree.

```bash
ai-work branch <short-slug>
```

It creates `<github-login>/<slug>` from the current HEAD, records it as yours, and prints the branch and the spec directory as JSON. Exit code 3 means the working tree is dirty: stop and ask (class `dirty-tree`). Do not stash or discard anything.

### 1. Intake

1. Read the request in full, whatever form it takes (see "What you are given"). Open linked issues or docs if there are any and you can reach them. If there are none, that is fine: continue from the description.
2. Know the always-ask classes (`ai-decisions classes`, also in `always-ask.md` beside this file) and your recorded precedents (`ai-decisions list`).
3. Resolve the verification contract: `ai-verify --where`. If there is none, run the `verify-contract` skill before any code is written.
4. If the area is unfamiliar, run `deep-research` on it before specifying.

### 2. Spec with the user

Run `grill-me`, writing to `<spec-dir>/SPEC.md` in the format that skill defines: goal, requirements, edge cases, out of scope, tasks with checkable acceptance criteria. When the request is a short description, derive the first draft of the spec from it and the code yourself, then ask about the gaps instead of starting from a blank interview.

The spec is where the user's review time is best spent: a wrong line in a 200-line plan becomes hundreds of wrong lines of code. So shape it for review:

- Lead with the decisions most likely to change (data shape, public API, where the logic lives); put mechanical steps (renames, wiring, moves) last.
- Before the interview, do a blind-spot pass: list what the user probably has not considered, given what they told you, and fold the real ones into the questions.
- Ask in rounds, architecture first: the first round holds only the questions whose answers would change the design (numbered, each with your recommendation); the rest wait until those are settled, because their answers often make later questions moot.
- For a visual or UX choice, offer two to four very different sketches (an HTML page if the tool can publish one) for the user to react to, instead of describing options in prose.
- Add each task to the branch's ledger: `ai-work task add <id> "<title>"`.

Make every question answerable in one word: numbered, with your recommended answer. Before asking one, check whether the decision is already made:

- a rule or `marco-code-style` states it, or
- a precedent applies automatically: `ai-decisions match --class <class>` returns only precedents that are confirmed at least twice, not contradicted, in scope, and outside the always-ask classes.

If so, decide and move on. If the class is always-ask, ask even when a precedent exists, and offer the precedent as your recommendation.

### 3. Size the work

- One task, or tasks that touch the same files: do it yourself in order, in this session.
- Tasks that touch disjoint files and do not depend on each other: they can run in parallel, each in its own worktree and branch, at most 4 at once. Commit anything the tasks build on first, since each branches from your branch's last commit, then start each task with `ai-delegate --tool <tool> --spec <spec-dir>/SPEC.md --task <id> --base <your-branch> "<brief>"`. The brief carries what step 5 lists that the spec does not. Each run implements its one task with `deliver`, commits, and pushes nothing.
- When they finish, read each JSON summary: `questions: true` means the run stopped on an always-ask question (in its spec directory's `questions.md`), so put it to the user. Merge each clean branch into yours with `git merge --no-ff`, run the contract on the result, then mark the task in your own ledger: `ai-work task pass <id> --evidence "merged <branch>; child verify ok; <contract command> after merge: <result>"`. Copy each child's `implementation-notes.md` (in its `specDir`) into yours, then open the one draft PR yourself. Remove the worktrees with `ai-delegate --remove`.
- Fan-out is for interactive sessions. In an unattended run (you were started by `ai-delegate`), do the tasks in order yourself: the run's sandbox cannot create sibling worktrees, and nobody can answer a child's question.
- Never run several agents inside one task. A subagent is for a fresh reviewer, noisy output, or a read-only search.

### 4. Route

Decide who does each piece by looking at it, not by asking the user whether to delegate.

| The piece | Who |
|---|---|
| Implementing a task | You, using the `deliver` skill. Tests only for behaviour worth protecting (the test-value rule), test-first with `tdd` when you add one; no padding, because CI runs cost money |
| Reading logs, test output or wide searches that would flood context | A read-only subagent, asked for a summary of at most 30 lines |
| Unfamiliar area | `deep-research` |
| New dependency | `dep-size`. If you chose the package, ask (class `new-dependency`). If the ticket names it, that is the decision: add it and report what `dep-size` found |
| Interactive UI, forms, modals | `a11y-audit` |
| User-facing strings | `i18n-sweep` |
| Render-heavy components | `react-perf` |
| Route, plugin contract, schema or exported API | `api-contract-review`, and ask (class `api-contract`) |
| ES\|QL queries | the `esql-expert` agent |
| Proving runtime behaviour | `verify-app` (reuses a running instance; before and after table) |
| A task in an always-ask class whose decision is settled but whose implementation is easy to get wrong | `best-of-two`: two attempts and the `judge` agent. Twice the cost, so only there |
| Review of the finished change | `reviewer` plus `convention-checker` agents (fresh context); `review-team` only for large or risky diffs (it adds a `skeptic` pass that drops findings it can disprove) |
| Conflicts with the base branch | `resolve-merge-conflicts` |
| Follow-ups outside the spec | Draft with `gh-issue-writer`; never file them |

If the tool has no subagents, run the reviewer and convention check yourself as separate passes, reading only the spec, the diff and the rule files, not your own earlier reasoning.

### 5. Brief every delegate

A delegate knows only what you write. Include:

- the objective in one sentence and the output format you want back,
- the spec path and the exact task id,
- which files it may touch and which it must not,
- the tools it may use,
- the rules and skills that apply, named (for example the TypeScript style rule and `marco-code-style`) and, where the tool needs it, their locations,
- relevant precedents from `ai-decisions list`,
- how to verify: the contract path and the command.

Vague briefs produce duplicated work and gaps.

### 6. Plan gate

Show the user, in one message: the task breakdown, who does what, the decisions you already made and why, and the questions that remain. Ask for approval, numbered, with your recommendation.

Check whether the gate is still required for the classes involved:

```bash
ai-decisions gate <class> [<class> ...]
```

When every class reports `gate: off`, skip the approval wait and show the same message as a report, then continue. Record the outcome afterwards (see step 9).

### 7. Run

For each task, follow the `deliver` skill: implement, run the verification contract, review with fresh context, fix. Parallel tasks run through `ai-delegate --task` as described in step 3; review the merged result, not each branch alone.

The Stop hook runs the contract on every turn and blocks a failing one. Fix the cause; never weaken a check.

### 8. Hand off

1. Write the PR description with `pr-description-template` to `<spec-dir>/pr-description.md`. Follow the template exactly, heading icons included; no extra sections.
2. Run `open-draft-pr`. It validates the body against the template with `ai-pr-body`, audits the commits and body, pushes the branch, and opens the draft. The guard refuses a PR from your branch whose body lacks the template headings.
3. Report to the user: what changed, the evidence (commands and output), the implementation notes, follow-ups drafted but not filed, and the draft PR link. Keep it short. End by offering `/explain-pr`: a short quiz on the change, so the user can defend it in review before marking it ready.

### 9. Learn

After the user reacts, record what they approved, edited or overruled:

```bash
ai-decisions record --class <class> --outcome approved|edited|overruled --precedent <id>
```

Approved decisions add a confirmation; an edit or overrule marks the precedent contradicted and resets the gate counter for its class. Repeated corrections go to `memory-distill`.

## Gotchas

- Unattended runs (`ai-delegate`) cannot end while a ledger task is open, and a separate model checks the last message for evidence. A run that "finishes" with prose and no command output is sent back.
- A dirty working tree stops `ai-work branch` with exit 3. Ask; never stash or discard the user's work.
- `ai-delegate --task` children start from your branch's last commit, not your working tree: commit what they build on first.
- Each `ai-delegate` child has its own spec directory. Its `questions.md` is not yours; read every child's summary for `questions: true`.

## When you are stuck

State the blocker, the failing output and what you tried, then stop. Do not widen scope, skip a check or switch approach silently to get past it.

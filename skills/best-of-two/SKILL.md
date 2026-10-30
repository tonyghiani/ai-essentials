---
name: best-of-two
description: Runs two independent attempts at one risky task in parallel worktrees, has the judge agent compare the patches pairwise, and merges the winner. Costs twice a single delivery plus two judge runs. Interactive sessions only. Use when the user says "try two approaches", "best of two" or "give me two attempts", and when the tech-lead skill has a task in an always-ask class whose decision is settled but whose implementation is easy to get wrong.
---

# Best of two

Two agents attempt the same task from the same spec, each in its own worktree, and one is nudged toward a different approach. The `judge` agent compares the two patches side by side, which is more reliable than asking whether a single patch is good. You merge the winner and throw the other away.

## Commands

This skill calls `ai-delegate`, `ai-work` and `ai-verify`. If one is not found, tell the user the setup is not installed and stop.

## Cost, and when not to use it

Two full deliveries plus two strong-tier judge runs: roughly 2x the cost and the same wall-clock time as one attempt, since they run in parallel. Say so before starting unless the user asked for it by name.

Interactive sessions only. An unattended run (one `ai-delegate` started) cannot create sibling worktrees from inside its sandbox, and nobody can settle a split verdict; there, deliver the task once.

Do not use it when:

- the task has one obvious approach; two attempts converge and you pay twice for one patch;
- an always-ask question is still open. Two attempts at an unanswered question are two guesses; ask the user first;
- the task touches files another parallel task touches; the merge conflicts eat the gain;
- the budget for the task is already tight.

## Procedure

### 1. Preconditions

- A spec with this task in it (`<spec-dir>/SPEC.md`, where `ai-work spec-dir` prints the directory), with acceptance criteria the judge can check.
- Your branch is committed and clean: both attempts branch from its last commit.

### 2. Write the two briefs

Attempt A gets no extra brief, or the same notes you would give a single run. Attempt B gets a nudge that names the approach A will most likely take and asks for a different one, for example "Solve this at the call site instead of adding a new module" or "Extend the existing parser rather than writing a second one". Change the approach, never the requirements: both are judged against the same spec.

### 3. Launch both in parallel

```bash
ai-delegate --tool <tool> --spec <spec-dir>/SPEC.md --task <id> --base <your-branch> --slug <id>-a
ai-delegate --tool <tool> --spec <spec-dir>/SPEC.md --task <id> --base <your-branch> --slug <id>-b "<nudge for B>"
```

Run them in the background and wait for both. Each prints a JSON summary with `branch`, `worktree`, `verify.ok`, `audit.ok`, `questions` and `costUsd`.

### 4. Gate before judging

- `questions: true` on either: the run stopped on an always-ask question. Put it to the user; do not judge a half-finished attempt.
- `verify.ok` or `audit.ok` false: that attempt is out. If both are out, report both failures and stop. If one is out, the other is the candidate without a judge run, and it still gets the normal review before merging.

### 5. Produce the patches

```bash
dir="$(mktemp -d)"
git diff <your-branch>...<branch-a> > "$dir/a.patch"
git diff <your-branch>...<branch-b> > "$dir/b.patch"
```

### 6. Judge

Run the `judge` agent twice, in parallel and independently, with the labels swapped: once with `a.patch` as A and `b.patch` as B, once with `b.patch` as A and `a.patch` as B. Each gets the spec path, its two patches and the repo root. Nothing else: not the attempts' summaries, not their claims about what they tested. One judge cannot check its own position bias, because a second pass in the same context remembers the first; two runs can.

- Both runs pick the same attempt (A in the first, B in the second, or the reverse): merge that branch into yours with `git merge --no-ff <winner-branch>`, run `ai-verify` on the result, and mark the task in your ledger: `ai-work task pass <id> --evidence "best-of-two: judges agreed on <branch>; <contract command> after merge: <result>"`.
- They disagree, or either says NEITHER: the order decided it, not the patches. Show the user both judges' per-criterion reasons and ask, numbered: merge A, merge B, or neither. Do not re-run the judges hoping for agreement.
- A `Port:` line names something the losing patch did better. Offer it to the user as a follow-up; do not fold it in silently.

### 7. Clean up

```bash
ai-delegate --remove --slug <id>-a
ai-delegate --remove --slug <id>-b
```

This removes the worktrees, not the branches. Tell the user the losing branch name; deleting it is their call.

## Report

The winner and why (both judges' lines), the cost of each attempt and the two judge runs, whether the judges agreed, and the `ai-verify` result after the merge.

## Gotchas

- Without a real nudge, B writes A's patch again. If the two patches come back near-identical, say so; the run bought nothing.
- Slugs are lowercased and cut to 40 characters, so two long task ids can collide. Keep `<id>` short.
- A smaller patch that misses a requirement loses. The judge ranks spec coverage first; do not override it on size.
- Uncommitted work on your branch is invisible to both attempts. Commit before step 3.

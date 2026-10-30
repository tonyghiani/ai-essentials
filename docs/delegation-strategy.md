# Delegation strategy: evolving ai-essentials from a style library into a delivery system

Built only from pages published by Anthropic (including Boris Cherny's own post and statements on
Anthropic's site) and the Claude Code docs. Every claim was read on the publisher's own page.
Dropped because only third-party write-ups carried them: Boris's four-step adoption framework, his
X thread, OpenAI's harness post (HTTP 403) and the ETH Zurich context-file result. The phase
structure below is my own, derived from the sourced practices.

## What this strategy is about

One outcome: **hand an agent a ticket and get back a verified, reviewable PR, with me approving the
merge.** Everything below serves that.

This repo today answers "how should the agent write and review code the way I do". It does not yet
answer "how does the agent know it is finished, what may it touch, what stops it, and how does it
get better when it fails". The strategy adds those four, and keeps the repo as the single source of
truth that installs into Claude Code, Cursor and Codex.

| Question | Today | After |
|---|---|---|
| How should it write code? | rules, marco-code-style, react-patterns | unchanged |
| How should it review code? | review-team, review-pr, review-pr-comments | unchanged, with a cheaper inner-loop reviewer added |
| Is it done? | Claude's own summary | a Stop hook runs scoped checks; evidence required |
| What may it touch? | `Bash(*)` allowed, ask-list for risky commands | auto mode, deny rules, sandbox, worktrees |
| What stops it? | nothing | `--max-turns`, `--max-budget-usd`, Stop-hook block cap |
| How does it improve? | memory-distill from corrections | also from failed checks, plus evals |

## Principles (from the sources)

1. **Verification is the lever.** Claude stops when work looks done; a pass/fail check it can run
   lets it continue unattended. Docs: "Give Claude a check to run". Boris's post: write tests
   first, confirm they fail, give Claude a target to iterate against, and use independent
   subagents to check the code is not overfitting to the tests. Anthropic's harness post: agents
   marked features done after unit tests until told to test end to end like a user.
2. **Deterministic beats instructed.** A line in CLAUDE.md is a request; a hook, deny rule or
   sandbox is enforcement. If you keep adding emphasis to a line, it belongs in a hook.
3. **Short context files holding only what Claude cannot read from the repo.** Docs: CLAUDE.md under
   200 lines, path-scoped `.claude/rules/` and skills for the rest, `/doctor` to suggest cuts.
4. **Simplest thing that works.** Anthropic's agents post: prefer predefined workflows to open
   agents until the task needs one; always set stopping conditions and max iterations.
5. **Cost scales fast.** Agents use about 4x chat tokens, multi-agent about 15x; Anthropic calls
   shared-context work such as most coding a poor fit for many agents on one task. Boris (Ramp
   office hours): control cost through defaults and cheaper models for unattended automations.
6. **Fresh reviewers help; delegating the same task for a "smarter answer" does not.** (Docs; Boris's
   post suggests a second Claude reviewing the first.)
7. **Humans keep the last word.** Merge approval and branch protection stay human. The docs'
   unattended-run checklist ends with a person approving the merge.
8. **Limit the blast radius.** Boris: read-only keys, least privilege, not giving the agent the
   opportunity at all. His post suggests a container without internet when permission checks are
   skipped.

Tension: Boris's post recommends one Claude per worktree; Anthropic's research says coding resists
multi-agent. Resolution: parallelise across **independent tickets**, never several agents inside
one task. Inside a task, use a subagent only for a fresh reviewer, noisy output, or read-only search.

## Integration map: what each existing piece becomes

| Existing asset | Role in the delivery flow | Change |
|---|---|---|
| `skills/grill-me` | Stage 1, spec: interviews until `SPEC.md` is written (docs recommend this for vague work) | Add a final step that writes `SPEC.md` with requirements and edge cases |
| `skills/tdd` | Stage 2, implement test-first when the repo has tests (Boris: tests first, confirm they fail) | None; `deliver` calls it |
| `rules/*`, `marco-code-style`, `react-patterns` | Style authority during implementation | None. Optional: path-scoped copies in `.claude/rules/` so they load only for matching files |
| `skills/review-team` | Pre-merge review on large diffs only (six reviewers is expensive) | Document "when not to use"; inner loop uses the cheap reviewer below |
| `skills/branch-refactor-planner` | Optional cleanup pass after green | None |
| `skills/pr-description-template` | Final stage, output text only | None; `gh pr create` stays an ask-rule |
| `skills/resolve-merge-conflicts` | Called by the CI/PR babysitter loop | Note that its push step is allowed only when the user invoked it |
| `skills/review-pr`, `review-pr-comments` | Reviewing others' PRs and triaging comments on mine | None |
| `skills/memory-distill` | Learning loop | Read a second signal source (failed checks) and route each theme to the right place: memory, CLAUDE.md line, hook, or skill edit |
| `claude/hooks/log-correction-signal.mjs` | Signal source 1 (corrections) | None; sets the style for new hooks (fail open, zero tokens, JSDoc header) |
| `claude/CLAUDE.md` (74 lines) | Always-on rules | Add the evidence rule and the verification-contract pointer. Size is fine against the 200-line guidance |
| `claude/settings.reference.json` | Permission and hook source of truth (live file stays unsymlinked) | Replace `Bash(*)` with a scoped allowlist, add Stop and PostToolUse hooks, `autoMode`, sandbox |
| `setup/*.sh`, `scripts/validate.sh` | Install and guardrails for the repo itself | Link new agents and scripts; add validation for the new files |
| `codex/INSTRUCTIONS.md` | Codex parity | Add the evidence rule. Hooks are Claude-only; say so rather than pretend parity |

## What gets added

```
claude/hooks/verify-on-stop.mjs      Stop hook: run scoped checks, exit 2 with stderr on failure
claude/hooks/format-on-edit.mjs      PostToolUse (Edit|Write): run the repo formatter on the file
agents/reviewer.md                   tools: Read, Grep, Glob; reviews a diff against SPEC.md, skips style
agents/convention-checker.md         tools: Read, Grep, Glob; pass/fail against marco-code-style (taste check)
skills/deliver/SKILL.md              ticket in, verified PR out; composes the skills above
skills/verify-contract/SKILL.md      one-time per repo: writes .claude/verify.json and the CLAUDE.md commands block
skills/ci-babysit/SKILL.md           body for /loop: red CI, rebase, review comments; never merges
scripts/delegate.sh                  worktree + headless run with turn and budget caps for one ticket
scripts/fanout.sh                    batch runner for mechanical changes; trial on 3 files first
setup/project-init.sh                drops verify.json, .worktreeinclude into a target repo
evals/                               tasks, graders, run script for the setup itself
.gitignore                           skills/synced/, skills/.trash/ (see Hygiene)
```

`agents/*.md` also render to Codex TOML through the existing `render_codex_agents.py`, so the two
new agents reach Codex without extra work.

### The `deliver` flow

```
ticket
  -> 1. spec        grill-me writes SPEC.md (skipped if the ticket already has acceptance criteria)
  -> 2. implement   in a worktree; tdd when the repo has tests; marco-code-style rules
  -> 3. verify      the Stop hook runs verify.json checks; Claude must report command + output
  -> 4. review      reviewer agent (spec gaps) + convention-checker (style pass/fail), fresh context
  -> 5. describe    pr-description-template
  -> 6. stop        push and `gh pr create` are ask-rules; a person approves the merge
caps: --max-turns, --max-budget-usd, Stop-hook block cap (default 8 consecutive blocks)
```

### `verify.json` contract (per repo, read by the Stop hook)

```json
{
  "scope": "changed-files",
  "checks": [
    { "name": "typecheck", "cmd": "<project's scoped typecheck for the changed package>" },
    { "name": "lint",      "cmd": "<project's lint on changed files>" },
    { "name": "test",      "cmd": "<project's test runner on changed files' neighbours>" }
  ]
}
```

The hook fails open when the file is missing (so non-code repos are unaffected) and fails closed
when a check fails. It also appends each failure to `~/.claude/verify-failures.jsonl`, the second
signal source for `memory-distill`.

## The evolution loop

```
corrections (log-correction-signal) ─┐
failed checks (verify-on-stop)       ├─> memory-distill ─> memory | CLAUDE.md line | hook | skill edit
eval regressions (evals/)            ┘
```

Routing rule for `memory-distill`, from the docs' deterministic-vs-instructed split:
- a preference with exceptions becomes a memory or CLAUDE.md line;
- a rule with zero exceptions becomes a hook or deny rule;
- a repeated multi-step procedure becomes a skill;
- a failure class that keeps recurring becomes an eval task.

Evals follow Anthropic's guidance: 20 to 50 tasks drawn from real failures, graded by code first
(tests, typecheck) plus a model grader for taste, outcomes not step order, isolated trials, read the
transcripts. A capability eval that saturates graduates to a regression suite.

## Hygiene to fix first

`~/.claude/skills` is symlinked to this repo's `skills/`, so Claude Desktop's skill sync writes
`skills/synced/` and `skills/.trash/` into the repo. They show as modified, deleted and untracked
noise and risk being committed. There is no `.gitignore`. Add one, and confirm nothing in
`skills/synced/` is wanted before ignoring it.

## Phased plan

Each phase ships alone and must be verified before the next.

### Phase 0: hygiene (day 1)
- `.gitignore` for `skills/synced/` and `skills/.trash/`.
- Commit `docs/delegation-strategy.md` on a branch.

### Phase 1: make "done" mean something (week 1)
- Write `verify-on-stop.mjs` and `format-on-edit.mjs` in the style of `log-correction-signal.mjs`.
- Write the `verify-contract` skill; run it on your main repo first to get real scoped commands.
- Add both hooks to `settings.reference.json`; add the evidence rule to `claude/CLAUDE.md` and
  `codex/INSTRUCTIONS.md`.
- Extend `validate.sh`: hooks named in the settings reference exist; CLAUDE.md stays under 200 lines.
- Verify: break a type on purpose; the stop must block until it is fixed.

### Phase 2: safe unattended permissions (weeks 1 to 2)
- Rewrite the `permissions` block in `settings.reference.json`: scoped allowlist (read-only git,
  scoped test and typecheck), deny rules for secrets, force push and publish. Keep existing ask-rules.
- Add an `autoMode` block (it must live in `~/.claude/settings.json`; the classifier ignores it in
  project settings). Keep `"$defaults"` in every list.
- Turn on `/sandbox`. Run `/fewer-permission-prompts` on real transcripts to seed the allowlist.
- Check any managed organization settings: your reference file notes they pin the model, and managed
  settings can override local permissions and hooks. Confirm with `/status` what is actually active.
- Diff the reference against the live file; the installer already prints that command.

### Phase 3: parallel, isolated delivery (weeks 2 to 3)
- Add `agents/reviewer.md` and `agents/convention-checker.md` with `tools: Read, Grep, Glob` and a
  `model:` (a smaller model for the convention check).
- Add `skills/deliver`, `scripts/delegate.sh`, `setup/project-init.sh`, `.worktreeinclude` template.
- Extend `grill-me` to write `SPEC.md`.
- Run 3 to 5 tickets in parallel worktrees; watch with `claude agents`.
- Extend `validate.sh`: every agent declares `tools:`; skills with side effects set
  `disable-model-invocation: true`.

### Phase 4: proactive work (weeks 3 to 4)
- `skills/ci-babysit` as a `/loop` body; `scripts/fanout.sh` using
  `claude --bare -p --permission-mode dontAsk --max-turns N`, trial on 3 files, track
  `total_cost_usd`.
- Loops for repetitive known-step work, dynamic workflows for open-ended work (Boris, Ramp office
  hours). Routines only for well-defined streams: bug triage, dependency bumps, stale branches.
- Branch protection the agent cannot bypass before any cloud routine touches a repo.
- For large mechanical changes, Anthropic's migration loop: build the judge first, write a
  rulebook, stress-test it on a trial, small models implement and large models review, derive the
  work queue from the filesystem, fix the rulebook (not the files) when a reviewer repeats a complaint.

### Phase 5: close the loop (ongoing)
- Teach `memory-distill` the routing rule and the second signal source.
- Create `evals/` from real failures; run it when a skill, hook or rule changes.
- `/usage` weekly to see which skills and subagents earn their tokens; `model: haiku` for
  mechanical subagents, the strongest model for reviewers.
- Review traces, not only results (Boris, Ramp office hours).
- Automate where 80% quality is enough; keep architecture, API contracts, security refactors and
  production deploys human-gated.

## Unattended-run checklist (docs, five questions)

1. Does it know what done looks like (goal condition, spec, failing test)?
2. Can it check its own work (suite, Stop hook, reviewer)?
3. What can it touch (deny rules, sandbox, worktree, one branch)?
4. What stops it (`--max-turns`, `--max-budget-usd`, spend limit)?
5. Where does the result go and who signs off (PR, then me)?

## What to skip

- ALL CAPS emphasis, "think harder", "don't be lazy": current models over-apply or ignore them.
- Describing architecture in CLAUDE.md; Claude reads the repo.
- Subagents to "protect context"; the window is large and compacts itself.

## Open items

- Scoped check commands differ per package in a monorepo; `verify.json` needs real commands from a
  working checkout.
- Boris's best-practices post is marked "no longer maintained" and defers to the docs; where they
  differ, the docs win (for example, sessions now start in auto mode).
- Unverified: whether managed organization settings restrict hooks or permissions on this machine.

## Sources

- [Claude Code: Best practices for agentic coding (Boris Cherny)](https://www.anthropic.com/research/claude-code-best-practices)
- [Boris Cherny office hours with Ramp](https://claude.com/customers/ramp-boris-office-hours)
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- [Common workflows](https://code.claude.com/docs/en/common-workflows)
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Building effective agents](https://www.anthropic.com/research/building-effective-agents)
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Claude Code sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [AI code migration](https://claude.com/blog/ai-code-migration)

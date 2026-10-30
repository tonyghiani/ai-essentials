# Daily workflow guide

How to use the delegation setup, from the first day to the odd corners. Organised by what you are
trying to do. For why it is built this way see [delegation-strategy.md](delegation-strategy.md); for
what was built see [implementation-plan.md](implementation-plan.md).

## 1. The idea in one page

You hand an agent a ticket. It works on its own branch, proves the work with the repo's own checks,
has a fresh reader review it, and leaves a **draft** PR in your name. You decide what leaves draft.

Four things make that safe to leave alone:

| Guarantee | How it is enforced |
|---|---|
| It knows when it is done | A Stop hook runs the repo's **verification contract** on every turn and blocks "done" while a check fails |
| It cannot take credit | Hooks block tool trailers, footers, identity overrides, tool-named branches; a commit-msg hook rejects them at commit time; a branch audit checks before any push |
| It cannot overreach | Drafts only. No ready-for-review, no merge, no force push, no push to a default branch, no recursive delete outside the repo |
| It asks only when it should | A list of always-ask classes (API contracts, migrations, security, scope, irreversible, outward-facing, dirty tree, new dependency you did not name). Everything else it decides and tells you |

Where things live:

| What | Where |
|---|---|
| Skills, rules, hooks, scripts (source of truth) | this repo (wherever you cloned it; `~/.ai-essentials/repo` always points at it) |
| Stable path skills use | `~/.ai-essentials/repo` (a link to this repo) |
| Per-repo contracts | `contracts/<host>__<owner>__<repo>.json` in this repo, gitignored |
| Your decision precedents | `policy/decisions.local.md`, gitignored |
| Specs, diffs, questions, logs | `~/.ai-essentials/state/` (never inside a repo you work on) |
| Delegated worktrees | beside the repo they belong to: `~/code/app` gets `~/code/app.worktrees/<slug>` (override with `AI_WORKTREES_DIR`) |
| Commands for your terminal | `ai-delegate`, `ai-fanout` in `~/.local/bin` (links the installer makes) |
| Config backups | `~/.ai-essentials/backups/` |

Nothing from this setup is ever written into the repo you are working on, except the change itself. This repo is where the setup is
kept; your day-to-day work never needs a path into it, because everything you run is a command on your PATH or a skill in your tool.

### The commands

Skills and agents never refer to this repository. They call these commands by name, which the installer puts in `~/.local/bin`:

| Command | What it does |
|---|---|
| `ai-work` | Creates the agent's branch, finds the spec directory, writes the diff, prints logs (`ai-work logs corrections\|failures\|errors`) |
| `ai-verify` | Runs, locates (`--where`) or trusts (`--trust`) a repo's verification contract |
| `ai-decisions` | Lists, matches and records your decision precedents; `classes` prints the always-ask classes |
| `ai-pr-body` | Builds the PR body, with the "Decisions made without you" section |
| `ai-audit` | Audits a branch's commits and a PR body for tool credit and identity |
| `ai-delegate`, `ai-fanout` | Parallel and batch runs (section 5) |

If a skill reports a command missing, the setup is not installed: run the installer.

## 2. One-time setup

Already done on this machine. To redo or check:

```bash
cd ~/.ai-essentials/repo
./setup/install.sh --all --config-write --doctor
```

`--doctor` should end with `0 failed`. The warnings are things only you can do:

1. **Codex:** open it once, run `/hooks`, review and trust the four ai-essentials hooks. Until you do,
   interactive Codex has no guard hooks (delegated runs still get the commit-msg hook).
2. **Cursor:** Settings, turn off Commit Attribution and PR Attribution. The hooks are untested in the app.
3. **Cursor CLI** (only for `ai-delegate --tool cursor`): install the `agent` CLI from cursor.com/docs/cli.

After pulling changes to this repo, re-run the install line above.

## 3. Per repo: teach it the checks (once)

Do this the first time you delegate in a repo, for example a large monorepo.

In any tool, from inside that repo, invoke the `verify-contract` skill (Claude: `/verify-contract`).
It reads the repo's scripts and docs, proposes **scoped** commands, shows them to you, and writes the
contract only after you approve. Those commands run automatically at the end of every agent turn, so
read them.

A contract looks like this:

```json
{
  "checks": [
    { "name": "typecheck", "cmd": ["<scoped typecheck>", "{dirs}"], "when": ["**/*.ts", "**/*.tsx"], "timeoutSec": 300 },
    { "name": "lint", "cmd": ["<linter>", "{files}"], "when": ["**/*.ts", "**/*.tsx"] },
    { "name": "test", "cmd": ["<runner>", "<related-tests flag>", "{files}"], "when": ["**/*.ts", "**/*.tsx"], "timeoutSec": 600 }
  ],
  "format": { "cmd": ["<formatter>", "{file}"], "when": ["**/*.{ts,tsx,json}"] },
  "worktree": {
    "copy": [".env"],
    "setup": [{ "cmd": ["<install or bootstrap>"], "timeoutSec": 1200 }]
  },
  "app": { "run": "<how to start the app>" }
}
```

Rules worth knowing:

- Commands are argument arrays, never shell strings. `{files}`, `{dirs}`, `{file}`, `{root}` are whole elements.
- Checks run only for changed files that match `when`, so the gate stays fast.
- `worktree.copy` lists untracked files a fresh worktree needs (for example `.env`).
- `worktree.setup` lists commands that bootstrap a fresh worktree (an install, a bootstrap script) before the agent starts. A parallel run's
  worktree has no `node_modules`; without a setup step its checks cannot run. A failing setup stops the run before any tool starts.
- Keep it to checks that finish in seconds to a couple of minutes. A flaky check teaches the agent to retry.

Useful commands:

```bash
ai-verify --where    # which contract applies, and where to create one
ai-verify            # run the gate by hand, exactly as the Stop hook does
ai-verify --trust    # trust a repo-owned .ai/verify.json after reading it
```

A repo that ships its own `.ai/verify.json` is ignored until you trust it, and stops being trusted
the moment its content changes. A cloned repo must not be able to make your Stop hook run its commands.

Without a contract the gate does nothing, and the agent is told to ask once and offer to write one.

## 4. The main loop: a task to a draft PR

### Start it

Open your tool inside the repo (on the branch you want to base the work on) and ask for the tech lead.

| Tool | How |
|---|---|
| Claude Code | `/tech-lead` then the ticket text or link |
| Codex | type `$tech-lead` or say "use the tech-lead skill" |
| Cursor | `@~/.cursor/skills/ai-essentials/tech-lead/SKILL.md` then the ticket |

You do not need a ticket. Give it whatever you have:

| You give it | It does |
|---|---|
| Just a description: `/tech-lead When a rule has no actions, the executor should skip the notification step instead of logging an error` | Treats the description as the source. It reads the code it points at, drafts the spec itself, and asks only about real gaps. It will not ask you for an issue number |
| A link or id: `/tech-lead see issue 1234` | Opens it if it can reach it and uses it as the starting point |
| Both | Your description wins where they differ, and it tells you what differed |

Without a ticket, the PR body says what the change does and why, and links nothing it was not given. It never invents an issue reference.

### What happens, in order

1. **Branch.** It creates `<your-login>/<slug>` from your current HEAD and records it as its own.
   If your working tree has uncommitted changes it **stops and asks** (exit code 3): it will not
   guess that your work-in-progress belongs to the task.
2. **Intake.** Reads the task, the always-ask classes, your decision precedents, and the repo's
   contract. No contract: it runs `verify-contract` first. Unfamiliar area: it runs `deep-research`.
3. **Spec, with you.** `grill-me` asks numbered questions, each with a recommended answer, and writes
   `SPEC.md` (goal, requirements, edge cases, out of scope, tasks with checkable criteria). Answer
   in one word: `1. yes  2. keep it  3. b`. A question a rule or an earlier decision already answers is
   not asked; it is recorded as a decision.
4. **Plan gate.** One message: the breakdown, who does what, the decisions it already made, what is
   left to ask. You approve or edit. (Once you have approved five breakdowns in a row without edits
   for a decision class, that class stops waiting: see section 6.)
5. **Run.** It implements. Tests follow one rule: add one only for behaviour that can break and is worth protecting, test-first when it does (details below). The Stop hook runs the contract every
   turn; a failing check sends the agent back, and the same failure three times in a row makes it stop
   and report instead of looping.
6. **Fresh review.** A read-only `reviewer` agent checks the diff against the spec (requirements,
   edge-case tests, correctness gaps; not style). A read-only `convention-checker` agent checks your
   style rules. Specialists run when the diff calls for them: `dep-size`, `a11y-audit`, `i18n-sweep`,
   `react-perf`, `api-contract-review`. At most two review rounds.
7. **Hand-off.** It writes the description (`pr-description-template`). A script then builds the PR body: your description plus a
   **"Decisions made without you"** section from what the run recorded, or an explicit "None". The guard refuses to open a PR from the
   agent's branch without that section, so it cannot be skipped. It then audits commits and body for tool credit, pushes the branch,
   opens a **draft** PR, and reports: what changed, the commands it ran and
   their output, decisions it made without you, follow-ups it noticed but did not do or file.

### Which tests it writes, and which it will not

CI runs cost money, so tests have to earn their place (`rules/test-value.mdc`, always on in all three tools).

It writes a test for: an observable outcome through the public interface, a boundary or edge case that can really break, a bug that
happened (one regression test that fails without the fix), and a contract callers rely on.

It does not write: assertions against a copy (`expect(TIMEOUT_MS).toBe(5000)`), tests that mirror the implementation (the same formula for
the expected value, a mock asserted with exactly what the code passes), type or shape checks, tests of getters, wiring or a library's
documented behaviour, large snapshots, a second test through the same path with other data, or anything that still passes with the
implementation deleted. It prefers the cheapest level that can fail for the right reason, extends an existing test before adding a file,
and adds no integration or end-to-end test for what a unit test already proves.

A config or constant change, a rename, wiring or docs gets **no** test, and the report says so in one line. The `reviewer` agent flags
any added test that breaks these rules, so a padded suite comes back as a finding, not a surprise in CI.

### What you do at the end

- Read the report. The "Decisions made without you" section in the PR body is the audit trail.
- Open the draft. Review it like any other PR. Mark it ready yourself when you are happy.
- If it overstepped, say so in plain words (`no, don't do that`). That is logged and feeds section 10.

### Your side of the conversation

- Short answers are complete (`out of scope`, `keep it`, `b`). Numbers map to questions by index.
- Say `skip` to drop a question. Say `go` to end the interview.
- You can interrupt anytime. Nothing is pushed until the last step.

## 5. Working in parallel: several tasks at once

For independent tasks, each gets its own worktree and branch, run headless with a command on your PATH. You never type a path into
this repo:

```bash
cd ~/code/app                     # any repo, on the branch to base work on
ai-delegate --tool claude "Fix issue 1234: retry loop in the executor"
ai-delegate --tool codex  "When a rule has no actions, skip the notification step instead of logging an error"
```

The task can be a ticket, a link, or just a description. Add `--slug name` for a readable branch, `--base REF` to branch from something
other than HEAD, and `@task.md` instead of text to read it from a file.

| Option | Default | What it does |
|---|---|---|
| `--tool claude\|codex\|cursor` | required | Which CLI runs the work |
| `--max-turns N` | 40 | Claude only |
| `--budget-usd X` | 10 | Claude only |
| `--timeout-min M` | 45 | Wall-clock cap for every tool; the only cap for Codex and Cursor |

**Where the worktree goes.** Beside the repo, where you would put your own: `~/code/app` gets
`~/code/app.worktrees/<slug>`. Set `AI_WORKTREES_DIR` to use another folder. Nothing is created inside ai-essentials, and
nothing is added to the repo itself (git keeps its own worktree bookkeeping in `.git`, as it does for any worktree).

**What a fresh worktree lacks.** It is a clean checkout: no `node_modules`, no `.env`. Teach it once, in the repo's contract:

```json
"worktree": {
  "copy": [".env"],
  "setup": [{ "cmd": ["yarn", "kbn", "bootstrap"], "timeoutSec": 1800 }]
}
```

`copy` copies untracked files from your main checkout; `setup` runs commands in the new worktree before the agent starts. If setup
fails the run stops before any tool starts, and the worktree is kept so you can look.

Each run then installs a commit-msg hook scoped to that run, starts the tool, then audits and verifies, and **prints a JSON summary**:
branch, worktree path, spec directory, commits made, audit result, verification result, and whether the agent left questions.

Read the summary first:

| You see | Meaning | Do |
|---|---|---|
| `"questions": true` | It hit an always-ask decision and stopped | Read `<specDir>/questions.md`, answer, rerun with the answer in the task |
| `"audit": { "ok": false }` | A commit or body credited a tool or used another identity | Look at `audit.output`; do not push |
| `"verify": { "ok": false }` | The contract fails on the final state | `cd` into the worktree and look |
| `"commits": 0` and no questions | It did not finish | Read `<specDir>/run.json` (Claude) or `run.txt` (Codex, Cursor) and `run.err` |

**Headless runs can open a draft PR on their own.** The prompt tells the agent to run `open-draft-pr` when the contract passes and the
audit is clean. If you want the run to stop before pushing, say so in the task: "Do not push and do not open a PR."

Clean up when you are done with a worktree:

```bash
ai-delegate --remove --repo ~/code/app --slug <slug>
```

A worktree is a real checkout: `cd` into it, run the app, edit by hand, push it yourself.

## 6. Letting it decide more over time

The tech lead settles what rules and your past answers already settle, and asks the rest. You shape
that with the **decision policy**.

```bash
cp ~/.ai-essentials/repo/policy/decisions.example.md ~/.ai-essentials/repo/policy/decisions.local.md
D=ai-decisions
$D list                                   # every precedent
$D match --class layout                   # precedents that would apply automatically
$D gate layout api-contract               # plan-gate state per class
$D add --class layout --situation "A new module needs a test file" \
       --decision "Colocate <name>.test.ts beside the source" --why "matches testing-style"
$D record --class layout --outcome approved --precedent D-001
```

How it works:

- A precedent applies automatically only with **2 or more confirmations**, no later contradiction, and a
  class outside the always-ask classes.
- Each approved, unedited plan breakdown counts toward the gate for its class. After **5 in a row** that
  class stops waiting for approval and is reported instead. One edit or overrule switches it back on and
  marks the precedent behind it contradicted.
- Always-ask classes never turn their gate off, whatever the count.
- The tech lead records outcomes itself; you rarely call `record` by hand.
- If it asked about something you consider obvious, add the precedent. If it decided something you
  disliked, overrule it once and it stops applying.

To change what is always asked, edit `always-ask.md` inside the `tech-lead` skill (`ai-decisions classes` lists the current ones). Today: `api-contract`, `data-migration`,
`security`, `scope-expansion`, `outward-facing`, `irreversible`, `dirty-tree`, `new-dependency`. A
package your ticket names is already your decision; one the agent chose is asked about.

## 7. Everything else you can ask for

Every skill works in any of the three tools. Say the name or what you want.

| You want | Skill or agent | Notes |
|---|---|---|
| Think a plan through before any code | `grill-me` | Numbered questions with recommendations; add "write a spec" to get `SPEC.md` |
| Understand an unfamiliar area first | `deep-research` | Reads docs and code, validates one against the other, asks when unclear |
| Test-first on one change | `tdd` | Failing test, read the failure, minimal implementation, refactor |
| Execute one already-specified task | `deliver` | Implement, verify, fresh review, clean commit; no spec stage |
| Push the branch and open a draft | `open-draft-pr` | Audits first. Only for a branch the agent created |
| Watch a draft PR's CI | `ci-babysit` | One bounded round; see below |
| Resolve merge conflicts | `resolve-merge-conflicts` | Merges the base in (never rebases), resolves by intent, verifies, pushes normally |
| Review someone's PR | `review-pr <url>` | Copy-pasteable conventional comments in your voice; you post them |
| Decide whether to accept review feedback | `review-pr-comments` | Triage comment links, drafted replies |
| A heavy multi-angle review of a branch | `review-team` | Six personas in parallel; costs several single reviews, so keep it for large or risky diffs |
| A cleanup plan for a branch | `branch-refactor-planner` | Prioritised list; does not edit |
| Write a PR description only | `pr-description-template` | Text only, never opens the PR |
| Draft a GitHub issue | `gh-issue-writer` | Text only; never files it |
| Is this dependency worth it | `dep-size` | Cost and a lighter alternative |
| Accessibility check | `a11y-audit` | Keyboard and screen-reader blockers in changed UI |
| Untranslated strings | `i18n-sweep` | Changed files only |
| Render performance | `react-perf` | Refuses to recommend memoisation without a cause |
| Is this change breaking | `api-contract-review` | Routes, plugin contracts, schemas, exported APIs |
| Effects, refs, derived state | `react-patterns` | Before writing or reviewing any `useEffect` |
| Your TS and React style, in depth | `marco-code-style` | Project conventions still win |
| Teach it from corrections | `memory-distill` | See section 10 |
| ES\|QL help | the `esql-expert` agent | Read-only |
| Blog posts in your voice | the `marco-blogger` agent | Unrelated to delivery |

Direct requests to a read-only helper also work: "have the reviewer check `<diff>` against `<spec>`".

## 8. Daily recipes

### Morning: start the day

```bash
cd ~/.ai-essentials/repo && ./setup/install.sh --doctor | tail -3     # 10 seconds; green or fix
gh pr list --author @me --draft                                                  # what the agents left you
```

Open each draft, read the report in the PR body, review the diff like a teammate's.

### A small fix, you want to stay in the loop

1. `/tech-lead <fix>` in your tool, in the repo. A sentence is enough; no ticket needed.
2. Answer two or three questions. Approve the breakdown.
3. Review the draft PR.

### A bigger ticket, you want to be consulted

Same, but tell it up front: "interview me first, no code until we agree" and let `grill-me` run long.
It will not stop early unless you say `go`.

### Three independent tickets before lunch

Run `ai-delegate` three times (section 5), each with an explicit "do not open a PR" if you want to read
the result first. Check each JSON summary when they finish. Work on something else meanwhile.

### A mechanical change across many files

```bash
printf '%s\n' $(git ls-files 'src/**/*.ts' | head -200) > /tmp/files.txt
ai-fanout --tool claude --branch migrate-logger --list /tmp/files.txt \
  --prompt "Migrate {file} to the new logger API and commit. Reply OK or FAIL."
```

`--branch` creates the agent's branch from your current HEAD first (it stops if your tree is dirty).

It runs the **first 3 files only** and prints `OK`/`FAIL` per file. Read what went wrong, fix the
prompt, repeat, and only then add `--all`. Per-run caps: `--max-turns 20`, `--budget-usd 2`,
`--timeout-min 15` by default. For a large migration, build the judge first (a check that fails when
the migration is wrong) and put it in the contract.

### Your draft PR went red

In Claude Code, from the PR's branch: `/loop 15m run the ci-babysit skill on this PR`. Each round reads
CI, fixes red checks on the agent's branch and pushes normally, merges the base in on conflicts, and
**drafts replies to review comments for you without posting them**. It stops itself after repeated
failures and tells you when to stop the loop. It runs with your own `gh` login, never from a cloud routine.

### Someone's PR needs a review

`/review-pr https://github.com/org/repo/pull/123`. You get comments with line references and
suggestions in your voice. Post the ones you agree with. For comments on your own PR,
`/review-pr-comments <comment links>` triages accept or push back.

### Conflicts with the base branch

`/resolve-merge-conflicts`. It explains each conflict by intent, verifies with the contract, commits the
merge, and pushes normally. It will not force-push.

### Before you go

`gh pr list --author @me --draft`, then `git worktree list` for forgotten worktrees and the
`ai-delegate --remove` command to clear them.

## 9. What gets blocked, and what to do

Blocks come from the guard hook, which prints a reason. The agent reads it and fixes the command. You
see one only when the agent cannot.

| Blocked | Why | Do instead |
|---|---|---|
| A commit message, PR body, issue or comment with a tool trailer, footer or robot emoji | No tool credit on your work | Remove the line |
| `--author`, `GIT_AUTHOR_*`, `git config user.*`, `GH_TOKEN`, `gh auth ...` | Your identity only | Nothing; commits use your configured identity |
| A branch named `claude/...`, `codex/...`, `cursor/...` | Branch names carry no tool name | Use `<login>/<slug>` |
| `gh pr create` without `--draft` | Drafts only | Add `--draft` |
| `gh pr create` from the agent's branch without a "Decisions made without you" section | You audit what it decided | Build the body with `ai-pr-body`; `open-draft-pr` does |
| `gh pr ready`, `gh pr merge` | Your decision | You do it |
| `git push --force`, `-f`, or a push to main or master | Never | Push the branch normally |
| `rm -r` of anything outside the repo, the repo root, or a path it cannot resolve | Blast radius | Use a literal path inside the repo |
| `curl ... \| sh` | Unreviewed code | Download, read, then run |
| Reading `.env`, keys, `.ssh`, `.aws/credentials` | Secrets | Ask the agent to describe where a value lives |

Things that need your answer rather than a block: `git reset --hard`, `git clean -fd`, `git branch -D`,
`sudo`, `chmod 777`, `npm publish`, `yarn publish`, `gh release create` prompt in interactive sessions
and are denied in unattended runs. Do those yourself.

If a guard blocks something legitimate, run it yourself in a terminal. The hook only watches the agent.

One false positive to expect: a shell command that contains tool-credit text next to `git commit` (for
example writing a test fixture through a heredoc) is blocked. Have the agent write such files with its
edit tool instead.

## 10. It gets better when you correct it

Every time you correct the agent (`no, ...`, `don't ...`, `I prefer ...`, `from now on ...`), a hook
logs the prompt, at zero token cost, to `~/.ai-essentials/state/corrections.jsonl`. Failed checks go to
`verify-failures.jsonl`.

Every few weeks, or after a stretch where preferences came up, run `/memory-distill`. It groups
repeated themes and proposes where each belongs, for your approval:

| The theme | Goes to |
|---|---|
| A preference with exceptions | A memory, or one line in `claude/CLAUDE.md` |
| A rule with no exceptions | A hook or deny rule |
| A procedure you repeat | A skill |
| A failure that keeps coming back | An eval task |
| A decision you keep making the same way | A precedent in the decision policy |

It never writes without asking.

## 11. Cost and limits

- Claude delegated runs are capped at 40 turns and 10 USD by default; Codex and Cursor only by the
  wall-clock timeout (45 minutes). Lower them for cheap experiments: `--max-turns 15 --budget-usd 2 --timeout-min 15`.
- Subagents multiply tokens. The tech lead uses them for a fresh reviewer or noisy output, not as a
  default, and runs several agents only on independent tickets.
- `review-team` is the expensive one. Use it on large or risky diffs.
- In Claude Code, `/usage` shows which skills and subagents earn their tokens.
- Real evals cost money: `node scripts/evals/run.mjs --self-test` is free; real runs are capped per trial.

## 12. When something is wrong

| Symptom | Check |
|---|---|
| Anything feels off | `./setup/install.sh --doctor` from this repo |
| The Stop gate never fires | `ai-verify --where` (is there a contract?), then `ai-work logs errors` |
| A hook crashed silently | `hook-errors.jsonl` in the state directory; hooks fail open and record the error |
| The agent loops on a failing check | It stops after three identical failures; read `verify-failures.jsonl` for the output |
| `ai-delegate` printed no summary | Read `run.err` in the spec directory; wrong tool name or missing CLI |
| Codex ignores the guard | You have not trusted its hooks: run `/hooks` in Codex |
| A skill cannot find a script | `ls ~/.ai-essentials/repo` should show this repo; re-run the installer |
| Settings reset after an update | Run `./setup/install.sh --config-write`; it merges, never replaces |
| You want to see what the installer would change | `./setup/install.sh --config` (dry run, prints a diff) |

Log files, all in `~/.ai-essentials/state/`:

| File | Holds |
|---|---|
| `verify-failures.jsonl` | Each failed contract check, with an excerpt |
| `hook-errors.jsonl` | Hook crashes (hooks never block on their own errors) |
| `corrections.jsonl` | Your corrections, for `memory-distill` |
| `branches.json` | Branches the agent created, per repo |
| `specs/<repo>/<branch>/` | `SPEC.md`, `decisions-made.md`, `questions.md`, `diff.patch`, `pr-body.md`, run logs |
| `evals/` | Results of real eval runs |

## 13. Differences between the tools

| | Claude Code | Codex | Cursor |
|---|---|---|---|
| Start a skill | `/skill-name` | `$skill-name` or name it | `@` the skill file |
| Hooks active | Yes | Only after `/hooks` trust | Configured; untested in the app |
| Delegated run caps | turns, budget, timeout | timeout | timeout |
| Unattended approvals | auto mode | `--approve-for-me` (a managed org policy may forbid `never`) | `--force` with the sandbox on |
| Read-only agents | `tools:` restriction | read-only sandbox | `readonly: true` |
| Attribution switches | `attribution` blank | none needed (guard and audit cover it) | config keys plus app toggles |

Eval record (one trial per task, 30 tasks): Claude 28 of 29 on the first pass over the original set, Codex 27
of 29, with the failures passing on rerun or traced to a fixed cause. Treat both as strong, not perfect: skim
what a run did before you merge anything.

## 14. Rules of thumb

1. Start every new repo with `verify-contract`. Everything else leans on it.
2. Delegate work with a checkable outcome. "Fix issue 1234 and keep the suite green" works; "improve the
   code" does not.
3. Keep tickets independent before you run them in parallel. Two tickets that touch the same files belong in one.
4. Read the evidence in the report, not the summary line. The commands and their output are the proof.
5. Review every draft PR yourself before marking it ready. The system makes the review smaller, not unnecessary.
6. When an agent asks a question you thought it should know, teach it: add a precedent.
7. When it does something you dislike, say so in plain words once. The correction is logged and distilled.
8. If a guard blocks something, the guard is usually right. If it is wrong, change `policy/` and run
   `VALIDATE_TESTS=1 ./scripts/validate.sh`, never work around it.

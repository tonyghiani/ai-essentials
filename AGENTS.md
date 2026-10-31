# ai-essentials

Agent configuration for this repository. Install globally via symlinks (see
[README.md](README.md)) or reference these paths when working inside this repo.

## Always apply

- [rules/no-ai-prose.mdc](rules/no-ai-prose.mdc)
- [rules/numbered-replies.mdc](rules/numbered-replies.mdc)
- [rules/no-ai-attribution.mdc](rules/no-ai-attribution.mdc): remote actions carry the user's name only
- [rules/verification-evidence.mdc](rules/verification-evidence.mdc): report commands and output, not assertions
- [rules/test-value.mdc](rules/test-value.mdc): tests only for behaviour worth protecting; CI runs cost money

For Claude Code these two, plus verification discipline and a compact TS/React
invariants block, are assembled in [claude/CLAUDE.md](claude/CLAUDE.md).

## Code style (file-scoped)

Each rule activates on its own globs. Read the one matching the file you are editing.

| Editing | Rule |
|---|---|
| any `.ts` / `.tsx` | [rules/typescript-style.mdc](rules/typescript-style.mdc) |
| adding files, folders, or imports | [rules/project-structure.mdc](rules/project-structure.mdc) |
| components and hooks | [rules/react-components.mdc](rules/react-components.mdc) |
| server, services, routes | [rules/node-api-patterns.mdc](rules/node-api-patterns.mdc) |
| `*.test.ts(x)` / `*.spec.ts(x)` | [rules/testing-style.mdc](rules/testing-style.mdc) |

These encode Marco's conventions, confirmed by a 69-question style interview against 40 merged PRs
and five personal repositories. Project conventions win where they conflict; read the neighbouring
files first.

Mechanical rules (formatting, import order, enums, `any`, naming casing) are config, not guidance.
They live in [eslint-recommendations.md](eslint-recommendations.md) and stay out of the rule files
on purpose.

## React (frontend files only)

Effect, dependency, and ref discipline is separate from component structure:

- [rules/react-avoid-effects.mdc](rules/react-avoid-effects.mdc)
- [rules/react-effects-dependencies.mdc](rules/react-effects-dependencies.mdc)
- [rules/react-refs-dom.mdc](rules/react-refs-dom.mdc)

These rules target `*.{tsx,jsx}` and paths under `components/`, `hooks/`, `pages/`, and `app/`. Skip them for backend-only or config-only changes.

Claude Code loads the same material on demand via the `react-patterns` skill.

## Skills (on demand)

Paths inside a skill resolve relative to that skill's own directory.

| Task | Skill |
|------|-------|
| Marco's TS/React conventions | [skills/marco-code-style/SKILL.md](skills/marco-code-style/SKILL.md) — project-agnostic; 748 authored commits, confirmed by a 69-question style interview. Depth behind the `rules/` code-style files |
| Effect / ref / dependency discipline | [skills/react-patterns/SKILL.md](skills/react-patterns/SKILL.md) |
| Test-first loop | [skills/tdd/SKILL.md](skills/tdd/SKILL.md) |
| Multi-perspective code review | [skills/review-team/SKILL.md](skills/review-team/SKILL.md) |
| GitHub PR review | [skills/review-pr/SKILL.md](skills/review-pr/SKILL.md) |
| Triage PR review comments | [skills/review-pr-comments/SKILL.md](skills/review-pr-comments/SKILL.md) |
| Branch refactor plan | [skills/branch-refactor-planner/SKILL.md](skills/branch-refactor-planner/SKILL.md) |
| Architecture deep dive | [skills/deep-research/SKILL.md](skills/deep-research/SKILL.md) |
| Plan stress-test | [skills/grill-me/SKILL.md](skills/grill-me/SKILL.md) |
| Brainstorm options for a feature, architecture or topic | [skills/brainstorm/SKILL.md](skills/brainstorm/SKILL.md): sessions and ADRs in `~/brainstorms` |
| Cited research on the web | [skills/web-research/SKILL.md](skills/web-research/SKILL.md) |
| PR description | [skills/pr-description-template/SKILL.md](skills/pr-description-template/SKILL.md) |
| GitHub issue draft | [skills/gh-issue-writer/SKILL.md](skills/gh-issue-writer/SKILL.md) |
| API / contract review | [skills/api-contract-review/SKILL.md](skills/api-contract-review/SKILL.md) |
| React render perf | [skills/react-perf/SKILL.md](skills/react-perf/SKILL.md) |
| Accessibility audit | [skills/a11y-audit/SKILL.md](skills/a11y-audit/SKILL.md) |
| Dependency / bundle cost | [skills/dep-size/SKILL.md](skills/dep-size/SKILL.md) |
| i18n sweep | [skills/i18n-sweep/SKILL.md](skills/i18n-sweep/SKILL.md) |
| Distil memory from correction log | [skills/memory-distill/SKILL.md](skills/memory-distill/SKILL.md) |
| Resolve merge conflicts | [skills/resolve-merge-conflicts/SKILL.md](skills/resolve-merge-conflicts/SKILL.md) |
| Take a ticket from spec to draft PR | [skills/tech-lead/SKILL.md](skills/tech-lead/SKILL.md) |
| Execute one specified task end to end | [skills/deliver/SKILL.md](skills/deliver/SKILL.md) |
| Push the agent's branch and open a draft PR | [skills/open-draft-pr/SKILL.md](skills/open-draft-pr/SKILL.md) |
| Write a repo's verification contract | [skills/verify-contract/SKILL.md](skills/verify-contract/SKILL.md) |
| Watch a draft PR's CI (for `/loop`) | [skills/ci-babysit/SKILL.md](skills/ci-babysit/SKILL.md) |
| Prove a change in the running app, reusing an instance already up | [skills/verify-app/SKILL.md](skills/verify-app/SKILL.md) |
| Two attempts at a risky task, judged pairwise | [skills/best-of-two/SKILL.md](skills/best-of-two/SKILL.md) |
| Quiz the user on an agent PR before it leaves draft | [skills/explain-pr/SKILL.md](skills/explain-pr/SKILL.md) |
| Read-only end-of-day triage report (scheduled `ai-triage`) | [skills/daily-triage/SKILL.md](skills/daily-triage/SKILL.md) |

## Agents (delegated workers)

- [agents/reviewer.md](agents/reviewer.md): fresh-context, read-only review against the spec
- [agents/convention-checker.md](agents/convention-checker.md): read-only pass or fail against the style rules
- [agents/skeptic.md](agents/skeptic.md): read-only; tries to disprove each serious review finding against the code
- [agents/judge.md](agents/judge.md): read-only; compares two patches pairwise, checking for position bias
- [agents/auditor.md](agents/auditor.md): read-only; runs the forked audit skills (a11y, API contract, render perf) on the standard tier
- [agents/Explore.md](agents/Explore.md): replaces Claude Code's built-in Explore so code searches run on the fast tier instead of the session model
- [agents/esql-expert.md](agents/esql-expert.md) — ES|QL queries (domain-specific, read-only tools)
- [agents/marco-blogger.md](agents/marco-blogger.md) — personal blog voice (replace for your own setup)

## Definitions never refer to this repo

Skills, rules, agents and the global instructions must work wherever they are installed, so they never name this
repository or point into it. They call commands by name (`ai-work`, `ai-verify`, `ai-decisions`, `ai-pr-body`,
`ai-audit`), refer to other skills and rules by name, and keep anything they need beside themselves (the tech-lead
skill carries its own `always-ask.md`). `scripts/guard/scan_repo.mjs`, run by `validate.sh`, fails when a definition
names the repo or a path in it, or names a project listed in `policy/project-tokens.local.json`.

## Delegation system

Daily use, start to finish: [docs/guide.md](docs/guide.md).

Hand an agent a ticket and get back a verified draft PR. Design and rationale:
[docs/delegation-strategy.md](docs/delegation-strategy.md) (sourced principles) and
[docs/implementation-plan.md](docs/implementation-plan.md) (what was built and why).

| Piece | Where |
|---|---|
| Verification gate: runs a repo's contract on every Stop | `scripts/verify/`, `*/hooks/verify-on-stop.mjs` |
| No-credit and draft-only guard | `scripts/guard/`, `*/hooks/guard-git.mjs`, `policy/attribution-patterns.json` |
| Permissions from one source | `policy/guardrails.json`, `scripts/guardrails/render.mjs` |
| Branch, spec and decision bookkeeping | `scripts/work/` (commands `ai-work`, `ai-decisions`, `ai-pr-body`), `skills/tech-lead/always-ask.md`, `policy/decisions.example.md` |
| Headless runs in worktrees beside the repo | `ai-delegate`, `ai-fanout` (installed on the PATH from `scripts/delegate.sh`, `scripts/fanout.sh`) |
| Task ledger and lessons | `ai-work task` (passes flip only with evidence; enforced in unattended runs), `ai-work lesson` (accepted review comments, routed by `memory-distill`) |
| Done-when evaluator and sandbox for headless Claude runs | `scripts/work/sandbox_settings.mjs` (a per-run `--settings` file) |
| App verification | `ai-verify --app-status\|--app-start\|--app-stop` (`scripts/verify/app.mjs`) |
| Evals of the setup itself | `scripts/evals/`: `run.mjs --self-test` (delivery behaviour), `review_eval.mjs` (reviewers catch planted defects), `trigger_eval.mjs` (skills fire on the right prompts) |
| Setup health | `ai-checkup` (skill usage, always-on token cost, hook errors, stale memory) |
| End-of-day triage | `ai-triage` (`scripts/triage.sh`), scheduled by `setup/install.sh --triage` |
| Install, merge into live configs, check | `setup/install.sh --all --config-write --doctor`; also links the `ai-*` commands into `~/.local/bin` |
| Claude Code plugin for teammates | `.claude-plugin/` (portable skills, the four review agents, hooks, `bin/` commands); `claude plugin validate .` runs in `validate.sh` |

Per-repo contracts (`contracts/*.json`) and `policy/decisions.local.md` are gitignored: this repo is public.

## Claude Code specifics

- [claude/CLAUDE.md](claude/CLAUDE.md) — always-on global instructions
- [claude/settings.reference.json](claude/settings.reference.json) — annotated settings reference
- [claude/hooks/](claude/hooks/): `log-correction-signal` (feeds `memory-distill`), `verify-on-stop`, `guard-git`, `format-on-edit`, `quiet-checks` (Claude only: a passing test, lint or typecheck run shrinks to one line), `session-context` (SessionStart, also after compaction), `log-skill-use` (feeds `ai-checkup`), `edit-scope` (registered by the tech-lead and deliver skills). Cursor has the first four; Codex has those plus `session-context`
- [claude/rules/](claude/rules/): path-scoped rules, linked at `~/.claude/rules`
- [eslint/style_rules.mjs](eslint/style_rules.mjs): the lint-checkable conventions as importable rule maps

## Codex CLI specifics

- [codex/INSTRUCTIONS.md](codex/INSTRUCTIONS.md) — global instructions (symlinked to `~/.codex/AGENTS.md`), including rule routing
- `skills/*/` — individually symlinked to `~/.agents/skills/`, with shared references
- `codex/agents/*.toml` — native agent metadata, combined with `agents/*.md` into `~/.codex/agents/`

## Installation

Run `./setup/install.sh --all` after cloning. See [SETUP.md](SETUP.md) for details.

## Personal vs portable

Skills and agents tagged with personal voice or domain context are optional:

- **Personal voice:** [skills/shared/pr-review-voice-marco.md](skills/shared/pr-review-voice-marco.md), [agents/marco-blogger.md](agents/marco-blogger.md)
- **Personal conventions:** [skills/marco-code-style/SKILL.md](skills/marco-code-style/SKILL.md)
- **Domain-specific:** [agents/esql-expert.md](agents/esql-expert.md), observability reviewer persona

Everything else is tool- and author-agnostic.

# AI Essentials

Personal AI agent configuration: rules, skills, subagents, and presentation assets. Works with Cursor, Claude Code, Codex, and other agentic coding tools. Copy or symlink what you need, or cherry-pick individual files.

See [AGENTS.md](AGENTS.md) for a quick index when working inside this repo.

## Repository layout

```
ai-essentials/
├── AGENTS.md       # Entry point for agents working in this repo
├── rules/          # Standing guidance (Cursor `.mdc`; content is portable)
├── skills/         # On-demand workflows (`SKILL.md` + supporting files)
│   └── shared/     # Cross-skill assets (voice profiles, etc.)
├── agents/         # Agent sources, rendered per tool (read-only reviewers, personas)
├── policy/         # Guardrails, attribution patterns, always-ask classes, decision format
├── contracts/      # Per-repo verification contracts (gitignored; example.json is tracked)
├── scripts/        # verify, guard, work, guardrails, evals, delegate.sh, validate.sh
├── claude/ cursor/ codex/   # Per-tool hooks and reference configs
├── setup/          # Installers, config merge (apply.mjs), doctor.mjs, agent renderer
├── docs/           # Delegation strategy and implementation plan
└── presentations/  # Standalone slide decks (HTML, no build step)
```

## Delegating work

The full walkthrough, with recipes and troubleshooting, is in [docs/guide.md](docs/guide.md).

Install once, then check it:

```bash
./setup/install.sh --all --config-write --doctor
```

| You want | Do |
|---|---|
| A ticket taken from spec to a draft PR | `/tech-lead <ticket or description>` in Claude Code (it never starts on its own, since it branches, commits and opens a PR); in Cursor and Codex, ask for the `tech-lead` skill. It branches, interviews you on the spec, implements, verifies, reviews with fresh context, and opens a draft PR |
| The agent to know a repo's checks | Run the `verify-contract` skill once in that repo; the contract is stored here, gitignored, not in the repo |
| Several tickets in parallel | `ai-delegate --tool claude\|codex\|cursor "<task>"` per task (a ticket or just a description); each gets its own worktree beside the repo, a turn or time cap, and an audit |
| One mechanical change over many files | `ai-fanout --tool claude --branch <slug> --list files.txt --prompt "Migrate {file} ..."`; runs 3 files first, then `--all` |
| A draft PR babysat | `/loop 15m` with the `ci-babysit` skill |
| To know the setup still works | `node scripts/evals/run.mjs --self-test` (free, 30 tasks), or `--tool claude\|codex\|cursor` for real runs, which report cost per task |
| To know the reviewers still catch bugs | `node scripts/evals/review_eval.mjs` (real runs of the `reviewer`, `convention-checker` and `skeptic` agents on planted defects and clean controls, about $0.30) |
| To know skills fire on the right prompts | `node scripts/evals/trigger_eval.mjs` (a few cents per skill on Haiku; `--trials 3` before acting on one miss) |
| To prove a change in the running app | the `verify-app` skill; `ai-verify --app-status` reuses an instance already running and tells this checkout's from another worktree's |
| A report of what to hand off tomorrow | `ai-triage` (read-only; `./setup/install.sh --triage` schedules it on weekdays at 18:00) |
| To see what the setup costs and what goes unused | `ai-checkup` |
| The workflow skills without the rest of this repo (teammates) | `/plugin marketplace add tonyghiani/ai-essentials`, then `/plugin install ai-essentials@ai-essentials` (see the plugin notes below) |

What it will not do, in any tool: credit itself on a commit, PR or comment, mark a PR ready, merge, force push, or push to a default branch. Hooks enforce that; `setup/doctor.mjs` checks the hooks and the attribution switches are in place. Details in [docs/implementation-plan.md](docs/implementation-plan.md).

**Plugin notes.** The plugin carries the portable skills, the `reviewer`, `convention-checker`, `skeptic` and `judge` agents, the hooks, and the `ai-*` commands (from `bin/`). It leaves out what is personal: the global instructions and rules, `marco-code-style`, the voice-based review skills and `memory-distill`; skills that mention those still work, without that step. Plugin skills are namespaced (`/ai-essentials:tech-lead`), and the headless runners (`ai-delegate`, `ai-triage`) start skills by their bare names, so use those through the symlink install. The skill-scoped edit fence also needs the symlink install. Use one install or the other, not both, or every hook runs twice.

The guard hook reads command text, so treat it as the first layer, not the last. Headless Claude runs (`ai-delegate`, `ai-fanout`) also run in Claude Code's OS sandbox: writes only inside the worktree, the repo's git directory and the state directory, network only to GitHub and the npm registry unless you pass `--allow-domain`. For repos you delegate to, add a GitHub ruleset on the default branch (block force pushes, require a pull request review): GitHub then refuses a force push or a merge however the command was phrased, and you cannot approve your own PR, so the agent cannot merge one under your login.

## Tool compatibility

The **content** is tool-agnostic plain Markdown. **File formats and install paths** differ by product:

| Concept | This repo | Cursor | Claude Code | Codex |
|---------|-----------|--------|-------------|----------------|
| **Rules** | `rules/*.mdc` | `.cursor/rules/` or `~/.cursor/rules/` | `.claude/rules/` or `CLAUDE.md` | Referenced from `~/.codex/AGENTS.md` |
| **Skills** | `skills/*/SKILL.md` | `.cursor/skills/` or `~/.cursor/skills/` | Project or user skills dir | `~/.agents/skills/` |
| **Agents** | `agents/*.md` | `.cursor/agents/` or `~/.cursor/agents/` | Subagent definitions | Converted to `~/.codex/agents/*.toml` |
| **Always-on rules** | `alwaysApply: true` in frontmatter | Auto-injected | Varies by tool | Included in global `AGENTS.md` |
| **File-scoped rules** | `globs:` in frontmatter | Activates when matching files are open | Tool-dependent | Global instructions select rules by task and file type |

`.mdc` frontmatter (`alwaysApply`, `globs`) is a Cursor convention. The rule **body** works anywhere: paste it into `AGENTS.md`, Claude project rules, or your tool's instruction file.

## Path resolution

Skills reference each other with paths like `skills/review-team/SKILL.md`. Resolve them in this order:

1. **Repo root in workspace** — path is `ai-essentials/skills/...` (or `./skills/...` if cwd is the repo).
2. **Symlinked install** — if skills live at e.g. `~/.cursor/skills/ai-essentials/review-team/SKILL.md`, then `skills/review-pr/SKILL.md` resolves to `~/.cursor/skills/ai-essentials/review-pr/SKILL.md` (same parent directory as the skill you're running).
3. **Unknown** — ask the user where they installed this repo.

Run `./scripts/validate.sh` after edits. It catches broken cross-references, skill name/folder mismatches, over-broad React globs, and style claims that one file restates after another file overrode them.

---

## Personal vs portable

| Kind | Files | Notes |
|------|-------|-------|
| **Portable** | Most rules and skills | Copy as-is |
| **Personal voice** | `skills/shared/pr-review-voice-marco.md`, `agents/marco-blogger.md`, `skills/review-pr/`, `skills/review-pr-comments/` | Replace voice file or drop `voice-profile` in skill frontmatter |
| **Domain-specific** | `agents/esql-expert.md`, `skills/review-team/reviewers/observability-expert.md` | Fork for your stack |

---

## Getting started

### Option A — installer (recommended)

```bash
git clone https://github.com/marcoghiani/ai-essentials
cd ai-essentials
chmod +x setup/install.sh
./setup/install.sh --all          # Claude Code + Cursor + Codex CLI
```

Or per tool:

```bash
./setup/install.sh --claude-code
./setup/install.sh --cursor
./setup/install.sh --codex
```

Safe to re-run. Codex backs up conflicts under `~/.codex/backups/ai-essentials/`;
other installers use `.bak`. See [SETUP.md](SETUP.md) for install paths and verification.

### Option B — copy individual files

Pick one rule, skill, or agent. No symlink required.

### Option C — reference from AGENTS.md

Many tools load `AGENTS.md` at the repo root. This repo includes [AGENTS.md](AGENTS.md) as an example. In your own projects:

```markdown
Follow the guidance in rules/no-ai-prose.mdc and rules/numbered-replies.mdc.
For PR reviews, use skills/review-pr/SKILL.md.
```

---

## Rules

Persistent instructions for the agent. Cursor uses `.mdc` with YAML frontmatter; other tools consume the same Markdown body.

| File | Scope | What it does |
|------|-------|--------------|
| [`no-ai-prose.mdc`](rules/no-ai-prose.mdc) | Always on | Bans AI-flavoured writing patterns in all output |
| [`numbered-replies.mdc`](rules/numbered-replies.mdc) | Always on | Maps numbered user replies to numbered questions |
| [`react-avoid-effects.mdc`](rules/react-avoid-effects.mdc) | Frontend globs | Prefer deriving data and event handlers over `useEffect` |
| [`react-effects-dependencies.mdc`](rules/react-effects-dependencies.mdc) | Frontend globs | `useEffect` dependency arrays and sync patterns |
| [`react-refs-dom.mdc`](rules/react-refs-dom.mdc) | Frontend globs | Refs and direct DOM access in React |
| [`typescript-style.mdc`](rules/typescript-style.mdc) | `**/*.ts(x)` | Naming, typing, control flow, comment intent |
| [`project-structure.mdc`](rules/project-structure.mdc) | `**/*.ts(x)` | Feature folders, barrels, type placement, import paths |
| [`react-components.mdc`](rules/react-components.mdc) | `**/*.{tsx,jsx}` | Component declaration, props, rendering, state placement |
| [`node-api-patterns.mdc`](rules/node-api-patterns.mdc) | Server globs | Layering, boundary validation, typed errors, concurrency |
| [`testing-style.mdc`](rules/testing-style.mdc) | Test globs | Colocation, test naming, mocking split, assertions |

React rules target `*.{tsx,jsx}` and common frontend paths (`components/`, `hooks/`, `pages/`, `app/`). They won't fire on arbitrary backend `.ts` files when installed globally.

The five code-style rules encode one author's conventions, confirmed by a 69-question interview against 40 merged PRs and five personal repositories. Each opens by deferring to project conventions. Swap the bodies for your own and the rest of the setup still works.

Mechanical rules stay out of them and live in [`eslint-recommendations.md`](eslint-recommendations.md): prettier settings, `simple-import-sort` groups, and lint rules covering enums, `any`, naming casing, and test titles. That file is reference material; Codex can read it through the installed repository link.

---

## Skills

Reusable workflows the agent loads on demand. Each skill lives in its own folder with a `SKILL.md` entry point.

| Skill | Trigger hints | What it does |
|-------|---------------|--------------|
| [`branch-refactor-planner`](skills/branch-refactor-planner/) | "refactor plan", "clean up this branch" | Reviews branch diff vs base and produces a prioritized refactor plan |
| [`deep-research`](skills/deep-research/) | "become the expert", "deep dive into" | Reads docs + code, produces a structured architecture report |
| [`gh-issue-writer`](skills/gh-issue-writer/) | "write a GitHub issue", "gh issue" | Drafts formatted issue Markdown (does not create the issue) |
| [`grill-me`](skills/grill-me/) | "grill me", "stress-test this plan" | Interviews you on a design until decisions are settled |
| [`pr-description-template`](skills/pr-description-template/) | "write a PR description" | PR body text from a fixed template; never opens the PR |
| [`resolve-merge-conflicts`](skills/resolve-merge-conflicts/) | "fix the conflicts", "merge main into this branch" | Merges the PR base, resolves conflicts by intent, verifies scoped checks, commits and pushes |
| [`review-pr`](skills/review-pr/) | "review pr", share a PR URL | Reviews a GitHub PR with copy-pasteable line comments (uses personal voice profile by default) |
| [`review-pr-comments`](skills/review-pr-comments/) | "should I accept this feedback" | Triages review comments against the PR diff (uses personal voice profile by default) |
| [`review-team`](skills/review-team/) | "review team", "multi-perspective review" | Runs three to six read-only reviewers in parallel and consolidates findings |

Delivery skills (the delegation system; see [docs/guide.md](docs/guide.md)):

| Skill | Started by | What it does |
|-------|------------|--------------|
| [`tech-lead`](skills/tech-lead/) | `/tech-lead`, `ai-delegate` | Ticket or description to a verified draft PR |
| [`deliver`](skills/deliver/) | tech-lead, `ai-delegate --task` | One specified task: implement, verify, fresh-context review, commit |
| [`open-draft-pr`](skills/open-draft-pr/) | tech-lead | Audits, pushes the agent's branch, opens a draft PR |
| [`verify-contract`](skills/verify-contract/) | "set up verification" | Writes the repo's verification contract |
| [`ci-babysit`](skills/ci-babysit/) | `/loop` | One round of fixing red CI on the agent's draft PR |
| [`memory-distill`](skills/memory-distill/) | "distill memory" | Routes logged corrections, failed checks and review lessons to a memory, rule, lint rule, hook, eval or skill gotcha |
| [`verify-app`](skills/verify-app/) | deliver, "check it in the app" | Proves the change in the running app, reusing an instance that is already up; before and after table |
| [`best-of-two`](skills/best-of-two/) | tech-lead, "try two approaches" | Two parallel attempts at a risky task, the `judge` agent picks one |
| [`explain-pr`](skills/explain-pr/) | `/explain-pr` | Explains an agent PR and quizzes you on it before it leaves draft |
| [`daily-triage`](skills/daily-triage/) | `ai-triage` | Read-only report of review requests, red CI and assigned issues, with `ai-delegate` lines for the easy ones |

Specialist skills the tech lead routes to by diff content: [`tdd`](skills/tdd/), [`dep-size`](skills/dep-size/), [`a11y-audit`](skills/a11y-audit/), [`i18n-sweep`](skills/i18n-sweep/), [`react-perf`](skills/react-perf/), [`api-contract-review`](skills/api-contract-review/), [`react-patterns`](skills/react-patterns/), [`marco-code-style`](skills/marco-code-style/).

The review-team panel:

| Reviewer | Runs | Source |
|----------|------|--------|
| Adversarial | always | [`reviewers/adversarial.md`](skills/review-team/reviewers/adversarial.md) |
| Fresh Eyes | always | [`reviewers/fresh-eyes.md`](skills/review-team/reviewers/fresh-eyes.md) |
| Conventions | always, on code | the [`convention-checker`](agents/convention-checker.md) agent |
| Architecture | boundary, API or schema changes | [`reviewers/architecture.md`](skills/review-team/reviewers/architecture.md) |
| Product Flow | user-visible changes | [`reviewers/product-flow.md`](skills/review-team/reviewers/product-flow.md) |
| Observability Expert | logging, metrics, tracing, ES\|QL | [`reviewers/observability-expert.md`](skills/review-team/reviewers/observability-expert.md) (Elasticsearch/OTel tuned) |

Shared assets: [`skills/shared/`](skills/shared/) (e.g. [`pr-review-voice-marco.md`](skills/shared/pr-review-voice-marco.md)).

---

## Agents

Specialist personas for delegated work (subagents, parallel workers, or focused sessions). Install into your tool's agent directory, or paste the prompt when spawning a worker.

| Agent | What it does |
|-------|--------------|
| [`reviewer.md`](agents/reviewer.md) | Fresh-context, read-only review of a diff against its spec; strongest model |
| [`convention-checker.md`](agents/convention-checker.md) | Read-only pass or fail against the style rules; fast model |
| [`skeptic.md`](agents/skeptic.md) | Read-only; tries to disprove each serious review finding, so false positives never reach you |
| [`judge.md`](agents/judge.md) | Read-only; compares two patches pairwise and reports position bias |
| [`marco-blogger.md`](agents/marco-blogger.md) | Personal blog voice; outputs MDX with frontmatter |
| [`esql-expert.md`](agents/esql-expert.md) | ES\|QL queries for Elasticsearch (domain-specific) |

The Codex installer combines each Markdown prompt with the matching metadata in
`codex/agents/` to produce native TOML agents. Cursor/Claude frontmatter is stripped
from the prompt; both agents inherit the parent model. Re-run `--codex` after
changing a persona. See [SETUP.md](SETUP.md) for details.

---

## Presentations

Self-contained HTML slide decks. Open in a browser; no build step.

| Deck | Description |
|------|-------------|
| [`cursor-skills-subagents-eah-madrid-2026`](presentations/cursor-skills-subagents-eah-madrid-2026/) | EAH Madrid 2026 talk. Concepts are tool-agnostic; some slides still show Cursor as the demo environment from the live session. See [deck README](presentations/cursor-skills-subagents-eah-madrid-2026/README.md). |

---

## Maintenance

```bash
chmod +x scripts/validate.sh   # once
./scripts/validate.sh
```

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Marco Antonio Ghiani

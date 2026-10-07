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
├── agents/         # Specialist agent personas (subagents / delegated workers)
├── scripts/        # Maintenance helpers (validate.sh)
└── presentations/  # Standalone slide decks (HTML, no build step)
```

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
| [`pr-description-template`](skills/pr-description-template/) | "write a PR description", "create a PR" | PR body from a fixed template; can create via `gh` |
| [`resolve-merge-conflicts`](skills/resolve-merge-conflicts/) | "fix the conflicts", "merge main into this branch" | Merges the PR base, resolves conflicts by intent, verifies scoped checks, commits and pushes |
| [`review-pr`](skills/review-pr/) | "review pr", share a PR URL | Reviews a GitHub PR with copy-pasteable line comments (uses personal voice profile by default) |
| [`review-pr-comments`](skills/review-pr-comments/) | "should I accept this feedback" | Triages review comments against the PR diff (uses personal voice profile by default) |
| [`review-team`](skills/review-team/) | "review team", "comprehensive review" | Runs 6 parallel reviewers and consolidates findings |

The review-team skill runs **6 reviewers**. Persona sources:

| Reviewer | Source |
|----------|--------|
| Code Quality | [`skills/branch-refactor-planner/SKILL.md`](skills/branch-refactor-planner/SKILL.md) |
| Adversarial | [`reviewers/adversarial.md`](skills/review-team/reviewers/adversarial.md) |
| Architecture | [`reviewers/architecture.md`](skills/review-team/reviewers/architecture.md) |
| Fresh Eyes | [`reviewers/fresh-eyes.md`](skills/review-team/reviewers/fresh-eyes.md) |
| Product Flow | [`reviewers/product-flow.md`](skills/review-team/reviewers/product-flow.md) |
| Observability Expert | [`reviewers/observability-expert.md`](skills/review-team/reviewers/observability-expert.md) (Elasticsearch/OTel tuned) |

Shared assets: [`skills/shared/`](skills/shared/) (e.g. [`pr-review-voice-marco.md`](skills/shared/pr-review-voice-marco.md)).

---

## Agents

Specialist personas for delegated work (subagents, parallel workers, or focused sessions). Install into your tool's agent directory, or paste the prompt when spawning a worker.

| Agent | What it does |
|-------|--------------|
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

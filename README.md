# ai-essentials

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

| Concept | This repo | Cursor | Claude Code | Codex / others |
|---------|-----------|--------|-------------|----------------|
| **Rules** | `rules/*.mdc` | `.cursor/rules/` or `~/.cursor/rules/` | `.claude/rules/` or `CLAUDE.md` | `AGENTS.md`, project instructions |
| **Skills** | `skills/*/SKILL.md` | `.cursor/skills/` or `~/.cursor/skills/` | Project or user skills dir | Same pattern where supported |
| **Agents** | `agents/*.md` | `.cursor/agents/` or `~/.cursor/agents/` | Subagent definitions | Custom system prompts / worker configs |
| **Always-on rules** | `alwaysApply: true` in frontmatter | Auto-injected | Varies by tool | Paste into global instructions |
| **File-scoped rules** | `globs:` in frontmatter | Activates when matching files are open | Tool-dependent | Manual `@` mention or project rules |

`.mdc` frontmatter (`alwaysApply`, `globs`) is a Cursor convention. The rule **body** works anywhere: paste it into `AGENTS.md`, Claude project rules, or your tool's instruction file.

## Path resolution

Skills reference each other with paths like `skills/review-team/SKILL.md`. Resolve them in this order:

1. **Repo root in workspace** — path is `ai-essentials/skills/...` (or `./skills/...` if cwd is the repo).
2. **Symlinked install** — if skills live at e.g. `~/.cursor/skills/ai-essentials/review-team/SKILL.md`, then `skills/review-pr/SKILL.md` resolves to `~/.cursor/skills/ai-essentials/review-pr/SKILL.md` (same parent directory as the skill you're running).
3. **Unknown** — ask the user where they installed this repo.

Run `./scripts/validate.sh` after edits to catch broken cross-references and skill name/folder mismatches.

---

## Personal vs portable

| Kind | Files | Notes |
|------|-------|-------|
| **Portable** | Most rules and skills | Copy as-is |
| **Personal voice** | `skills/shared/pr-review-voice-marco.md`, `agents/marco-blogger.md`, `skills/review-pr/`, `skills/review-pr-comments/` | Replace voice file or drop `voice-profile` in skill frontmatter |
| **Domain-specific** | `agents/esql-expert.md`, `skills/review-team/reviewers/observability-expert.md` | Fork for your stack |

---

## Getting started

### Option A — clone and symlink (stays in sync with git pull)

**Cursor:**

```bash
ln -s /path/to/ai-essentials/rules ~/.cursor/rules/ai-essentials
ln -s /path/to/ai-essentials/skills ~/.cursor/skills/ai-essentials
ln -s /path/to/ai-essentials/agents ~/.cursor/agents/ai-essentials
```

**Project-scoped (any tool that reads project config):**

```bash
mkdir -p .cursor/rules .cursor/skills .cursor/agents
ln -s ../../path/to/ai-essentials/rules .cursor/rules/ai-essentials
ln -s ../../path/to/ai-essentials/skills .cursor/skills/ai-essentials
ln -s ../../path/to/ai-essentials/agents .cursor/agents/ai-essentials
```

For Claude Code, Codex, or tools without a skills directory: copy `SKILL.md` files into your tool's skill/instruction mechanism, or `@`-mention them when needed.

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

React rules target `*.{tsx,jsx}` and common frontend paths (`components/`, `hooks/`, `pages/`, `app/`). They won't fire on arbitrary backend `.ts` files when installed globally.

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

Optional Cursor frontmatter fields (`model`, etc.) are ignored by other tools.

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

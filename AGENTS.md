# ai-essentials

Agent configuration for this repository. Install globally via symlinks (see
[README.md](README.md)) or reference these paths when working inside this repo.

## Always apply

- [rules/no-ai-prose.mdc](rules/no-ai-prose.mdc)
- [rules/numbered-replies.mdc](rules/numbered-replies.mdc)

For Claude Code these two, plus verification discipline and a compact TS/React
invariants block, are assembled in [claude/CLAUDE.md](claude/CLAUDE.md).

## React (frontend files only)

When editing React UI code, follow:

- [rules/react-avoid-effects.mdc](rules/react-avoid-effects.mdc)
- [rules/react-effects-dependencies.mdc](rules/react-effects-dependencies.mdc)
- [rules/react-refs-dom.mdc](rules/react-refs-dom.mdc)

These rules target `*.{tsx,jsx}` and paths under `components/`, `hooks/`, `pages/`, and `app/`. Skip them for backend-only or config-only changes.

Claude Code loads the same material on demand via the `react-patterns` skill.

## Skills (on demand)

Paths inside a skill resolve relative to that skill's own directory.

| Task | Skill |
|------|-------|
| Marco's TS/React conventions | [skills/marco-code-style/SKILL.md](skills/marco-code-style/SKILL.md) — project-agnostic; derived from 748 authored commits |
| Effect / ref / dependency discipline | [skills/react-patterns/SKILL.md](skills/react-patterns/SKILL.md) |
| Test-first loop | [skills/tdd/SKILL.md](skills/tdd/SKILL.md) |
| Multi-perspective code review | [skills/review-team/SKILL.md](skills/review-team/SKILL.md) |
| GitHub PR review | [skills/review-pr/SKILL.md](skills/review-pr/SKILL.md) |
| Triage PR review comments | [skills/review-pr-comments/SKILL.md](skills/review-pr-comments/SKILL.md) |
| Branch refactor plan | [skills/branch-refactor-planner/SKILL.md](skills/branch-refactor-planner/SKILL.md) |
| Architecture deep dive | [skills/deep-research/SKILL.md](skills/deep-research/SKILL.md) |
| Plan stress-test | [skills/grill-me/SKILL.md](skills/grill-me/SKILL.md) |
| PR description | [skills/pr-description-template/SKILL.md](skills/pr-description-template/SKILL.md) |
| GitHub issue draft | [skills/gh-issue-writer/SKILL.md](skills/gh-issue-writer/SKILL.md) |
| API / contract review | [skills/api-contract-review/SKILL.md](skills/api-contract-review/SKILL.md) |
| React render perf | [skills/react-perf/SKILL.md](skills/react-perf/SKILL.md) |
| Accessibility audit | [skills/a11y-audit/SKILL.md](skills/a11y-audit/SKILL.md) |
| Dependency / bundle cost | [skills/dep-size/SKILL.md](skills/dep-size/SKILL.md) |
| i18n sweep | [skills/i18n-sweep/SKILL.md](skills/i18n-sweep/SKILL.md) |
| Distil memory from correction log | [skills/memory-distill/SKILL.md](skills/memory-distill/SKILL.md) |

## Agents (delegated workers)

- [agents/esql-expert.md](agents/esql-expert.md) — ES|QL queries (domain-specific, read-only tools)
- [agents/marco-blogger.md](agents/marco-blogger.md) — personal blog voice (replace for your own setup)

## Claude Code specifics

- [claude/CLAUDE.md](claude/CLAUDE.md) — always-on global instructions
- [claude/settings.reference.json](claude/settings.reference.json) — annotated settings reference
- [claude/hooks/log-correction-signal.mjs](claude/hooks/log-correction-signal.mjs) — `UserPromptSubmit` hook feeding `memory-distill`

## Codex CLI specifics

- [codex/INSTRUCTIONS.md](codex/INSTRUCTIONS.md) — global instructions (installed to `~/.codex/instructions.md`)

## Installation

Run `./setup/install.sh --all` after cloning. See [SETUP.md](SETUP.md) for details.

## Personal vs portable

Skills and agents tagged with personal voice or domain context are optional:

- **Personal voice:** [skills/shared/pr-review-voice-marco.md](skills/shared/pr-review-voice-marco.md), [agents/marco-blogger.md](agents/marco-blogger.md)
- **Personal conventions:** [skills/marco-code-style/SKILL.md](skills/marco-code-style/SKILL.md)
- **Domain-specific:** [agents/esql-expert.md](agents/esql-expert.md), observability reviewer persona

Everything else is tool- and author-agnostic.

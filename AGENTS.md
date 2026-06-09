# ai-essentials

Agent configuration for this repository. Install globally via symlinks (see
[README.md](README.md)) or reference these paths when working inside this repo.

## Always apply

- [rules/no-ai-prose.mdc](rules/no-ai-prose.mdc)
- [rules/numbered-replies.mdc](rules/numbered-replies.mdc)

## React (frontend files only)

When editing React UI code, follow:

- [rules/react-avoid-effects.mdc](rules/react-avoid-effects.mdc)
- [rules/react-effects-dependencies.mdc](rules/react-effects-dependencies.mdc)
- [rules/react-refs-dom.mdc](rules/react-refs-dom.mdc)

These rules target `*.{tsx,jsx}` and paths under `components/`, `hooks/`, `pages/`, and `app/`. Skip them for backend-only or config-only changes.

## Skills (on demand)

Resolve skill paths per [README.md — Path resolution](README.md#path-resolution).

| Task | Skill |
|------|-------|
| Multi-perspective code review | [skills/review-team/SKILL.md](skills/review-team/SKILL.md) |
| GitHub PR review | [skills/review-pr/SKILL.md](skills/review-pr/SKILL.md) |
| Triage PR review comments | [skills/review-pr-comments/SKILL.md](skills/review-pr-comments/SKILL.md) |
| Branch refactor plan | [skills/branch-refactor-planner/SKILL.md](skills/branch-refactor-planner/SKILL.md) |
| Architecture deep dive | [skills/deep-research/SKILL.md](skills/deep-research/SKILL.md) |
| Plan stress-test | [skills/grill-me/SKILL.md](skills/grill-me/SKILL.md) |
| PR description | [skills/pr-description-template/SKILL.md](skills/pr-description-template/SKILL.md) |
| GitHub issue draft | [skills/gh-issue-writer/SKILL.md](skills/gh-issue-writer/SKILL.md) |

## Agents (delegated workers)

- [agents/esql-expert.md](agents/esql-expert.md) — ES|QL queries (domain-specific)
- [agents/marco-blogger.md](agents/marco-blogger.md) — personal blog voice (replace for your own setup)

## Personal vs portable

Skills and agents tagged with personal voice or domain context are optional:

- **Personal voice:** [skills/shared/pr-review-voice-marco.md](skills/shared/pr-review-voice-marco.md), [agents/marco-blogger.md](agents/marco-blogger.md)
- **Domain-specific:** [agents/esql-expert.md](agents/esql-expert.md), observability reviewer persona

Everything else is tool- and author-agnostic.

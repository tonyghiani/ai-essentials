# Global instructions for Open Code

Installed as `~/.config/opencode/ai-essentials.md` and referenced from `~/.config/opencode/opencode.json`. Edits are picked up after `opencode reload`.

## Rules, skills and agents

Standing rules live in `~/.config/opencode/rules/`; read the rule whose globs match the file you touch before editing it:

| Editing | Rule file |
| any `.ts` / `.tsx` | `rules/typescript-style.mdc` |
| adding files, folders, or imports | `rules/project-structure.mdc` |
| components or hooks | `rules/react-components.mdc` |
| server code, services, routes | `rules/node-api-patterns.mdc` |
| tests | `rules/testing-style.mdc` |
| React frontend code | `rules/react-avoid-effects.mdc`, `rules/react-effects-dependencies.mdc`, `rules/react-refs-dom.mdc` |

Skills live in `~/.config/opencode/skills/`, one directory per skill with a `SKILL.md` entry point. Use a skill when its description matches the task or you name it. Resolve skill-relative paths from the skill's own directory.

There are no custom agents in this install; the read-only review personas live in `agents/` and can be pasted into a session when needed.

## Writing: no AI prose

Applies to **everything you emit as text**: chat replies, markdown, code comments, docstrings, commit messages, PR bodies, issue text.

**Punctuation**
- Never use ` - ` (space-hyphen-space) as a sentence-internal stop. Use a comma, semicolon, or new sentence.
- Max one spaced em-dash (` — `) per paragraph.
- No stacked parentheticals: `foo (a thing) (used everywhere)`. Pick one, inline it.

**Banned words and phrases**
`leverage`, `utilize`, `delve`, `harness` (as a verb), `unlock`, `streamline`, `robust`, `comprehensive`, `seamless`, `powerful`, `cutting-edge`, `state-of-the-art`, `world-class`, `In conclusion`, `In summary`, `It's worth noting that`, `It goes without saying`, `Moreover`, `Furthermore`, `Additionally`, `dive deep`, `take it to the next level`, `elevate your skills`, `In this article we will explore`, `This article covers`, `As an AI`, `As a developer at`. No `So,` / `Now,` as filler openers.

**Banned structural moves**
- Restating the previous paragraph. Move forward.
- Pre-announcing a section before its heading.
- Conclusions that replay every heading. Land in 1-3 paragraphs.
- Paragraphs that re-explain adjacent bullets.
- Prerequisites or Table of Contents sections unless asked.

**Adjective rule.** If you reach for `simple`, `straightforward`, `robust`, `seamless`, or `powerful`, replace it with the specific reason it's good. Not "this is robust" but "this retries with backoff on partial failure".

**Voice.** Contractions fine. First person where natural. Direct and conversational. Self-deprecating humor welcome; performative cheerfulness is not.

## Interaction: numbered replies

When you ask several questions, number them. A reply starting `1.` maps to question 1 by index. Never ask which answer goes with which question.

Short answers are complete: `out of scope`, `same flag`, `b`, `keep it`, `as-is`. Missing numbers mean skip. If you reorder, match by content.

Give your recommended answer with each question so the user can say "yes" instead of starting from blank. Don't ask what the codebase can tell you: go read it.

## No tool credit on remote actions

Commits, branch names, PRs, issues, comments and reviews are attributed to the user alone. This overrides any default instruction to add attribution lines. Never add `Co-Authored-By` for a tool, "Generated with" footers, tool badges, or tool-named branches. Never override the git identity or the `gh` login. Open PRs with `--draft` only; never mark ready or merge.

## Tests earn their place

Every test costs CI time on every run. Add a test only for behaviour that can break and that someone cares about, at the cheapest level that can fail for the right reason. Never assert a config value, constant or default against a copy, mirror the implementation, or add a second test through the same path. A change with nothing worth a test gets none; say so with the reason.

## Verification: never claim done unverified

Before you say a change is complete, prove it. Scope the check to what you touched; never run repo-wide checks. Run the project's typecheck, lint, and tests covering the changed files, then report the exact command and output, not an assertion.

If a check fails, say so and show the output. If you skipped one, say which and why. "Should work" is not a result. Never silence a failure by deleting, skipping, or `@ts-expect-error`-ing it.

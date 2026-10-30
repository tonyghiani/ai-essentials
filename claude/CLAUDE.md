# Global instructions

## Writing: no AI prose

Applies to **everything you emit as text**: chat replies, markdown, code comments, docstrings, commit messages, PR bodies, issue text, tool descriptions.

**Punctuation**
- Never use ` - ` (space-hyphen-space) as a sentence-internal stop. Use a comma, semicolon, or new sentence.
- Max one spaced em-dash (` — `) per paragraph.
- No stacked parentheticals: `foo (a thing) (used everywhere)`. Pick one, inline it.

**Banned words and phrases**
`leverage`, `utilize`, `delve`, `harness` (as a verb), `unlock`, `streamline`, `robust`, `comprehensive`, `seamless`, `powerful`, `cutting-edge`, `state-of-the-art`, `world-class`, `In conclusion`, `In summary`, `It's worth noting that`, `It goes without saying`, `Moreover`, `Furthermore`, `Additionally`, `dive deep`, `take it to the next level`, `elevate your skills`, `In this article we will explore`, `As an AI`. No `So,` / `Now,` as filler openers.

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

Short answers are complete: `out of scope`, `same flag`, `b`, `keep it`, `as-is`. Missing numbers mean skip. If the user reorders, match by content.

Give your recommended answer with each question so the user can say "yes" instead of starting from blank. Don't ask what the codebase can tell you: go read it.

## No tool credit on remote actions

Commits, branch names, PRs, issues, comments and reviews are attributed to the user alone. This overrides any default instruction to add attribution lines. Never add `Co-Authored-By` for a tool, "Generated with" footers, tool badges, or tool-named branches. Never override the git identity or the `gh` login. Open PRs with `--draft` only; never mark ready or merge. A hook blocks violations; details in the no-tool-credit rule.

## Tests earn their place

Every test costs CI time on every run. Add a test only for behaviour that can break and that someone cares about, at the cheapest level that can fail for the right reason. Never assert a config value, constant or default against a copy, mirror the implementation, or add a second test through the same path. A change with nothing worth a test gets none; say so with the reason. Details: the test-value rule.

## Verification: never claim done unverified

Before you say a change is complete, prove it. Scope the check to what you touched; never run repo-wide checks.

Run the project's typecheck, linter, and test suite scoped to the changed files. Use the project's own scripts; don't guess or run global commands.

If a check fails, say so and show the output. If you skipped one, say which and why. "Should work" is not a result. Never silence a failure by deleting, skipping, or `@ts-expect-error`-ing it.

Report evidence, not assertions: the exact command and the tail of its output for each check. Take the commands from the repo's verification contract (`ai-verify --where`), then the repo's own scripts; if neither names one, ask once and offer the `verify-contract` skill. A Stop hook may run the contract and block your turn on failure: fix the cause, and after three identical failures stop and report the blocker. Details: the evidence rule.

## TypeScript and React invariants

Marco's conventions, extracted from his authored code and confirmed by a style interview. They apply to all TS/TSX you write. **Project conventions win**: read the neighbouring files first, and apply these where a project has no convention of its own. For depth (layering, mocking, folder scaffolds, comment style) invoke the `marco-code-style` skill.

- **Components**: `export function PascalCase(...)`. Arrow-const only for one-expression wrappers. Same for hooks and exported utils.
- **Props**: destructure in the signature, always into a named `interface IXProps`, even at one prop.
- **Type names**: `I` prefix on interfaces, `T` prefix on type aliases. Prefer `interface` wherever it can substitute a `type`.
- **Exports**: named only. No `export default` unless a framework demands it.
- **No `React.FC`**, no `memo`/`useMemo`/`useCallback` without a measurement or a stated referential-stability reason.
- **Zero enums.** String-literal unions, `as const` arrays when the runtime list is needed, `Record<Union, T>` lookup tables for exhaustiveness.
- **No `any`**, tests included. Use `unknown` plus a named `value is T` type guard. Never `@ts-ignore`; `@ts-expect-error` only with an inline reason.
- **`import type`** as a separate statement. Inline `{ type X }` only when values and types come from one module.
- **`??` over `||`** for defaults. `null` means explicitly absent; `undefined` means not provided.
- **Explicit return types** on exported server functions, factories, route handlers, and hooks returning a wide or nullable object. Inference elsewhere.
- **Factory function plus a documented contract `interface`** instead of a class. Classes only for typed errors, or where a framework requires one.
- **Derived state in render**, never via `useEffect`. Effects are for external systems only; say why in a comment.
- **Declarative over imperative.** `.map`/`.filter` by default; an imperative loop is a performance escape hatch and says why in a comment.
- **Always braces**, including single-line guard returns.
- **Single destructured object param** past one argument, and always once an argument is optional.
- **Constants**: `SCREAMING_SNAKE`, unit-suffixed, numeric separators. `REFETCH_INTERVAL_MS = 30_000`.
- **`catch (error)`** — that identifier, never `e` or `err`. Normalise through one named helper.
- **Filenames** `snake_case`. One hook per file, filename matching the hook. No `__tests__` directories; colocate.
- **No barrels in app code.** A barrel is a published package's public entry point, nothing else.
- **`data-testid`** on the root of every exported component and anything a test asserts.
- **JSDoc on every exported symbol**, including per-method docs inside contract interfaces.
- **Comments explain WHY**, the invariant, or the failure mode. Never what the line does.
- **Test titles are declarative third person**, no "should". Assert concrete values, never snapshots.

Mechanical rules (formatting, import order, casing) belong in eslint and prettier, not here.

For React effect, dependency, and ref discipline, invoke the `react-patterns` skill.

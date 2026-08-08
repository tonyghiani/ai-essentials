---
name: marco-code-style
description: Marco's TypeScript and React conventions, extracted from 748 authored commits and confirmed by a 69-question style interview. Invoke before writing or reviewing substantial TS/TSX, when scaffolding a new module, when writing tests, or when a reviewer disagrees with a style choice. Covers components, hooks, types, errors, async, testing, comments, and folder layout with evidence from real code.
---

# Marco's code style

Observed conventions, then confirmed. Every rule below came from reading 748 commits Marco authored,
cross-checked by author-frequency per file, and then put to him directly in a 69-question interview
covering naming, control flow, typing, React, state, server patterns, structure, comments, and tests.

**Precedence.** Project conventions win when they conflict with this file. Read the neighbouring files
first. Where project documentation states a rule Marco's own code contradicts, follow the surrounding
file, and follow this file for new modules he owns.

**Scope.** Mechanical rules (formatting, import order, casing, banned syntax) are lint config, not
guidance; they live in `eslint-recommendations.md` in the ai-essentials repo. Cursor consumes the same
material as file-scoped rules in `rules/typescript-style.mdc`, `rules/react-components.mdc`,
`rules/node-api-patterns.mdc`, `rules/testing-style.mdc`, and `rules/project-structure.mdc`.

## Where his stated preference overrides his existing code

Read these first. Following the code instead of the preference is the most likely way to get it wrong.

| Rule | His code | His answer |
|---|---|---|
| Type name prefixes | no prefixes in Kibana (58 declarations) | `I` on interfaces, `T` on type aliases |
| Props interface | inline object type under ~4 props | always a named `interface IXProps` |
| Guard braces | 12 brace-less single-line guards | always braces |
| Imperative loops | 24 `for…of` for sequencing | declarative by default; imperative is a performance escape hatch |
| Abort signals | threaded through every call | only long-running or user-cancellable requests |
| Destructured params | past ~2 arguments | past 1 argument, and always once one is optional |

## Components

```tsx
// Default form.
export function SignificantEventsPage({ tab, onTabChange }: ISignificantEventsPageProps) {
  // ...
}

// Arrow-const only for a one-expression wrapper.
export const AppHeader = (props: IAppHeaderProps) => <PageHeader {...props} />;
```

- Props destructured **in the signature**, never in the body.
- **Always a named `interface IXProps`**, even at one prop.
- **Named exports only.** `export default` only where a framework requires it.
- No `React.FC`. No `memo`, no `forwardRef` without a measured reason.
- **Guard stack of early returns, then one JSX return.** Loading spinner, unavailable prompt, redirect,
  then the real tree. `return null` is normal. Braces on every guard.
- Conditional rendering is `{cond && (<>…</>)}`, with the condition coerced to a real boolean.
  `{items.length && …}` renders a stray `0`.
- `data-testid` on the root of every exported component and anything a test asserts.
- **Compound components via static properties on the function**: `PageTemplate.Body = …`.

**Context.** `export function XProvider({ children }: React.PropsWithChildren<IXProps>)` → `useMemo`
the value → a separate `useX()` that **throws when the provider is missing**. Context narrows badly in
TypeScript, so it is for app-wide concerns (auth, theme, platform services) where narrowing does not
matter. Drilling props is preferred otherwise.

## Hooks

- One hook per file. Filename is the hook name in `snake_case`: `use_time_range.ts`.
- **`export function useX()`**, matching the component form.
- **Derived state computed in render, never in an effect.** `const canManageStreams = streams?.manage === true`.
- Effects are for external systems only: breadcrumbs, timefilter sync, debounce timers. Say why in a comment.
- `useLayoutEffect` for pre-paint redirects, **always with a comment naming the warning it avoids**.
- `useMemo` justified by **referential stability**, and the comment says so: "without it every render
  produces new absolute values, which turns them into unstable effect/query dependencies."
- Return types annotated only when the hook returns a wide object or a nullable union.
- Private inner hook plus exported component when a wrapper has logic: `useDateRangeRedirect` → `DateRangeRedirect`.

**State placement.** Server data in the query cache, shared page state in context, user-visible filters
and tabs in the URL. `useState` for ephemeral local UI only. The ratio in his recent work is 2 `useState`
against 21 `useMemo`.

**With react-query** (skip if the project doesn't use it): module-level `as const` query key,
`queryFn: ({ signal }: QueryFunctionContext) => client.fetch(endpoint, { signal: signal ?? null })`.
Mutations toast in `onSuccess`/`onError` and invalidate the shared key in `onSettled`. Optimistic
updates only when the mutation is trivially reversible.

## Types

- `interface` for object shapes (82 uses), `type` for unions, mapped, and derived types (55). Reach for
  `interface` wherever it can substitute a `type`.
- **`I` prefix on interfaces, `T` prefix on type aliases.** This overrides his Kibana code; match the
  neighbours in a project that already went the other way.
- **Zero enums, ever.** String-literal unions; `as const` arrays only when the runtime list is needed.
- **Exhaustiveness via `Record<Union, T>`, with a comment saying that's the point:** "Keying by reason
  makes this exhaustive: TypeScript errors if any reason lacks a message here."
- Id unions: `as const` array → `(typeof arr)[number]` → hand-written `isValidX` guard.
- **`any` is banned, tests included.** `unknown` plus narrowing instead, via a named exported guard
  returning `value is T`.
- `import type` as a separate statement (225 uses vs 5 inline `{ type X }`; inline only when mixing
  values and types from one module).
- Explicit return types on **exported server functions, factories, route handlers, and hooks returning a
  wide or nullable object**. Inference elsewhere.
- Generics only where they remove a cast that would otherwise be unsafe. Reusable packages, not app code.
- `null` means explicitly absent; `undefined` means not provided.
- Derived over duplicated: `ReturnType<typeof factory>`, `Awaited<ReturnType<…>>`, for internal glue.
  Anything crossing a module boundary gets a hand-written contract interface instead.
- `@ts-expect-error` with an inline reason (5 uses). `@ts-ignore` never (0).
- **Factory function plus a separate exported contract `interface`, instead of a class.**
  `createMaintenanceService` with the interface JSDoc'd method by method. Classes only for typed errors,
  or where a framework requires one.
- **Single destructured object parameter past one argument**, and always once an argument is optional.
- `??` over `||` for defaults (61 to 4). `lodash` named imports only, never the default import.

## Control flow

- **Declarative by default.** 51 `.map`, 17 `.filter`, 1 `.reduce`, and **zero** index-based `for` loops
  across 17.6k added lines. An imperative loop is a performance escape hatch, or a way to attribute a
  failure to its item; say which in a comment.
- **Braces on everything**, including single-line guard returns.
- Ternary in expression position is fine, including as the whole body of a predicate. Nested ternaries in
  JSX are not; use the guard-return stack.
- Extract a block into a named function when it is reused, or when the name replaces the comment you were
  about to write. His refactors go both ways: `findFirstUnmetRequirement` was extracted at 17 lines with
  one caller, and a hook that only wrapped a one-line expression was deleted and inlined at three sites.

## Errors and async

- `async`/`await` throughout (749 vs 19 `.then(`). `.then()` is fine for a point-free chain onto an
  existing function (`client.fetch(endpoint).then(setData)`), a typed transform, or a lazy `import()`.
- **`catch (error)`** — always that identifier, never `e` or `err` (27 to 0).
- Error normalisation through **named helpers**, never inline juggling: `toMessage = (error: unknown): string`,
  `getFormattedError` unwrapping nested error shapes → `string` → `'Unknown error'`.
- Custom errors: `<Domain><Condition>Error` extending a status-carrying base, with a `DEFAULT_MESSAGE`
  const and `this.name` set. This is the one place a class beats a factory.
- Typed domain errors are thrown inside a single request path; the route layer maps them to status codes.
- **An operation that fans out over many targets collects failures and returns a partial-success summary
  rather than throwing.** Thread a `failures: Failure[]` array through helpers, push `{ target, error }`,
  surface `partialFailures` to the UI.
- **Fail-open vs fail-closed is an explicit, commented decision, case by case.** No blanket rule.
  "unknown persisted state → enabled, so activity is not permanently blocked". "while paused, unreadable
  settings → report false, fail closed so the UI does not sync stale enabled=true toggles".
- Not-found is translated, not propagated: `isNotFoundError(error) → undefined`, `{ ignore: [404] }`.
- Abort signals on long-running or user-cancellable requests, not on every call.
- **UI loading and error is a three-state contract with a pessimistic default.** `blocksActivity = isLoading || isError || isBlocked`,
  so controls stay disabled while status is unknown. Dedicated error callout with a Retry button, not a toast.
- `Promise.all` for independent I/O. Sequential `for…of` when order matters or failures must be attributed
  per item, with a comment saying which.

## Server layering

The reference shape is Kibana's `fields_metadata` plugin:

```
routes/<domain>/         thin; validates, calls the service, maps errors to status codes
services/<domain>/
  <domain>_service.ts    factory + exported contract interface
  <domain>_client.ts     transport
  <domain>_service.mock.ts
  errors.ts  types.ts  repositories/
```

A service earns its own module when it holds state or exposes three or more operations. Below that,
export a plain function (`assertSignificantEventsAccess`, `resolveStreamNames`).

**Validation at the boundary.** Zod, with every string and array explicitly bounded and every field
described. The bounds are a learned correction: CodeQL flagged four unbounded arrays on one PR, and
bounds appear on every schema since.

```ts
query: z.object({ name: z.string().max(MAX_ID_LENGTH).describe('The name of the stream.') })
```

## Testing

- Jest plus `@testing-library/react`. `renderHook`/`act` for hooks, `render`/`screen` for components.
- Colocated `<name>.test.ts(x)` beside the source. **Zero `__tests__/` directories.**
- `describe('<ExportedSymbol>')` at top level, nested `describe` per method or option group.
- **`it()` phrasing: declarative third person, no `should`.** "returns enabled when no state has been
  persisted", "throws a 409 error in a state that blocks activity". 252 `it()` calls, exactly one `should`.
- **Mocking splits by target.** Services and anything stateful get a hand-rolled fake that actually
  round-trips state: a saved-objects client that throws NotFound until `create`, a management API that
  tracks `enabled` so pause→resume works. JSDoc each option field. `jest.mock` is for module-mocking his
  own hooks in component tests, and nothing else.
- Fakes cast at the seam with `as unknown as T`.
- Shared fixtures as SCREAMING_SNAKE module constants: `const REQUEST = {} as Request`.
- Full variable names in tests too. The 37 `const rc = …` / `const sc = …` in one PR are a lapse, not a style.
- **Test behaviour and edge cases, not the happy path.** Idempotency, retry after partial failure, missing
  plugin, out-of-band re-enable, inverted date range, the exact debounce boundary at 299ms then +1ms.
- **1 snapshot assertion in everything he authored.** Assert concrete values and `expect.objectContaining`.
- Async via `await expect(fn()).rejects.toBeInstanceOf(X)` / `.rejects.toMatchObject({ statusCode: 409 })`.
- **Negative assertions to pin the contract:** `expect(service.getStatus).not.toHaveBeenCalled()` proves
  the guard took the cheap read.
- **Open.** `user-event` has zero uses, but so does `fireEvent`; too few interaction tests to call it a
  preference. No rule either way. Same for form libraries: none appear in any repo.

## Comments

Density is ~3.7% of authored lines (221 JSDoc blocks, 517 line comments in ~20k lines). Deliberate.

- **JSDoc on every exported symbol**, including per-method docs inside contract interfaces, with
  `@param`/`@returns` where non-obvious.
- **Comments explain WHY, the invariant, or the failure mode.** Never what the line does.
- **Long procedures: extract each phase into a named function**, then call them in order from the
  orchestrator with `// 1.` `// 2.` step comments matching a numbered list in its JSDoc.
- **Name the legacy reason and the removal condition:** "Legacy alias from an earlier tab name; keep until
  bookmarks are gone."
- When documenting a non-obvious pattern, list the alternatives and why each fails.

## Structure and naming

- Files and folders `snake_case`, hooks included.
- **Feature folders, never layer folders.** Top-level `components/`, `hooks/`, `util/` only for genuinely
  cross-feature code.
- `folder_name/index.tsx` only when the folder holds a lone component and nothing else. Once tests, hooks,
  or utils join it, the component gets its own named file.
- **No barrels in app code.** Import from the defining file. A barrel is a published package's public entry
  point, nothing else. He actively prunes them: one PR is titled "Prune dead package barrel exports".
- Types **colocated with the module that owns them**; shared types move to the closest common ancestor.
  No global `types/` directory, and no catch-all `src/types.ts`.
- Relative imports within a feature, alias or package-absolute across features and packages.
- Circular dependencies are banned.
- Naming is long and unabbreviated: `reassertPausedWorkflows`, `shouldRestoreSettingsBackedWorkflow`,
  `newlyDisabledRuleIds`. Booleans always `is`/`has`/`can`/`should`-prefixed.
- Verb ledger: `assert*` throws, `is*`/`has*` returns a boolean, `get*` is cheap and sync, `fetch*` hits
  the network, `resolve*` is multi-step, `create*`/`make*` is a factory. Props take `onX`, internal
  handlers take `handleX`.
- Module constants `SCREAMING_SNAKE`, **unit-suffixed**, numeric separators:
  `MAINTENANCE_STATUS_REFETCH_INTERVAL_MS = 30_000`, `ONE_DAY_MS`.
- i18n messages hoisted to SCREAMING_SNAKE consts when reused. `FormattedMessage` only when the message
  contains JSX.

## Commits

Conventional prefixes on working commits, and the distribution is real: `refactor:` 97, `fix:` 60,
`feat:` 14, `test:` 6, `chore:` 6. **He lands cleanup separately from features**, and addresses review
feedback in a dedicated `refactor: address PR comments` commit rather than amending.

**His refactors delete.** `refactor: remove extra unused computations`, `refactor: drop try/finally`, and
one that removed an entire hook because it only wrapped a one-line expression, inlining it at three call
sites. When proposing a refactor, prefer deletion over abstraction.

---
name: marco-code-style
description: Marco's observed TypeScript and React conventions, extracted from 748 authored commits. Invoke before writing or reviewing substantial TS/TSX, when scaffolding a new module, when writing tests, or when a reviewer disagrees with a style choice. Covers components, hooks, types, errors, async, testing, comments, and folder layout with evidence from real code.
---

# Marco's code style

Observed conventions, not aspirations. Every rule below came from reading 748 commits Marco authored, cross-checked by author-frequency per file.

**Precedence.** Project conventions win when they conflict with this file. Read the neighbouring files first. Where project documentation states a rule Marco's own code contradicts, follow the surrounding file, and follow this file for new modules he owns.

## Components

```tsx
// Default form.
export function SignificantEventsPage({ tab, onTabChange }: SignificantEventsPageProps) {
  // ...
}

// Arrow-const only for a one-expression wrapper.
export const AppHeader = (props: AppHeaderProps) => <PageHeader {...props} />;
```

- Props destructured **in the signature**, never in the body.
- Inline object type under ~4 props: `{ reason }: { reason: NotEnabledReason }`. Named `interface XProps` at 4+ props or when the type is reused or exported.
- **Named exports only.** `export default` only where a framework requires it.
- No `React.FC`. No `memo`, no `forwardRef` without a measured reason.
- **Guard stack of early returns, then one JSX return.** Loading spinner, unavailable prompt, redirect, then the real tree. `return null` is normal.
- Conditional rendering is `{cond && (<>…</>)}`.
- **Compound components via static properties on the function**: `PageTemplate.Body = …`, `PageTemplate.Header = …`.

**Context.** `export function XProvider({ context, children })` → `useMemo` the value → a separate `useX()` that **throws when the provider is missing**.

## Hooks

- One hook per file. Filename is the hook name in `snake_case`: `use_time_range.ts`.
- **Derived state computed in render, never in an effect.** `const canManageStreams = streams?.manage === true`.
- Effects are for external systems only: breadcrumbs, timefilter sync, debounce timers. Say why in a comment.
- `useLayoutEffect` for pre-paint redirects, **always with a comment naming the warning it avoids**.
- `useMemo` justified by **referential stability**, and the comment says so: "without it every render produces new absolute values, which turns them into unstable effect/query dependencies."
- Return types annotated only when the hook returns a wide object or a nullable union. Otherwise inferred.
- **Data fetching**: module-level `as const` query key, `queryFn: ({ signal }: QueryFunctionContext) => client.fetch(endpoint, { signal: signal ?? null })`. Mutations toast in `onSuccess`/`onError` and invalidate the shared key in `onSettled`.
- Private inner hook plus exported component when a wrapper has logic: `useDateRangeRedirect` → `DateRangeRedirect`.

**Open question, currently mixed.** Hook declaration form is genuinely split in his code: 15 `export function useX()` vs ~21 `export const useX = () =>`, both in files committed the same day. Match the neighbouring files. Same for children typing: `React.PropsWithChildren<Props>` and `{ children: React.ReactNode }` both appear.

## Types

- `interface` for object shapes (82 uses), `type` for unions, mapped, and derived types (55).
- **Zero enums, ever.** String-literal unions, `as const` arrays, `Record<Union, T>` lookup tables.
- **Exhaustiveness via `Record<Union, T>`, with a comment saying that's the point:** "Keying by reason makes this exhaustive: TypeScript errors if any reason lacks a message here."
- Id unions: `as const` array → `(typeof arr)[number]` → hand-written `isValidX` guard.
- `satisfies` for literals checked against a union: `id: 'events' satisfies SignificantEventsLinkId`.
- **`any` is banned.** Zero `: any` annotations in his code. `unknown` plus narrowing instead, via a named exported guard returning `value is T`.
- `import type` is the default (225 uses vs 5 inline `{ type X }`; inline only when mixing values and types from one module).
- Explicit return types on **exported server functions, factories, and route handlers**. Inference for components and hooks.
- Derived over duplicated: `ReturnType<typeof factory>`, `Awaited<ReturnType<…>>`.
- `@ts-expect-error` with an inline reason (5 uses). `@ts-ignore` never (0).
- **Factory function plus a separate exported contract `interface`, instead of a class.** `createMaintenanceService` with the interface JSDoc'd method by method. Classes only where a framework requires one.
- Single destructured object parameter past ~2 arguments (65 signatures open with `({`).
- `??` over `||` for defaults (61 to 4). `lodash` named imports only, never the default import.

## Errors and async

- `async`/`await` throughout (749 vs 19 `.then(`). `.then()` only for a typed transform on a client call or a lazy `import()`.
- **`catch (error)`** — always that identifier, never `e` or `err` (27 to 0).
- Error normalisation through **named helpers**, never inline juggling: `toMessage = (error: unknown): string`, `getFormattedError` unwrapping nested error shapes → `string` → `'Unknown error'`.
- Custom errors: `<Domain><Condition>Error` extending a status-carrying base, with a `DEFAULT_MESSAGE` const and `this.name` set.
- **Server code collects failures and returns a partial-success summary rather than throwing.** Thread a `failures: Failure[]` array through helpers, push `{ target, error }`, surface `partialFailures` to the UI.
- **Fail-open vs fail-closed is an explicit, commented decision.** "unknown persisted state → enabled, so activity is not permanently blocked". "while paused, unreadable settings → report false, fail closed so the UI does not sync stale enabled=true toggles".
- Not-found is translated, not propagated: `isNotFoundError(error) → undefined`, `{ ignore: [404] }` on transport calls.
- Cancellation threaded everywhere: `useAbortController` in forms, `signal: signal ?? null` in query fns, `signal: null` for fire-and-forget.
- **UI loading and error is a three-state contract with a pessimistic default.** `blocksActivity = isLoading || isError || isBlocked`, so controls stay disabled while status is unknown. Dedicated error callout with a Retry button, not a toast.
- `Promise.all` for independent I/O. Sequential `for…of` when order matters or failures must be attributed per item.

## Testing

- Jest plus `@testing-library/react`. `renderHook`/`act` for hooks, `render`/`screen` for components.
- **No `user-event` anywhere in his tests** (0 hits). No enzyme.
- Colocated `<name>.test.ts(x)` beside the source. **Zero `__tests__/` directories.**
- `describe('<ExportedSymbol>')` at top level, nested `describe` per method or option group. `describe('#setup()')` for class methods.
- **`it()` phrasing: declarative third person, no `should`.** "returns enabled when no state has been persisted", "throws a 409 error in a state that blocks activity". The 50 `should`-prefixed cases are all older code; use the no-`should` form for anything new.
- **Mocking is hand-rolled stateful factories, not `jest.mock`** (2 vs 66 `jest.fn`). Build a `Map`-backed fake that actually round-trips state: a saved-objects client that throws NotFound until `create`, a management API that tracks `enabled` so pause→resume works. JSDoc each option field.
- Fakes cast at the seam with `as unknown as T`.
- Shared fixtures as SCREAMING_SNAKE module constants: `const REQUEST = {} as Request`.
- **Test behaviour and edge cases, not the happy path.** Idempotency, retry after partial failure, missing plugin, out-of-band re-enable, inverted date range, the exact debounce boundary at 299ms then +1ms.
- **1 snapshot assertion in everything he authored.** Assert concrete values and `expect.objectContaining` instead.
- Async via `await expect(fn()).rejects.toBeInstanceOf(X)` / `.rejects.toMatchObject({ statusCode: 409 })` / `.resolves.toBe(…)`.
- **Negative assertions to pin the contract:** `expect(service.getStatus).not.toHaveBeenCalled()` proves the guard took the cheap read.

## Comments

Density is ~3.7% of authored lines (221 JSDoc blocks, 517 line comments in ~20k lines). Deliberate.

- **JSDoc on every exported symbol**, including per-method docs inside contract interfaces, with `@param`/`@returns` where non-obvious.
- **Comments explain WHY, the invariant, or the failure mode.** Never what the line does.
- **Numbered step comments in long procedures** (`// 1.`, `// 2.`), matching a numbered list in the function's JSDoc.
- **Name the legacy reason and the removal condition:** "Legacy alias from an earlier tab name; keep until bookmarks are gone."
- When documenting a non-obvious pattern, list the alternatives and why each fails.

## Structure and naming

- Files and folders `snake_case`.
- Single-component folder → `folder_name/index.tsx`. Multi-component folder → one named file per component. Both conventions coexist; match the neighbours.
- Types **colocated with the module that owns them**. No global `types/` directory. **He actively prunes barrels.**
- Naming is long and unabbreviated: `reassertPausedWorkflows`, `shouldRestoreSettingsBackedWorkflow`, `newlyDisabledRuleIds`. Booleans always `is`/`has`/`can`/`should`-prefixed.
- Module constants `SCREAMING_SNAKE`, **unit-suffixed**, numeric separators: `MAINTENANCE_STATUS_REFETCH_INTERVAL_MS = 30_000`, `ONE_DAY_MS`.
- i18n messages hoisted to SCREAMING_SNAKE consts when reused. `FormattedMessage` only when the message contains JSX.

## Commits

Conventional prefixes on working commits, and the distribution is real: `refactor:` 97, `fix:` 60, `feat:` 14, `test:` 6, `chore:` 6. **He lands cleanup separately from features.**

**His refactors delete.** `refactor: remove extra unused computations`, `refactor: drop try/finally`, and one that removed an entire hook because it only wrapped a one-line expression, inlining it at three call sites. When proposing a refactor, prefer deletion over abstraction.

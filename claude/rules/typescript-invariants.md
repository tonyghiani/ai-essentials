---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mts"
  - "**/*.cts"
---

# TypeScript and React invariants

Marco's conventions, extracted from his authored code and confirmed by a style interview. They apply to all TS/TSX you write. **Project conventions win**: read the neighbouring files first, and apply these where a project has no convention of its own. For depth (layering, mocking, folder scaffolds, comment style) invoke the `marco-code-style` skill. The full rule files are in `~/.claude/guidance/`.

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

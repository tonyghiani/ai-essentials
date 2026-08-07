---
name: react-patterns
description: Effect, dependency, and ref discipline for React. Invoke before writing or reviewing any useEffect, useLayoutEffect, useRef, or DOM access, and when a component has state that could be derived instead. Catches the failure modes that cause stale UI, double-fetch, and render loops.
---

# React patterns

The rule underneath all of this: **an effect synchronises React with something outside React.** If nothing outside React is involved, you don't need an effect.

## Before you write an effect, try these

**Derived data → compute in render.**
```tsx
// Not this
const [visible, setVisible] = useState([]);
useEffect(() => setVisible(filter(todos, query)), [todos, query]);

// This
const visible = filterTodos(todos, query);
```
Reach for `useMemo` only when the calculation is measurably expensive *and* its deps are stable. Justify it by referential stability, and say so in the comment when that's the reason.

**Resetting state on prop change → `key`.**
```tsx
<Profile key={userId} userId={userId} />
```

**"Adjusting" state → hold an id, recompute the object.**
```tsx
const selection = items.find((item) => item.id === selectedId) ?? null;
```

**Event-specific logic → the event handler.** If it should run because the user did something, it belongs in the handler. Never toggle state and react to it in an effect. Shared logic across handlers becomes a plain function, not an effect.

**No effect chains.** An effect whose only job is to set state that triggers another effect is a bug. Compute the whole next state in the initiating handler.

## When an effect is correct

Websockets, subscriptions, browser APIs and event listeners, non-React widgets, imperative DOM APIs driven by props or state, and data fetching where no framework-level API exists.

Structure: set up in the body, return a cleanup that fully undoes it.

- **Cleanup is mandatory** for subscriptions (`removeEventListener`), async work (`AbortController`, or an `ignore` flag), and external instances (`disconnect`/`destroy`).
- **setup → cleanup → setup again must be safe and idempotent.** Strict Mode double-mounts in dev; that's a test, not a nuisance. Never gate an effect with a ref flag to dodge it.
- Effects run after commit. Never rely on one to produce a value needed for the current render.
- `useLayoutEffect` only for pre-paint work such as a redirect, and **comment which warning or flash it prevents**.

## Dependencies

Include every reactive value the effect reads: props, state, and anything defined in the component body. Treat the lint warning as an error and fix the code, not the array. Never disable `eslint-plugin-react-hooks`.

Safe to omit: `useState` setters, and the ref object from `useRef` (not `ref.current`).

To shrink a dependency list: hoist static values to module scope, create objects inside the effect and depend on primitives, use functional updates (`setValue((prev) => next(prev, input))`), and split an effect that does two unrelated things into two effects.

Never use `useEffectOnce`, `useMount`, or similar wrappers that hide dependencies from the linter.

**`useEffectEvent` where available.** For a callback that needs the latest props or state but must not re-trigger the effect. Put setup and teardown in `useEffect`, pass the effect event as the subscription callback. Don't pass effect events as props or call them outside an effect.

## Data fetching

Prefer framework or library APIs (React Query, RSC, framework loaders) over hand-rolled effect fetches.

If you must use an effect: wrap it in a named custom hook, handle races with an `ignore` flag or `AbortController`, and refetch only when a real parameter changes.

Thread cancellation all the way through. Queries take the signal; fire-and-forget passes `null` explicitly so the intent is visible.

**Three-state contract with a pessimistic default.** Expose `isLoading`, `isError`, and the value; derive gating from all three so controls stay disabled while status is unknown:
```tsx
const blocksActivity = isLoading || isError || isBlocked;
```
Render a dedicated error state with a retry affordance, not just a toast.

## Refs and DOM

Use **state** when the value affects render. Use a **ref** when it doesn't: timers, external instances, previous values, DOM nodes.

```tsx
const inputRef = useRef<HTMLInputElement | null>(null);
// read or mutate inputRef.current only in handlers or effects
```

- Don't read or write `ref.current` during render. The one exception is idempotent lazy init: `if (!ref.current) ref.current = create();`
- Ref changes never trigger a re-render. Don't build UI that assumes they do.
- Valid DOM uses: focus, scroll, measuring layout, integrating imperative libraries.
- **Never call `useRef` in a loop, map, or condition.** For collections use one `useRef<Map<Key, HTMLElement | null>>(new Map())` with a ref callback that sets on mount and deletes on unmount.
- Safe on React-owned nodes: focus, scroll, reading layout, adding and removing listeners. Unsafe: removing, reparenting, or deeply mutating them. Mount third-party DOM code into a container React treats as a black box, an always-empty div, and confine mutations there.
- Keep refs internal to a component or hook. Expose them only when the API genuinely requires it.

## Review checklist

1. Every `useEffect`: what external system does this synchronise? If none, delete it.
2. Every piece of state: could this be derived in render?
3. Every effect: does cleanup fully undo setup, and is setup idempotent?
4. Every dependency array: does it match what the body reads, with no suppression?
5. Every async effect: is a stale response possible?
6. Every `ref.current` access: is it in a handler or effect, never render?

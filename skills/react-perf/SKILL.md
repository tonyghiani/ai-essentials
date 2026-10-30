---
name: react-perf
description: Audit React render performance from the code, prioritised by measured or measurable impact. Invoke when the user reports a slow or janky UI, asks about re-renders, mentions memo/useMemo/useCallback, or asks for a perf review of a component tree. Refuses to recommend memoisation without a reason.
context: fork
agent: Explore
background: false
---

# React render perf audit

## Target

What the caller passed: $ARGUMENTS

This runs as a separate read-only agent that has not seen the conversation, so the target above and the repository are all it has. When the target is empty, audit the current branch's change: the files in `git diff --name-only --merge-base origin/HEAD` (or against the base the caller named), read in full. Report findings; never edit.

Most React perf advice is cargo cult. This skill only reports things with a plausible mechanism and a way to confirm.

## Order of operations

Do not skip to memoisation. Work down this list; the earlier items are where real wins live.

**1. Are you rendering too much data?** A 5,000-row table with no virtualisation dwarfs every other cause. Look for unbounded `.map()` over server data, missing pagination, and lists without windowing.

**2. Is the work in the wrong place?** Expensive computation in a component body that runs on every parent render, when it could be computed once at the data layer, on the server, or in the query's `select`.

**3. Is state too high in the tree?** State in a common ancestor forces siblings to re-render. Moving it down, or splitting a context, removes the render instead of memoising it. Prefer this over `memo`.

**4. Is a context value unstable?** A provider whose value is a fresh object every render re-renders every consumer, and `memo` on consumers won't help. `useMemo` the value; that's referential stability, a real reason.

**5. Are effects causing extra render passes?** State set in an effect means render → commit → set → render again. `react-patterns` covers this; derived-in-render removes the second pass entirely.

**6. Only now: memoisation.** And only with an answer to "what re-render does this prevent, and why does that render cost enough to matter?"

## Reporting rules

For each finding, give:

- `file:line`
- The mechanism: what triggers the render, what re-renders as a result
- Estimated impact: how many components, how often
- The fix, in the house style
- **How to confirm** it: React DevTools Profiler flame chart, `<Profiler>` `onRender` timings, or a Performance panel recording

If you can't name the mechanism, don't report it. "This could be memoised" is not a finding.

Severity:
- **Critical**: unbounded render work, or a render loop
- **Important**: an unstable context or provider value, state too high causing wide re-renders
- **Minor**: a genuinely expensive computation that could be memoised

## Things that are not findings

- `useCallback` on a handler passed to a DOM element. React doesn't care.
- `memo` on a component whose props change every render anyway.
- `useMemo` on a cheap expression. The hook costs more than the arithmetic.
- Inline object or arrow props on a non-memoised child. No effect.
- Anything where the fix is more code than the render costs.

Say so explicitly if the component tree looks fine. "No render-perf findings; the slowness is likely elsewhere. Profile before changing anything" is a valid, useful result.

## If nothing in the code explains it

Say that, and point at the likelier causes: network waterfalls, an unindexed query, a slow API, bundle parse time on first paint, layout thrash from synchronous `getBoundingClientRect` in a loop. Recommend a Performance recording before touching component code. Never invent a React cause to have something to report.

## When the tech lead invokes this

Invoked for components that render large lists, run on every keystroke, or sit high in a tree, when the change touches them. Report findings with a measured or measurable cause; recommend no memoisation without one.

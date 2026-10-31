---
name: api-contract-review
description: Review an HTTP route, plugin contract, or exported package API for compatibility, validation, and evolvability before it ships. Invoke when adding or changing a route, a plugin setup/start contract, a saved object schema, or a package public export, and when the user asks whether a change is breaking.
context: fork
agent: auditor
background: false
---

# API contract review

## Target

What the caller passed: $ARGUMENTS

This runs as a separate read-only agent that has not seen the conversation, so the target above and the repository are all it has. When the target is empty, audit the current branch's change: the files in `git diff --name-only --merge-base origin/HEAD` (or against the base the caller named), read in full. Report findings; never edit.

A contract is the part you can't take back. Review it before it merges, not after someone depends on it.

## What counts as a contract

HTTP routes, plugin `setup`/`start` return values, exported package symbols, persisted schemas and their migrations, persisted config, URL and locator state, and any type another team imports.

## Checklist

### Breaking change analysis

Walk each change and classify it:

- **Safe**: adding an optional field, adding a new route, widening an accepted input, narrowing a returned union to fewer cases *only if* no consumer switches on the removed case.
- **Breaking**: removing or renaming a field, making an optional field required, narrowing accepted input, widening a returned union, changing a status code, changing a default that alters behaviour.

For each breaking change, find the consumers. Grep for the symbol, the route path, the persisted type. Report the call sites you found and say plainly if you could not establish the full set.

### Input validation

Every request input needs a schema, and **every string, array, and object needs a bound**. Unbounded input is a denial-of-service vector.

```ts
schema.string({ maxLength: 1_000 })
schema.arrayOf(itemSchema, { maxSize: 100 })
z.string().max(1_000)
z.array(item).max(100)
```

Flag: unbounded `schema.string()` / `z.string()`, unbounded arrays, `schema.any()`, recursive schemas without a depth limit, and numbers without a range where a range is meaningful.

Also check: is validation at the boundary, or does raw input reach a query builder? Are ids validated before interpolation?

### Response shape

- Is the success shape stable, or does it leak internal structure that will change?
- Are errors typed and consistent? A route that returns a bare string on one path and a Boom object on another has no contract.
- Does it expose data the caller shouldn't see? Internal ids, stack traces, other tenants' fields.
- Partial success: if the operation can half-fail, does the response say which parts failed? Prefer a `partialFailures` array over throwing on the first error.

### Evolvability

- Can a field be added later without a breaking change? Prefer objects over positional tuples, named unions over booleans.
- Is the surface minimal? Every exported symbol is a future obligation. Don't export what callers don't need.
- Is the abstraction at the caller's level, or does it expose implementation? A route that accepts an internal data structure forces callers to know about an implementation detail that may change.
- Versioning: does the framework's route versioning apply, and is it set?

### Persistence and migration

- Can existing stored data be read after this change without a migration?
- If a migration exists: can it fail partway, and what state does that leave?
- Rolling deploys mean old and new code run at once. Is the change compatible in both directions for one release?
- Is there a point of no return, an irreversible transformation? Say so loudly.

### Auth and limits

- Is the route's authorisation explicit, and does it match the capability the UI checks?
- Rate limiting or a size cap on anything expensive?
- Does an error message reveal whether a resource exists to a caller who shouldn't know?

## Output

```markdown
## Contract review: <route or symbol>

### Breaking changes
- `file:line` — <what breaks, which consumers found, migration path>

### Validation gaps
- `file:line` — <unbounded input, missing schema, suggested bound>

### Evolvability
- `file:line` — <what will be hard to change later, and the alternative>

### Verdict
Safe to ship | Ship with a migration | Breaking, needs a version bump or deprecation window
```

Cite every finding with `file:line`. If the change is clean, say so and name the consumers you checked, so the reader knows the claim's scope.

## When the tech lead invokes this

Invoked when the diff adds or changes a route, plugin contract, persisted-schema or exported package API. Changing a contract is an always-ask class (the always-ask classes): report the compatibility risk and let the tech lead ask the user.

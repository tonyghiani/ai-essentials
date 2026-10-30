---
name: branch-refactor-planner
description: Critically review all code changes on the current branch against the base branch, identify improvement opportunities across naming, structure, DRY/KISS/YAGNI, declarative style, self-documenting code, edge cases, testing, and general best practices, then produce a categorized refactoring plan with prioritized action items. Produces a plan, not a bug review. Use when the user asks for a "refactor plan", a "code quality review", or to "clean up this branch".
---

# Branch Refactor Planner

Systematically review every file changed on the current branch, apply the
quality checklist below, and produce a prioritized refactoring plan.

## Investigation workflow

1. **Determine base branch**
   - `git merge-base HEAD main` (fall back to `master` or the branch the user specifies).
2. **Gather the changeset**
   - `git diff --name-only <base>...HEAD` for the file list.
   - `git diff <base>...HEAD` for the full diff.
3. **Read changed files in full** -- not just diff hunks. Surrounding context
   reveals duplication, naming drift, and missing edge-case handling that hunks alone hide.
4. **Cross-reference related files** -- look for shared patterns, duplicated
   logic across the changeset, and opportunities to extract helpers or reuse
   existing project utilities.
5. **Consult project rules** -- if the repo contains `AGENTS.md`, `CLAUDE.md`,
   a rules directory, or other project-level agent instructions, incorporate
   them into the review.
6. **Produce the plan** using the output format below.

## Quality dimensions

Walk through every dimension for each changed file:

| Dimension | What to look for |
|---|---|
| **Naming** | Variables, functions, types, and files convey intent and follow project conventions |
| **Helper utils** | Hand-rolled logic replaceable by standard library, lodash, or project-shared code |
| **Declarative style** | Imperative loops/mutation replaceable by map/filter/reduce, config objects, or declarative patterns |
| **Self-documenting code** | Code reads clearly without comments; flag redundant comments and missing non-obvious ones |
| **Edge cases** | Null/undefined, empty collections, boundary values, error paths |
| **Testing** | Tests are meaningful and non-redundant; flag no-op assertions, duplicate coverage, and missing coverage |
| **DRY** | Duplicated logic across or within files |
| **KISS** | Over-engineered abstractions, unnecessary indirection |
| **YAGNI** | Code, config, or types added speculatively without current need |
| **Control flow** | Early returns, positive conditions, flat nesting |
| **Type safety** | `any`/`unknown` usage, non-null assertions, missing return types |
| **Error handling** | Explicit and typed; no swallowed errors |
| **Consistency** | Patterns within the changeset are internally consistent |

## Output format

```markdown
## Summary
<1-2 sentences on overall quality and recurring themes>

## Action items

### Critical (correctness / bugs)
- [ ] `file:line` [dimension] -- concrete suggestion

### Important (maintainability / readability)
- [ ] `file:line` [dimension] -- concrete suggestion

### Minor (style / polish)
- [ ] `file:line` [dimension] -- concrete suggestion

## Files reviewed
- `path/to/file.ts` -- one-line verdict
```

Rules for action items:
- Cite file path and line range.
- Tag with the quality dimension in brackets.
- Give a concrete suggestion, not a vague observation
  (e.g. "rename `proc` to `processDocument`", not "improve naming").
- If a test should be removed or rewritten, explain why it provides no value.

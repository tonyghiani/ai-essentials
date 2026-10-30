# Decision policy (format)

The real file is `policy/decisions.local.md`, which is gitignored because precedents can name private
projects. Copy this file there to start. `scripts/work/decisions.mjs` reads and updates it; edit by hand
only to correct a mistake.

A precedent is applied automatically only when all of these hold:

1. `confirmations` is 2 or more.
2. `contradicted` is `no`.
3. Its `class` is not one of the always-ask classes (`ai-decisions classes`).
4. `scope` is `global` or equals the current repo key.

`record` is optional: the ADR a `brainstorm` session wrote for the decision (`ai-decisions add --record <path>`).
Read it before applying the precedent when the situation is not an exact match.

The plan gate (the breakdown the tech lead shows before fan-out) turns off per class after 5
consecutive approved breakdowns with no edits. The counters live in the `## Gate` table at the end.

## Precedents

### D-001 Test file placement
- class: `layout`
- situation: A new module needs a test file.
- decision: Colocate `<name>.test.ts` beside the source; no `__tests__` directory.
- why: Matches the existing convention in `rules/testing-style.mdc`.
- scope: global
- confirmations: 3
- last-confirmed: 2026-10-01
- contradicted: no

### D-002 Retry helper reuse
- class: `reuse`
- situation: The task needs retry with backoff.
- decision: Reuse the repo's existing retry helper instead of adding a dependency.
- why: A new dependency is an always-ask class; the helper already covers the case.
- scope: github.com/example/project
- confirmations: 2
- last-confirmed: 2026-10-12
- contradicted: no
- record: ~/brainstorms/2026-10-12-retry-strategy/adr.md

## Gate

| class | consecutive-approved-unedited | gate |
|---|---|---|
| layout | 0 | on |
| reuse | 0 | on |

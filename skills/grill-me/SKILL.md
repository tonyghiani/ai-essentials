---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree before any code is written. Use when the user says "grill me", "roast me", "ask me until we agree 100%", "stress-test this plan", "interview me", "ask me clarifying questions", "iterative process", or any time the user invites questioning before producing output. Also use proactively when a non-trivial design or plan task is starting and significant ambiguity is visible.
---

# Grill Me

Interview the user relentlessly about every aspect of this plan until
you reach a shared understanding. Walk down each branch of the design
tree resolving dependencies between decisions one by one.

## How to ask

Use numbered questions so the user can reply concisely (1, 2, 3 → matching
numbered answers). Map replies by index: `1.` in the user's reply answers
your question 1. Do not ask which answer goes with which question.

Accept short answers as complete: "Out of scope", "b", "keep it", "same as
before". Missing numbers mean skip / no change.

If a question can be answered by exploring the codebase, explore the codebase
instead. Don't make the user answer something the code already knows.

For each question, provide your **recommended answer** so they can say "yes"
or push back instead of starting from a blank.

## When to stop

You stop grilling when:

- The user says "OK, build it" / "go" / "start" / anything that signals the discussion is done.
- The decision tree's open branches are all small enough to be handled inline during build.
- The user explicitly drops a question ("out of scope", "skip", "default is fine").

Do not stop just because the user is short with you — that's the format, not a complaint. Keep grilling unless they tell you to switch modes.

## Writing a spec

When the tech-lead skill invokes you, or the user asks for a spec, finish by writing `SPEC.md` instead of ending with a summary. Resolve the directory with `ai-work spec-dir`; never write the spec into the repo being changed.

```markdown
# Spec: <title>

## Goal
<one or two sentences: the outcome, not the method>

## Requirements
- R1 <observable behaviour, one sentence>

## Edge cases
- E1 <input or state> -> <expected behaviour>

## Out of scope
- <what a reasonable reader might assume is included but is not>

## Tasks
### T1 <name>
- areas: <files or directories it may touch>
- accept: <checks a command or a test can prove; no "works well">
- depends-on: <task ids or none>

## Decisions
- <decision> (source: user | rule | precedent D-nnn)
```

Every requirement maps to at least one task criterion. List only edge cases that can realistically happen and break. An edge case or requirement gets a test only if it passes the test-value rule (behaviour worth protecting, cheapest level); otherwise say what already covers it, or that nothing needs to. Questions a rule or a precedent already answers are decided, not asked; list them under Decisions with their source.

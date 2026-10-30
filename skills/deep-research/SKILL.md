---
name: deep-research
description: Builds expert understanding of a topic, codebase, or architecture before producing any output. Reads a primary source folder (docs/specs), validates against secondary source folders (code), produces a structured report, and asks clarifying questions when something is unclear. Use when the user says "become the expert", "deep dive into", "research the architecture", "understand this codebase", "load context from" or "explore in depth before doing anything", and when the tech-lead skill meets an unfamiliar area.
---

# Deep Research

Become an expert on a topic before producing any output. Research first, report second, then ask conceptual questions before acting.

## Inputs

The user provides one or both of:

- **A topic** (what to become expert on)
- **One or more `@folder` mentions**: primary docs/specs, and optionally secondary code folders for validation

If the user gives only a topic, ask which folders are the source of truth before reading anything.

## Workflow

### Step 1 — Triage, then load primary sources

Start with a lightweight pass before full reads:

1. List all files in the primary folder(s).
2. Read first: `README`, `ARCHITECTURE.md`, `AGENTS.md`, index files, and any
   doc the user pointed at explicitly.
3. Identify entry points, public exports, and the docs that define the system's
   vocabulary.
4. Skip or deprioritize: generated code, vendored deps, build output, and
   snapshot fixtures unless the user asked about them.

Then read remaining primary files end-to-end. Don't grep or sample for files
you've committed to reading.

If the folder is large (> 30 files or > 100k tokens estimated), tell the user and ask whether to:
- Read all of it (slower, more accurate)
- Read a triaged subset (you propose the list after Step 1 triage, user confirms)

### Step 2 — Validate against secondary sources

If the user provided code folders for validation, cross-check claims in the docs against the actual implementation. Surface any discrepancies you find — outdated docs are common and worth flagging.

### Step 3 — Produce a structured report

Use this exact template:

```markdown
# [Topic] — architecture report

## What it is
[1-2 sentences. The elevator pitch in your own words.]

## The pieces
- **[Component A]** — what it does, where it lives (`path/to/it`)
- **[Component B]** — ...

## How they fit together
[Walk the happy path. Use a flow:
  Input → Component A (does X) → Component B (does Y) → Output]

## Key concepts and terminology
- **[Term]**: [precise definition as used in this codebase, not the generic one]
- ...

## What I'm unsure about
[Numbered list of conceptual questions where the docs were ambiguous or
contradicted the code. Each question is specific and answerable.]

## What looks outdated
[Specific doc paragraphs or code comments that don't match current behavior.
Include file:line references.]
```

### Step 4 — Ask conceptual questions

Present the questions from "What I'm unsure about" using a structured
multiple-choice prompt if your tool supports one; otherwise ask conversationally.
**Do not produce downstream output (code, slides, docs, PRs) until the user
has answered the conceptual questions.**

Phrase questions to be answerable in a numbered reply. The user will likely reply with a numbered list matching your numbering — accept short answers ("Out of scope", "Same as current", "b") as complete.

### Step 5 — Stay open for iteration

Once the user confirms the report is accurate, hold the expertise. They will likely follow up with a task like "now restructure the slides" or "now plan the migration" — your job is to keep the research loaded and apply it.

## What this skill is NOT

- Not a quick lookup — if the user wants a one-shot answer, this is overkill
- Not a code review — see `review-team` or `review-pr` for that
- Not a planning skill — see `grill-me` for plan stress-testing

## Tone

- Confident, not hedging. You're the expert now.
- Plain language. Don't hide behind jargon you don't fully own.
- Specific over generic. Names, paths, function signatures — not "the relevant module".
- Honest about what you couldn't confirm.

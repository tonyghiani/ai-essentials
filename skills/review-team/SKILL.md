---
name: review-team
description: >-
  Runs a panel of three to six read-only reviewers in parallel, each with a
  distinct perspective, has a skeptic try to disprove every serious finding,
  and consolidates what survives into one prioritized report. Use when the user says "review team", "multi-perspective review" or
  "multi-angle review" of branch changes, a module or a plan, and when the
  tech-lead skill meets a large or risky diff.
---

# Review Team

Launch the selected reviewers in parallel, each with a distinct perspective,
verify their Critical and Important findings against the code, then
consolidate what survives into a single prioritized report.

## Reviewers

| Name | Runs | Source | Model |
|---|---|---|---|
| Adversarial | always | `reviewers/adversarial.md` | strongest available (the session model) |
| Fresh Eyes | always | `reviewers/fresh-eyes.md` | standard tier (`sonnet` in Claude Code) |
| Conventions | always, on code | the `convention-checker` agent | its own (`haiku`) |
| Architecture | the diff crosses a module or package boundary, changes a public API, a persisted schema or cross-package imports | `reviewers/architecture.md` | standard tier |
| Product Flow | the diff changes user-visible behaviour | `reviewers/product-flow.md` | standard tier |
| Observability Expert | the diff touches logging, metrics, tracing, telemetry, or ES\|QL and Elasticsearch queries | `reviewers/observability-expert.md` | standard tier |

So three reviewers at least, six at most. Say which conditional reviewers you
skipped and why. When the review runs inside a delivery that has a spec, the
`reviewer` agent replaces Adversarial: it covers correctness and also checks
the change against the spec.

There is no Code Quality persona: style is the convention checker's job, and a
refactoring plan is the `branch-refactor-planner` skill's, run on its own when
the user wants one.

Paths are relative to **this skill's own directory**, wherever the tool
installed it. If a read fails, `ls` the skill directory rather than guessing.

## When to use, and when not to

Each reviewer is a full agent run, and verification (Step 3b) adds one cheaper run per file with Critical or Important findings, capped at 10 findings. Use this skill when the user asks for it, or when the tech-lead skill finds a large or risky change: roughly 400 or more changed lines, or a change in an always-ask class. For the inner loop of a delivery use the `reviewer` and `convention-checker` agents alone; they are cheaper and read-only.

## Mode detection

- **Branch review** (default): user says "review team", "review my changes", "comprehensive review"
- **Scoped review**: user provides a target path or project name, e.g. "review team the billing module", "review team src/api/http"
- **Plan review**: user says "review team plan", "review this plan", or attaches a plan document

When the user provides a scope, use **scoped review**. When no scope is given
and no plan is attached, fall back to **branch review**.

## Workflow

### Step 0 -- Check for previous runs

Before gathering context, check if a **Review Team Report** was already
produced earlier in this conversation.

If a previous report exists:

1. Extract **all findings** from the previous report (file paths, line ranges,
   severity, description).
2. Store them as `PREVIOUS_FINDINGS` -- you will pass this to every reviewer.
3. In your message to the user, briefly note: "Re-running review team.
   Previous findings will be compared against current state."

If no previous report exists, set `PREVIOUS_FINDINGS` to empty / null and
proceed normally.

### Step 1 -- Gather context

**Branch review mode (default -- no scope provided):**

1. **Sync the default branch from the canonical remote** -- from the repo root,
   identify the remote that tracks the original repository (`origin` in a
   direct clone; `upstream` when `origin` is a fork). Fetch its default branch,
   e.g. `git fetch upstream main` or `git fetch origin main` (use `master` if
   that is the default branch name). The goal is that `<remote>/main` (or
   `<remote>/master`) matches the latest state on GitHub before you diff.
2. **Optional local `main`** -- if a local branch named `main` (or `master`)
   should mirror that remote, fast-forward it without checking it out:
   `git fetch <remote> main:main` (adjust remote and branch names). Skip if this
   would discard local commits you must keep.
3. `git merge-base HEAD <remote>/main` for `<base>` (fall back to
   `<remote>/master` or another default-branch ref as appropriate)
4. `git diff --name-only <base>...HEAD` for the file list
5. `git diff <base>...HEAD` for the full diff
6. If more than **30 changed files**, warn the user and ask whether to narrow
   scope (by path, package, or file list).
7. Write the diff to a patch file outside the repo, for example
   `git diff <base>...HEAD > "$(mktemp -d)/review.patch"`. Reviewers read it
   and the changed files themselves; you do not paste file contents into
   their prompts.

**Scoped review mode (user provided a target path or project):**

1. Resolve the scope to a concrete directory path. If the user gave a project
   name rather than a path, search for it (e.g. `find -name package.json` or
   glob for the package/plugin directory).
2. List all source files in the scope (`**/*.{ts,tsx,js,jsx}` or as
   appropriate for the project's language).
3. If the file count is large (> 50 files), ask the user to narrow the scope
   or confirm they want a full review. For very large scopes, focus on public
   API surface files, entry points, and recently modified files
   (`git log --since='2 weeks ago' --name-only -- <scope>`).
4. Write the in-scope file list to a file outside the repo.
5. There is no diff in this mode -- reviewers evaluate the code as-is, not
   relative to a base branch, reading the listed files themselves.

**Plan review mode:**

1. Read the plan document (attached file or user-provided path)
2. Identify files and areas the plan references
3. Read those files for context

### Step 1b -- Point each reviewer at its files

Every reviewer gets the repo root, the patch path (or the file list in scoped
mode) and the list of files to read first. They open files themselves, so the
brief stays small and each reviewer reads only what its focus needs:

| Reviewer | Read first |
|----------|------------|
| Adversarial | All changed source files |
| Fresh Eyes | Changed files and the patch only. **Never** give it PR descriptions, commit messages, plan documents, issue text, or any narrative you gathered |
| Conventions | The patch, plus the absolute paths of the rule files that match the changed file types (installed in `~/.claude/guidance/`, `~/.codex/guidance/` or `~/.cursor/rules/`) |
| Architecture | Changed files that define module boundaries, public APIs, persisted schemas, and cross-package imports |
| Product Flow | Changed UI components, routes, hooks managing user state, and server/API handlers that serve the UI |
| Observability Expert | Files touching queries, alerts, metrics, logging, telemetry, LLM prompts that generate observability queries, and threshold/aggregation logic |

### Step 2 -- Read the selected persona files

Read the persona file of each selected reviewer (not the convention checker,
which is an agent with its own instructions) in one parallel batch. You will
embed each verbatim in the matching reviewer prompt.

### Step 3 -- Launch the selected reviewers in parallel

Run them **concurrently** when your environment supports parallel workers
(subagents, task delegation, background agents). If it does not, run them
sequentially; consolidation in Step 4 is the same.

Send one prompt per reviewer, combining:

1. The persona instructions (from the file read in Step 2)
2. That reviewer's file pointers from Step 1b
3. `PREVIOUS_FINDINGS` from Step 0 (if any -- see block below)
4. The output format template (copy the block below verbatim)

Give the convention checker its usual brief (patch path and rule paths) and
map its violations into the Minor section unless a rule file marks one as
blocking.

For **Fresh Eyes**, add this line at the top of its prompt:

```
BLIND REVIEW: You have not seen the PR description, commit messages, or design
docs. Judge only from the code and diff below.
```

Each reviewer should operate in **read-only mode** when your tool supports it
(analyze and report; do not edit files).

#### Previous findings block (include only when PREVIOUS_FINDINGS is non-empty)

Paste this block **before** the output format in every reviewer's prompt:

```
PREVIOUS FINDINGS (from an earlier run in this session)
=======================================================
The following findings were reported in a previous review pass. Some may
have been fixed since then. For each previous finding:

- If the issue is FIXED in the current code, do NOT re-report it.
- If the issue PERSISTS unchanged, re-report it and prefix with "[PERSISTS]".
- If the issue changed but a related problem remains, report the new version
  and prefix with "[EVOLVED]".

Focus your effort on NEW findings not covered below.

<paste PREVIOUS_FINDINGS here>
```

#### Tool-specific parallel execution (optional)

When your tool exposes delegated workers, prefer parallel launch with
read-only constraints. Examples:

- **Claude Code**: one message with one Agent call per reviewer. The
  convention checker is the `convention-checker` agent type. For personas, use
  a general-purpose agent, set `model` from the table above, and state the
  no-write constraint in the prompt.
- **Cursor**: one message with one Task call per reviewer; set `readonly: true`.
- **Codex / similar**: parallel worker sessions with a read-only sandbox.

If none of the above applies, run the prompts sequentially in this chat.

#### Output format to include in every reviewer prompt

Paste this block at the end of every reviewer's prompt:

```
REQUIRED OUTPUT FORMAT
======================
Return your findings in EXACTLY this structure. Every finding must cite a
file path and line number or range. Keep each finding to 1-2 sentences.

## [Your Reviewer Name] Findings

### Critical (must address)
- `file/path.ts:42` -- What is wrong and what to do instead.

### Important (should address)
- `file/path.ts:15-20` -- What is wrong and what to do instead.

### Minor (consider)
- `file/path.ts:99` -- What is wrong and what to do instead.

If a severity section has no findings, write "None."
Do NOT include findings outside your designated focus area.

If PREVIOUS FINDINGS were provided, prefix each re-reported finding with
[PERSISTS] or [EVOLVED]. New findings have no prefix.
```

### Step 3b -- Verify Critical and Important findings

Reviewers asked to find problems report some that are wrong: a guard they
missed, a caller that never passes the bad input. Before anything reaches the
report, the `skeptic` agent tries to disprove each Critical and Important
finding against the code. Minor findings skip this step.

1. Collect every Critical and Important finding. The `reviewer` agent's
   `[blocks]` counts as Critical and `[gap]` as Important. Merge findings that
   cite the same location, so one defect is verified once.
2. A `[PERSISTS]` finding that was CONFIRMED in the previous run keeps that
   verdict and is not sent again.
3. **Cap: at most 10 findings verified per review.** Pick Critical before
   Important, then findings raised by more than one reviewer. The rest go into
   the report labelled `[unverified]`.
4. Group the selected findings by file and launch one `skeptic` run per file,
   in parallel. Each brief carries the repo root, the patch path (and the spec
   path when the review runs inside a delivery), and that file's findings
   pasted verbatim with severity, location and claim. Give it nothing else:
   not the reviewer's reasoning, not the PR description.
5. Read each verdict:
   - **CONFIRMED**: keep the finding. If the skeptic corrected the line or the
     severity, use its version.
   - **REFUTED**: drop the finding from the report and the action plan.
   - **UNSURE**: keep it, labelled `[UNSURE]`, with the skeptic's one-line
     reason.

In plan review mode, verify only findings that make a claim about existing
code; a finding about the plan itself has nothing to check against.

In Claude Code, `skeptic` is an agent type. Elsewhere, run it the way Step 3
runs reviewers, read-only.

### Step 4 -- Consolidate

After every selected reviewer returns and Step 3b has verified its findings:

1. Group findings by file path, then by line number / range.
2. When two or more reviewers flag the same location, merge into one item
   and tag it with every reviewer name that raised it.
3. Use the highest severity among the merged reviewers
   (Critical > Important > Minor).
4. Carry forward the `[PERSISTS]` / `[EVOLVED]` prefixes from reviewers.
   New findings (no prefix) stay as-is.
5. Keep any domain-specific observations that don't overlap (e.g. from the
   Observability Expert) in a dedicated "Reviewer-Specific Notes" section.
6. If `PREVIOUS_FINDINGS` was non-empty, add a **Resolved** section listing
   previous findings that **no reviewer re-reported** -- these are presumed
   fixed.

Present the final report as:

```markdown
# Review Team Report

Verification: 8 checked, 5 confirmed, 2 refuted (dropped), 1 unsure; 3 unverified (over the cap).

<!-- include Resolved section only on re-runs -->
## Resolved (fixed since last run)
- ~~`file:line` [Reviewer1] -- previous finding that is now fixed~~

## Critical
- `file:line` [Reviewer1, Reviewer2] -- merged finding
- `file:line` [PERSISTS] [Reviewer1] -- finding from previous run, still present

## Important
- `file:line` [Reviewer1] -- finding
- `file:line` [EVOLVED] [Reviewer1] -- related to previous finding, changed form
- `file:line` [UNSURE] [Reviewer2] -- finding (skeptic: depends on runtime config it could not read)
- `file:line` [unverified] [Reviewer3] -- finding past the verification cap

## Minor
- `file:line` [Reviewer1] -- finding

## Reviewer-Specific Notes

### Observability Expert
- domain-specific observations

### Architecture
- system-level observations
```

### Step 5 -- Generate plan

For all findings marked as **Critical** or **Important** in the consolidated report, generate a prioritized action plan. The plan should:

1. List each action item as a checklist bullet `- [ ]` with a brief, actionable description.
2. Reference the file and line(s) to fix, and summarize the core issue.
3. For merged findings, indicate all relevant reviewers.
4. Order first by severity (**Critical** before **Important**), then by file path, then by line number.
5. If there are no **Critical** or **Important** findings, state:  
   `No blocking findings. Minor feedback may be addressed at your discretion.`

Example:

```markdown
## Action Plan

- [ ] `file/path.ts:42` (**Critical**, flagged by Reviewer1, Reviewer2): Replace unsafe method with secure alternative to prevent possible crash.
- [ ] `other/file.js:10-12` (**Important** [PERSISTS], flagged by Reviewer3): Refactor duplicated code into a shared helper function.
```

`[UNSURE]` and `[unverified]` labels carry through to the action plan too, so
the user knows which items to check before acting.

On re-runs, `[PERSISTS]` / `[EVOLVED]` tags carry through to the action plan so
the user can see which items are new versus still outstanding from a prior pass.
Omit resolved items from the action plan (they appear in the Resolved section
of the report instead).

If there are relevant reviewer-supplied remediation suggestions or links, include them, but avoid speculative advice outside reviewer focus.

---

If ALL sections are empty, report: "No findings -- all reviewers passed."

## Gotchas

- Fresh Eyes is only useful blind: one sentence of the PR description in its prompt and it reviews the intent instead of the code.
- Pasting file contents into every reviewer prompt multiplies the cost by the panel size; pass paths and let reviewers read what their focus needs.
- The skeptic is capped at 10 findings per run. When more serious findings come back, the panel was asked too broad a question; narrow the scope rather than raising the cap.

---
name: review-team
description: >-
  Launch a team of 6 specialized code reviewers in parallel to catch issues
  from multiple perspectives. Use when the user says "review team",
  "comprehensive review", "multi-perspective review", or wants a thorough
  multi-angle review of branch changes or a plan.
---

# Review Team

Launch 6 specialized reviewers in parallel, each with a distinct perspective,
then consolidate findings into a single prioritized report.

## Reviewers

| # | Name                  | Persona source                                  |
|---|-----------------------|-------------------------------------------------|
| 1 | Code Quality          | `../branch-refactor-planner/SKILL.md`           |
| 2 | Adversarial           | `reviewers/adversarial.md`                      |
| 3 | Architecture          | `reviewers/architecture.md`                     |
| 4 | Fresh Eyes            | `reviewers/fresh-eyes.md`                       |
| 5 | Product Flow          | `reviewers/product-flow.md`                     |
| 6 | Observability Expert  | `reviewers/observability-expert.md`             |

Paths are relative to **this skill's own directory**. When installed for Claude
Code that is `~/.claude/skills/review-team/`, so `reviewers/adversarial.md`
resolves to `~/.claude/skills/review-team/reviewers/adversarial.md`. If a read
fails, `ls` the skill directory rather than guessing.

## Mode detection

- **Branch review** (default): user says "review team", "review my changes", "comprehensive review"
- **Scoped review**: user provides a target path or project name, e.g. "review team the streams plugin", "review team src/core/packages/http"
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
   scope (by path, package, or file list) before reading everything in full.
7. Read every changed file in full -- not just diff hunks (after scope is confirmed)

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
4. Read every in-scope file in full.
5. There is no diff in this mode -- reviewers evaluate the code as-is, not
   relative to a base branch.

**Plan review mode:**

1. Read the plan document (attached file or user-provided path)
2. Identify files and areas the plan references
3. Read those files for context

Store the gathered context as `REVIEW_CONTEXT`. Then build **per-reviewer
context bundles** (Step 1b) before launching workers.

### Step 1b -- Build per-reviewer context bundles

Do not paste the full `REVIEW_CONTEXT` into every worker. Filter by reviewer:

| Reviewer | Context bundle |
|----------|----------------|
| Code Quality | Full diff + all changed source files |
| Adversarial | Full diff + all changed source files |
| Architecture | File list + diff + changed files that define module boundaries, public APIs, persisted schemas, and cross-package imports |
| Fresh Eyes | **Code only:** changed file contents + diff hunks. **Exclude:** PR descriptions, commit messages, plan documents, issue text, and any narrative the orchestrator gathered |
| Product Flow | Changed UI components, routes, hooks managing user state, and server/API handlers that serve the UI |
| Observability Expert | Files touching queries, alerts, metrics, logging, telemetry, LLM prompts that generate observability queries, and threshold/aggregation logic |

If a reviewer has no matching files in the changeset, give them the diff summary
and file list only — they should report "None." for all severity sections unless
the diff itself reveals issues in their domain.

When total context would exceed practical limits (roughly > 40 files or very
large files), summarize non-critical files as path + one-line purpose for
Architecture and Observability; keep full content for Code Quality and
Adversarial on the highest-risk files the user confirmed.

### Step 2 -- Read all persona files

Read **all 6 persona files listed in the table above** in a single parallel
batch. Store each file's content -- you will embed it verbatim in the matching
reviewer prompt.

### Step 3 -- Launch 6 reviewers in parallel

Run all 6 reviewers **concurrently** when your environment supports parallel
workers (subagents, task delegation, background agents). If parallel execution
is not available, run them sequentially; consolidation in Step 4 is the same.

Send one prompt per reviewer, combining:

1. The persona instructions (from the file read in Step 2)
2. That reviewer's **context bundle** from Step 1b (not the full `REVIEW_CONTEXT`)
3. `PREVIOUS_FINDINGS` from Step 0 (if any -- see block below)
4. The output format template (copy the block below verbatim)

For **Fresh Eyes**, add this line at the top of the context bundle:

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

- **Cursor**: one message with 6 Task calls; set `readonly: true` and a
  general-purpose subagent type; inherit the session model unless told otherwise.
- **Claude Code / Codex / similar**: spawn parallel subagent or worker sessions
  with the same prompt bundle and a no-write constraint.

If none of the above applies, run the six prompts sequentially in this chat.

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

### Step 4 -- Consolidate

After all 6 reviewers return:

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

<!-- include Resolved section only on re-runs -->
## Resolved (fixed since last run)
- ~~`file:line` [Reviewer1] -- previous finding that is now fixed~~

## Critical
- `file:line` [Reviewer1, Reviewer2] -- merged finding
- `file:line` [PERSISTS] [Reviewer1] -- finding from previous run, still present

## Important
- `file:line` [Reviewer1] -- finding
- `file:line` [EVOLVED] [Reviewer1] -- related to previous finding, changed form

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

On re-runs, `[PERSISTS]` / `[EVOLVED]` tags carry through to the action plan so
the user can see which items are new versus still outstanding from a prior pass.
Omit resolved items from the action plan (they appear in the Resolved section
of the report instead).

If there are relevant reviewer-supplied remediation suggestions or links, include them, but avoid speculative advice outside reviewer focus.

---

If ALL sections are empty, report: "No findings -- all reviewers passed."

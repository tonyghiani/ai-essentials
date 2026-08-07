---
name: review-pr
voice-profile: marco
description: Review a GitHub pull request by URL using the review-team skill. Outputs copy-pasteable conventional comments with line references and code suggestions. Uses a personal voice profile by default — swap skills/shared/pr-review-voice-marco.md for your own. Use when the user shares a PR URL, asks to review a PR, or mentions "review pr".
---

# Review PR

Fetch a GitHub PR, check out its branch, run the review-team skill, and
transform the report into copy-pasteable conventional comments.

## Path resolution

Paths below are relative to this skill's directory (`~/.claude/skills/review-pr/`
for a Claude Code install).

## Inputs

The user provides a GitHub PR URL (e.g. `https://github.com/org/repo/pull/123`).
Extract `OWNER/REPO` and `PR_NUMBER` from the URL.

## Workflow

### Step 1 — Fetch PR and check out the branch

Before checkout, verify git state:

```bash
git status --porcelain
```

If the working tree is dirty, warn the user and ask whether to proceed, stash,
or use `git worktree add` for an isolated checkout.

```bash
gh pr view $PR_NUMBER --repo $OWNER/$REPO --json title,body,baseRefName,headRefName,files,additions,deletions,author
gh pr checkout $PR_NUMBER --repo $OWNER/$REPO --detach
```

Record the previous branch/ref (`git rev-parse --abbrev-ref HEAD` before
checkout if needed) so you can tell the user how to return.

If the PR has more than 50 changed files, warn the user and ask whether to
proceed or narrow the scope.

### Step 2 — Run the review-team skill

Read and follow `../review-team/SKILL.md` using **branch review mode**.
The checked-out PR branch is the HEAD; the base branch from `PR_META` is the
comparison target.

The review-team skill handles gathering context, reading reviewer personas,
launching 6 parallel reviewers, and consolidating findings into a report.

### Step 3 — Transform report into conventional comments

Take the Review Team Report from Step 2 and convert each finding into a
comment ready to copy-paste onto the GitHub PR.

#### Severity → conventional comment label mapping

| Report severity | Conventional label              |
|-----------------|---------------------------------|
| Critical        | `issue (blocking):`             |
| Important       | `suggestion:`                   |
| Minor           | `nitpick (non-blocking):`       |
| Praise (from Reviewer-Specific Notes or inline) | `praise:` |

Use other labels when they fit better:
- `question:` when the finding is uncertain
- `thought (non-blocking):` for ideas worth considering
- `todo:` for small mechanical fixes
- `polish (non-blocking):` for quality-of-life improvements

#### Voice

Read and follow `../shared/pr-review-voice-marco.md` for tone and phrasing.
Replace with your own voice profile file if this repo is forked.

#### Code snippets

Where there's a clear improvement, include a plain code snippet showing how
you'd write it. These aren't GitHub suggestion blocks — they're illustrative
snippets the author can adapt, since the same pattern may apply in multiple
places. Keep them short (1-10 lines).

### Step 4 — Present output

#### When the PR looks good

If the Review Team Report has no Critical or Important findings and Minor
findings are few (≤ 2):

```
This PR looks solid across all review perspectives (code quality,
correctness, architecture, readability, product flow, observability).
Nothing blocking — ship it 🚀
```

Optionally include 1-2 praise comments worth leaving on the PR.

#### When there are findings

Present each comment as a self-contained markdown block the user can
copy-paste directly onto the PR. Group by file, ordered by line number.
Each comment is wrapped in its own fenced code block (` ```markdown `)
so the user can copy the raw markdown in one shot.

Example:

````
📄 **file/path.ts** (line 42) — [Code Quality, Adversarial]

```markdown
suggestion: I honestly think we can simplify this a bit.

The nested ternary here is doing too much work in one expression.
Breaking it out makes the intent way more obvious:

const status = isActive
  ? StatusType.Active
  : StatusType.Inactive;
```
````

Format rules for each comment:
- A header line outside the block: `📄 **file**` (line N) — [Reviewers]
- A fenced block containing the full comment to copy:
  - Conventional comment label + subject (first line)
  - Discussion paragraph (optional, for context/reasoning)
  - Code snippet (optional, plain code indented or in its own block)
- The user copies only the content inside the fenced block

#### End with a summary line

```
**Summary**: X comments (Y blocking, Z suggestions, W nitpicks, V praise)
```

## Edge cases

- **PR too large (> 50 files):** ask the user to confirm or narrow scope.
- **Auth failure:** tell the user to run `gh auth login`.
- **PR already merged:** still review — user may want post-merge feedback.
- **Dirty working tree:** do not checkout without explicit user consent.

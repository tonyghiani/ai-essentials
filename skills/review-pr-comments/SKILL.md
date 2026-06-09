---
name: review-pr-comments
voice-profile: marco
description: Triage PR review comments — decide whether to accept or push back on each one. Given comment links from a GitHub PR, fetches comment content and PR diff, then reasons about each comment in context. Uses a personal voice profile for suggested replies — swap skills/shared/pr-review-voice-marco.md for your own. Use when the user shares PR comment links, asks "should I accept this feedback", or wants help responding to PR review comments.
---

# Review PR Comments

Analyze review comments on a GitHub PR and recommend whether to **accept**
or **push back** on each one, with reasoning grounded in the actual diff.

## Path resolution

Resolve `skills/...` paths per [README — Path resolution](../../README.md#path-resolution).

## Inputs

The user provides:
1. One or more GitHub PR comment links (e.g. `https://github.com/org/repo/pull/123#discussion_r456`)
2. Optionally, the PR URL itself

Extract `OWNER/REPO`, `PR_NUMBER`, and any comment/discussion IDs from the links.

## Workflow

### Step 1 — Fetch PR metadata and diff

```bash
gh pr view $PR_NUMBER --repo $OWNER/$REPO --json title,body,baseRefName,headRefName,files,additions,deletions
gh pr diff $PR_NUMBER --repo $OWNER/$REPO
```

### Step 2 — Fetch the review comments

```bash
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments
```

From the full list, filter to the comments the user linked. If the user
provided only a PR URL with no specific comment links, fetch all pending
review comments and analyze every one.

For each comment, extract:
- `body` (the reviewer's text)
- `path` and `line`/`original_line` (file location)
- `diff_hunk` (surrounding diff context)
- `user.login` (who wrote it)
- `in_reply_to_id` (thread context — fetch parent if present)

### Step 3 — Gather deeper context (if needed)

If the diff hunk alone is insufficient to reason about a comment:

1. Read the full file at the relevant lines (±30 lines around the comment).
2. Check git blame or history for context on why the code was written that way.
3. **Last resort only:** if the comment spans multiple files, touches
   architecture, or cannot be judged from local context, read and follow
   `skills/review-pr/SKILL.md` on the same PR. Do **not** escalate for
   single-line style nits or localized logic questions.

### Step 4 — Analyze each comment

For every comment, reason through:

1. **Is the reviewer correct?** Does the comment identify a real issue, or is
   it based on a misunderstanding of the code/context?
2. **Severity**: Is this blocking, a nice-to-have, or purely stylistic?
3. **Cost vs benefit**: How much effort to address vs how much it improves the
   code? Is the change mechanical or does it require rethinking the approach?
4. **Alternatives**: If the reviewer's suggestion isn't ideal, is there a
   better middle ground?

### Step 5 — Present verdicts

For each comment, output a verdict block:

```
### 💬 Comment by @reviewer — file/path.ts (line 42)

> [quoted reviewer comment, truncated if long]

**Verdict: ✅ Accept** | **Verdict: 🔙 Push back** | **Verdict: 🤝 Compromise**

[2-4 sentence reasoning explaining why, referencing the actual code]

**Suggested reply:**
> [Draft reply using skills/shared/pr-review-voice-marco.md — or your own voice profile.]
```

### Verdict guidelines

| Verdict | When to use |
|---------|-------------|
| ✅ Accept | The comment is correct, improves the code, and the fix is reasonable |
| 🔙 Push back | The comment is incorrect, based on a misunderstanding, or the cost outweighs the benefit |
| 🤝 Compromise | The reviewer has a point but the suggested fix isn't ideal — propose an alternative |

Lean toward accepting when:
- The reviewer caught a genuine bug or edge case
- The suggestion measurably improves readability or maintainability
- The fix is mechanical / low-effort

Lean toward pushing back when:
- The comment misreads the intent or context of the code
- The suggestion would introduce unnecessary complexity
- It's a pure style preference with no clear winner
- The reviewer is asking for a change outside the PR's scope

### Voice for suggested replies

Read and follow `skills/shared/pr-review-voice-marco.md`.

### End with a summary

```
**Summary**: X comments analyzed — Y accept, Z push back, W compromise
```

## Edge cases

- **Comment links from multiple PRs:** process each PR separately.
- **Deleted or outdated comments:** note them as stale and skip.
- **Comment threads:** read the full thread before rendering a verdict.
- **No comment links given, just a PR URL:** fetch all pending review
  comments and analyze them all.

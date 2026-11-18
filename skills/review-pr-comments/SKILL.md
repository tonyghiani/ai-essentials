---
name: review-pr-comments
voice-profile: marco
description: Triage PR review comments, then act on the verdicts without waiting. Given comment links from a GitHub PR, decides accept or push back on each, implements the accepted ones, verifies, commits and pushes, posts the replies and resolves the threads it addressed. Uses a personal voice profile for replies; swap the voice profile in the shared folder for your own. Use when the user shares PR comment links, asks "should I accept this feedback", or wants to respond to PR review comments.
---

# Review PR Comments

Analyze review comments on a GitHub PR, decide whether to **accept** or
**push back** on each one with reasoning grounded in the actual diff, then
carry the verdicts through: implement, verify, commit, push, reply, resolve.
The user does not need to ask for the second half; triage alone is not done.

## Path resolution

Paths below are relative to this skill's directory.

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
- `html_url` (the comment's link, for recording a lesson)

### Step 3 — Gather deeper context (if needed)

If the diff hunk alone is insufficient to reason about a comment:

1. Read the full file at the relevant lines (±30 lines around the comment).
2. Check git blame or history for context on why the code was written that way.
3. **Last resort only:** if the comment spans multiple files, touches
   architecture, or cannot be judged from local context, read and follow
   `../review-pr/SKILL.md` on the same PR. Do **not** escalate for
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

**Reply (posted after the fixes land):**
> [Reply using ../shared/pr-review-voice-marco.md — or your own voice profile.]
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

Read and follow `../shared/pr-review-voice-marco.md`.

### Summary line

```
**Summary**: X comments analyzed — Y accept, Z push back, W compromise
```

Print the verdicts and this line, then go straight to the next section. Do not stop to ask for approval.

## Act on the verdicts

Runs right after triage, in the same turn. The comments sit on the user's own PR, so the commits and replies go out under their own `gh` login and git identity, with no tool credit anywhere (the no-tool-credit rule applies to commit messages and reply text).

Stop and ask instead of acting only when one of these holds:

- The PR's head branch is not checked out locally and no worktree for it can be made without touching the user's uncommitted work.
- The working tree has uncommitted changes unrelated to the PR.
- A verdict is Compromise and the middle ground is a design choice the reviewer or the user has to make, not a mechanical change.
- The head branch is a default branch, or the update would need a force push.

### A. Implement

Check out the PR's head branch (`gh pr checkout $PR_NUMBER`, or a worktree beside the repo). Implement every Accept and Compromise comment, smallest change that satisfies the reviewer. Follow the repo's conventions and the matching style rules. Do not widen scope beyond what the comments ask.

### B. Verify

Run the repo's verification contract scoped to the files you touched (`ai-verify`), plus the tests that cover them. A comment that turns out wrong once you are in the code is re-labelled Push back, not forced through. Show the command and the tail of its output.

### C. Commit and push

One commit per comment or per tight group of comments, plain messages, nothing amended or rebased. Push the PR branch by its own name, never forced. Remember each commit's short SHA for the replies.

### D. Reply

Post one reply per comment, in the voice from `../shared/pr-review-voice-marco.md`:

```bash
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/$COMMENT_ID/replies -f body="<reply>"
```

Reply to the root comment of a thread, not to a reply inside it. Accept and Compromise replies name the commit that fixed it. Push back replies state the reasoning and stop; they do not push the reviewer to agree.

### E. Resolve

Resolve the thread of every Accept and Compromise comment once its fix is pushed and its reply is posted. Leave Push back threads open: the reviewer decides whether the reasoning holds. Find the thread ids, then resolve:

```bash
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId}}}}}}}' -F o=$OWNER -F r=$REPO -F n=$PR_NUMBER
gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t=<thread id>
```

Match a thread to a comment by the first comment's `databaseId`. Skip threads already resolved.

### Final report

Per comment: verdict, commit SHA or "no change", reply posted, thread resolved or left open. Then the verification evidence and any lessons recorded.

## Record the lesson (the agent's own PRs)

A comment a reviewer had to write on a PR the agent opened is an automation failure: the setup should have caught it first. When the PR's head branch is one the agent created (`ai-work is-agent-branch <headRefName> --cwd <a local checkout of the PR's repo>` exits 0; it cannot tell from anywhere else, so without a checkout ask the user) and the user accepts a comment, as is or as a compromise, record what it teaches:

```bash
ai-work lesson --source pr-comment --route <route> --text "<one-sentence lesson>" --ref <comment html_url>
```

The text states the general rule, not the fix: "Validate route params with the shared schema, not inline checks", not "Fixed the check in handler.ts". Skip comments that teach nothing general, such as a typo in this PR. If `ai-work` is not found, say so and skip the recording; the triage still stands.

Pick the route by how the rule behaves:

| The lesson is | Route |
|---|---|
| A rule with zero exceptions that a linter can see in the code | `lint-rule` |
| A rule with zero exceptions about what the agent does (commands, files it touches) | `hook` |
| A convention that holds only for some paths or file types | `path-rule` |
| A procedure a skill keeps getting wrong | `skill-gotcha` |
| A preference with exceptions that applies everywhere | `claude-md` |
| A preference with exceptions tied to one project or area | `memory` |
| A failure class worth catching automatically next time | `eval` |

Record before replying, and say which lessons you recorded in the final report. `memory-distill` turns them into changes later; this skill only records.

## Edge cases

- **Comment links from multiple PRs:** process each PR separately.
- **Deleted or outdated comments:** note them as stale and skip.
- **Comment threads:** read the full thread before rendering a verdict.
- **No comment links given, just a PR URL:** fetch all pending review
  comments and analyze them all.
- **A comment already answered:** if the user's login replied after the reviewer's last comment in the thread, skip it.
- **`gh api` is not allowed in the session:** do the work up to the push, then print the replies and the resolve commands for the user to run, and say why.

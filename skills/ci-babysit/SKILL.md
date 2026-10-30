---
name: ci-babysit
description: One round of watching a draft PR the agent opened: read CI status, fix red checks on the agent's own branch, merge the base in when it conflicts, and report review comments as drafts for the user. Built to run under /loop. Never merges, never marks ready, never replies on the user's behalf. Use when the user says "babysit this PR", "watch CI", "fix the red build on my draft PR".
---

# CI babysit

One bounded round per invocation, so `/loop` can repeat it without runaway work. Each round reads state, makes at most a few fixes, and reports. It runs locally with the user's own `gh` login; never run it from a cloud routine or a GitHub App, because those act under their own identity.

## Commands

This skill calls `ai-work` and `ai-verify`. If a command is not found, tell the user the setup is not installed and stop; do not improvise a replacement.

## Scope limits

- Only branches this tool created: `ai-work is-agent-branch <branch>`. Anything else: report and stop.
- Never merge, never mark ready, never force push, never push to a default branch.
- Never post a comment or review. Review comments become drafts in your report.
- At most 3 fix attempts per round. At most 2 rounds on the same failure; then stop and report it.
- Same rule as everywhere: no tool credit in commits or text (the no-tool-credit rule).

## Round

### 1. Read state

```bash
gh pr view --json number,state,isDraft,headRefName,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision
gh pr checks
```

If the PR is closed or merged, say so and tell the user to stop the loop. If `headRefName` is not an agent branch, stop.

### 2. Red checks

For each failing check, read its log: `gh run view <run-id> --log-failed`. Reproduce locally with the verification contract (`ai-verify`) before changing anything. A failure that only happens in CI and cannot be reproduced locally: report it with the log excerpt and stop; do not guess.

Fix on the branch, verify locally, commit with a plain message, push normally. Keep the fix minimal and inside the PR's scope.

### 3. Conflicts with the base

If `mergeable` is `CONFLICTING`, follow `resolve-merge-conflicts`: merge the base into the branch (not rebase), resolve by intent, verify, push normally.

### 4. Review comments

```bash
gh pr view --comments
gh api repos/{owner}/{repo}/pulls/<number>/comments
```

Do not answer them. List each new comment with the file and line, your reading of the ask, whether you would accept it, and a drafted reply in the user's voice (`review-pr-comments` has the triage method). Offer to implement accepted ones when the user says so.

### 5. Report

One short block: PR state, checks (pass, fail, pending), what you fixed with the evidence, comments awaiting the user, and whether another round is needed. When all checks are green and nothing is pending, say so and suggest stopping the loop.

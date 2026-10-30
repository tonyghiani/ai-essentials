---
name: open-draft-pr
description: Push the agent's own branch and open a draft pull request attributed to the user alone, after auditing commits and body for tool credit and confirming checks pass. Never marks a PR ready and never merges. Use at the end of a delivery, or when the user says "open a draft PR", "push this as a draft".
---

# Open draft PR

The last step of a delivery. It does one thing: put the finished branch on the remote as a draft PR under the user's name. Everything else (describing, reviewing, deciding what leaves draft) is somebody else's job.

## Commands

This skill calls `ai-work`, `ai-verify`, `ai-pr-body` and `ai-audit`. If a command is not found, tell the user the setup is not installed and stop; do not improvise a replacement.

## Hard limits

- Draft only: `gh pr create --draft`. Never `gh pr ready`, never `gh pr merge`; a hook blocks both.
- Only a branch recorded as yours: `ai-work is-agent-branch`. If it is not, stop and ask.
- Never force push, never push to a default branch.
- No tool credit anywhere: not in commits, the title, the body, or a comment. The user's own `gh` login and git identity are the only identities.

## Steps

### 1. Preconditions

- Working tree is clean and everything is committed.
- The verification contract passes: `ai-verify`. Show the output.
- The PR body is built, not just written. Write the description with `pr-description-template` to `pr-description.md` in the spec directory (`ai-work spec-dir`), then build the body:

  ```bash
  ai-pr-body
  ```

  It appends the section `## Decisions made without you` from the run's `decisions-made.md` (or states that there were none) and writes `pr-body.md`. Never open the PR from the description alone: the guard refuses `gh pr create` from an agent branch whose body lacks that section.

### 2. Audit

```bash
ai-pr-body --check "$(ai-work spec-dir)/pr-body.md"
```

It must print `ok`. Then audit commits and body for tool credit:

```bash
ai-audit --body-file "$(ai-work spec-dir)/pr-body.md"
```

It must print `clean`. On a problem, do not push. Fix the PR body yourself. For a commit problem, tell the user which commit and why; rewriting commits is theirs to approve, even unpushed ones.

### 3. Push

```bash
git push -u origin <branch>
```

Use the remote the branch tracks if it has one, or `remote.pushDefault`. A rejected push means the remote moved or you lack access: report it. Do not retry with force.

### 4. Open the draft

```bash
gh pr create --draft --title "<concise title>" --body-file "<spec-dir>/pr-body.md"
```

Add `--base <branch>` only when the repo's default base is not the intended one. The title is plain: what the change does, no prefix naming a tool.

### 5. Report

Print the PR URL, the audit result, and the verification evidence. Say that the PR is a draft and that marking it ready is the user's decision.

## If something is blocked

A guard hook may refuse a command and print a reason. Fix the text or the command so it complies; do not look for another route to the same outcome.

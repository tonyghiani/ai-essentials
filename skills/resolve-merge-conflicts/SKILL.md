---
name: resolve-merge-conflicts
description: Resolve a conflicted merge (typically a long-lived epic or integration branch against its PR base), explain why each conflict exists, fix it by intent, verify scoped checks, then commit the merge and push. Use when a PR shows conflicts against its base, when the user says "fix the conflicts", "merge main into this branch", or "resolve merge conflicts".
---
# Resolve merge conflicts

Conflicts are two intents colliding, not two texts. Work out what each side was trying to do, then write the result that satisfies both.

## 1. Pin down the merge

- Run `git branch --show-current` and `gh pr view <n> --json baseRefName,headRefName`. "Conflicts against X" means merge the PR base into the current branch, not the other way round.
- Check `git rev-parse --abbrev-ref @{u}` and `git remote -v`. Forks are common: the tracking remote is where you push, and it may not be `origin`.
- `git fetch <remote> <base>`, then `git merge <remote>/<base>`. Merge, do not rebase, unless the user asks: epic branches carry merge history reviewers rely on.
- List what is left: `git status --short | grep -E '^(UU|AA|DU|UD|AU|UA|DD)'`.

## 2. Find the intent behind each conflict

For every conflicted file, answer two questions before editing:

1. What did our side change, and in which PR? `git log --oneline -3 HEAD -- <file>` and `git diff $(git merge-base HEAD <base>) HEAD -- <file>`.
2. What did the base change, and in which PR? Same commands against `<remote>/<base>`.

Then pick a strategy by shape:

| Shape | Resolution |
|-------|------------|
| Both sides edited the same lines | Take the structure of the side that restructured (usually the base), then re-apply the other side's semantic change on top. Typical case: base rewrites a block, we renamed a field inside it. |
| Modify/delete | The deleter's intent wins unless our change is the point of the branch. Delete the file, then grep for imports and identifiers it exported; carry our change into whatever replaced it. |
| Generated artifact (schemas, snapshots, lockfiles, `index.json` with hashes) | Do not hand-merge. Regenerate if the generator is runnable. If it needs a running stack, take the base's file, re-apply our semantic delta (diff both sides against the merge base with a small JSON flattener to isolate it), then recompute checksums. Confirm the checksum method by hashing the base's own file first. |
| Duplicate work (both sides fixed the same thing) | Keep the base's version; drop ours. |

Look past the conflict markers. Auto-merged files can still be wrong when the base introduced a new use of something we renamed (a new route schema field, a new type member). Grep the old name across the touched packages after resolving.

## 3. Resolve

- Edit with a script or `Edit`, not by guessing. For repeated marker shapes, a short Python regex that keeps one side is fine; read the result afterwards.
- `git rm` for accepted deletions.
- Never run `git stash`, `git checkout .`, or `git reset --hard` mid-merge. Stash drops `MERGE_HEAD` and the merge becomes a plain dirty tree. If it happens: `git stash pop --index`, then rebuild the commit with `git write-tree` and `git commit-tree -p HEAD -p <remote>/<base>`, followed by `git reset --soft <new-commit>`.

## 4. Verify, scoped to what the merge touched

Follow the global verification rule: no repo-wide checks.

- No markers left: `git diff --cached --name-only | xargs grep -ln '^<<<<<<<'`.
- Jest for the directories around each resolved file, using the project's own jest config.
- Type check for each affected project only (`node scripts/type_check --project <tsconfig>` in Kibana).
- Lint the resolved TS files.
- Run the tests of any package whose fixtures the merge touched. A failing test is not automatically ours: check whether it already failed on the pre-merge HEAD, and say so either way. Fixing a pre-existing break is fine when it is small and obvious; tell the user.

## 5. Commit and push

- Commit message: `Merge remote-tracking branch '<remote>/<base>' into <branch>`, then a short list of what was resolved and why. No AI attribution lines.
- Push to the tracking remote with a plain `git push <remote> <branch>`. A merge commit needs no force. If the push is rejected, fetch and merge again; never force-push an epic branch.

## 6. Report

Per conflicted file: one line on why it conflicted and how you resolved it. Then the checks you ran with results, anything you skipped and why, and the pushed commit hash.

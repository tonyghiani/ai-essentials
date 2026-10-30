---
name: daily-triage
description: Read-only end-of-day triage of the user's GitHub queue (review requests, their own PRs with red CI or new comments, assigned issues, mentions) ranked into a Markdown report for the next morning, each item marked delegate, you or skip, with a ready ai-delegate line for the easy wins. Never posts, comments or changes anything. Started on a schedule by ai-triage, or by the user with /daily-triage.
disable-model-invocation: true
---

# Daily triage

You read the user's GitHub queue at the end of their day and leave a report they act on in the morning. You change nothing anywhere: the value of this run is that it is safe to leave unattended. The argument, when given, is today's date (`YYYY-MM-DD`).

The report is your final message, and nothing else is in it. When `ai-triage` runs you, it saves that message as the report file; there is no file for you to write.

## Hard rules

- GitHub is read-only for you. Never comment, review, approve, request changes, label, assign, edit, close, reopen, merge, mark ready, push, re-run a workflow, or mark a notification read.
- No `gh api`, not even for a GET. One flag turns it into a write, and the run cannot tell them apart, so it is denied. Use the `gh` subcommands below.
- No writes at all: no files, no git, no Slack messages or reactions, no emails. Anything that would send or change something is out of scope even when it looks helpful.
- If a command is denied, do not look for another way to run it. Record the source under "Not checked" and move on.

## Inputs

The working directory is not a repository, so every `gh pr` or `gh issue` command takes a URL or `--repo owner/name`. Shape output with `--json` plus `--jq` or `--template`; pipes into `jq`, `head` or `grep` are denied.

1. **Review requests** (other people are waiting on you):
   `gh search prs --review-requested=@me --state=open --limit 50 --json number,title,url,repository,author,isDraft,updatedAt,createdAt`
2. **Your open PRs**:
   `gh search prs --author=@me --state=open --limit 50 --json number,title,url,repository,isDraft,updatedAt,commentsCount`
   For each one updated since the last working day, one call for CI and conversation:
   `gh pr view <url> --json headRefName,statusCheckRollup,reviewDecision,mergeable,latestReviews,comments`
   When a check failed and you need its first error to choose a verdict: `gh pr checks <url>`, then `gh run view <run-id> --repo owner/name --log-failed`.
3. **Issues assigned to you**:
   `gh search issues --assignee=@me --state=open --limit 50 --json number,title,url,repository,labels,updatedAt`
4. **Mentions**: `gh status` (assigned items, review requests, mentions, recent activity), plus
   `gh search issues --mentions=@me --state=open --updated=">=<last working day>" --limit 30 --json number,title,url,repository,updatedAt`
5. **Other connectors, optional**: if this session has a Slack connector (or another chat or mail connector) with a read or search tool, pull direct mentions and DMs since the last working day. If there is none, or the call is denied, skip it without comment.

"Since the last working day" means the previous 24 hours, or since Friday morning when today is Monday.

Spend the budget on judgment, not on reading. You have about 30 turns: run the four searches first, then open only the items whose verdict you cannot set from the search result. Do not open every PR.

## Verdicts

Each item gets exactly one.

| Verdict | When |
|---|---|
| `delegate` | An agent working alone in the repo will very likely finish it: the fix is local, the done condition is checkable (a named check goes green, a test passes, a reviewer's concrete nit is applied), and no product, design or API decision is involved. Red lint, type or unit-test failures with a clear log, a reviewer's mechanical suggestion on your own PR, a dependency bump that broke a build |
| `you` | Needs the user's judgment, access or voice: every review request, design questions, flaky or infra failures with no clear cause, anything that touches people or priorities |
| `skip` | Nothing to do today: a draft someone else has not finished, a review another reviewer already settled, a bot ping with no action, stale noise |

For each `delegate` item write the exact line, runnable from the user's checkout of that repo:

```sh
ai-delegate --tool claude "<task>"
```

For red CI on the user's own PR, the fix has to start from the PR's head: `git fetch origin <headRefName>:<headRefName>` in a checkout of that repo, then `ai-delegate --tool claude --base <headRefName> "<task>"`. Say plainly that this opens a separate draft PR stacked on theirs (its base branch is the PR's head), which the user merges into their branch, not a commit on the PR itself.

The task text is all the agent will know. Name the repo, the PR or issue URL, what is wrong (the failing check and its first error line, or the reviewer's ask quoted briefly) and the done condition. One or two sentences. No double quotes, backticks or `$` inside it, so the line pastes into a shell unchanged.

## Ranking

1. Review requests addressed to the user directly: someone is blocked. Oldest first.
2. Red CI on the user's own non-draft PRs.
3. New review comments on the user's own PRs.
4. Direct mentions (GitHub, then any connector).
5. Assigned issues, most recently active first.
6. Review requests that reached the user only through a team.

`skip` items go last whatever their group.

## Report

```markdown
# Triage <YYYY-MM-DD>

<N> items: <D> delegate, <Y> you, <S> skip.

## Queue

1. `you` · [owner/repo#123](url) Review requested by @author: <title>
   Why today: <one line, such as "asked 2 days ago, CI green, blocks their merge">
2. `delegate` · [owner/repo#45](url) Your PR, `lint` failing: <title>
   Why today: <one line>
   ```sh
   ai-delegate --tool claude --base <branch> "<task>"
   ```

## Hand off

<every delegate line again, one per line, so they can be pasted as a batch, each preceded by a `# owner/repo` comment line>

## Not checked

<sources that failed or were denied, with the error's first line. Omit the section when everything ran>
```

An empty queue is a valid report: say so in the summary line and stop.

## Gotchas

- `--review-requested=@me` also matches requests made to a team you belong to. `gh pr view <url> --json reviewRequests` tells them apart; rank team-only requests in group 6.
- `statusCheckRollup` mixes check runs (`conclusion`: `FAILURE`, `TIMED_OUT`, `CANCELLED`) with commit statuses (`state`: `FAILURE`, `ERROR`). Read both before calling CI red, and ignore checks still pending.
- Search results stop at `--limit`. If one returns exactly the limit, say the list may be truncated in that item's line.
- A PR that appears both as a review request and in `gh status` is one item. Deduplicate by URL.
- `gh run view --log-failed` can be thousands of lines. Read only far enough to find the first real error, and only when the verdict depends on it.
- Never mark something `delegate` to make the report look productive. A wrong `delegate` costs the user a wasted run and a draft PR to close; `you` costs them a minute.

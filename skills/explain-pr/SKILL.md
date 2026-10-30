---
name: explain-pr
description: Explains a branch or draft PR the agent produced (what changed and why, the riskiest part, what the tests prove and what they miss), then quizzes the user with three to five questions they would need to answer to defend it in review, and scores the answers. A comprehension gate before the user marks a PR ready. Started by the user with /explain-pr, optionally followed by a PR number, URL or branch.
effort: low
disable-model-invocation: true
---

# Explain PR

The user is about to put their name on code an agent wrote. This skill checks they understand it well enough to defend it in review, before they mark the PR ready. You explain, quiz, and score. You never mark the PR ready yourself.

## 1. Resolve the change

| Given | Read |
|---|---|
| A PR number or URL | `gh pr view <pr> --json number,url,title,body,baseRefName,headRefName,isDraft` and `gh pr diff <pr>` |
| A branch | `git diff <base>...<branch>`, with the base from `git merge-base` against the default branch |
| Nothing | The current branch: `ai-work diff` writes its patch and prints the path |

If a spec exists for the branch (`<spec-dir>/SPEC.md`, where `ai-work spec-dir` prints the directory), read it. Then read the changed files around each hunk and every test the change adds or edits.

## 2. Explain

Keep it under about 25 lines, every claim with a `file:line`:

- **What changed and why.** The behaviour before and after, and the reason from the spec or the PR body. Check the reason against the code; if they disagree, say so.
- **The riskiest part.** The one place most likely to break something, and for whom: a caller, stored data, a user flow.
- **What the tests prove, and what they don't.** Which behaviour each test would catch breaking, and which risky paths no test covers.

## 3. Quiz

Three to five questions, **one at a time**: wait for the answer before asking the next. Number them.

Each question targets something a reviewer could ask and the user must be able to answer: what happens on the riskiest path with an edge input, which callers see a change in behaviour, why a design choice beat the obvious alternative, what a given test would and would not catch, what to roll back if it breaks. Skip trivia such as names, line counts or file order.

Don't re-ask a sentence from the explanation; ask about its consequence. "What does `parse` return for an empty header?" tests understanding; "Which function changed?" tests reading.

Use the tool's question tool when there is one (`AskUserQuestion` in Claude Code), multiple choice with three or four options, one correct and the others the misreadings a hurried reviewer would make. Without a question tool, write the question with lettered options in chat. When the options would give the answer away, ask it open-ended.

## 4. Score

After each answer, say right, partly right or wrong. On anything short of right, explain the correct answer with the `file:line` that shows it, in two or three sentences. Then ask the next question.

At the end, give the score (`3/4`) and list the misses with the lines to re-read.

## 5. Hand back

Tell the user they can mark the PR ready themselves when they are comfortable (`gh pr ready <number>`). If they missed the question on the riskiest part, suggest re-reading it first. The decision stays theirs. Never run `gh pr ready`, never merge, never comment on the PR.

If the tool can publish an HTML page, offer once to put the explanation and the quiz on one, for re-reading or sharing with a pairing partner. Do not publish without a yes.

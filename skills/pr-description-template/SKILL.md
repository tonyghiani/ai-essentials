---
name: pr-description-template
description: Writes pull request description text from a fixed template that starts with a plain-language summary of the problem and the approach, an optional screenshots section for UI changes, and an optional testing section of reproduction steps. Returns text only; opening the PR is open-draft-pr's job. Use when the user asks to write a PR description, PR body or pull request summary.
effort: low
---
# PR Description Template

## When to use

Use this skill when the user asks for:
- a PR description
- a PR body for GitHub
- a summary/testing section for a pull request

## Output requirements

Always follow these rules:
- Keep heading icons as part of the heading text (example: `## 📓 Summary`, `## 🧪 Testing`).
- The body starts directly with `## 📓 Summary`. It has no title line; the caller passes the title separately when it opens the PR.
- The summary explains the problem and the approach in plain language. It never lists the code changes: the diff already does that.
- The screenshots section is optional. Include it only when the change visibly alters the UI of a feature in a significant way. It sits between the summary and the testing section.
- The testing section is optional. Include it only when the reviewer can do something concrete to see the change.

## Template

Use this structure:

```markdown
## 📓 Summary
<The problem, in a few plain sentences: who hits it, what they see, why it matters.>

<The approach, in a few plain sentences: how this PR fixes it, and why that way rather than the obvious alternative when there is one.>

## 📸 Screenshots
| Before | After |
|---|---|
| <screenshot> | <screenshot> |

## 🧪 Testing
1. <how to get into the broken state, or the starting state>
2. <what to do>
3. <what the reviewer should see now, and what they saw before>
```

Drop the `## 📸 Screenshots` section entirely when the change does not touch the UI, or only nudges it in a way a reviewer would not notice (a copy tweak, a spacing fix of a pixel or two, a change behind the scenes). Do not write a placeholder.

Drop the `## 🧪 Testing` section entirely when there is nothing concrete for a reviewer to do (a refactor with no behaviour change, a type-only change, a docs change, a dependency bump covered by CI). Do not pad it, and do not write a placeholder such as "N/A".

## Writing guidance

**Summary**
- Start from the problem, as if explaining it to a teammate who has not seen the code. Say what goes wrong for a user or a developer before saying anything about the fix.
- Use everyday words. Name a function, file or flag only when the reader needs it to follow the story.
- Explain the how as an idea ("we now read the value once and pass it down instead of recomputing it in each child"), not as a list of edits.
- No bullet list of changed files, functions or hunks. Short bullets are fine only for a parallel set of things the reader must keep in mind, such as the cases the fix covers.
- Two or three short paragraphs is the target. A one-line fix gets two or three sentences.

**Screenshots**
- Show a before and after pair when a view changed. When the change adds a new view or several views, show each new state instead and label it.
- Cover each state the change touches (empty, loading, error, a narrow layout) only when it differs in a way the reviewer should check.
- You cannot capture an image yourself unless the app is running and a browser tool is available. When you cannot, leave a labelled placeholder per image (`<screenshot: settings flyout, before>`) for the user to fill in. Never invent an image link.

**Testing**
- Write reproduction guidelines: how to reach the state, what to click or call, what to expect to see now versus before.
- Do not say how to run the test suite, a linter or the typechecker. CI does that, and the reviewer knows how.
- Include setup only when it is not obvious (a feature flag, a sample data set, a config value).
- Mention an edge case only when it is worth a reviewer's time to try by hand.

## Output

Return only the formatted PR description text. Do not offer to create the PR, run `gh`, or ask about a base branch.

## Example

```markdown
## 📓 Summary
When our payment provider's endpoint was slow to answer, the webhook call timed out and we gave up on the first try. The customer had paid, but the order stayed "pending" until someone replayed the event by hand.

We now retry a timed-out call a few times, waiting a little longer between attempts. Only calls that are safe to repeat are retried, so a webhook that already went through is never delivered twice.

## 🧪 Testing
1. Point `PAYMENT_WEBHOOK_URL` at a local server that sleeps for 10 seconds on its first request and answers normally after that.
2. Complete a test checkout.
3. The order moves to "paid" after the second attempt. Before this change it stayed "pending".
```

## Template headings

Whoever calls this skill (including `tech-lead` and `open-draft-pr`), the output is the template above and nothing else: `## 📓 Summary`, then `## 📸 Screenshots` and `## 🧪 Testing` when they apply, in that order, with the icons. Add no other section. `ai-pr-body` rejects a body that does not start with the summary heading, including one that still opens with a `> title` line.

## Attribution

The text is the user's. Add no footer, badge, "generated" note or tool name as author (the no-tool-credit rule).

## Gotchas

- The heading icons are part of the template. `ai-pr-body` and the guard check them, so a body with a plain `## Summary` heading is refused when the PR is opened.
- A missing Screenshots section is valid. A Screenshots section on a change with no visible UI difference is not: cut it.
- A missing Testing section is valid. A Testing section that only says how to run the tests is not: cut it.

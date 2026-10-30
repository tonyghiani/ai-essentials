---
name: pr-description-template
description: Creates pull request descriptions using a fixed template with a concise title, a mixed paragraph-and-bullets summary section, and testing bullets, and can create the PR with gh. Use when the user asks to write a PR description, PR body, pull request summary, or to create a PR.
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
- Write the summary as a mix of short paragraphs and bullet points.
- Keep the title concise and focused on the main change.
- Keep testing steps actionable and reproducible.

## Template

Use this exact structure:

```markdown
> <concise PR title summarizing the main change>

## 📓 Summary
<2-4 sentences explaining what the PR does, why it is needed, and the outcome. Mention impacted area(s) and context.>

- <key change 1>
- <key change 2>
- <key change 3>

## 🧪 Testing
- <main flow to test>
- <edge case or secondary flow>
- <validation check (errors, telemetry, or regressions)>
```

## Writing guidance

- Prefer concrete wording over generic phrasing.
- Mention affected layers explicitly when relevant (API, UI, background jobs, telemetry, tests).
- Keep bullets parallel and one line when possible.
- Do not include unrelated implementation detail.

## Output

Return only the formatted PR description text. Do not offer to create the PR, run `gh`, or ask about a base branch.

## Example

```markdown
> Add retry with exponential backoff to payment webhook handler

## 📓 Summary
Webhook deliveries to our payment provider occasionally fail on transient network errors. This change adds bounded retries so successful payments are not lost when the first POST times out.

- Adds retry helper with exponential backoff and jitter.
- Applies retries only to idempotent webhook dispatch paths.
- Logs each retry attempt with correlation id for debugging.

## 🧪 Testing
- Simulate network timeout and confirm webhook succeeds on retry.
- Verify non-idempotent endpoints still fail fast without retry.
- Check logs include attempt count and final outcome.
```

## Decisions section

When this skill is used by `tech-lead` or `open-draft-pr`, do not write a "Decisions made without you" section. `ai-pr-body` appends it from the run's record, so it cannot be forgotten or paraphrased. Used on its own, this skill produces the template above and nothing else.

## Attribution

The text is the user's. Add no footer, badge, "generated" note or tool name as author (the no-tool-credit rule).

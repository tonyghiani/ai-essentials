---
name: gh-issue-writer
description: Generate well-formatted GitHub issue content from a brief context, feature request, or bug report. Outputs ready-to-copy Markdown — does not create the issue. Use when the user asks to write a GitHub issue, draft an issue, create issue content, or mentions "gh issue".
effort: low
---

# GitHub Issue Writer

Generate GitHub issue content in this preferred template. Output **only** the
formatted Markdown — never call `gh issue create`.

## Workflow

1. Read the user's brief (feature request, bug report, or context).
2. If the brief is too vague to produce concrete acceptance criteria, ask one round of clarifying questions before drafting.
3. Produce the issue using the exact template below.
4. Present the result in two parts:
   - **Title** (plain text, one line) — for the GitHub title field
   - **Body** (fenced Markdown block) — for the issue description

## Template

**Title** (plain text, not a heading in the body):

```
[Area] Action-oriented and concise description
```

**Body:**

```markdown
## 📓 Summary
[1-2 sentences: what is happening, why it matters, user impact.]

## ✔️ Acceptance criteria
* [Specific, measurable outcome 1]
* [Specific, measurable outcome 2]
* [Edge cases or UI/UX states if applicable]

## 💡 Implementation hints
* [Components or layers to touch — UI, API, state, tests]
* [Data model considerations — types, schemas, migrations]
* [Compact bullet points; no actual code]
```

## Writing Rules

- **Title**: `[Area]` prefix, then an action-oriented phrase (e.g., `[Auth] Support password reset via email link`).
- **Summary**: 1-2 sentences. Describe observable behavior, why it matters, and user impact. No filler.
- **Acceptance criteria**: Each bullet is a specific, testable outcome. Include edge cases and relevant UI states.
- **Implementation hints**: High-level pointers only. Mention files, components, or schemas by name in `inline code`. Never write actual implementation code.
- **Tone**: Professional, clear, neutral, highly technical. Focus on observable behavior.
- **Formatting**: **Bold** for key concepts. `Inline code` for technical terms, field names, file names. Concrete examples in (parentheses) when helpful.
- Keep the body concise — aim for ≤30 lines of Markdown.

## Attribution

The text is the user's. Add no footer, badge, "generated" note or tool name as author (the no-tool-credit rule).

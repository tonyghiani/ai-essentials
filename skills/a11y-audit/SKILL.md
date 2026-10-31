---
name: a11y-audit
description: Audit UI code for accessibility defects that block keyboard and screen-reader users. Invoke when adding or reviewing interactive UI, a form, a modal or flyout, a custom control, or when the user asks about a11y, WCAG, screen readers, or keyboard navigation.
context: fork
agent: auditor
background: false
---

# Accessibility audit

## Target

What the caller passed: $ARGUMENTS

This runs as a separate read-only agent that has not seen the conversation, so the target above and the repository are all it has. When the target is empty, audit the current branch's change: the files in `git diff --name-only --merge-base origin/HEAD` (or against the base the caller named), read in full. Report findings; never edit.

Order findings by who gets blocked. A keyboard trap stops work entirely; a missing `aria-describedby` is a degradation.

## Blocking defects

**Keyboard reachability.** Every interactive element must be operable without a mouse.
- `onClick` on a `div` or `span` with no `role`, `tabIndex`, and key handler. Use a `button`.
- Custom controls that don't handle `Enter` and `Space`, or `Escape` to dismiss.
- `tabIndex` greater than 0, which breaks document order.
- Elements hidden from sighted users but still focusable, or the reverse.

**Focus management.** A modal, flyout, or dialog must move focus in, trap it while open, and return it to the trigger on close. Route changes must move focus to the new content, not leave it on a stale node. Never remove a focus outline without an equally visible replacement.

**Accessible name.** Every control needs one.
- Icon-only buttons with no `aria-label`.
- Inputs with no associated `label` (a placeholder is not a label).
- Links whose text is "here" or "read more" out of context.
- Images that convey meaning with no `alt`; decorative images should have `alt=""`.

**Semantics.** Prefer the native element over ARIA. A `button` beats `role="button"`. Check heading order for skipped levels, list markup for lists, `table` markup for tabular data, `fieldset`/`legend` for radio and checkbox groups.

## Important defects

**State communicated visually only.** Toggles need `aria-pressed` or `aria-checked`. Expandable sections need `aria-expanded` and `aria-controls`. Sort direction needs `aria-sort`. Selected tabs need `aria-selected`.

**Errors and async updates.** Form errors must be programmatically tied to the field (`aria-describedby`, `aria-invalid`), not just rendered red nearby. Content that appears after an action, a toast, a validation summary, a loaded result, needs a live region or focus move, or a screen-reader user never learns it happened.

**Colour and contrast.** Text below 4.5:1, or large text below 3:1. Meaning conveyed by colour alone with no icon, text, or pattern. Focus indicators below 3:1 against their background.

**Motion and zoom.** Animation that ignores `prefers-reduced-motion`. Layout that breaks at 200% zoom or 320px width.

## In an EUI codebase

EUI components carry a lot of this already. The defects tend to appear where the code goes custom:
- A raw element used instead of the EUI equivalent
- An EUI component with a required a11y prop omitted (`aria-label` on `EuiButtonIcon`, `EuiComboBox`)
- Custom CSS overriding EUI's focus styles
- A hand-rolled dropdown or tooltip instead of `EuiPopover` / `EuiToolTip`

Check the test id attribute is present too (`data-testid`, or whatever the project uses). Untestable UI is UI that regresses.

## Output

```markdown
## Accessibility audit

### Blocking (unusable for some users)
- `file:line` — <defect>. <who is blocked>. Fix: <concrete change>

### Important
- `file:line` — <defect>. Fix: <concrete change>

### Minor
- `file:line` — <defect>. Fix: <concrete change>

### Verified manually
- <what you could and could not check from code alone>
```

## Be honest about limits

Reading code cannot confirm contrast ratios, actual screen-reader output, or focus order as rendered. State which findings are code-certain and which need a real check: keyboard-only walkthrough, VoiceOver or NVDA pass, axe DevTools, or a contrast checker. Don't report a contrast failure you inferred from a variable name.

## When the tech lead invokes this

Invoked when the diff adds or changes interactive UI: forms, modals, flyouts, custom controls. Audit only the changed components and report defects that block keyboard or screen-reader use.

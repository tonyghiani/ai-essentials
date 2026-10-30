---
name: i18n-sweep
description: Find untranslated user-facing strings and i18n defects that break translation. Invoke when adding UI copy, when an i18n check fails, or when the user asks to review translations, hardcoded strings, or localisation.
context: fork
agent: Explore
background: false
---

# i18n sweep

## Target

What the caller passed: $ARGUMENTS

This runs as a separate read-only agent that has not seen the conversation, so the target above and the repository are all it has. When the target is empty, audit the current branch's change: the files in `git diff --name-only --merge-base origin/HEAD` (or against the base the caller named), read in full. Report findings; never edit.

Two failure modes: strings that were never wrapped, and strings that were wrapped in a way translators can't work with. The second is more expensive because it looks done.

## Untranslated strings

Scan for user-visible literals in JSX text, and in these props: `title`, `label`, `placeholder`, `aria-label`, `alt`, `description`, `helpText`, `tooltip`, `emptyMessage`, `confirmButtonText`, `cancelButtonText`, plus toast and error messages surfaced to the UI.

Not findings: test id attributes, `className`, ids, route paths, log messages, dev-only errors, and anything behind an internal flag no user sees.

## Defects that break translation

**Concatenation.** Word order differs by language, so assembled sentences can't be translated.
```tsx
// Broken
<>{count} {count === 1 ? 'item' : 'items'} found</>

// Correct: one message, pluralisation inside it
i18n.translate('xpack.myPlugin.itemsFound', {
  defaultMessage: '{count, plural, one {# item} other {# items}} found',
  values: { count },
})
```

**Pluralisation by ternary.** Many languages have more than two plural forms. Use ICU `plural`, always.

**Gender or list interpolation** built with string joins rather than ICU `select` and a list formatter.

**Dates, numbers, currency formatted by hand.** Use `Intl` or the framework's formatter so locale conventions apply.

**Missing `values`** for a message with placeholders, or a placeholder name that doesn't match the message.

**Reused message id with different copy**, or the same copy duplicated under two ids. Both create translation drift.

**Unstable id built at runtime** (`` `xpack.p.${key}` ``). The extractor can't find it, so it never gets translated.

**JSX inside a plain `i18n.translate`.** Use `FormattedMessage` when the message embeds markup, so translators see one coherent string with tags.

**No context for an ambiguous word.** "Open" is a verb and an adjective. Add a `description` so the translator knows which.

## House conventions

- Ids: stable, namespaced, camelCase: `myApp.featureArea.descriptiveName`.
- Hoist to a SCREAMING_SNAKE module const when the message is used more than once or would bloat the JSX.
- Shared copy for a component folder goes in a colocated `translations.ts`.
- `FormattedMessage` only when the message contains JSX; `i18n.translate` otherwise.

## Verify

Run your project's i18n extraction and check tool. Report the result — `--fix` handles mechanical problems; it will not fix concatenation or a bad plural, so read the remaining output rather than assuming a clean exit means clean copy.

## Output

```markdown
## i18n sweep

### Untranslated
- `file:line` — "<string>" in <prop or JSX>. Suggested id: `<namespace>.<area>.<name>`

### Breaks translation
- `file:line` — <concatenation / ternary plural / runtime id>. Fix: <the ICU message>

### Convention
- `file:line` — <id shape, duplication, missing description>

### Check result
<output of i18n_check, or why it was not run>
```

## When the tech lead invokes this

Invoked when the diff adds or changes user-facing strings. Sweep only the changed files and report untranslated or untranslatable strings.

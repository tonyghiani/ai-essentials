---
name: dep-size
description: Check what a dependency or import actually costs before adding it, and find bundle bloat in existing code. Invoke when adding a package, when the user asks whether a dependency is worth it, when a bundle-size check fails in CI, or when reviewing imports in browser-shipped code.
---

# Dependency and bundle cost

Two jobs: decide whether a new dependency earns its place, and find the ones that already didn't.

## Before adding a dependency

Answer these in order, and stop at the first that disqualifies it.

**1. Does the platform already do this?** `Intl` for dates, numbers, and currency. `URL` and `URLSearchParams`. `structuredClone`. `Array.prototype.at`/`flat`/`group`. `crypto.randomUUID`. `AbortController`. Most date formatting and deep-clone packages are now redundant.

**2. Does the repo already have something?** Grep `package.json` and the shared packages before reaching outside. Adding a second HTTP client, date library, or validation library is worse than using the awkward existing one.

**3. What does it actually cost?**
```bash
npx --yes bundlephobia@latest <pkg>   # or check bundlephobia.com
npm view <pkg> dependencies
```
Report minified plus gzipped size, transitive dependency count, and whether it's tree-shakeable (ESM with `sideEffects: false`) or all-or-nothing.

**4. Is it maintained and safe?** Last publish date, open issue count, whether it's a single-maintainer package, and `npm audit` on it. A 2KB abandoned package with a prototype-pollution CVE is worse than 20KB that's maintained.

**5. Is the alternative genuinely a lot of code?** If the package replaces 15 lines you could write and test, write the 15 lines. If it replaces a date-parsing state machine, take the package.

Give a verdict: **take it**, **write it inline**, **use what's already here**, or **take it but only on the server**.

## Finding existing bloat

**Import shape.** The most common and most fixable problem.
```ts
import _ from 'lodash';              // pulls the world
import { debounce } from 'lodash';   // better
import debounce from 'lodash/debounce'; // best where the build needs it
```
Grep for default imports of large libraries, `import * as`, and barrel imports that reach a whole package to use one symbol.

**Server-only code in a browser bundle.** A `fs`, `path`, or Node-only package imported from a file that ships to the client. In a plugin architecture, check that `common/` doesn't pull server dependencies and that `public/` entry points don't transitively import server modules.

**Eager loading of rarely used code.** A heavy editor, chart library, or PDF renderer imported statically when it's used on one tab. Use `await import()` behind the interaction that needs it. This is the highest-leverage fix available and it doesn't remove a dependency, it moves it.

**Duplicated versions.** Two copies of the same library at different majors:
```bash
npm ls <pkg> --all 2>/dev/null | grep <pkg>
yarn why <pkg>
```

**Polyfills for baselines you don't support.** Check the browserslist target against what's being polyfilled.

## Output

```markdown
## Dependency cost: <pkg>  (or)  ## Bundle findings

**Verdict:** take it | write it inline | use <existing> | server-only

- Size: X KB min, Y KB gzip
- Transitive deps: N
- Tree-shakeable: yes/no
- Maintenance: <last publish, maintainer count, audit result>
- Replaces: <how much code you'd otherwise write>

### Findings
- `file:line` — <import shape or eager load>. Saves ~X KB. Fix: <change>
```

State when a size number is an estimate rather than measured from this repo's build. Don't quote a figure you didn't look up.

## When the tech lead invokes this

Invoked before any new dependency is added. Report its cost and a lighter alternative if one exists; adding a package the agent chose is an always-ask class (the always-ask classes), so the tech lead asks the user with your finding as the recommendation. When the user named the package, your finding is reported, not asked about.

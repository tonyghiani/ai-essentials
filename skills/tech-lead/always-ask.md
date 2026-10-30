# Always ask

Decision classes the tech lead never settles alone, however many precedents exist. A precedent can
inform the recommended answer it offers; it cannot replace the question.

| Class | Why it is gated | Examples |
|---|---|---|
| `api-contract` | Callers outside this change depend on it | Public route, exported package API, saved-object schema, plugin contract, event payload |
| `data-migration` | Hard to reverse, affects stored data | Schema change, backfill, index mapping change, deleting data |
| `security` | A wrong guess is a vulnerability | Authn or authz, secrets handling, input validation boundaries, dependency with known advisories |
| `scope-expansion` | The spec is the agreement | Work beyond the spec, new feature, extra refactor not needed for the task |
| `outward-facing` | Others see it, and it may be cached or indexed | Marking a PR ready, merging, publishing, posting to Slack or any chat, filing an issue, commenting on someone else's PR |
| `irreversible` | No undo | Force push, deleting branches or files outside the change, dropping a database, rewriting pushed history |
| `dirty-tree` | The uncommitted work may be someone's | Starting a branch while the working tree has changes |
| `new-dependency` | Cost and supply-chain risk | Adding a package the agent chose; run `dep-size` first and ask. When the ticket names the exact package, that is the decision: run `dep-size`, report its finding, and add it without asking again |

## Not gated

Naming, file layout inside the change, test structure, which existing helper to reuse, wording of
commit messages and PR text, and any convention already written in the rules or `marco-code-style`.
Those are decided by the rules or by a precedent.

## Adding a class

When the user corrects a decision the tech lead made alone, and the cost of the mistake was more than
a quick edit, add its class here instead of only demoting the precedent.

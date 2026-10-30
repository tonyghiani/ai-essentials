---
name: memory-distill
description: Turn logged correction signals into durable memory files. Reads the correction log (written automatically by the log-correction-signal hook in Claude Code, Cursor and Codex whenever Marco corrects the assistant or states a preference), plus the failed-check log and overruled decisions, groups recurring themes, and proposes memory entries for approval. Invoke when the user says "distill memory", "update your memory", "what have you learned", or after a stretch of work where preferences came up.
---

# Memory distill

The `log-correction-signal` hook captures every prompt where Marco corrected behaviour or stated a preference, at zero token cost. This skill turns that raw log into memory files. Run it periodically, not every session.

## Why it works this way

Auto-extracting memories at the end of every session burns tokens and produces low-grade noise ("user wanted the button blue"). Corrections are the high-signal moments: they mark where the assistant's default diverged from what Marco actually wants. Logging is free; distilling is deliberate.

## Workflow

### Step 1 — Read the log

```bash
ai-work logs corrections
# Older entries from before the hooks were shared across tools, if the file still exists:
cat ~/.claude/memory-signal.jsonl 2>/dev/null
```

Each line is `{ at, cwd, session, prompt, hits }`. If the output is empty, say so and stop; don't invent memories.

### Step 1b — Read the other signal sources

Corrections are one source. Two more feed the same pass:

- **Failed checks:** `ai-work logs failures`, written by the Stop-hook gate. Each line is `{ at, repo, session, check, excerpt }`. A check that fails the same way across sessions is a missing rule, not bad luck.
- **Decisions the user overruled:** `ai-decisions list` shows precedents marked contradicted. Each is evidence that a habit stopped fitting.

If a source is empty, skip it. `ai-work logs errors` lists hook crashes, which are worth a look too.

### Step 2 — Read what's already stored

Memory lives per-project at `~/.claude/projects/<slug>/memory/`. Read the relevant `MEMORY.md` index and any file that might already cover a theme. You are updating, not appending duplicates.

### Step 3 — Group into themes

Cluster the raw prompts. A theme needs **at least two independent occurrences**, or one very explicit standing instruction ("from now on…"). Discard:

- One-off task corrections with no general rule ("no, the other file")
- Anything already covered by `CLAUDE.md`, a skill, or the repo's own docs
- Preferences derivable from the code itself (the `marco-code-style` skill covers style; don't duplicate it here)

For each surviving theme, write down the **why**. A memory without a reason gets misapplied later.

### Step 4 — Propose, don't write

Present each candidate as:

```
### <slug>
**Type:** feedback | project | user | reference
**Claim:** <one line>
**Why:** <the reason it matters>
**Evidence:** <2-3 quoted fragments from the log, with dates>
**Action:** new file | update <existing-file.md> | supersedes <old-file.md>
**Destination:** memory | instruction line | hook or deny rule | skill | eval task | precedent
```

Then ask which to keep, using a numbered list so a numbered reply maps by index.

### Step 5 — Write approved memories

One fact per file, frontmatter as required:

```markdown
---
name: <kebab-slug>
description: <one line, used for recall relevance>
metadata:
  type: user | feedback | project | reference
---

<the fact>

**Why:** <reason>
**How to apply:** <concrete trigger and behaviour>

Related: [[other-memory-slug]]
```

Add or update the one-line pointer in `MEMORY.md`. Delete memories the log shows are now wrong.

### Step 6 — Prune the log

After distilling, archive the consumed lines so the next run starts clean:

```bash
ai-work logs corrections --archive > /dev/null
[ -f ~/.claude/memory-signal.jsonl ] && mv ~/.claude/memory-signal.jsonl ~/.claude/memory-signal.$(date +%Y%m%d).jsonl.bak
```

Report how many signals you read, how many themes survived, and how many memory files changed.

## Where each theme goes

Match the theme to the cheapest place that enforces it, following the docs' split between instructed and enforced:

| The theme | Destination |
|---|---|
| A preference with exceptions | A memory file, or one line in the global instructions if it applies everywhere |
| A rule with zero exceptions (never edit generated files, always run the formatter) | A hook or deny rule, not a memory |
| A multi-step procedure repeated across sessions | A skill, or an edit to an existing one |
| A failure class that keeps recurring (same check failing across sessions) | An eval task, so a regression is caught |
| A decision the user keeps making the same way for the same situation | A precedent: `ai-decisions add --class ... --situation ... --decision ... --why ...` |

Propose the destination with each theme in step 4. Never write a hook, deny rule or precedent without approval.

## Guardrails

- Never write a memory that contradicts an existing one without explicitly proposing to supersede it.
- Never store secrets, tokens, or file contents from the log.
- If a "correction" was actually the assistant being wrong once (not a standing preference), skip it. Memory is for durable facts.

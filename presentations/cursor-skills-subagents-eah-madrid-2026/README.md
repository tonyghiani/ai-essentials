# Skills, Rules & Subagents — EAH Madrid 2026

Single-file slide deck on configuring AI coding agents (skills, rules, subagents). Delivered at EAH Madrid 2026. No build step.

**Note:** This deck was presented with Cursor as the live demo environment. Core concepts apply to Claude Code, Codex, and similar tools; some slides still mention Cursor-specific paths or features from the original session.

## View the presentation

Open `index.html` in a browser. Double-click the file, or drag it into a tab. `file://` URLs work fine.

**Audience view** (default): the full-screen deck.

**Presenter view** (speaker notes, timers, next slide):

- Append `?view=presenter` to the URL, or
- In the main deck, press **N** or click **N · notes** to open presenter view in a second window.

Both windows stay in sync over a shared channel, so navigation in either window updates the other.

## Navigation

Use arrow keys or click the on-screen controls to move between slides.

## Portable install paths (cheat sheet)

| Kind | This repo | Typical install |
|------|-----------|-----------------|
| Skills | `skills/*/SKILL.md` | Tool-specific skills directory |
| Rules | `rules/*.mdc` | Tool rules dir or `AGENTS.md` |
| Agents | `agents/*.md` | Subagent / worker definitions |

See the repo [README](../../README.md) for symlink instructions and path resolution.

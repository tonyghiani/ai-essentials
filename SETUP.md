# Setup

Clone this repo, then run the installer for each tool you use.

```bash
git clone https://github.com/marcoghiani/ai-essentials
cd ai-essentials
chmod +x setup/install.sh
./setup/install.sh --all          # Claude Code + Cursor + Codex
```

Or per tool:

```bash
./setup/install.sh --claude-code
./setup/install.sh --cursor
./setup/install.sh --codex
```

Safe to re-run. Existing files are backed up with a `.bak` suffix.

---

## What each installer does

### Claude Code

Creates symlinks into `~/.claude/`:

| Link | Source |
|------|--------|
| `~/.claude/skills` | `skills/` |
| `~/.claude/agents` | `agents/` |
| `~/.claude/hooks`  | `claude/hooks/` |
| `~/.claude/CLAUDE.md` | `claude/CLAUDE.md` |

Creates `~/.claude/settings.json` from `claude/settings.reference.json` if none exists. If a settings file already exists, the installer prints a diff command and leaves it untouched.

Skills load as slash commands (`/review-team`, `/tdd`, etc.). Agents load as subagent types for the `Agent` tool.

### Cursor

Symlinks each `rules/*.mdc` into `~/.cursor/rules/`. Files with `alwaysApply: true` are injected automatically; files with `globs:` activate on matching open files.

Symlinks `skills/` into `~/.cursor/skills/ai-essentials/`. Cursor has no native skill loading, so reference them in chat with:

```
@~/.cursor/skills/ai-essentials/<skill-name>/SKILL.md
```

### Codex CLI

Copies `codex/INSTRUCTIONS.md` to `~/.codex/instructions.md`. This is Codex's global instructions file, equivalent to Claude Code's `CLAUDE.md`.

`AGENTS.md` at the repo root is read automatically when Codex runs inside this repo.

---

## Verification

```bash
# Claude Code
ls ~/.claude/skills          # should list skill folders
cat ~/.claude/CLAUDE.md      # should show global instructions

# Cursor
ls ~/.cursor/rules            # should list *.mdc files

# Codex
cat ~/.codex/instructions.md  # should show global instructions

# Repo structure
./scripts/validate.sh
```

---

## Requirements

| Tool | Requirement |
|------|-------------|
| Claude Code | `node` for settings merge; bash |
| Cursor | bash |
| Codex CLI | bash |

---

## Updating

Pull the latest changes and re-run the installer:

```bash
git pull
./setup/install.sh --all
```

Symlinks update automatically on pull. The Codex instructions file is a copy, so re-run `--codex` after changes to `codex/INSTRUCTIONS.md`.

---

## Other tools

**Windsurf:** place `rules/*.mdc` content in `.windsurfrules` at the project root, or paste into Windsurf's global rules via Settings. No installer script needed; the file format is plain markdown.

**GitHub Copilot:** create `.github/copilot-instructions.md` in your project and paste the content from `claude/CLAUDE.md` (minus the skill references). Per-project only; no global equivalent.

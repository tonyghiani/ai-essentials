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

Safe to re-run. Codex stores conflicts under `~/.codex/backups/ai-essentials/`;
the other installers use a `.bak` suffix.

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

### Codex

Installs for local Codex clients, including the CLI and desktop app:

| Installed path | Source |
|----------------|--------|
| `~/.codex/AGENTS.md` | Symlink to `codex/INSTRUCTIONS.md` |
| `~/.codex/ai-essentials` | Symlink to this repository, including all `rules/` |
| `~/.agents/skills/<name>` | Individual symlinks to `skills/<name>/` |
| `~/.agents/skills/shared` | Symlink to shared skill references |
| `~/.codex/agents/<name>.toml` | Generated from `codex/agents/<name>.toml` metadata and the full `agents/<name>.md` prompt |

Codex reads global guidance from `AGENTS.md`. The older installer only copied
`instructions.md`, which isn't an automatic global instruction source. An existing
legacy file is backed up and replaced with a symlink for configurations that
explicitly reference it. A non-empty `AGENTS.override.md` takes precedence; the
installer reports it without replacing it. See [instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

The global instructions route Codex to the appropriate `.mdc` files by task and file
type. Codex doesn't apply Cursor's frontmatter automatically. These writing and
code conventions are separate from Codex's command permission `.rules` files.

Skills appear in `/skills` or when typing `$` in the CLI. Each skill is linked
individually so existing skills remain installed. Shared references keep their
relative paths. See [local skill discovery](https://learn.chatgpt.com/docs/build-skills).

The `esql-expert` and `marco-blogger` personas are converted into native custom
agents. Both inherit the parent model and reasoning effort. The ES|QL agent uses
a read-only filesystem sandbox. Ask Codex to use the agent by name. See
[custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

When `CODEX_HOME` is set, it replaces `~/.codex` in these paths; user skills still
live in `~/.agents/skills`. Existing Codex settings and unrelated skills or agents
are preserved. Conflicting files, directories, and symlinks are moved to unique
backup directories outside skill and agent discovery paths.

Start a new Codex session after installation to load the global instructions and
agent definitions.

---

## Verification

```bash
# Claude Code
ls ~/.claude/skills          # should list skill folders
cat ~/.claude/CLAUDE.md      # should show global instructions

# Cursor
ls ~/.cursor/rules            # should list *.mdc files

# Codex (use $CODEX_HOME instead of ~/.codex if set)
ls ~/.agents/skills                    # should list skill folders and shared
cat ~/.codex/AGENTS.md                 # should show global instructions
ls ~/.codex/ai-essentials/rules        # should list *.mdc files
ls ~/.codex/agents                    # should list both *.toml agent definitions

# Repo structure
./scripts/validate.sh
```

---

## Requirements

| Tool | Requirement |
|------|-------------|
| Claude Code | `node` for settings merge; bash |
| Cursor | bash |
| Codex | bash, python3; a current Codex release with custom agent support |

---

## Updating

Pull the latest changes and re-run the installer:

```bash
git pull
./setup/install.sh --all
```

Symlinked instructions, rules, and existing skills update automatically on pull.
Re-run `--codex` after adding skills or changing agent prompts or Codex agent metadata;
the installer regenerates the native agent definitions.

---

## Other tools

**Windsurf:** place `rules/*.mdc` content in `.windsurfrules` at the project root, or paste into Windsurf's global rules via Settings. No installer script needed; the file format is plain markdown.

**GitHub Copilot:** create `.github/copilot-instructions.md` in your project and paste the content from `claude/CLAUDE.md` (minus the skill references). Per-project only; no global equivalent.

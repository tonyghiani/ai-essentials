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
| `~/.claude/agents` | `~/.ai-essentials/generated/claude/agents/` (generated from `agents/`) |
| `~/.claude/hooks`  | `claude/hooks/` |
| `~/.claude/CLAUDE.md` | `claude/CLAUDE.md` |
| `~/.ai-essentials/repo` | this repository; the stable path skills use to reach scripts |

Agents are generated, not linked: neutral agents (`access:`, `tier:` frontmatter) become Claude subagents with a `tools:` restriction, which a plain symlink cannot give them.

Creates `~/.claude/settings.json` from `claude/settings.reference.json` if none exists. If one exists, the installer leaves it alone; run `./setup/install.sh --config` to preview merging the reference into it, and `--config-write` to apply.

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
| `~/.codex/guidance` | Symlink to this repository's `rules/` folder |
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

## Live configs: preview, apply, check

Live settings stay unsymlinked because each tool writes to them. Merge the reference configs in instead:

```bash
./setup/install.sh --config          # dry run: prints a diff for each file, writes nothing
./setup/install.sh --config-write    # applies it; backups go to ~/.ai-essentials/backups
./setup/install.sh --doctor          # checks links, hooks, attribution off in every tool, git and gh identity
```

The merge is additive and idempotent. It touches only these keys and keeps everything else:

| File | Merged |
|---|---|
| `~/.claude/settings.json` | `permissions` (allow, ask, deny), `attribution`, `includeCoAuthoredBy`, `hooks`, `autoMode` |
| `~/.cursor/hooks.json` | `hooks` |
| `~/.cursor/cli-config.json` | `attribution`, `permissions` |
| `~/.codex/hooks.json` | `hooks` |
| `~/.codex/rules/guardrails.rules` | copied whole; `~/.codex/rules/default.rules` is never touched |

Permission blocks are generated from `policy/guardrails.json`; after editing it run `node scripts/guardrails/render.mjs --write`.

### Steps no script can do

- **Codex:** hooks run only after you trust them. Open Codex, run `/hooks`, and trust the four ai-essentials hooks.
- **Cursor:** turn off Commit Attribution and PR Attribution in Cursor Settings. Hook payloads there follow the docs and are untested on this machine, since the Cursor CLI is not installed.
- **Per repo:** run the `verify-contract` skill once so the Stop-hook gate knows that repo's checks.

### Machine-local data

`~/.ai-essentials/state/` holds logs, specs and the list of branches the agent created. It contains prompt text, so it is never inside a repository. `contracts/*.json`, `policy/decisions.local.md` and `policy/project-tokens.local.json` live in this checkout but are gitignored. The last one lists the names of your own projects; `validate.sh` fails if any appears in a skill, rule, agent, script or doc, so the setup stays project-agnostic (see `policy/project-tokens.example.json`).

### Known gaps

- Codex and Cursor have no turn or budget flag; `delegate.sh` enforces a wall-clock timeout instead.
- Cursor delegation needs its `agent` CLI (see cursor.com/docs/cli) and `CURSOR_API_KEY` or a login; it is not installed on this machine, so that path is covered by flag-assertion tests only.
- Codex can be under managed (MDM) requirements (`approval_policy` cannot be `never`); unattended Codex runs use `--approve-for-me`.
- Cursor shell permissions match only a command's first word, so multi-word rules there rely on the guard hook.
- Outside `ai-delegate`, no-credit enforcement for Codex depends on you trusting its hooks in `/hooks`. Delegated runs also get a commit-msg hook that works in every tool without trust.

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
ls ~/.codex/guidance                  # should list *.mdc files
ls ~/.codex/agents                    # should list the generated *.toml agent definitions
ls ~/.codex/rules                      # should include guardrails.rules

# Repo structure
./scripts/validate.sh
```

---

## Requirements

| Tool | Requirement |
|------|-------------|
| All | `node` 20+ (hooks, scripts, config merge), `python3` (agent renderer), `git`, `gh` logged in as you |
| Claude Code | bash |
| Cursor | bash |
| Codex | bash; a current Codex release with custom agents and hooks |

---

## Updating

Pull the latest changes and re-run the installer:

```bash
git pull
./setup/install.sh --all
```

Symlinked instructions, rules, and existing skills update automatically on pull.
Re-run the installer after adding skills or changing agent sources; it regenerates the per-tool
agent definitions. Run `./scripts/validate.sh` (add `VALIDATE_TESTS=1` for the test suites) before
committing changes to skills, rules, hooks or policy.

---

## Other tools

**Windsurf:** place `rules/*.mdc` content in `.windsurfrules` at the project root, or paste into Windsurf's global rules via Settings. No installer script needed; the file format is plain markdown.

**GitHub Copilot:** create `.github/copilot-instructions.md` in your project and paste the content from `claude/CLAUDE.md` (minus the skill references). Per-project only; no global equivalent.

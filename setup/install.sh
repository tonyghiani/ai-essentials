#!/usr/bin/env bash
# Usage: ./setup/install.sh [--all] [--claude-code] [--cursor] [--codex] [--config] [--config-write] [--doctor]
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=setup/claude-code.sh
source "$REPO/setup/claude-code.sh"
# shellcheck source=setup/cursor.sh
source "$REPO/setup/cursor.sh"
# shellcheck source=setup/codex.sh
source "$REPO/setup/codex.sh"

info()    { printf '\033[1;34m→\033[0m  %s\n' "$*"; }
success() { printf '\033[1;32m✓\033[0m  %s\n' "$*"; }
warn()    { printf '\033[1;33m!\033[0m  %s\n' "$*"; }

export -f info success warn

# Shared by every tool: the stable path skills use to reach scripts, and machine-local state.
install_core() {
  local repo="$1"
  mkdir -p "$HOME/.ai-essentials/state" "$HOME/.ai-essentials/generated"
  _safe_link "$repo" "$HOME/.ai-essentials/repo"

  # Commands for your own terminal, so working in other repos never means typing a path into this one.
  mkdir -p "$HOME/.local/bin"
  # Skills and agents call these by name, so a definition never needs to know where this repo lives.
  _safe_link "$repo/scripts/delegate.sh"            "$HOME/.local/bin/ai-delegate"
  _safe_link "$repo/scripts/fanout.sh"              "$HOME/.local/bin/ai-fanout"
  _safe_link "$repo/scripts/verify/cli.mjs"         "$HOME/.local/bin/ai-verify"
  _safe_link "$repo/scripts/work/cli.mjs"           "$HOME/.local/bin/ai-work"
  _safe_link "$repo/scripts/work/decisions.mjs"     "$HOME/.local/bin/ai-decisions"
  _safe_link "$repo/scripts/work/pr_body.mjs"       "$HOME/.local/bin/ai-pr-body"
  _safe_link "$repo/scripts/guard/audit_branch.mjs" "$HOME/.local/bin/ai-audit"
  _safe_link "$repo/scripts/checkup/checkup.mjs"    "$HOME/.local/bin/ai-checkup"
  _safe_link "$repo/scripts/triage.sh"              "$HOME/.local/bin/ai-triage"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) warn "$HOME/.local/bin is not on your PATH; add it so the ai-* commands work." ;;
  esac
}

# The end-of-day triage: a macOS LaunchAgent that runs ai-triage on weekdays at 18:00. Read-only by
# construction (see scripts/triage.sh); it writes a report and nothing else. Opt in with --triage.
install_triage_schedule() {
  local repo="$1"
  if [[ "$(uname)" != Darwin ]]; then
    warn "The triage schedule is a macOS LaunchAgent; on this system, schedule ai-triage with cron."
    return
  fi
  local node_bin node_dir plist label="com.ai-essentials.triage"
  # `dirname "$(command -v node)"` prints "." when node is missing, so test the lookup itself.
  if ! node_bin="$(command -v node)"; then
    warn "node not found; the triage schedule needs it on the LaunchAgent's PATH."
    return
  fi
  node_dir="$(dirname "$node_bin")"
  plist="$HOME/Library/LaunchAgents/$label.plist"
  # launchd does not create the log directory itself.
  mkdir -p "$HOME/.ai-essentials/state/triage" "$HOME/Library/LaunchAgents"
  sed -e "s#__HOME__#$HOME#g" -e "s#__NODE_DIR__#$node_dir#g" "$repo/setup/triage.launchd.plist.template" > "$plist"
  plutil -lint "$plist" >/dev/null || { warn "Generated $plist does not lint; not loading it."; return; }
  # Reload, so a re-install picks up a changed template instead of failing on "already loaded".
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  # Under set -e a failed bootstrap would end the installer before --config and --doctor run.
  if ! launchctl bootstrap "gui/$(id -u)" "$plist"; then
    warn "launchctl could not load $plist; run: launchctl bootstrap gui/$(id -u) $plist"
    return
  fi
  success "Scheduled ai-triage on weekdays at 18:00 (reports in ~/.ai-essentials/state/triage/)"
}

# Render the neutral agent sources into one tool's native format. Usage: render_agents REPO TOOL DEST
render_agents() {
  local repo="$1" tool="$2" dest="$3"
  if ! command -v python3 &>/dev/null; then
    warn "python3 is required to generate the $tool agents."
    return 1
  fi
  rm -rf "$dest"
  python3 "$repo/setup/render_agents.py" "$repo" "$tool" "$dest"
  success "Generated $tool agents: $dest"
}

usage() {
  cat <<'EOF'
Install ai-essentials rules, skills, and agents for a given tool.

Usage:
  ./setup/install.sh --all
  ./setup/install.sh --claude-code
  ./setup/install.sh --cursor
  ./setup/install.sh --codex

Options:
  --all          Install for all supported tools
  --claude-code  Symlink into ~/.claude/ (skills, agents, hooks, CLAUDE.md, settings)
  --cursor       Symlink rules into ~/.cursor/rules/ and skills into ~/.cursor/skills/
  --codex        Install global instructions, skills, rule references, hooks and custom agents
  --config       Preview merging the reference hooks, permissions and attribution settings into
                 the live Claude, Cursor and Codex configs (writes nothing)
  --config-write Apply that merge, saving a backup of each file under ~/.ai-essentials/backups
  --doctor       Check the install: links, hooks, attribution off in every tool, git and gh identity
  --triage       Schedule the read-only end-of-day triage (ai-triage) on weekdays at 18:00 (macOS)
  --help         Show this message

Safe to re-run. Codex backs up conflicts under ~/.codex/backups/ai-essentials/;
the other installers use a .bak suffix.
EOF
}

if [[ $# -eq 0 ]]; then
  usage
  exit 0
fi

INSTALL_CLAUDE_CODE=false
INSTALL_CURSOR=false
INSTALL_CODEX=false
RUN_CONFIG=false
CONFIG_WRITE=false
RUN_DOCTOR=false
INSTALL_TRIAGE=false

for arg in "$@"; do
  case $arg in
    --all)         INSTALL_CLAUDE_CODE=true; INSTALL_CURSOR=true; INSTALL_CODEX=true ;;
    --claude-code) INSTALL_CLAUDE_CODE=true ;;
    --cursor)      INSTALL_CURSOR=true ;;
    --codex)       INSTALL_CODEX=true ;;
    --config)      RUN_CONFIG=true ;;
    --config-write) RUN_CONFIG=true; CONFIG_WRITE=true ;;
    --doctor)      RUN_DOCTOR=true ;;
    --triage)      INSTALL_TRIAGE=true ;;
    --help)        usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; usage; exit 1 ;;
  esac
done

if [[ "$INSTALL_CLAUDE_CODE" == true || "$INSTALL_CURSOR" == true || "$INSTALL_CODEX" == true ]]; then
  install_core "$REPO"
fi

[[ "$INSTALL_CLAUDE_CODE" == true ]] && install_claude_code "$REPO"
[[ "$INSTALL_CURSOR"      == true ]] && install_cursor      "$REPO"
[[ "$INSTALL_CODEX"       == true ]] && install_codex       "$REPO"
[[ "$INSTALL_TRIAGE"      == true ]] && install_triage_schedule "$REPO"

if [[ "$RUN_CONFIG" == true ]]; then
  info "Live configs"
  if [[ "$CONFIG_WRITE" == true ]]; then
    node "$REPO/setup/apply.mjs" --write
  else
    node "$REPO/setup/apply.mjs"
  fi
fi

if [[ "$RUN_DOCTOR" == true ]]; then
  info "Doctor"
  node "$REPO/setup/doctor.mjs" || DOCTOR_FAILED=true
fi

echo ""
success "Done. Run ./scripts/validate.sh to check repo structure."
[[ "${DOCTOR_FAILED:-false}" == true ]] && exit 1
exit 0

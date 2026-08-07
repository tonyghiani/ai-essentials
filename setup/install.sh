#!/usr/bin/env bash
# Usage: ./setup/install.sh [--all] [--claude-code] [--cursor] [--codex]
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
  --codex        Copy codex/INSTRUCTIONS.md to ~/.codex/instructions.md
  --help         Show this message

Safe to re-run. Existing files are backed up with a .bak suffix before replacement.
EOF
}

if [[ $# -eq 0 ]]; then
  usage
  exit 0
fi

INSTALL_CLAUDE_CODE=false
INSTALL_CURSOR=false
INSTALL_CODEX=false

for arg in "$@"; do
  case $arg in
    --all)         INSTALL_CLAUDE_CODE=true; INSTALL_CURSOR=true; INSTALL_CODEX=true ;;
    --claude-code) INSTALL_CLAUDE_CODE=true ;;
    --cursor)      INSTALL_CURSOR=true ;;
    --codex)       INSTALL_CODEX=true ;;
    --help)        usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; usage; exit 1 ;;
  esac
done

[[ "$INSTALL_CLAUDE_CODE" == true ]] && install_claude_code "$REPO"
[[ "$INSTALL_CURSOR"      == true ]] && install_cursor      "$REPO"
[[ "$INSTALL_CODEX"       == true ]] && install_codex       "$REPO"

echo ""
success "Done. Run ./scripts/validate.sh to check repo structure."

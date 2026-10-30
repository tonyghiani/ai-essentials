#!/usr/bin/env bash
# Codex installer. Sourced by install.sh; do not run directly.

install_codex() (
  local repo="$1"
  local codex_home="${2:-${CODEX_HOME:-$HOME/.codex}}"
  local skills_dir="${3:-$HOME/.agents/skills}"
  info "Codex"

  if ! command -v python3 &>/dev/null; then
    warn "python3 is required to convert the agent prompts to Codex TOML."
    return 1
  fi

  # Render before changing the installation so invalid sources fail early.
  local staging
  staging="$(mktemp -d "${TMPDIR:-/tmp}/ai-essentials-codex.XXXXXX")"
  trap 'rm -rf "$staging"' EXIT
  python3 "$repo/setup/render_agents.py" "$repo" codex "$staging"

  mkdir -p "$codex_home/agents" "$skills_dir"
  # Rules only: the instructions refer to them as guidance/<name>.mdc, so nothing points back at this repo.
  _codex_safe_link "$repo/rules" "$codex_home/guidance"
  if [[ -L "$codex_home/ai-essentials" ]]; then
    rm "$codex_home/ai-essentials"
    info "Removed the old $codex_home/ai-essentials link (replaced by guidance/)."
  fi
  _codex_safe_link "$repo/codex/INSTRUCTIONS.md" "$codex_home/AGENTS.md"
  _codex_safe_link "$repo/codex/hooks" "$codex_home/hooks"

  # Generated guardrail rules live in their own file; default.rules is Codex's own record of
  # commands you approved, and is never touched.
  mkdir -p "$codex_home/rules"
  _codex_install_file "$repo/codex/guardrails.rules" "$codex_home/rules/guardrails.rules"
  # The file used to be called ai-essentials.rules; drop the old copy so the rules are not applied twice.
  rm -f "$codex_home/rules/ai-essentials.rules"

  # Keep an existing legacy path current for configs that explicitly reference it.
  if [[ -e "$codex_home/instructions.md" || -L "$codex_home/instructions.md" ]]; then
    _codex_safe_link "$repo/codex/INSTRUCTIONS.md" "$codex_home/instructions.md"
  fi

  local skill name agent
  for skill in "$repo"/skills/*; do
    [[ -d "$skill" ]] || continue
    [[ -f "$skill/SKILL.md" || "${skill##*/}" == shared ]] || continue
    name="${skill##*/}"
    _codex_safe_link "$skill" "$skills_dir/$name"
  done

  for agent in "$staging"/*.toml; do
    name="${agent##*/}"
    _codex_install_file "$agent" "$codex_home/agents/$name"
  done

  if [[ -s "$codex_home/AGENTS.override.md" ]]; then
    warn "$codex_home/AGENTS.override.md takes precedence over the installed AGENTS.md."
  fi
  info "Rules are referenced by AGENTS.md through $codex_home/guidance/."
  info "Start a new Codex session to load the global instructions and custom agents."
  info "Codex runs hooks only after you trust them: open Codex, run /hooks, review and trust the ai-essentials hooks."
  info "Run ./setup/install.sh --config to preview merging hooks.json."
  echo ""
)

_codex_backup() {
  local target="$1" backup
  # Backups must stay outside skill and agent discovery paths to avoid duplicates.
  mkdir -p "$codex_home/backups/ai-essentials"
  backup="$(mktemp -d "$codex_home/backups/ai-essentials/install.XXXXXX")"
  mv "$target" "$backup/${target##*/}"
  warn "Backed up: $target → $backup/${target##*/}"
}

_codex_safe_link() {
  local src="$1" target="$2"
  if [[ -L "$target" && "$(readlink "$target")" == "$src" ]]; then
    success "Already linked: $target"
    return
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    _codex_backup "$target"
  fi
  ln -s "$src" "$target"
  success "Linked: $target"
}

_codex_install_file() {
  local src="$1" target="$2"
  if [[ -f "$target" ]] && cmp -s "$src" "$target"; then
    success "Already installed: $target"
    return
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    _codex_backup "$target"
  fi
  cp "$src" "$target"
  success "Installed: $target"
}

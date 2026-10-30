#!/usr/bin/env bash
# Cursor installer. Sourced by install.sh — do not run directly.

install_cursor() {
  local repo="$1"
  info "Cursor"

  # Global rules: each .mdc file symlinked individually so Cursor scans the flat dir.
  mkdir -p "$HOME/.cursor/rules"
  for mdc in "$repo/rules/"*.mdc; do
    local name
    name="$(basename "$mdc")"
    _cursor_safe_link "$mdc" "$HOME/.cursor/rules/$name"
  done

  # Skills: no native Cursor concept, but a conventional path lets you @-reference them.
  mkdir -p "$HOME/.cursor/skills"
  _cursor_safe_link "$repo/skills" "$HOME/.cursor/skills/ai-essentials"

  # Hooks run from ~/.cursor, so ./hooks/<name>.mjs in hooks.json resolves through this link.
  _cursor_safe_link "$repo/cursor/hooks" "$HOME/.cursor/hooks"

  # Agents are generated from the neutral source, so read-only agents get `readonly: true`.
  render_agents "$repo" cursor "$HOME/.ai-essentials/generated/cursor/agents"
  _cursor_safe_link "$HOME/.ai-essentials/generated/cursor/agents" "$HOME/.cursor/agents"

  echo ""
  info "In Cursor chat, reference a skill with: @~/.cursor/skills/ai-essentials/<name>/SKILL.md"
  info "Run ./setup/install.sh --config to preview merging hooks.json and cli-config.json."
  echo ""
}

_cursor_safe_link() {
  local src="$1" target="$2"

  if [[ -L "$target" ]]; then
    local existing
    existing="$(readlink "$target")"
    if [[ "$existing" == "$src" ]]; then
      success "Already linked: $(basename "$target")"
      return
    fi
    warn "Replacing existing symlink: $target (was → $existing)"
    rm "$target"
  elif [[ -e "$target" ]]; then
    warn "Backing up: $target → ${target}.bak"
    mv "$target" "${target}.bak"
  fi

  ln -s "$src" "$target"
  success "Linked: $target"
}

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

  echo ""
  info "In Cursor chat, reference a skill with: @~/.cursor/skills/ai-essentials/<name>/SKILL.md"
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
    mv "$target" "${target}.bak"
  elif [[ -e "$target" ]]; then
    warn "Backing up: $target → ${target}.bak"
    mv "$target" "${target}.bak"
  fi

  ln -s "$src" "$target"
  success "Linked: $target"
}

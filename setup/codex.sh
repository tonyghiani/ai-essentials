#!/usr/bin/env bash
# OpenAI Codex CLI installer. Sourced by install.sh — do not run directly.

install_codex() {
  local repo="$1"
  info "Codex CLI"

  mkdir -p "$HOME/.codex"

  local src="$repo/codex/INSTRUCTIONS.md"
  local target="$HOME/.codex/instructions.md"

  if [[ -f "$target" && ! -L "$target" ]]; then
    warn "Backing up existing instructions: $target → ${target}.bak"
    mv "$target" "${target}.bak"
  fi

  cp "$src" "$target"
  success "Installed: $target"
  info "AGENTS.md at repo root is read automatically by Codex per project."
  echo ""
}

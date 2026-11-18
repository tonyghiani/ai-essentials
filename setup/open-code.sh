#!/usr/bin/env bash
# Open Code installer. Sourced by install.sh; do not run directly.

install_open_code() (
  local repo="$1"
  local opencode_home="${2:-${OPENCODE_HOME:-$HOME/.config/opencode}}"
  local skills_dir="${3:-$opencode_home/skills}"
  info "Open Code"

  mkdir -p "$opencode_home" "$skills_dir"

  # Skills: one symlink per skill directory. Open Code takes the skill name from the directory name.
  local skill name
  for skill in "$repo"/skills/*; do
    [[ -d "$skill" ]] || continue
    [[ -f "$skill/SKILL.md" || "${skill##*/}" == shared ]] || continue
    name="${skill##*/}"
    _open_code_safe_link "$skill" "$skills_dir/$name"
  done

  # Rules: the .mdc convention files, linked whole so the installed instructions can point at them.
  _open_code_safe_link "$repo/rules" "$opencode_home/rules"

  # Global instructions: linked into the config dir and referenced from opencode.json.
  _open_code_safe_link "$repo/open-code/INSTRUCTIONS.md" "$opencode_home/ai-essentials.md"
  _open_code_install_config "$repo" "$opencode_home"

  echo ""
  info "Open Code skills: $skills_dir"
  info "Global instructions: $opencode_home/ai-essentials.md (from opencode.json)"
  info "Rules: $opencode_home/rules/*.mdc"
  info "Run 'opencode reload' so the running server picks up the new config and skills."
)

_open_code_safe_link() {
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

_open_code_install_config() {
  local repo="$1" opencode_home="$2"
  local target="$opencode_home/opencode.json"
  local reference="$repo/open-code/opencode.reference.json"

  if [[ -f "$target" ]] && cmp -s "$reference" "$target"; then
    success "Already installed: $target"
    return
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    warn "Already present: $target — not overwritten. Add the instructions entry from $reference yourself, or run ./setup/install.sh --config-write to merge it into the live file."
    return
  fi
  cp "$reference" "$target"
  success "Installed: $target"
}

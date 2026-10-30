#!/usr/bin/env bash
# Claude Code installer. Sourced by install.sh — do not run directly.

install_claude_code() {
  local repo="$1"
  info "Claude Code"

  mkdir -p "$HOME/.claude"

  _safe_link "$repo/skills"          "$HOME/.claude/skills"
  _safe_link "$repo/claude/hooks"    "$HOME/.claude/hooks"
  _safe_link "$repo/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"

  # Agents are generated, not linked: a read-only reviewer must get `tools:` restrictions,
  # which the neutral source format does not carry.
  render_agents "$repo" claude "$HOME/.ai-essentials/generated/claude/agents"
  _safe_link "$HOME/.ai-essentials/generated/claude/agents" "$HOME/.claude/agents"

  _init_claude_settings "$repo"
  echo ""
}

_init_claude_settings() {
  local repo="$1"
  local ref="$repo/claude/settings.reference.json"
  local target="$HOME/.claude/settings.json"

  if [[ -f "$target" ]]; then
    warn "settings.json already exists — not overwritten."
    warn "Diff against reference: diff $target $ref"
    return
  fi

  if ! command -v node &>/dev/null; then
    warn "node not found — copy $ref to $target and strip the // comment keys manually."
    return
  fi

  node - "$ref" "$target" <<'EOF'
const fs = require('fs');
const [, , src, dest] = process.argv;
const obj = JSON.parse(fs.readFileSync(src, 'utf8'));

function stripComments(o) {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return o;
  return Object.fromEntries(
    Object.entries(o)
      .filter(([k]) => !k.startsWith('//'))
      .map(([k, v]) => [k, stripComments(v)])
  );
}

fs.writeFileSync(dest, JSON.stringify(stripComments(obj), null, 2) + '\n');
EOF
  success "Created: $target"
  warn "Review $target before starting Claude Code."
  info "Run ./setup/install.sh --config to preview merging hooks, permissions and attribution into it."
}

_safe_link() {
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

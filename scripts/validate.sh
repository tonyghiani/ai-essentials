#!/usr/bin/env bash
# Validate ai-essentials structure: skill names, folders, and internal paths.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

err() {
  echo "ERROR: $*" >&2
  ERRORS=$((ERRORS + 1))
}

warn() {
  echo "WARN: $*" >&2
}

# Each skills/*/SKILL.md name should match its parent folder.
while IFS= read -r skill_file; do
  dir_name="$(basename "$(dirname "$skill_file")")"
  name_line="$(grep -E '^name:' "$skill_file" | head -1 || true)"
  if [[ -z "$name_line" ]]; then
    err "Missing name in frontmatter: $skill_file"
    continue
  fi
  skill_name="${name_line#name:}"
  skill_name="$(echo "$skill_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [[ "$skill_name" != "$dir_name" ]]; then
    err "Name mismatch in $skill_file: name=$skill_name folder=$dir_name"
  fi
done < <(find "$ROOT/skills" -mindepth 2 -maxdepth 2 -name 'SKILL.md' | sort)

# Referenced skill paths should exist under skills/.
while IFS= read -r ref; do
  target="$ROOT/skills/${ref#skills/}"
  if [[ ! -e "$target" ]]; then
    err "Broken skill reference: skills/$ref (expected $target)"
  fi
done < <(grep -rhoE 'skills/[a-z0-9./_-]+\.(md|mdc)' "$ROOT/skills" "$ROOT/AGENTS.md" 2>/dev/null | sort -u)

# Agent frontmatter must have closing --- within first 20 lines.
for agent in "$ROOT"/agents/*.md; do
  [[ -f "$agent" ]] || continue
  if ! awk 'NR==1{ if ($0!="---") exit 1 } NR>1 && /^---$/{ found=1; exit } END{ exit !found }' "$agent"; then
    err "Invalid or missing YAML frontmatter: $agent"
  fi
done

# React rules should not use bare **/*.ts globs (backend noise when installed globally).
for rule in "$ROOT"/rules/react-*.mdc; do
  [[ -f "$rule" ]] || continue
  if grep -q '\*\*/\*\.ts"' "$rule" || grep -q '\*\*/\*\.js"' "$rule"; then
    warn "Broad ts/js glob in $rule — may fire on non-React files when installed globally"
  fi
done

# Style claims the interview settled. A skill or rule restating an overridden claim
# silently un-teaches the rule that replaced it, which no structural check catches.
# Format: regex % why it is wrong now % path allowed to contain it
STALE_CLAIMS=(
  'not `jest\.mock`%mocking splits by target: hand-rolled fakes for services, jest.mock for own hook modules%'
  '[Nn]o `user-event`%user-event is unresolved on purpose, not banned%'
  'under ~4 props%props always get a named interface, even at one prop%skills/marco-code-style/SKILL.md'
  'past ~2 arguments%single destructured object past one argument%skills/marco-code-style/SKILL.md'
  'Open question, currently mixed%the interview settled every mixed case%'
  'Both conventions coexist%the interview settled every mixed case%'
)

for entry in "${STALE_CLAIMS[@]}"; do
  pattern="${entry%%%*}"
  rest="${entry#*%}"
  why="${rest%%%*}"
  exempt="${rest#*%}"

  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    [[ -n "$exempt" && "$hit" == "$exempt":* ]] && continue
    err "Overridden style claim in $hit — $why"
  done < <(grep -rnE "$pattern" \
    "$ROOT/rules" "$ROOT/skills" "$ROOT/agents" "$ROOT/claude" "$ROOT/codex" "$ROOT/AGENTS.md" \
    2>/dev/null | sed "s|^$ROOT/||")
done

if [[ "$ERRORS" -gt 0 ]]; then
  echo "" >&2
  echo "$ERRORS validation error(s)." >&2
  exit 1
fi

echo "OK — ai-essentials validation passed."

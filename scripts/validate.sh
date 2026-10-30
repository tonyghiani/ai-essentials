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

# No skill or rule may credit an AI tool, and skills must stay repo-agnostic.
if ! scan_output="$(node "$ROOT/scripts/guard/scan_repo.mjs" 2>&1)"; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && err "${line#ERROR: }"
  done <<< "$scan_output"
fi

# Every hook script a reference config registers must exist in the repo.
for ref in "$ROOT/claude/settings.reference.json" "$ROOT/cursor/hooks.reference.json" "$ROOT/codex/hooks.reference.json"; do
  [[ -f "$ref" ]] || continue
  tool_dir="$(basename "$(dirname "$ref")")"
  while IFS= read -r hook; do
    [[ -z "$hook" ]] && continue
    [[ -f "$ROOT/$tool_dir/hooks/$hook" ]] || err "$ref registers a missing hook: $tool_dir/hooks/$hook"
  done < <(grep -oE 'hooks/[a-z0-9-]+\.mjs' "$ref" | sed 's#^hooks/##' | sort -u)
done

# Always-on instructions stay short; the docs recommend under 200 lines.
claude_md_lines="$(wc -l < "$ROOT/claude/CLAUDE.md")"
if [[ "$claude_md_lines" -ge 200 ]]; then
  err "claude/CLAUDE.md is $claude_md_lines lines; keep it under 200"
fi

# Every agent must render for every tool, and read-only agents must stay read-only there.
if command -v python3 &>/dev/null; then
  render_tmp="$(mktemp -d)"
  for tool in claude cursor codex; do
    if ! render_output="$(python3 "$ROOT/setup/render_agents.py" "$ROOT" "$tool" "$render_tmp/$tool" 2>&1)"; then
      err "agents do not render for $tool: $render_output"
    fi
  done
  rm -rf "$render_tmp"
fi

# Permission references must match policy/guardrails.json.
if ! guardrails_output="$(node "$ROOT/scripts/guardrails/render.mjs" --check 2>&1)"; then
  err "$guardrails_output"
fi

# Set VALIDATE_TESTS=1 to also run every test suite (about 30 seconds).
if [[ "${VALIDATE_TESTS:-0}" == "1" ]]; then
  if ! test_output="$(cd "$ROOT" && node --test "scripts/**/*.test.mjs" "setup/*.test.mjs" 2>&1)"; then
    echo "$test_output" | grep -E "✖|fail|Error" | head -40 >&2
    err "node tests failed"
  fi
  if command -v python3 &>/dev/null; then
    if ! py_output="$(cd "$ROOT/setup" && python3 -m unittest discover -p '*_test.py' 2>&1)"; then
      echo "$py_output" | tail -20 >&2
      err "python tests failed"
    fi
  fi
fi

if [[ "$ERRORS" -gt 0 ]]; then
  echo "" >&2
  echo "$ERRORS validation error(s)." >&2
  exit 1
fi

echo "OK — ai-essentials validation passed."

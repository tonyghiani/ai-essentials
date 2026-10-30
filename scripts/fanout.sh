#!/usr/bin/env bash
# Run the same mechanical change over a list of files, one headless agent run per file.
# Installed on the PATH as `ai-fanout`.
#
# Usage:
#   ai-fanout --tool claude|codex|cursor --list FILE --prompt TEXT [--all]
#                     [--branch SLUG] [--trial N] [--repo DIR] [--max-turns N] [--budget-usd X] [--timeout-min M]
#                     [--effort LEVEL]
#                     [--no-sandbox] [--allow-domain HOST]... [--allow-write PATH]...
#
# TEXT may contain {file}. Each run must answer OK or FAIL on its last line. By default only the
# first 3 files run (a trial): read what went wrong, fix the prompt, then pass --all. The repo must
# be on a branch the agent created; pass --branch SLUG to create one from the current HEAD.
#
# Claude runs at --effort (default high: unattended, so it verifies its own edge cases).
# Caps per run: --max-turns and --max-budget-usd for Claude; --timeout-min (perl alarm) for Codex and Cursor.
# Claude runs sandboxed, as in ai-delegate (see scripts/work/sandbox_settings.mjs); --no-sandbox turns it off.
# Test seam: AI_ESSENTIALS_TOOL_CMD replaces the tool, with $AI_ESSENTIALS_PROMPT and $AI_ESSENTIALS_FILE set.
set -euo pipefail

# Resolve symlinks, so the script finds the rest of ai-essentials when it is run through the
# ai-delegate / ai-fanout links the installer puts on the PATH.
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
HERE="$(cd -P "$(dirname "$SOURCE")" && pwd)"
WORK_CLI=(node "$HERE/work/cli.mjs")

TOOL="" LIST="" PROMPT="" BRANCH_SLUG="" ALL=false TRIAL=3 REPO="$PWD" MAX_TURNS=20 BUDGET_USD=2 EFFORT=high TIMEOUT_MIN=15 TIMEOUT_SEC=""
SANDBOX=true SANDBOX_FLAGS=()

die() { printf 'fanout: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool) TOOL="$2"; shift 2 ;;
    --list) LIST="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --branch) BRANCH_SLUG="$2"; shift 2 ;;
    --all) ALL=true; shift ;;
    --trial) TRIAL="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --budget-usd) BUDGET_USD="$2"; shift 2 ;;
    --effort) EFFORT="$2"; shift 2 ;;
    --timeout-min) TIMEOUT_MIN="$2"; shift 2 ;;
    --timeout-sec) TIMEOUT_SEC="$2"; shift 2 ;;
    --no-sandbox) SANDBOX=false; shift ;;
    --allow-domain|--allow-write) SANDBOX_FLAGS+=("$1" "$2"); shift 2 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$TOOL" || -n "${AI_ESSENTIALS_TOOL_CMD:-}" ]] || die "--tool claude|codex|cursor is required"
[[ -f "$LIST" ]] || die "--list must name a file with one path per line"
[[ -n "$PROMPT" ]] || die "--prompt is required"
if [[ -n "$BRANCH_SLUG" ]]; then
  "${WORK_CLI[@]}" branch "$BRANCH_SLUG" --cwd "$REPO" >&2 || die "could not create the branch (is the working tree clean?)"
fi
"${WORK_CLI[@]}" is-agent-branch --cwd "$REPO" || die "$REPO is not on a branch the agent created; pass --branch <slug> to create one"

# macOS ships bash 3.2, which has no mapfile.
FILES=()
while IFS= read -r line; do
  [[ -n "${line//[[:space:]]/}" ]] && FILES+=("$line")
done < "$LIST"
[[ ${#FILES[@]} -gt 0 ]] || die "$LIST has no files"
if [[ "$ALL" != true ]]; then
  FILES=("${FILES[@]:0:$TRIAL}")
  printf 'fanout: trial run on the first %s of the list; pass --all for the rest\n' "${#FILES[@]}" >&2
fi

TIMEOUT_SEC="${TIMEOUT_SEC:-$((TIMEOUT_MIN * 60))}"
CLAUDE_EXTRA=()
if [[ "$TOOL" == claude && "$SANDBOX" == true ]]; then
  STATE="${AI_ESSENTIALS_STATE:-$HOME/.ai-essentials/state}"
  RUN_SETTINGS="$STATE/run-settings/fanout-$(basename "$REPO").json"
  node "$HERE/work/sandbox_settings.mjs" --out "$RUN_SETTINGS" \
    --git-dir "$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)" --state "$STATE" \
    ${SANDBOX_FLAGS[@]+"${SANDBOX_FLAGS[@]}"}
  CLAUDE_EXTRA=(--settings "$RUN_SETTINGS")
fi
OK=0 FAILED=0
for file in "${FILES[@]}"; do
  prompt="${PROMPT//\{file\}/$file}

Reply with OK or FAIL as the last line. Do not push, do not open a PR."
  out="$(mktemp)"
  status=0
  pushd "$REPO" >/dev/null
  if [[ -n "${AI_ESSENTIALS_TOOL_CMD:-}" ]]; then
    AI_ESSENTIALS_PROMPT="$prompt" AI_ESSENTIALS_FILE="$file" perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SEC" bash -c "$AI_ESSENTIALS_TOOL_CMD" >"$out" 2>&1 || status=$?
  elif [[ "$TOOL" == claude ]]; then
    claude -p "$prompt" --permission-mode auto --max-turns "$MAX_TURNS" --max-budget-usd "$BUDGET_USD" --effort "$EFFORT" ${CLAUDE_EXTRA[@]+"${CLAUDE_EXTRA[@]}"} </dev/null >"$out" 2>&1 || status=$?
  elif [[ "$TOOL" == codex ]]; then
    perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SEC" codex exec --approve-for-me -C "$REPO" "$prompt" </dev/null >"$out" 2>&1 || status=$?
  elif [[ "$TOOL" == cursor ]]; then
    perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SEC" "${AI_ESSENTIALS_CURSOR_BIN:-agent}" -p --force --trust --sandbox enabled --workspace "$REPO" --output-format text "$prompt" </dev/null >"$out" 2>&1 || status=$?
  else
    popd >/dev/null; die "unknown tool: $TOOL"
  fi
  popd >/dev/null
  verdict="$(grep -E '^(OK|FAIL)\s*$' "$out" | tail -1 || true)"
  if [[ "$status" -eq 0 && "$verdict" == OK ]]; then
    OK=$((OK + 1)); printf 'OK\t%s\n' "$file"
  else
    FAILED=$((FAILED + 1)); printf 'FAIL\t%s\t(exit %s)\t%s\n' "$file" "$status" "$(tail -3 "$out" | tr '\n' ' ' | cut -c1-200)"
  fi
  rm -f "$out"
done

printf 'fanout: %s ok, %s failed\n' "$OK" "$FAILED" >&2
[[ "$FAILED" -eq 0 ]]

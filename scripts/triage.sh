#!/usr/bin/env bash
# End-of-day triage: one headless, read-only Claude Code run over the user's GitHub queue that leaves
# a Markdown report for the next morning. Installed on the PATH as `ai-triage`; a LaunchAgent runs it
# on weekday evenings.
#
# Usage:
#   ai-triage [--max-turns N] [--budget-usd X] [--effort LEVEL] [--allow-tool RULE]... [--dry-run]
#
# Effort defaults to low: the run only reads and summarises, so extra verification buys nothing.
#
# The report lands in <state>/triage/<YYYY-MM-DD>.md, and <state>/triage/latest.md points at it. On
# failure the exit status is non-zero, the tool's stderr and its result event stay in
# <state>/triage/<YYYY-MM-DD>.err, and latest.md keeps pointing at the last good report.
#
# Read-only by construction, not by request:
#   - Permission mode dontAsk, not auto: a call no allow rule covers is denied outright instead of
#     going to the auto-mode classifier, so the allowlist below is the boundary and not a hint.
#   - The allowlist names read-only gh subcommands only. `gh api` stays out: -X or -f turns a GET
#     into a write, and a permission pattern cannot tell them apart.
#   - --setting-sources project, run from a scratch directory with no project settings: the user's
#     own allow rules (git commit, gh pr create, any write they ever approved) never load, so they
#     cannot widen this run. Checked with a real run: a command only user settings allow was denied.
#     The deny list below stays as a second layer.
#   - The skill writes no file. Its final message is the report, and this script saves it, so the
#     run needs no file tool at all.
#   - An OS sandbox from sandbox_settings.mjs, with auto-approval of sandboxed Bash turned off so a
#     sandboxed command still needs an allow rule.
# --allow-tool adds one allow rule, for a connector's read tool (a Slack search, say).
#
# Test seam: AI_ESSENTIALS_TOOL_CMD replaces the claude invocation with any command, run in the
# scratch directory with the prompt in $AI_ESSENTIALS_PROMPT. Its stdout is taken as the report.
set -euo pipefail

# Resolve symlinks, so the script finds the rest of ai-essentials when it runs through the ai-triage
# link the installer puts on the PATH.
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
HERE="$(cd -P "$(dirname "$SOURCE")" && pwd)"
REPO_HOME="$(cd "$HERE/.." && pwd)"

MAX_TURNS=30 BUDGET_USD=2 EFFORT=low DRY_RUN=false EXTRA_ALLOW=()

die() { printf 'triage: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --budget-usd) BUDGET_USD="$2"; shift 2 ;;
    --effort) EFFORT="$2"; shift 2 ;;
    --allow-tool) EXTRA_ALLOW+=("$2"); shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) sed -n '2,27p' "$SOURCE"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# A LaunchAgent starts with a bare PATH; a missing node would otherwise surface as a confusing
# failure halfway through.
command -v node >/dev/null || die "node is not on the PATH"

STATE="${AI_ESSENTIALS_STATE:-$HOME/.ai-essentials/state}"
TRIAGE="$STATE/triage"
DATE="$(date +%F)"
REPORT="$TRIAGE/$DATE.md"
ERR="$TRIAGE/$DATE.err"
# Emptied on every run: there is no repository here, and nothing an earlier run left may become input.
WORK="$TRIAGE/work"
SETTINGS="$STATE/run-settings/triage.json"
PROMPT="/daily-triage $DATE"

rm -rf "$WORK"
mkdir -p "$WORK"

# The scratch directory doubles as the git and state directory the sandbox may write: the run has no
# repository and keeps nothing, so no other path needs to be writable.
node "$REPO_HOME/scripts/work/sandbox_settings.mjs" --out "$SETTINGS" --git-dir "$WORK" --state "$WORK"
node -e '
const fs = require("fs");
const file = process.argv[1];
const settings = JSON.parse(fs.readFileSync(file, "utf8"));
// Delegated runs auto-approve sandboxed Bash; here every command must match the read-only allowlist.
settings.sandbox.autoAllowBashIfSandboxed = false;
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
' "$SETTINGS"

ALLOW=(
  "Skill(daily-triage)"
  "Bash(gh status)"
  "Bash(gh status *)"
  "Bash(gh search prs *)"
  "Bash(gh search issues *)"
  "Bash(gh pr view *)"
  "Bash(gh pr list *)"
  "Bash(gh pr checks *)"
  "Bash(gh pr diff *)"
  "Bash(gh issue view *)"
  "Bash(gh issue list *)"
  "Bash(gh run view *)"
  ${EXTRA_ALLOW[@]+"${EXTRA_ALLOW[@]}"}
)
DENY=(Write Edit NotebookEdit "Bash(git *)" "Bash(gh api *)" "Bash(gh pr create *)" "Bash(node *)")

# One comma-joined value per flag: the rules contain spaces, and a single argument cannot be split
# differently by the CLI's list parser.
join_rules() { local IFS=,; printf '%s' "$*"; }

CLAUDE_ARGS=(-p "$PROMPT" --permission-mode dontAsk --setting-sources project --max-turns "$MAX_TURNS" --max-budget-usd "$BUDGET_USD" --effort "$EFFORT"
  --output-format json --settings "$SETTINGS"
  --allowedTools "$(join_rules "${ALLOW[@]}")" --disallowedTools "$(join_rules "${DENY[@]}")")

if [[ "$DRY_RUN" == true ]]; then
  printf 'cd %q && claude' "$WORK"
  printf ' %q' "${CLAUDE_ARGS[@]}"
  printf '\n'
  exit 0
fi

EXIT=0
pushd "$WORK" >/dev/null
if [[ -n "${AI_ESSENTIALS_TOOL_CMD:-}" ]]; then
  AI_ESSENTIALS_PROMPT="$PROMPT" bash -c "$AI_ESSENTIALS_TOOL_CMD" </dev/null > "$WORK/report.md" 2> "$ERR" || EXIT=$?
else
  claude "${CLAUDE_ARGS[@]}" </dev/null > "$WORK/result.json" 2> "$ERR" || EXIT=$?
  if [[ "$EXIT" -eq 0 ]]; then
    # The final result event carries the skill's last message, which is the report. A run that hit the
    # turn or budget cap still exits 0 on some versions, so its subtype decides, not the exit code.
    node -e '
const fs = require("fs");
const [file, out] = process.argv.slice(1);
let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (error) {
  console.error("claude printed no JSON result");
  process.exit(1);
}
const result = Array.isArray(parsed) ? parsed.filter((event) => event.type === "result").pop() : parsed;
const report = typeof result?.result === "string" ? result.result.trim() : "";
if (result?.is_error || result?.subtype !== "success" || report === "") {
  console.error(`claude ended with ${result?.subtype ?? "no result"}`);
  process.exit(1);
}
fs.writeFileSync(out, report + "\n");
' "$WORK/result.json" "$WORK/report.md" 2>> "$ERR" || EXIT=$?
  fi
fi
popd >/dev/null

if [[ "$EXIT" -ne 0 || ! -s "$WORK/report.md" ]]; then
  [[ -s "$WORK/result.json" ]] && cat "$WORK/result.json" >> "$ERR"
  [[ "$EXIT" -ne 0 ]] || EXIT=1
  printf 'triage: run failed (exit %s); see %s\n' "$EXIT" "$ERR" >&2
  exit "$EXIT"
fi

# A rename, so latest.md never points at half a report.
mv "$WORK/report.md" "$REPORT"
ln -sfn "$DATE.md" "$TRIAGE/latest.md"
rm -f "$ERR"
printf '%s\n' "$REPORT"

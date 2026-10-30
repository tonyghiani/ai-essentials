#!/usr/bin/env bash
# Run one task headlessly in its own git worktree, with caps, then audit the result. The task is a
# ticket, an issue link, or just a description. Installed on the PATH as `ai-delegate`.
#
# Usage:
#   ai-delegate --tool claude|codex|cursor [--repo DIR] [--slug NAME] [--base REF]
#                       [--max-turns N] [--budget-usd X] [--timeout-min M]
#                       [--no-sandbox] [--allow-domain HOST]... [--allow-write PATH]...
#                       <ticket text | @file>
#   ai-delegate --tool ... --spec SPEC.md --task ID --base PARENT-BRANCH [notes]
#   ai-delegate --remove --repo DIR --slug NAME
#
# The worktree is created from the repo in --repo (default: the current directory), beside that repo
# (<repo>.worktrees/<slug>, or $AI_WORKTREES_DIR), on a new branch named <github-login>/<slug>,
# recorded as the agent's. It prints a JSON summary and leaves the worktree for review.
#
# Two modes:
#   whole task   the tool runs the tech-lead skill and, when checks pass and the audit is clean,
#                ends by opening a draft PR through open-draft-pr.
#   --task ID    one task of a spec a tech lead already wrote (--spec), for parallel work. The tool
#                runs the deliver skill on that task only, commits, and pushes nothing: the tech lead
#                merges the branch into its own and opens the one PR.
#
# Commits are checked by a commit-msg hook scoped to the run (see below), in any tool.
#
# Caps: Claude Code gets --max-turns and --max-budget-usd. Codex and Cursor (binary: agent) have
# neither flag, so the wrapper enforces --timeout-min with perl's alarm (macOS has no `timeout`).
# Cursor needs its `agent` CLI (see cursor.com/docs/cli) and CURSOR_API_KEY or a login; its flags
# follow Cursor's docs and are untested against a real install on this machine.
#
# Sandbox: Claude Code runs with an OS sandbox from a per-run --settings file. Bash may write only
# inside the worktree, the repo's git directory, the ai-essentials state directory and the
# --allow-write paths, and reach only the --allow-domain hosts (GitHub and the npm registry by
# default). gh and git network commands run outside it, still behind the guard hook. --no-sandbox
# turns it off. Codex and Cursor use their own sandbox flags (below).
#
# Done means done: the same settings file adds a prompt-based Stop hook (what /goal is built on), so
# a separate model lets the run stop only on shown evidence, and AI_ESSENTIALS_ENFORCE_LEDGER makes the
# Stop gate refuse to end the run while the branch's task ledger (`ai-work task`) is empty or has a task
# open. The variable lives only in this run's environment, so later interactive sessions are not held.
#
# Test seam: AI_ESSENTIALS_TOOL_CMD replaces the tool invocation with any command, run inside
# the worktree with the prompt in $AI_ESSENTIALS_PROMPT. Its stdout goes to stderr, so the JSON summary
# on stdout stays the only thing this script prints.
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
REPO_HOME="$(cd "$HERE/.." && pwd)"
WORK_CLI=(node "$REPO_HOME/scripts/work/cli.mjs")
VERIFY_CLI=(node "$REPO_HOME/scripts/verify/cli.mjs")
AUDIT=(node "$REPO_HOME/scripts/guard/audit_branch.mjs")

TOOL="" REPO="$PWD" SLUG="" BASE="" MAX_TURNS=40 BUDGET_USD=10 TIMEOUT_MIN=45 TIMEOUT_SEC="" REMOVE=false TICKET=""
SPEC="" TASK="" SANDBOX=true SANDBOX_FLAGS=()

die() { printf 'delegate: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool) TOOL="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --max-turns) MAX_TURNS="$2"; shift 2 ;;
    --budget-usd) BUDGET_USD="$2"; shift 2 ;;
    --timeout-min) TIMEOUT_MIN="$2"; shift 2 ;;
    --timeout-sec) TIMEOUT_SEC="$2"; shift 2 ;;
    --spec) SPEC="$2"; shift 2 ;;
    --task) TASK="$2"; shift 2 ;;
    --no-sandbox) SANDBOX=false; shift ;;
    --allow-domain|--allow-write) SANDBOX_FLAGS+=("$1" "$2"); shift 2 ;;
    --remove) REMOVE=true; shift ;;
    -h|--help) sed -n '2,37p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) TICKET="$1"; shift ;;
  esac
done

ROOT="$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null)" || die "$REPO is not inside a git repository"
# Name things after the main checkout, even when --repo points inside one of its worktrees.
COMMON_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)"
if [[ "$(basename "$COMMON_DIR")" == .git ]]; then MAIN="$(dirname "$COMMON_DIR")"; else MAIN="$ROOT"; fi
REPO_NAME="$(basename "$MAIN")"
STATE="${AI_ESSENTIALS_STATE:-$HOME/.ai-essentials/state}"
# Worktrees live beside the repo they belong to, where your own worktrees would: ~/code/app gets
# ~/code/app.worktrees/<slug>. Nothing about them lives in ai-essentials. AI_WORKTREES_DIR overrides.
WORKTREES="${AI_WORKTREES_DIR:-$(dirname "$MAIN")/$REPO_NAME.worktrees}"

slugify() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-40; }

if [[ "$REMOVE" == true ]]; then
  [[ -n "$SLUG" ]] || die "--remove needs --slug"
  git -C "$ROOT" worktree remove --force "$WORKTREES/$(slugify "$SLUG")"
  printf 'removed %s\n' "$WORKTREES/$(slugify "$SLUG")"
  exit 0
fi

[[ -n "$TOOL" || -n "${AI_ESSENTIALS_TOOL_CMD:-}" ]] || die "--tool claude|codex|cursor is required"
if [[ -n "$TASK" ]]; then
  [[ -n "$SPEC" && -f "$SPEC" ]] || die "--task needs --spec pointing at the tech lead's SPEC.md"
  [[ -n "$BASE" ]] || die "--task needs --base: the tech lead's branch, which this task's branch merges back into"
  SPEC="$(cd "$(dirname "$SPEC")" && pwd)/$(basename "$SPEC")"
  [[ -n "$SLUG" ]] || SLUG="task-$TASK"
else
  [[ -n "$TICKET" ]] || die "a task (text or @file) is required"
fi
[[ "$TICKET" == @* ]] && TICKET="$(cat "${TICKET#@}")"
[[ -n "$SLUG" ]] || SLUG="$(printf '%s' "$TICKET" | head -1 | cut -c1-60)"
SLUG="$(slugify "$SLUG")"
[[ -n "$SLUG" ]] || die "could not derive a slug; pass --slug"

LOGIN="$("${WORK_CLI[@]}" login 2>/dev/null || true)"
BRANCH="${LOGIN:+$LOGIN/}$SLUG"
WORKTREE="$WORKTREES/$SLUG"
BASE="${BASE:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
# On a detached HEAD the name is the literal "HEAD", which after the run means the agent's own tip:
# the audit would cover HEAD..HEAD and pass with nothing checked. Pin the commit instead.
[[ "$BASE" != HEAD ]] || BASE="$(git -C "$ROOT" rev-parse HEAD)"
BASE_SHA="$(git -C "$ROOT" rev-parse --verify --quiet "$BASE^{commit}")" || die "--base $BASE does not resolve to a commit"
[[ ! -e "$WORKTREE" ]] || die "$WORKTREE already exists; remove it or pick another --slug"
mkdir -p "$WORKTREES"

git -C "$ROOT" worktree add -q -b "$BRANCH" "$WORKTREE" "$BASE"
"${WORK_CLI[@]}" register "$BRANCH" --base "$BASE" --cwd "$WORKTREE" >/dev/null

# Files the contract says a fresh worktree needs (for example .env), copied from the main checkout.
while IFS= read -r file; do
  [[ -n "$file" && -e "$ROOT/$file" ]] || continue
  mkdir -p "$WORKTREE/$(dirname "$file")"
  cp -p "$ROOT/$file" "$WORKTREE/$file"
done < <("${VERIFY_CLI[@]}" --worktree-copy --cwd "$ROOT")

# A commit-msg hook scoped to this run, so a commit that credits a tool is refused at commit time in
# any tool, with no hook trust step. It is set through GIT_CONFIG_* for the tool process only, so the
# repo's own config is never touched. The repo's existing hooks (core.hooksPath or .git/hooks) are
# wrapped, not replaced: each runs as before, and its commit-msg runs after ours.
ORIG_HOOKS="$(git -C "$WORKTREE" config --get core.hooksPath || true)"
if [[ -z "$ORIG_HOOKS" ]]; then
  ORIG_HOOKS="$(git -C "$WORKTREE" rev-parse --path-format=absolute --git-common-dir)/hooks"
elif [[ "$ORIG_HOOKS" != /* ]]; then
  ORIG_HOOKS="$WORKTREE/$ORIG_HOOKS"
fi
RUN_HOOKS="$STATE/run-hooks/$REPO_NAME-$SLUG"
rm -rf "$RUN_HOOKS"; mkdir -p "$RUN_HOOKS"
for original in "$ORIG_HOOKS"/*; do
  name="$(basename "$original")"
  [[ -f "$original" && -x "$original" && "$name" != commit-msg && "$name" != *.sample ]] || continue
  printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$original" > "$RUN_HOOKS/$name"
  chmod +x "$RUN_HOOKS/$name"
done
cat > "$RUN_HOOKS/commit-msg" <<HOOK
#!/usr/bin/env bash
node "$REPO_HOME/scripts/guard/check_message.mjs" "\$1" || exit 1
if [[ -x "$ORIG_HOOKS/commit-msg" ]]; then exec "$ORIG_HOOKS/commit-msg" "\$@"; fi
exit 0
HOOK
chmod +x "$RUN_HOOKS/commit-msg"

# Bootstrap the worktree if the contract says how (for example an install), so its checks can run.
"${VERIFY_CLI[@]}" --worktree-setup --cwd "$WORKTREE" || {
  printf 'delegate: worktree setup failed; the worktree is kept at %s\n' "$WORKTREE" >&2
  exit 1
}

SPEC_DIR="$("${WORK_CLI[@]}" spec-dir --cwd "$WORKTREE")"
if [[ -n "$TASK" ]]; then
  PROMPT="Use the deliver skill on task $TASK of the spec at $SPEC.

You are running non-interactively in a git worktree on branch $BRANCH, created for this one task by a tech lead working elsewhere. Do not create another branch. Nobody can answer questions while you run:
- implement task $TASK only, touching only the files it names; every other task has its own run;
- decide everything a rule or an approved precedent settles;
- if a decision falls in an always-ask class and the spec does not answer it, write the question with your recommended answer to $SPEC_DIR/questions.md and stop;
- task $TASK is already in the branch's ledger: mark it only after you have shown it works (ai-work task pass $TASK --evidence \"<command and what it showed>\"); the run cannot finish while it is open;
- commit on this branch once the verification contract passes. Do not push and do not open a pull request: the tech lead merges this branch into its own and opens the one PR.${TICKET:+

Notes from the tech lead:
$TICKET}"
else
  # Claude starts the skill as a slash command: tech-lead is not model-invocable, so a request to
  # "use" it would be declined. The other tools read the instruction.
  if [[ "$TOOL" == claude ]]; then LEAD="/tech-lead"; else LEAD="Use the tech-lead skill on the task below."; fi
  PROMPT="$LEAD

You are running non-interactively in a git worktree on branch $BRANCH, which already exists and is recorded as yours. Do not create another branch. Nobody can answer questions while you run:
- decide everything a rule or an approved precedent settles;
- if a decision falls in an always-ask class (see the tech-lead skill) and no answer is given below, write the question with your recommended answer to $SPEC_DIR/questions.md and stop;
- skip the plan gate, but write the task breakdown to $SPEC_DIR/SPEC.md first, and add each task to the ledger (ai-work task add <id> \"<title>\"); mark one only after you have shown it works (ai-work task pass <id> --evidence \"<command and what it showed>\"); the run cannot finish while any is open;
- finish by running open-draft-pr only if the verification contract passes and the branch audit is clean; otherwise stop and report.

Task (a ticket, or just a description; do not ask for a ticket):
$TICKET"
fi

# Claude's sandbox for this run only, layered over the user's settings with --settings.
# It also carries the done-when evaluator (the mechanism behind /goal): a separate model decides
# whether the run may stop, so the agent that did the work does not grade it.
RUN_SETTINGS="$STATE/run-settings/$REPO_NAME-$SLUG.json"
[[ "$SANDBOX" == true ]] || SANDBOX_FLAGS+=(--no-sandbox)
node "$REPO_HOME/scripts/work/sandbox_settings.mjs" --out "$RUN_SETTINGS" --git-dir "$COMMON_DIR" --state "$STATE" \
  --done-when "$([[ -n "$TASK" ]] && echo task || echo whole)" ${SANDBOX_FLAGS[@]+"${SANDBOX_FLAGS[@]}"}
# A branch name, and so its spec directory, can come back after a deleted branch: start the ledger
# clean. In --task mode the task is known, so it is registered here rather than left to the agent.
node -e 'import(process.argv[1]).then((m) => m.resetLedger(process.argv[2]))' "$REPO_HOME/scripts/work/tasks.mjs" "$SPEC_DIR"
if [[ -n "$TASK" ]]; then
  "${WORK_CLI[@]}" task add "$TASK" "task $TASK of $(basename "$SPEC")" --cwd "$WORKTREE" >/dev/null
fi

TIMEOUT_SEC="${TIMEOUT_SEC:-$((TIMEOUT_MIN * 60))}"
EXIT=0
START="$(date +%s)"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0="$RUN_HOOKS"
# The tool's hooks inherit this, so the Stop gate holds this run, and only this run, to its task ledger.
export AI_ESSENTIALS_ENFORCE_LEDGER=1
pushd "$WORKTREE" >/dev/null
if [[ -n "${AI_ESSENTIALS_TOOL_CMD:-}" ]]; then
  AI_ESSENTIALS_PROMPT="$PROMPT" perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SEC" bash -c "$AI_ESSENTIALS_TOOL_CMD" >&2 || EXIT=$?
elif [[ "$TOOL" == claude ]]; then
  # stream-json keeps every step, so a failed run can be read as a trace and not only as a result.
  CLAUDE_ARGS=(-p "$PROMPT" --permission-mode auto --max-turns "$MAX_TURNS" --max-budget-usd "$BUDGET_USD" --output-format stream-json --verbose --settings "$RUN_SETTINGS")
  claude "${CLAUDE_ARGS[@]}" </dev/null > "$SPEC_DIR/run.jsonl" 2> "$SPEC_DIR/run.err" || EXIT=$?
elif [[ "$TOOL" == codex ]]; then
  perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SEC" \
    codex exec --approve-for-me -C "$WORKTREE" "$PROMPT" \
    </dev/null > "$SPEC_DIR/run.txt" 2> "$SPEC_DIR/run.err" || EXIT=$?
elif [[ "$TOOL" == cursor ]]; then
  perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SEC" \
    "${AI_ESSENTIALS_CURSOR_BIN:-agent}" -p --force --trust --sandbox enabled --workspace "$WORKTREE" \
    --output-format text "$PROMPT" \
    </dev/null > "$SPEC_DIR/run.txt" 2> "$SPEC_DIR/run.err" || EXIT=$?
else
  popd >/dev/null; die "unknown tool: $TOOL"
fi
popd >/dev/null
unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 AI_ESSENTIALS_ENFORCE_LEDGER
SECONDS_TAKEN=$(( $(date +%s) - START ))

AUDIT_OUT="$("${AUDIT[@]}" --cwd "$WORKTREE" --base "$BASE_SHA" 2>&1)" && AUDIT_OK=true || AUDIT_OK=false
VERIFY_OUT="$("${VERIFY_CLI[@]}" --cwd "$WORKTREE" 2>&1)" && VERIFY_OK=true || VERIFY_OK=false
COMMITS="$(git -C "$WORKTREE" rev-list --count "$BASE_SHA..HEAD")"

node -e '
const fs = require("fs");
const [, branch, worktree, specDir, exit, seconds, commits, auditOk, audit, verifyOk, verify, task] = process.argv;
// Claude ends its stream with one "result" event carrying cost and turns; other tools report neither.
const stream = specDir + "/run.jsonl";
const result = fs.existsSync(stream)
  ? fs.readFileSync(stream, "utf8").split("\n").flatMap((line) => {
      try { const event = JSON.parse(line); return event.type === "result" ? [event] : []; } catch (error) { return []; }
    }).pop()
  : undefined;
console.log(JSON.stringify({
  branch, worktree, specDir, task: task || null, toolExit: Number(exit), seconds: Number(seconds), commits: Number(commits),
  costUsd: result?.total_cost_usd ?? null, turns: result?.num_turns ?? null,
  audit: { ok: auditOk === "true", output: audit },
  verify: { ok: verifyOk === "true", output: verify.slice(0, 800) },
  questions: fs.existsSync(specDir + "/questions.md"),
}, null, 2));
' "$BRANCH" "$WORKTREE" "$SPEC_DIR" "$EXIT" "$SECONDS_TAKEN" "$COMMITS" "$AUDIT_OK" "$AUDIT_OUT" "$VERIFY_OK" "$VERIFY_OUT" "$TASK"

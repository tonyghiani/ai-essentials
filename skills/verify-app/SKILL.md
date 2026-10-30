---
name: verify-app
description: Proves a change works in the running app, not only in its tests, reusing an instance that is already running instead of starting another. Compares this checkout against a baseline from another checkout when one is up, and returns a before and after table with evidence. Use after a change with user-visible or runtime behaviour and before review, when the deliver skill reaches verification, or when the user says "verify it in the app", "check it works in the browser", "try it in the running app".
---

# Verify app

Tests prove the code does what the tests say. This skill proves the change does what the user will see: the page renders, the endpoint answers, the command prints the right thing, and nothing new breaks on the way.

## Commands

This skill calls `ai-verify`. If a command is not found, tell the user the setup is not installed and stop; do not improvise a replacement.

| Command | Prints (JSON) |
|---|---|
| `ai-verify --app-status` | `status`, this checkout's `root` and `branch`, the `url` probed, the `probe` result, every `listeners` entry with its `owner`, `checkout` and `branch`, the `baseline` when another checkout serves the app, and `advice` |
| `ai-verify --app-start` | `started` with `pid`, `readyUrl` and `log`, or `refused` / `start-failed` / `start-timeout` with a `reason` |
| `ai-verify --app-start --force-new --port <n>` | the same, starting this checkout beside another instance on port `n` |
| `ai-verify --app-stop` | `stopped`, or `not-started-by-tool` when there is nothing of its own to stop |

All of them read the `app` block of the repo's verification contract. Status `not-configured` means there is none (or it is malformed; the `reason` says which): run the `verify-contract` skill to add it, or ask the user how to start the app. Do not guess a start command.

`--app-start` waits for the app to be ready, which can take minutes. Run it with a Bash timeout above the contract's `readyTimeoutSec` (or in the background, then poll `--app-status`); a timed-out call leaves the app starting, and `--app-status` finds it.

**Which address is "this checkout".** Always test this checkout at the `url` that `--app-status` reports when `startedByTool` is set (the instance you started, possibly on a `--force-new` port), or at the `readyUrl` that `--app-start` printed. The contract's own URL may be the baseline's.

**Nobody to ask.** In an unattended run (started by `ai-delegate`, nobody answering), every "ask the user" below becomes: record `verify-app skipped: <status and reason>` with the status JSON in the implementation notes, and hand back. Never stop someone else's process to make room.

## Procedure

### 1. Find what is running

```bash
ai-verify --app-status
```

| Status | What it means | Do |
|---|---|---|
| `running-here` | a process started from this checkout serves the app | Reuse it. It runs this branch's code. If `baseline` is also set, another checkout is up beside it: that is your "before". |
| `running-elsewhere` | a process from another checkout or worktree of the same repo, named in `baseline` | It does not show this change. Use it as the baseline (the "before"). For the "after", start this checkout on a free port with `--force-new --port <n>` if the app takes its port from the command or `PORT`; otherwise ask the user whether to stop theirs or check out this branch there. |
| `running-unknown` | something answers, owner not identified | Report it and ask. Never stop it. |
| `stopped` | nothing answers | `ai-verify --app-start`. If another checkout of the repo exists and the user wants a baseline, ask before starting a second app. |

Never stop or restart a process you did not start. `ai-verify --app-stop` refuses to, and so do you: no `kill`, no `pkill`, no freeing a port by hand.

### 2. Wait until it serves the latest edit

`ready` only says the server answers. Before testing, confirm the build includes your change: watch the log `--app-start` printed, or the dev server's own output, for a finished rebuild after your last edit. A `start-timeout` means it is still running and may still be compiling; read `logTail` and decide whether to wait longer.

### 3. Exercise the changed behaviour

Test what the change touched, through the surface a user would use:

- **UI**: whichever browser tool the session has (a browser extension tool, a Playwright MCP server, the editor's built-in browser). Navigate to the changed screen, do the user's steps, take a screenshot of each state that matters, and read the browser console.
- **HTTP API**: `curl -sS -i` against the changed routes, including one error case (bad input, missing auth) next to the happy path.
- **CLI**: run the changed command with the arguments the spec names, plus one invalid input.

Run the same steps against the baseline when there is one. A difference you cannot explain is a finding, even when the new side looks right.

### 4. Check that nothing new broke

- Zero new console errors or warnings in the browser on the screens you visited, compared with the baseline.
- Zero new errors in the app log since your change loaded.
- Neighbouring behaviour still works: one adjacent flow the change could plausibly affect.

### 5. Report

Hand back to the caller with:

| Behaviour | Baseline (`<branch>`) | This checkout (`<branch>`) | Result |
|---|---|---|---|
| <step from the spec> | <what happened> | <what happened> | pass / fail / changed as intended |

Then the evidence: screenshot paths or response excerpts for each row, console and log errors (or "none"), the exact commands you ran, and the `ai-verify --app-status` output you started from. With no baseline, drop that column and say why.

If you started the app with `--app-start` and the caller does not need it any more, `ai-verify --app-stop`.

## Stop rules

- Do not edit code inside this skill. A failure is a finding: report it with its evidence and hand back.
- Login or credentials needed: ask the user. Never invent, guess or reuse credentials found in files.
- If the app cannot be reached or started after one honest attempt, report what you saw (status JSON, log tail) instead of trying other start commands.

## Gotchas

- **Stale build.** A server that answers may still serve the code from before your edit: a production build, a crashed watcher, or a bundle cached by the browser. Confirm a rebuild after your last edit and hard-reload the page.
- **Hot reload not finished.** The first request after an edit can hit the old bundle or a half-built one. Wait for the dev server's "compiled" line, not a fixed sleep.
- **Another worktree on the same port.** `running-elsewhere` on the address you expected means you would be testing someone else's branch. The status names its checkout and branch; check it before every claim.
- **Auth walls.** A redirect to a login page counts as ready but tests nothing. Ask the user for access instead of working around it.
- **Self-signed HTTPS.** A local `https` URL with a self-signed certificate fails the probe with a certificate `error`, so the app never looks ready. Read `listeners` for who owns the port before concluding it is down, and say so instead of starting another instance.

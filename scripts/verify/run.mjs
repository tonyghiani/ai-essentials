/**
 * Tool-neutral verification runner. The Stop-hook adapters for Claude Code,
 * Cursor and Codex call runVerify() and only translate the result into each
 * tool's protocol; all decisions live here.
 *
 * Statuses:
 *   skipped   nothing to verify (no repo, no contract, no changed files) or the
 *             run is deliberately allowed to end
 *   pass      every check that applied succeeded
 *   fail      at least one check failed; the agent should fix and retry
 *   escalate  the same failure repeated; the agent must stop and report it
 *
 * @typedef {{ name: string, detail: string }} IFailure
 * @typedef {{ status: 'skipped' | 'pass' | 'fail' | 'escalate', message: string, failures: IFailure[] }} IVerifyResult
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { matchesAny } from '../lib/glob.mjs';
import { changedFiles, repoKey, repoRoot } from '../lib/repo.mjs';
import { appendJsonl, readJson, writeJson } from '../lib/state.mjs';
import { resolveContract } from './contract.mjs';

/** Identical failures in a row before the agent is told to stop retrying. */
export const MAX_IDENTICAL_FAILURES = 3;
const DEFAULT_CHECK_TIMEOUT_SEC = 300;
const EXCERPT_MAX_LINES = 40;
const EXCERPT_MAX_CHARS = 3_000;
const OUTPUT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const ATTEMPTS_FILE = 'verify-attempts.json';
const ATTEMPTS_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Placeholders are whole argv elements so file names with spaces survive and
 * nothing passes through a shell.
 *
 * @param {string[]} cmd
 * @param {{ root: string, files: string[], dirs: string[] }} values
 * @returns {string[] | null} Null when a list placeholder expands to nothing.
 */
export function expandArgv(cmd, { root, files, dirs }) {
  const argv = [];
  for (const part of cmd) {
    if (part === '{files}' || part === '{dirs}') {
      const values = part === '{files}' ? files : dirs;
      if (values.length === 0) {
        return null;
      }
      argv.push(...values);
    } else {
      argv.push(part.replaceAll('{root}', root));
    }
  }
  return argv;
}

/**
 * @param {string} output
 * @returns {string} The tail of the output, which is where failures print.
 */
function excerpt(output) {
  const tail = output.trim().split('\n').slice(-EXCERPT_MAX_LINES).join('\n');
  return tail.length > EXCERPT_MAX_CHARS ? tail.slice(-EXCERPT_MAX_CHARS) : tail;
}

/**
 * @param {import('./contract.mjs').ICheck} check
 * @param {string} root
 * @param {string[]} changed
 * @returns {IFailure | null} Null when the check passed or did not apply.
 */
function runCheck(check, root, changed) {
  const files = changed.filter((file) => matchesAny(file, check.when));
  if (files.length === 0) {
    return null;
  }
  const dirs = [...new Set(files.map((file) => dirname(file)))];
  const argv = expandArgv(check.cmd, { root, files, dirs });
  if (argv === null) {
    return null;
  }
  const [file, ...args] = argv;
  const result = spawnSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: (check.timeoutSec ?? DEFAULT_CHECK_TIMEOUT_SEC) * 1_000,
    maxBuffer: OUTPUT_MAX_BUFFER_BYTES,
  });
  if (result.error !== undefined) {
    const timedOut = 'code' in result.error && result.error.code === 'ETIMEDOUT';
    return {
      name: check.name,
      detail: timedOut
        ? `timed out after ${check.timeoutSec ?? DEFAULT_CHECK_TIMEOUT_SEC}s`
        : `could not run: ${result.error.message}`,
    };
  }
  if (result.status === 0) {
    return null;
  }
  return {
    name: check.name,
    detail: `exit ${result.status}\n${excerpt(`${result.stdout}\n${result.stderr}`)}`,
  };
}

/**
 * Count identical consecutive failures per session, so a stuck loop ends before
 * the tool's own block cap does.
 *
 * @param {string} sessionId
 * @param {IFailure[]} failures
 * @returns {number} How many times this exact failure has now occurred in a row.
 */
function recordFailure(sessionId, failures) {
  const signature = createHash('sha1').update(JSON.stringify(failures)).digest('hex');
  const now = Date.now();
  const stored = readJson(ATTEMPTS_FILE, {});
  const live = Object.fromEntries(
    Object.entries(stored).filter(([, entry]) => now - entry.at < ATTEMPTS_TTL_MS),
  );
  const previous = live[sessionId];
  const count = previous?.signature === signature ? previous.count + 1 : 1;
  writeJson(ATTEMPTS_FILE, { ...live, [sessionId]: { signature, count, at: now } });
  return count;
}

/** @param {string} sessionId */
function clearFailures(sessionId) {
  const stored = readJson(ATTEMPTS_FILE, {});
  if (sessionId in stored) {
    const { [sessionId]: removed, ...rest } = stored;
    writeJson(ATTEMPTS_FILE, rest);
  }
}

/**
 * @param {IFailure[]} failures
 * @returns {string}
 */
function formatFailures(failures) {
  const body = failures.map((failure) => `[${failure.name}] ${failure.detail}`).join('\n\n');
  return `Verification failed (${failures.length} check${failures.length === 1 ? '' : 's'}). Fix these before finishing, and report the command you ran and its output:\n\n${body}`;
}

/**
 * @param {{ cwd: string, sessionId?: string }} options
 * @returns {IVerifyResult}
 */
export function runVerify({ cwd, sessionId = 'default' }) {
  const root = repoRoot(cwd);
  if (root === null) {
    return { status: 'skipped', message: 'not inside a git repository', failures: [] };
  }

  const resolved = resolveContract(root);
  if (resolved.status === 'none') {
    return { status: 'skipped', message: 'no verification contract for this repo', failures: [] };
  }
  if (resolved.status === 'untrusted') {
    return {
      status: 'skipped',
      message: `${resolved.path} is not trusted; review it, then run: ai-verify --trust`,
      failures: [],
    };
  }
  if (resolved.status === 'invalid') {
    const failure = { name: 'contract', detail: `${resolved.path}: ${resolved.reason}` };
    return { status: 'fail', message: formatFailures([failure]), failures: [failure] };
  }

  const changed = changedFiles(root);
  if (changed.length === 0) {
    return { status: 'skipped', message: 'no changed files', failures: [] };
  }

  const failures = resolved.contract.checks.flatMap((check) => {
    const failure = runCheck(check, root, changed);
    return failure === null ? [] : [failure];
  });

  if (failures.length === 0) {
    clearFailures(sessionId);
    return { status: 'pass', message: 'all checks passed', failures: [] };
  }

  const count = recordFailure(sessionId, failures);
  for (const failure of failures) {
    appendJsonl('verify-failures.jsonl', {
      at: new Date().toISOString(),
      repo: repoKey(root),
      session: sessionId,
      check: failure.name,
      excerpt: failure.detail.slice(0, 600),
    });
  }

  if (count > MAX_IDENTICAL_FAILURES) {
    return {
      status: 'skipped',
      message: `same failure ${count} times; letting the turn end`,
      failures,
    };
  }
  if (count === MAX_IDENTICAL_FAILURES) {
    return {
      status: 'escalate',
      message: `${formatFailures(failures)}\n\nThis exact failure has now happened ${count} times in a row. Stop retrying: report the blocker and the failing output to the user, then end your turn.`,
      failures,
    };
  }
  return { status: 'fail', message: formatFailures(failures), failures };
}

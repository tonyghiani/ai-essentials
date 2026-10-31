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
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { matchesAny } from '../lib/glob.mjs';
import { changedFiles, repoKey, repoRoot } from '../lib/repo.mjs';
import { appendJsonl, updateJson } from '../lib/state.mjs';
import { currentBranch, isAgentBranch, specDir } from '../work/branches.mjs';
import { ledgerEnforced, ledgerGaps } from '../work/tasks.mjs';
import { resolveContract } from './contract.mjs';
import { testIntegrityFailure } from './test_integrity.mjs';

/** Identical failures in a row before the agent is told to stop retrying. */
export const MAX_IDENTICAL_FAILURES = 3;
/**
 * Failing stops in a row, whatever the output, before the agent is told to stop.
 * The backstop for checks whose output never repeats exactly. At or under
 * Cursor's loop_limit (5) and Claude Code's block cap, so this hook escalates
 * with a reason before the tool cuts the loop without one.
 */
export const MAX_CONSECUTIVE_BLOCKS = 5;
const DEFAULT_CHECK_TIMEOUT_SEC = 300;
/**
 * All checks together. Kept under the Stop hook's timeout in each tool's
 * reference config (1200s): a hook the tool kills logs nothing and the turn
 * ends unverified, while running out of budget here is reported as a failure.
 */
export const VERIFY_BUDGET_SEC = 1_080;
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
 * @param {{ root: string, changed: string[], remainingSec: number }} options
 * @returns {IFailure | null} Null when the check passed or did not apply.
 */
function runCheck(check, { root, changed, remainingSec }) {
  const files = changed.filter((file) => matchesAny(file, check.when));
  if (files.length === 0) {
    return null;
  }
  const dirs = [...new Set(files.map((file) => dirname(file)))];
  const argv = expandArgv(check.cmd, { root, files, dirs });
  if (argv === null) {
    return null;
  }
  if (remainingSec <= 0) {
    return { name: check.name, detail: `not run: the ${VERIFY_BUDGET_SEC}s verification budget was spent on earlier checks; scope or speed them up in the contract` };
  }
  const timeoutSec = Math.min(check.timeoutSec ?? DEFAULT_CHECK_TIMEOUT_SEC, remainingSec);
  const [file, ...args] = argv;
  const result = spawnSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutSec * 1_000,
    maxBuffer: OUTPUT_MAX_BUFFER_BYTES,
  });
  if (result.error !== undefined) {
    const timedOut = 'code' in result.error && result.error.code === 'ETIMEDOUT';
    return {
      name: check.name,
      detail: timedOut ? `timed out after ${Math.round(timeoutSec)}s` : `could not run: ${result.error.message}`,
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
 * Numbers and temp paths vary between runs of the same failure (timings,
 * durations, mkdtemp names). Left in, they make every failure look new and the
 * identical-failure count never reaches its limit.
 *
 * @param {IFailure[]} failures
 * @returns {string}
 */
function signatureOf(failures) {
  const normalised = failures.map(({ name, detail }) => ({
    name,
    detail: detail
      .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/\S*/g, '<tmp>')
      .replace(/\d+(?:\.\d+)?/g, 'N'),
  }));
  return createHash('sha1').update(JSON.stringify(normalised)).digest('hex');
}

/**
 * Count failing stops per session: in a row with the same failure, and in a row
 * with any failure. Either reaching its limit ends the loop.
 *
 * @param {string} sessionId
 * @param {IFailure[]} failures
 * @returns {{ identical: number, blocks: number }}
 */
function recordFailure(sessionId, failures) {
  const signature = signatureOf(failures);
  const now = Date.now();
  const written = updateJson(ATTEMPTS_FILE, {}, (stored) => {
    const live = Object.fromEntries(
      Object.entries(stored).filter(([, entry]) => now - entry.at < ATTEMPTS_TTL_MS),
    );
    const previous = live[sessionId];
    const identical = previous?.signature === signature ? previous.count + 1 : 1;
    const blocks = (previous?.blocks ?? 0) + 1;
    return { ...live, [sessionId]: { signature, count: identical, blocks, at: now } };
  });
  return { identical: written[sessionId].count, blocks: written[sessionId].blocks };
}

/** @param {string} sessionId */
function clearFailures(sessionId) {
  updateJson(ATTEMPTS_FILE, {}, (stored) => {
    const { [sessionId]: removed, ...rest } = stored;
    return rest;
  });
}

/**
 * @param {string} root
 * @returns {{ status: 'ran', failures: IFailure[] } | { status: 'skipped', message: string }}
 */
function runContractChecks(root) {
  const resolved = resolveContract(root);
  if (resolved.status === 'none') {
    return { status: 'skipped', message: 'no verification contract for this repo' };
  }
  if (resolved.status === 'untrusted') {
    return { status: 'skipped', message: `${resolved.path} is not trusted; review it, then run: ai-verify --trust` };
  }
  if (resolved.status === 'invalid') {
    return { status: 'ran', failures: [{ name: 'contract', detail: `${resolved.path}: ${resolved.reason}` }] };
  }
  const changed = changedFiles(root);
  // Read before the empty check: changedFiles drops deleted files, so a change that only deletes a
  // test would otherwise look like no change at all.
  const integrity = resolved.contract.testIntegrity === false ? null : testIntegrityFailure(root);
  if (changed.length === 0) {
    return integrity === null ? { status: 'skipped', message: 'no changed files' } : { status: 'ran', failures: [integrity] };
  }
  // A loop, not flatMap: each check's timeout depends on the time the earlier ones used.
  const startedAt = Date.now();
  const failures = [];
  for (const check of resolved.contract.checks) {
    const remainingSec = VERIFY_BUDGET_SEC - (Date.now() - startedAt) / 1_000;
    const failure = runCheck(check, { root, changed, remainingSec });
    if (failure !== null) {
      failures.push(failure);
    }
  }
  return { status: 'ran', failures: integrity === null ? failures : [...failures, integrity] };
}

/**
 * In an unattended run, the ledger must be written and every task in it shown
 * to pass, unless the run stopped to ask: a question for the user is a
 * legitimate way to end one. Interactive sessions are never held to it.
 *
 * @param {string} root
 * @returns {IFailure | null}
 */
function ledgerFailure(root) {
  if (!ledgerEnforced()) {
    return null;
  }
  const branch = currentBranch(root);
  // Only agent branches have a ledger; checking first also keeps specDir from creating a spec
  // directory for every branch of every repo a session stops in.
  if (branch === null || !isAgentBranch(root, branch)) {
    return null;
  }
  const dir = specDir(root, branch);
  if (existsSync(join(dir, 'questions.md'))) {
    return null;
  }
  const { empty, open } = ledgerGaps(dir);
  const askHint = `If something needs the user, write the question to ${join(dir, 'questions.md')} and stop.`;
  if (empty) {
    return { name: 'tasks', detail: `the task ledger is empty. Add the spec's tasks with: ai-work task add <id> "<title>", and mark each once shown to work. ${askHint}` };
  }
  if (open.length === 0) {
    return null;
  }
  const list = open.map((task) => `${task.id} ${task.title}`).join('; ');
  return {
    name: 'tasks',
    detail: `not shown to pass yet: ${list}. Verify each, then record it with: ai-work task pass <id> --evidence "<command and what it showed>". ${askHint}`,
  };
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

  const checked = runContractChecks(root);
  // The ledger is checked even when there is no contract or nothing changed: an unattended run that
  // stops with tasks still open has not finished, whatever the checks say.
  const ledger = ledgerFailure(root);
  const failures = [...(checked.status === 'ran' ? checked.failures : []), ...(ledger === null ? [] : [ledger])];

  if (failures.length === 0) {
    clearFailures(sessionId);
    return checked.status === 'ran'
      ? { status: 'pass', message: 'all checks passed', failures: [] }
      : { status: 'skipped', message: checked.message, failures: [] };
  }

  const { identical, blocks } = recordFailure(sessionId, failures);
  for (const failure of failures) {
    appendJsonl('verify-failures.jsonl', {
      at: new Date().toISOString(),
      repo: repoKey(root),
      session: sessionId,
      check: failure.name,
      excerpt: failure.detail.slice(0, 600),
    });
  }

  if (identical > MAX_IDENTICAL_FAILURES || blocks > MAX_CONSECUTIVE_BLOCKS) {
    return {
      status: 'skipped',
      message: `verification failed ${blocks} stops in a row; letting the turn end`,
      failures,
    };
  }
  if (identical === MAX_IDENTICAL_FAILURES || blocks === MAX_CONSECUTIVE_BLOCKS) {
    const why =
      identical === MAX_IDENTICAL_FAILURES
        ? `This exact failure has now happened ${identical} times in a row.`
        : `Verification has now failed ${blocks} stops in a row.`;
    return {
      status: 'escalate',
      message: `${formatFailures(failures)}\n\n${why} Stop retrying: report the blocker and the failing output to the user, then end your turn.`,
      failures,
    };
  }
  return { status: 'fail', message: formatFailures(failures), failures };
}

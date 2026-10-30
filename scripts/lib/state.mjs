/**
 * Machine-local runtime state for ai-essentials hooks and scripts.
 *
 * Lives under ~/.ai-essentials/state, never inside a repository: the logs hold
 * prompt text and command output, and ai-essentials itself is a public repo.
 * AI_ESSENTIALS_STATE overrides the location so tests never touch the real one.
 */

import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_MAX_ENTRIES = 400;
/** A lock older than this belongs to a process that died holding it. */
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 20;

/** @returns {string} Absolute path of the state directory, created on demand. */
export function stateDir() {
  const dir = process.env.AI_ESSENTIALS_STATE ?? join(homedir(), '.ai-essentials', 'state');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} name File name inside the state directory.
 * @returns {string} Absolute path.
 */
export function statePath(name) {
  return join(stateDir(), name);
}

/**
 * Append one JSON line and keep the file bounded so a later reader (the
 * memory-distill skill, the doctor script) can always load it whole.
 *
 * @param {string} name File name inside the state directory.
 * @param {Record<string, unknown>} entry
 * @param {number} [maxEntries]
 */
export function appendJsonl(name, entry, maxEntries = DEFAULT_MAX_ENTRIES) {
  const path = statePath(name);
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  if (lines.length > maxEntries) {
    writeFileSync(path, `${lines.slice(-maxEntries).join('\n')}\n`, 'utf8');
  }
}

/**
 * @template T
 * @param {string} name
 * @param {T} fallback Returned when the file is missing or unreadable.
 * @returns {T}
 */
export function readJson(name, fallback) {
  try {
    return JSON.parse(readFileSync(statePath(name), 'utf8'));
  } catch (error) {
    return fallback;
  }
}

/**
 * Written to a temporary file and renamed into place, so a reader in another
 * process never sees half a file.
 *
 * @param {string} name
 * @param {unknown} value
 */
export function writeJson(name, value) {
  const path = statePath(name);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

/** @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Read, change and write one state file under a lock. Parallel ai-delegate runs
 * and hooks share these files; without the lock, two writers that read the same
 * version each drop the other's change (a branch registration, a failure count).
 *
 * @template T
 * @param {string} name
 * @param {T} fallback Used when the file is missing or unreadable.
 * @param {(current: T) => T} update
 * @returns {T} The value written.
 */
export function updateJson(name, fallback, update) {
  const lock = `${statePath(name)}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  // A loop because acquiring is a retry: mkdir is atomic, so exactly one process creates the lock.
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > LOCK_STALE_MS) {
        rmSync(lock, { recursive: true, force: true });
      } else if (Date.now() > deadline) {
        throw new Error(`timed out waiting for the lock on ${name}`);
      } else {
        sleep(LOCK_RETRY_MS);
      }
    }
  }
  try {
    const next = update(readJson(name, fallback));
    writeJson(name, next);
    return next;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

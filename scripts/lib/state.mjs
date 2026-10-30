/**
 * Machine-local runtime state for ai-essentials hooks and scripts.
 *
 * Lives under ~/.ai-essentials/state, never inside a repository: the logs hold
 * prompt text and command output, and ai-essentials itself is a public repo.
 * AI_ESSENTIALS_STATE overrides the location so tests never touch the real one.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_MAX_ENTRIES = 400;

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
 * @param {string} name
 * @param {unknown} value
 */
export function writeJson(name, value) {
  writeFileSync(statePath(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

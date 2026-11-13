/**
 * The files each agent session wrote through its edit tools. The Stop gate
 * checks these instead of the branch's diff from a base: a branch that took in
 * upstream commits, or a base branch that went stale, otherwise hands the
 * session other people's changes to verify and blocks it on them.
 *
 * Edits made through a shell command (sed, a heredoc) are not recorded, so a
 * session that only edits that way is not gated. Run `ai-verify` by hand then.
 */

import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { readJson, updateJson } from '../lib/state.mjs';

const EDITS_FILE = 'session-edits.json';
/** Sessions idle longer than this are dropped, so the file never grows without bound. */
const EDITS_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * @typedef {{ at: number, files: string[] }} ISessionEdits
 */

/**
 * @param {{ sessionId: string, cwd: string, file: string }} options `file` may be absolute or relative to `cwd`.
 */
export function recordEdit({ sessionId, cwd, file }) {
  const path = resolve(cwd, file);
  const now = Date.now();
  updateJson(EDITS_FILE, /** @type {Record<string, ISessionEdits>} */ ({}), (stored) => {
    const live = Object.fromEntries(
      Object.entries(stored).filter(([, entry]) => now - entry.at < EDITS_TTL_MS),
    );
    const files = new Set(live[sessionId]?.files ?? []);
    files.add(path);
    return { ...live, [sessionId]: { at: now, files: [...files] } };
  });
}

/**
 * @param {{ sessionId: string, root: string }} options
 * @returns {string[]} Repo-relative POSIX paths the session wrote inside `root` that still exist, sorted.
 */
export function sessionEdits({ sessionId, root }) {
  const stored = /** @type {Record<string, ISessionEdits>} */ (readJson(EDITS_FILE, {}));
  const files = (stored[sessionId]?.files ?? [])
    .map((path) => relative(root, path).split('\\').join('/'))
    .filter((file) => file !== '' && !file.startsWith('..') && existsSync(resolve(root, file)));
  return [...new Set(files)].sort();
}

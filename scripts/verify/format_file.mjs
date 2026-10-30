/**
 * Run the repo's formatter on one file the agent just edited. Formatting is a
 * rule with no exceptions, so it runs from a hook instead of depending on the
 * model remembering a line in CLAUDE.md.
 */

import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { matchesAny } from '../lib/glob.mjs';
import { repoRoot } from '../lib/repo.mjs';
import { resolveContract } from './contract.mjs';

const DEFAULT_FORMAT_TIMEOUT_SEC = 60;

/**
 * @param {{ cwd: string, file: string }} options `file` may be absolute or relative to `cwd`.
 * @returns {{ ran: boolean, ok: boolean, message: string }}
 */
export function formatFile({ cwd, file }) {
  const root = repoRoot(cwd);
  if (root === null) {
    return { ran: false, ok: true, message: 'not inside a git repository' };
  }
  const resolved = resolveContract(root);
  if (resolved.status !== 'ok' || resolved.contract.format === undefined) {
    return { ran: false, ok: true, message: 'no formatter in the contract' };
  }

  const { cmd, when, timeoutSec } = resolved.contract.format;
  const relativeFile = relative(root, resolve(cwd, file)).split('\\').join('/');
  if (relativeFile.startsWith('..') || !matchesAny(relativeFile, when)) {
    return { ran: false, ok: true, message: 'file is outside the formatter scope' };
  }

  const argv = cmd.map((part) =>
    part.replaceAll('{file}', relativeFile).replaceAll('{root}', root),
  );
  const [command, ...args] = argv;
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: (timeoutSec ?? DEFAULT_FORMAT_TIMEOUT_SEC) * 1_000,
  });
  const ok = result.error === undefined && result.status === 0;
  return { ran: true, ok, message: ok ? 'formatted' : `${result.stderr}${result.error?.message ?? ''}`.trim() };
}

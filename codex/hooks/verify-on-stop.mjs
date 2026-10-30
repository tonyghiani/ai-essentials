#!/usr/bin/env node
/**
 * Stop hook for Codex. Exit 2 with the reason on stderr makes Codex continue
 * with that reason as the next prompt (documented behaviour).
 *
 * UNVERIFIED: Codex project hooks need an interactive trust review in /hooks
 * before they run, so the stdin field names here follow the docs, not a
 * captured payload. Input reading is defensive and falls back to the working
 * directory. Confirm with scripts/doctor after the first trusted session.
 */

import { logHookError, pickCwd, pickSession, readHookInput } from '../../scripts/lib/hook_io.mjs';
import { runVerify } from '../../scripts/verify/run.mjs';

const BLOCK_EXIT_CODE = 2;

try {
  const input = readHookInput();
  const result = runVerify({ cwd: pickCwd(input), sessionId: pickSession(input) });
  if (result.status === 'fail' || result.status === 'escalate') {
    process.stderr.write(`${result.message}\n`);
    process.exit(BLOCK_EXIT_CODE);
  }
} catch (error) {
  logHookError('verify-on-stop', error);
}
process.exit(0);

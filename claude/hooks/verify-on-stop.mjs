#!/usr/bin/env node
/**
 * Stop hook for Claude Code. Runs the repo's verification contract and, when a
 * check fails, exits 2 with the failure on stderr, which Claude Code feeds back
 * to the model as the reason it cannot finish yet.
 *
 * All decisions live in scripts/verify/run.mjs; this file only translates the
 * result into Claude's protocol. Fails open on its own errors and records them
 * in ~/.ai-essentials/state/hook-errors.jsonl so the doctor script can report a
 * gate that has quietly stopped working.
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

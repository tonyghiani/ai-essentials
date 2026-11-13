#!/usr/bin/env node
/**
 * Stop hook for Claude Code. Runs the repo's verification contract and, when a
 * check fails, exits 2 with the failure on stderr, which Claude Code feeds back
 * to the model as the reason it cannot finish yet.
 *
 * Checks only the files this session wrote through Edit or Write, which
 * format-on-edit.mjs records, so a turn that edited nothing is never blocked by
 * changes it did not make. The Cursor and Codex adapters still check the whole
 * branch: their edit-hook payloads have not been captured, so a recorded edit
 * list there could be silently empty.
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
  const result = runVerify({ cwd: pickCwd(input), sessionId: pickSession(input), scope: 'session' });
  if (result.status === 'fail' || result.status === 'escalate') {
    process.stderr.write(`${result.message}\n`);
    process.exit(BLOCK_EXIT_CODE);
  }
} catch (error) {
  logHookError('verify-on-stop', error);
}
process.exit(0);

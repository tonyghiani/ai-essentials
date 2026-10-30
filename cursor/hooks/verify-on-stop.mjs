#!/usr/bin/env node
/**
 * Stop hook for Cursor. Cursor continues the agent when a stop hook prints a
 * non-empty `followup_message`, submitting it as the next user message. The
 * hook's loop_limit (default 5) bounds the retries on Cursor's side.
 *
 * UNVERIFIED: the Cursor CLI is not installed on this machine, so the stdin
 * field names follow the docs, not a captured payload. Input reading is
 * defensive (workspace_roots, conversation_id) and falls back to the working
 * directory. Confirm in the Cursor app and record the real payload.
 */

import { logHookError, pickCwd, pickSession, readHookInput } from '../../scripts/lib/hook_io.mjs';
import { runVerify } from '../../scripts/verify/run.mjs';

try {
  const input = readHookInput();
  const result = runVerify({ cwd: pickCwd(input), sessionId: pickSession(input) });
  if (result.status === 'fail' || result.status === 'escalate') {
    process.stdout.write(`${JSON.stringify({ followup_message: result.message })}\n`);
  }
} catch (error) {
  logHookError('verify-on-stop', error);
}
process.exit(0);

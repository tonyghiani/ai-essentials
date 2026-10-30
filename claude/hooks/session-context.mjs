#!/usr/bin/env node
/**
 * SessionStart hook for Claude Code. Prints the branch, spec, task ledger and
 * contract state, which Claude Code adds to the context before the first turn.
 * SessionStart also fires with source "compact" after a compaction, which is
 * the only way to re-inject context then: PostCompact has no decision control.
 *
 * All logic lives in scripts/work/session_context.mjs. Fails open: on its own
 * error it prints nothing and records the error for the doctor script.
 */

import { logHookError, pickCwd, pickString, readHookInput } from '../../scripts/lib/hook_io.mjs';
import { sessionContext } from '../../scripts/work/session_context.mjs';

try {
  const input = readHookInput();
  const text = sessionContext({ cwd: pickCwd(input), source: pickString(input, ['source']) });
  if (text !== '') {
    process.stdout.write(`${text}\n`);
  }
} catch (error) {
  logHookError('session-context', error);
}
process.exit(0);

#!/usr/bin/env node
/**
 * SessionStart hook for Codex. Codex adds a SessionStart hook's plain stdout as
 * developer context, including after a compaction (source "compact"), so this
 * is the same adapter as Claude Code's.
 *
 * All logic lives in scripts/work/session_context.mjs. Fails open. Like every
 * Codex hook it runs only after the user trusts it in /hooks.
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

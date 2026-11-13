#!/usr/bin/env node
/**
 * PostToolUse hook for Claude Code (matcher: Edit|Write). Records the file for
 * the session, so the Stop gate checks what this session wrote and nothing
 * else, then runs the formatter named in the repo's verification contract on
 * it. Never blocks: a formatter failure is logged, and the Stop gate catches
 * real problems.
 */

import {
  logHookError,
  pickCwd,
  pickEditedFile,
  pickSession,
  readHookInput,
} from '../../scripts/lib/hook_io.mjs';
import { formatFile } from '../../scripts/verify/format_file.mjs';
import { recordEdit } from '../../scripts/verify/session_edits.mjs';

try {
  const input = readHookInput();
  const file = pickEditedFile(input);
  if (file !== undefined) {
    // Its own try: a failed record only costs this edit its Stop check, never its formatting.
    try {
      recordEdit({ sessionId: pickSession(input), cwd: pickCwd(input), file });
    } catch (error) {
      logHookError('format-on-edit', error);
    }
    const result = formatFile({ cwd: pickCwd(input), file });
    if (result.ran && !result.ok) {
      logHookError('format-on-edit', new Error(result.message));
    }
  }
} catch (error) {
  logHookError('format-on-edit', error);
}
process.exit(0);

#!/usr/bin/env node
/**
 * PostToolUse hook for Claude Code (matcher: Edit|Write). Runs the formatter
 * named in the repo's verification contract on the file that was just written.
 * Never blocks: a formatter failure is logged, and the Stop gate catches real
 * problems.
 */

import {
  logHookError,
  pickCwd,
  pickEditedFile,
  readHookInput,
} from '../../scripts/lib/hook_io.mjs';
import { formatFile } from '../../scripts/verify/format_file.mjs';

try {
  const input = readHookInput();
  const file = pickEditedFile(input);
  if (file !== undefined) {
    const result = formatFile({ cwd: pickCwd(input), file });
    if (result.ran && !result.ok) {
      logHookError('format-on-edit', new Error(result.message));
    }
  }
} catch (error) {
  logHookError('format-on-edit', error);
}
process.exit(0);

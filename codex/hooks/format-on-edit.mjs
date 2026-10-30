#!/usr/bin/env node
/**
 * PostToolUse hook for Codex. Runs the formatter from the repo's verification
 * contract on the edited file. Never blocks.
 *
 * UNVERIFIED: Codex edits arrive through its own patch tool, whose PostToolUse
 * payload has not been captured. This reads the file path from the usual
 * fields and does nothing when it cannot find one.
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

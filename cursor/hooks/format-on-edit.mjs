#!/usr/bin/env node
/**
 * afterFileEdit hook for Cursor. Runs the formatter from the repo's
 * verification contract on the edited file. Never blocks.
 *
 * UNVERIFIED: Cursor's afterFileEdit payload has not been captured on this
 * machine. This reads `file_path` and falls back to nothing when it is absent.
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

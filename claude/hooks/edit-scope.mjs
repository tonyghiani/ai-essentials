#!/usr/bin/env node
/**
 * PreToolUse hook for Claude Code (matcher: Edit|Write), registered in the
 * frontmatter of the tech-lead and deliver skills, so it is active only while
 * one of them runs. Exit 2 refuses an edit outside the task's repository and
 * tells the model why. Fails open on its own error: this is a scope fence for
 * a cooperative agent, not a security boundary (the sandbox is that).
 */

import { isRecord, logHookError, pickCwd, pickString, readHookInput } from '../../scripts/lib/hook_io.mjs';
import { checkEditScope } from '../../scripts/guard/edit_scope.mjs';

const BLOCK_EXIT_CODE = 2;

try {
  const input = readHookInput();
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  const filePath = pickString(toolInput, ['file_path', 'path']);
  if (filePath !== undefined) {
    const verdict = checkEditScope({ filePath, cwd: pickCwd(input) });
    if (!verdict.allow) {
      process.stderr.write(`Blocked by the edit scope: ${verdict.reason}\n`);
      process.exit(BLOCK_EXIT_CODE);
    }
  }
} catch (error) {
  logHookError('edit-scope', error);
}
process.exit(0);

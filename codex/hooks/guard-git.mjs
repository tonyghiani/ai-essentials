#!/usr/bin/env node
/**
 * PreToolUse hook for Codex. Same policy as the Claude hook: exit 2 with the
 * reason on stderr blocks the call and returns the reason to the model
 * (documented Codex behaviour).
 *
 * UNVERIFIED: Codex's PreToolUse payload has not been captured, because
 * project hooks need an interactive /hooks trust review first. The command is
 * read from `tool_input.command` and then `command`; confirm after trusting.
 */

import {
  isRecord,
  logHookError,
  pickCwd,
  pickString,
  readHookInput,
} from '../../scripts/lib/hook_io.mjs';
import { checkCommand } from '../../scripts/guard/git.mjs';

const BLOCK_EXIT_CODE = 2;

try {
  const input = readHookInput();
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  const command = pickString(toolInput, ['command', 'cmd']) ?? pickString(input, ['command']);
  if (command !== undefined) {
    const verdict = checkCommand({ command, cwd: pickCwd(input) });
    if (!verdict.allow) {
      process.stderr.write(`Blocked by the agent guard (${verdict.rule}): ${verdict.reason}\n`);
      process.exit(BLOCK_EXIT_CODE);
    }
  }
} catch (error) {
  logHookError('guard-git', error);
}
process.exit(0);

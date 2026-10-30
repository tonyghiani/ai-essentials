#!/usr/bin/env node
/**
 * PreToolUse hook for Claude Code (matcher: Bash). Blocks git and gh commands
 * that would credit an AI tool, override the user's identity, open a PR that is
 * not a draft, mark one ready, merge, or push to a default branch. Exit 2 puts
 * the reason in front of the model, which can then correct the command.
 *
 * Unlike the verification hook this one fails CLOSED on a policy match and open
 * only on its own crash, which is recorded for the doctor script.
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
  const command = pickString(toolInput, ['command']) ?? pickString(input, ['command']);
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

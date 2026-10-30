#!/usr/bin/env node
/**
 * beforeShellExecution hook for Cursor. Same policy as the Claude hook. Cursor
 * documents exit code 2 as "deny" and a JSON `permission: "deny"` response with
 * `agent_message` for the model, so this does both.
 *
 * UNVERIFIED: the Cursor CLI is not installed here and the payload has not been
 * captured. The command is read from `command`, then `tool_input.command`.
 * Cursor's own attribution trailer is added outside the shell, so the branch
 * audit is the layer that catches it; see scripts/guard/audit_branch.mjs.
 */

import {
  isRecord,
  logHookError,
  pickCwd,
  pickString,
  readHookInput,
} from '../../scripts/lib/hook_io.mjs';
import { checkCommandFailClosed } from '../../scripts/guard/git.mjs';

const BLOCK_EXIT_CODE = 2;

try {
  const input = readHookInput();
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  const command = pickString(input, ['command']) ?? pickString(toolInput, ['command']);
  if (command !== undefined) {
    const verdict = checkCommandFailClosed({ command, cwd: pickCwd(input) });
    if (verdict.error !== undefined) {
      logHookError('guard-git', verdict.error);
    }
    if (!verdict.allow) {
      const message = `Blocked by the agent guard (${verdict.rule}): ${verdict.reason}`;
      process.stdout.write(
        `${JSON.stringify({ permission: 'deny', user_message: message, agent_message: message })}\n`,
      );
      process.stderr.write(`${message}\n`);
      process.exit(BLOCK_EXIT_CODE);
    }
  }
} catch (error) {
  logHookError('guard-git', error);
}
process.exit(0);

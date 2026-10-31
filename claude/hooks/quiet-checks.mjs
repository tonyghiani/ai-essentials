#!/usr/bin/env node
/**
 * PostToolUse hook for Claude Code (matcher: Bash). Replaces the output of a
 * passing test, lint or typecheck run with one line naming a file that holds
 * it. Never blocks: on any error the original output goes through.
 */

import {
  isRecord,
  logHookError,
  pickCwd,
  pickSession,
  readHookInput,
} from '../../scripts/lib/hook_io.mjs';
import { repoRoot } from '../../scripts/lib/repo.mjs';
import { resolveContract } from '../../scripts/verify/contract.mjs';
import { checkPrefixes, quietOutput } from '../../scripts/verify/quiet_output.mjs';

try {
  const input = readHookInput();
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  const response = isRecord(input.tool_response) ? input.tool_response : null;
  if (typeof toolInput.command === 'string' && toolInput.run_in_background !== true && response !== null) {
    const root = repoRoot(pickCwd(input));
    const contract = root === null ? null : resolveContract(root);
    const prefixes = contract?.status === 'ok' ? checkPrefixes(contract.contract.checks) : [];
    const replacement = quietOutput({ command: toolInput.command, response, prefixes, sessionId: pickSession(input) });
    if (replacement !== null) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: replacement } }),
      );
    }
  }
} catch (error) {
  logHookError('quiet-checks', error);
}
process.exit(0);

#!/usr/bin/env node
/**
 * Skill usage log for Claude Code, read by ai-checkup to find skills nobody uses.
 *
 * Registered on two events because neither sees every invocation:
 * - PreToolUse with matcher `Skill` fires when the model calls the Skill tool.
 * - UserPromptExpansion fires when the user types `/name`; that path never
 *   reaches PreToolUse.
 *
 * Fails open, always: a bug here must never block a turn.
 */

import { isRecord, logHookError, pickCwd, pickSession, pickString, readHookInput } from '../../scripts/lib/hook_io.mjs';
import { appendJsonl } from '../../scripts/lib/state.mjs';

/** Months of history at a few dozen invocations a day; the checkup reads it whole. */
const MAX_ENTRIES = 5_000;

/**
 * @param {Record<string, unknown>} input
 * @returns {{ skill: string, via: 'model' | 'slash' } | undefined}
 */
function pickSkill(input) {
  if (input.hook_event_name === 'UserPromptExpansion') {
    const name = input.expansion_type === 'slash_command' ? pickString(input, ['command_name']) : undefined;
    return name === undefined ? undefined : { skill: name.replace(/^\//, ''), via: 'slash' };
  }
  if (input.tool_name === 'Skill' && isRecord(input.tool_input)) {
    const name = pickString(input.tool_input, ['skill', 'name']);
    return name === undefined ? undefined : { skill: name, via: 'model' };
  }
  return undefined;
}

try {
  const input = readHookInput();
  const picked = pickSkill(input);
  if (picked !== undefined) {
    appendJsonl(
      'skill-usage.jsonl',
      { at: new Date().toISOString(), session: pickSession(input), skill: picked.skill, via: picked.via, cwd: pickCwd(input) },
      MAX_ENTRIES,
    );
  }
} catch (error) {
  logHookError('log-skill-use', error);
}
process.exit(0);

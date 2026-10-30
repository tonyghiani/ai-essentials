#!/usr/bin/env node
/**
 * Prompt-submit hook for Claude Code (UserPromptSubmit). Logs prompts where the user corrects the
 * assistant or states a preference, so memory-distill can turn them into
 * durable rules. The detection lives in scripts/signals/correction.mjs.
 *
 * Fails open, always: a bug here must never block a turn.
 */

import { logHookError, pickCwd, pickSession, pickString, readHookInput } from '../../scripts/lib/hook_io.mjs';
import { logCorrection } from '../../scripts/signals/correction.mjs';

try {
  const input = readHookInput();
  const prompt = pickString(input, ['prompt', 'user_prompt', 'text']);
  if (prompt !== undefined) {
    logCorrection({ prompt, cwd: pickCwd(input), session: pickSession(input) });
  }
} catch (error) {
  logHookError('log-correction-signal', error);
}
process.exit(0);

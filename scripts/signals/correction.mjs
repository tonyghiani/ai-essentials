/**
 * Detects when the user is correcting the assistant or stating a standing
 * preference, and appends the prompt to a signal log. Pure regex, so it costs
 * no tokens and injects nothing into the conversation.
 *
 * Shared by the Claude Code, Cursor and Codex prompt-submit hooks. The
 * memory-distill skill reads the log and proposes where each theme belongs.
 */

import { appendJsonl } from '../lib/state.mjs';

export const CORRECTIONS_LOG = 'corrections.jsonl';
const MAX_ENTRIES = 400;
const MIN_PROMPT_CHARS = 8;
const PROMPT_EXCERPT_CHARS = 600;

/**
 * Deliberately narrow: a false positive is noise in the distill pass, so only
 * phrasings that reliably mean "you are overriding behaviour" or "this is a
 * standing preference" are matched.
 */
export const SIGNALS = [
  /^\s*(no|nope|wrong|actually|incorrect)\b/i,
  /\b(don't|do not|never|stop) (do|use|add|write|say|call|create|run|assume)/i,
  /\bi (prefer|always|never|hate|don't want|would rather)\b/i,
  /\b(instead of|rather than) (that|this|using)\b/i,
  /\bthat'?s not (what|how|right|correct)\b/i,
  /\bnot what i (asked|wanted|meant)\b/i,
  /\buse .{1,40} instead\b/i,
  /\b(from now on|going forward|in future)\b/i,
  /\bwe (already|don't) (have|use|do)\b/i,
];

/**
 * @param {string} prompt
 * @returns {number} How many correction markers the prompt matches.
 */
export function countSignals(prompt) {
  return prompt.length < MIN_PROMPT_CHARS ? 0 : SIGNALS.filter((signal) => signal.test(prompt)).length;
}

/**
 * @param {{ prompt: string, cwd?: string, session?: string }} input
 * @returns {boolean} True when the prompt was logged.
 */
export function logCorrection({ prompt, cwd, session }) {
  const hits = countSignals(prompt);
  if (hits === 0) {
    return false;
  }
  appendJsonl(
    CORRECTIONS_LOG,
    {
      at: new Date().toISOString(),
      cwd: cwd ?? null,
      session: session ?? null,
      // Truncated: the distill pass needs the gist, not a transcript.
      prompt: prompt.slice(0, PROMPT_EXCERPT_CHARS),
      hits,
    },
    MAX_ENTRIES,
  );
  return true;
}

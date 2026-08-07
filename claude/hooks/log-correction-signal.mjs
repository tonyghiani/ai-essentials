#!/usr/bin/env node
/**
 * UserPromptSubmit hook. Detects when Marco is correcting the assistant and
 * appends the prompt to a signal log. Costs zero tokens: pure regex, no output
 * injected into the conversation.
 *
 * The `memory-distill` skill reads this log and proposes memory files, so
 * preferences get captured at the moment they're expressed instead of being
 * re-litigated every session.
 *
 * Fails open. Any error exits 0 silently so a bad regex can never block a turn.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG = join(homedir(), '.claude', 'memory-signal.jsonl');
const MAX_ENTRIES = 400;

/**
 * Correction and preference markers. Deliberately narrow: a false positive is
 * noise in the distill pass, so only phrasings that reliably indicate the user
 * is overriding behaviour or stating a standing preference are matched.
 */
const SIGNALS = [
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

function main() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return; // no stdin, nothing to do
  }

  const { prompt, cwd, session_id: sessionId } = JSON.parse(raw);
  if (typeof prompt !== 'string' || prompt.length < 8) return;

  const matched = SIGNALS.filter((re) => re.test(prompt));
  if (matched.length === 0) return;

  const entry = {
    // Caller supplies no timestamp; Date here is fine because this runs
    // out-of-process and is never replayed.
    at: new Date().toISOString(),
    cwd: cwd ?? null,
    session: sessionId ?? null,
    // Truncated: the distill pass needs the gist, not a transcript.
    prompt: prompt.slice(0, 600),
    hits: matched.length,
  };

  appendFileSync(LOG, `${JSON.stringify(entry)}\n`, 'utf8');
  trim();
}

/** Keep the log bounded so it never becomes a file the distill pass can't read. */
function trim() {
  if (!existsSync(LOG)) return;
  const lines = readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
  if (lines.length <= MAX_ENTRIES) return;
  writeFileSync(LOG, `${lines.slice(-MAX_ENTRIES).join('\n')}\n`, 'utf8');
}

try {
  main();
} catch {
  // Fail open, always.
}
process.exit(0);

/**
 * Shrinks the output of a passing check to one line. A green test, lint or
 * typecheck run can print thousands of lines, and every one of them is re-read
 * on every later turn of the session. Claude Code only calls PostToolUse for a
 * command that exited 0 (a failing one goes to PostToolUseFailure untouched),
 * so a failure always reaches the agent in full.
 *
 * The full output is written to a temp file and the replacement names it, so
 * the agent can still read a passing run's logs when it needs them. Prefixing
 * a command with AI_VERBOSE=1 skips the rewrite.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Shorter output costs little to keep and is often what the agent asked to see. */
export const QUIET_MIN_LINES = 20;
const OUTPUT_DIR = join(tmpdir(), 'ai-essentials-output');
const PACKAGE_RUNNER = String.raw`(?:(?:npx|bunx|pnpm\s+exec|yarn|pnpm|bun)\s+)?`;
const RUNNER_PATTERNS = [
  new RegExp(String.raw`^${PACKAGE_RUNNER}(?:jest|vitest|mocha|tsc|eslint|pytest|playwright\s+test)\b`),
  /^(?:node\s+--test|go\s+test|cargo\s+test|python3?\s+-m\s+pytest)\b/,
  /^(?:yarn|npm|pnpm|bun)\s+(?:run\s+)?(?:test|lint|typecheck|type-check|type_check)\b/,
];

/**
 * One segment per command in a chain, with leading env assignments dropped, so
 * `cd x && CI=1 yarn jest` is recognised and `git commit -m "fix jest"` is not.
 *
 * @param {string} command
 * @returns {string[]}
 */
function segments(command) {
  return command
    .split(/&&|\|\||[;|]/)
    .map((segment) => segment.trim().replace(/^(?:\w+=\S*\s+)+/, ''));
}

/**
 * The fixed part of each contract check, up to its first placeholder, so a
 * repo's own runner (`node tools/test-runner`) counts as a check too.
 *
 * @param {{ cmd: string[] }[]} checks
 * @returns {string[]}
 */
export function checkPrefixes(checks) {
  return checks
    .map((check) => check.cmd.slice(0, 2).filter((part) => !part.includes('{')).join(' '))
    .filter((prefix) => prefix.includes(' '));
}

/**
 * @param {string} command
 * @param {string[]} prefixes From checkPrefixes.
 * @returns {boolean}
 */
export function isCheckCommand(command, prefixes) {
  if (/\bAI_VERBOSE=1\b/.test(command)) {
    return false;
  }
  return segments(command).some(
    (segment) => RUNNER_PATTERNS.some((pattern) => pattern.test(segment)) || prefixes.some((prefix) => segment.startsWith(prefix)),
  );
}

/**
 * @param {{ command: string, response: Record<string, unknown>, prefixes: string[], sessionId: string }} options
 * @returns {Record<string, unknown> | null} The replacement Bash result, or null to leave the output alone.
 */
export function quietOutput({ command, response, prefixes, sessionId }) {
  const stdout = typeof response.stdout === 'string' ? response.stdout : '';
  const stderr = typeof response.stderr === 'string' ? response.stderr : '';
  const full = [stdout, stderr].filter((part) => part !== '').join('\n');
  const lineCount = full.split('\n').length;
  if (response.interrupted === true || lineCount < QUIET_MIN_LINES || !isCheckCommand(command, prefixes)) {
    return null;
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const logFile = join(OUTPUT_DIR, `${sessionId.replace(/[^\w-]/g, '_')}-${Date.now()}.log`);
  writeFileSync(logFile, `$ ${command}\n${full}\n`);
  return {
    ...response,
    stdout: `✓ exit 0 (${lineCount} lines of output hidden; full output: ${logFile})`,
    stderr: '',
  };
}

/**
 * Reading hook input. Claude Code, Cursor and Codex each send JSON on stdin
 * with slightly different field names, so every read is defensive and falls
 * back to the process working directory. Claude's field names were captured
 * from a live run; Cursor's and Codex's follow their docs and are unverified.
 */

import { readFileSync } from 'node:fs';
import { appendJsonl } from './state.mjs';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @returns {Record<string, unknown>} Parsed stdin, or an empty record. */
export function readHookInput() {
  try {
    const parsed = JSON.parse(readFileSync(0, 'utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} keys Tried in order.
 * @returns {string | undefined}
 */
export function pickString(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }
  return undefined;
}

/**
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
export function pickCwd(input) {
  const roots = input.workspace_roots;
  const firstRoot = Array.isArray(roots) && typeof roots[0] === 'string' ? roots[0] : undefined;
  return pickString(input, ['cwd']) ?? firstRoot ?? process.cwd();
}

/**
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
export function pickSession(input) {
  return pickString(input, ['session_id', 'conversation_id', 'sessionId']) ?? 'default';
}

/**
 * The file a tool just wrote, from whichever field the tool uses.
 *
 * @param {Record<string, unknown>} input
 * @returns {string | undefined}
 */
export function pickEditedFile(input) {
  const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
  return (
    pickString(toolInput, ['file_path', 'path']) ?? pickString(input, ['file_path', 'path'])
  );
}

/**
 * Hooks fail open so a bug never blocks a turn, which also means a broken gate
 * looks like a passing one. Recording the error is what lets the doctor
 * script surface it.
 *
 * @param {string} hook
 * @param {unknown} error
 */
export function logHookError(hook, error) {
  try {
    appendJsonl('hook-errors.jsonl', {
      at: new Date().toISOString(),
      hook,
      message: error instanceof Error ? error.message : String(error),
    });
  } catch (loggingError) {
    // Nothing left to do; the hook must still exit cleanly.
  }
}

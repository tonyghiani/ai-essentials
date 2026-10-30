/**
 * Reading shell command lines well enough for a policy check. Not a shell
 * parser: it splits a line into segments and words the way bash would for the
 * common cases, and errs towards seeing a command that is not really there (a
 * false block) rather than missing one that is.
 */

import { basename } from 'node:path';

/** Operators that start a new command when they appear outside quotes. */
const OPERATORS = ['&&', '||', ';', '|', '&', '\n', '(', ')'];

/**
 * Command substitutions run even inside double quotes. Matched anywhere,
 * including single quotes where they would not run: a false block is the
 * cheaper mistake.
 */
const SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`/g;

/** Programs that run the rest of the line as a command of their own. */
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'time', 'sudo', 'nice', 'builtin', 'xargs']);

/** Shells whose `-c` argument is a command line. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/**
 * Split a command line into the commands it runs. Operators inside quotes are
 * text (`--title "Fix (x)"` stays one segment); command substitutions are added
 * as segments of their own. The inside of `bash -c '...'` is not expanded here:
 * programOf() returns it so the caller can check it as a command line.
 *
 * @param {string} command
 * @returns {string[]} Segments in order, then substitutions.
 */
export function splitSegments(command) {
  const segments = [];
  let current = '';
  /** @type {'"' | "'" | null} */
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote !== null) {
      if (char === '\\' && quote === '"' && index + 1 < command.length) {
        current += char + command[index + 1];
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      current += char;
      continue;
    }
    if (char === '\\' && index + 1 < command.length) {
      current += char + command[index + 1];
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    const operator = OPERATORS.find((candidate) => command.startsWith(candidate, index));
    if (operator !== undefined) {
      segments.push(current);
      current = '';
      index += operator.length - 1;
      continue;
    }
    current += char;
  }
  segments.push(current);
  const substitutions = [...command.matchAll(SUBSTITUTION)].map((match) => match[1] ?? match[2] ?? '');
  return [...segments, ...substitutions];
}

/**
 * Words of one segment with quotes removed and backslash escapes applied, so
 * `"--force"` and `--force` compare equal. An unterminated quote runs to the end.
 *
 * @param {string} segment
 * @returns {string[]}
 */
export function shellWords(segment) {
  const words = [];
  let current = '';
  let inWord = false;
  /** @type {'"' | "'" | null} */
  let quote = null;
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '\\' && index + 1 < segment.length) {
      index += 1;
      current += segment[index];
      inWord = true;
    } else if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) {
        words.push(current);
        current = '';
        inWord = false;
      }
    } else {
      current += char;
      inWord = true;
    }
  }
  if (inWord) {
    words.push(current);
  }
  return words;
}

/**
 * The program a segment runs and its arguments, after dropping `VAR=value`
 * assignments and wrappers such as `env` or `sudo`, with the program reduced to
 * its base name so `/usr/bin/git` reads as `git`.
 *
 * @param {string[]} words
 * @returns {{ program: string, args: string[], inner: string | null }} `inner` is
 *   the command line a shell would run (`bash -c '...'`, `eval ...`), else null.
 */
export function programOf(words) {
  const rest = [...words];
  while (rest.length > 0) {
    if (/^\w+=/.test(rest[0])) {
      rest.shift();
    } else if (WRAPPERS.has(basename(rest[0]))) {
      rest.shift();
      while (rest.length > 0 && rest[0].startsWith('-')) {
        rest.shift();
      }
    } else {
      break;
    }
  }
  const program = rest.length > 0 ? basename(rest[0]) : '';
  const args = rest.slice(1);
  if (program === 'eval') {
    return { program, args, inner: args.join(' ') };
  }
  if (SHELLS.has(program)) {
    const flagIndex = args.findIndex((arg) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
    if (flagIndex !== -1 && flagIndex + 1 < args.length) {
      return { program, args, inner: args[flagIndex + 1] };
    }
  }
  return { program, args, inner: null };
}

/**
 * Expand a cluster of short flags (`-uf`) into single flags (`-u`, `-f`).
 * Long flags and lone short flags pass through.
 *
 * @param {string[]} args
 * @returns {string[]}
 */
export function expandShortFlags(args) {
  return args.flatMap((arg) =>
    /^-[a-zA-Z]{2,}$/.test(arg) ? [...arg.slice(1)].map((flag) => `-${flag}`) : [arg],
  );
}

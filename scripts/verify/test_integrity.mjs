/**
 * Catches a change that makes checks pass by weakening them: a deleted test
 * file, a test switched to .skip or .only, a lint or type error silenced with
 * no reason given, or a test file that lost assertions. Agents do this even when
 * told not to, and a prompt barely moves the rate; a read of the diff does.
 *
 * Everything is counted net per file (added minus removed lines), so moving or
 * reformatting existing code is not a finding. A suppression with a reason
 * (`eslint-disable-next-line rule -- why`, `@ts-expect-error why`) passes.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultBase, git } from '../lib/repo.mjs';

const TEST_FILE = /(?:^|\/)(?:__tests__|tests?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py)$|(?:^|\/)test_[^/]*\.py$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const FOCUS_OR_SKIP = /\b(?:it|test|describe|context|suite)\.(?:skip|only)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(|@pytest\.mark\.skip/g;
// Only inside a comment, so a regex or string that names a directive is not one.
const BARE_SUPPRESSION =
  /(?:\/\/|\/\*)\s*(?:@ts-(?:ignore|nocheck)\b|@ts-expect-error\s*(?:\*\/)?\s*$|eslint-disable(?:-next-line|-line)?\b(?![^\n]*\s--\s))/g;
const ASSERTION = /\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(|\bassert\s/g;
const UNTRACKED_MAX_BYTES = 1024 * 1024;
const LOCAL_BASE_BRANCHES = ['main', 'master'];
/** More files than one session plausibly touches; see readChange. */
const MAX_CHANGED_FILES = 500;
/** Rename detection gives up on big diffs unless the limit is raised, which turns a move into a delete. */
const DIFF_CONFIG = ['-c', `diff.renameLimit=${MAX_CHANGED_FILES * 4}`];

/**
 * @typedef {{ added: string[], removed: string[] }} ILines
 */

/**
 * @param {string} diff Output of `git diff -U0`.
 * @returns {Map<string, ILines>}
 */
export function parseDiff(diff) {
  /** @type {Map<string, ILines>} */
  const files = new Map();
  let current = null;
  for (const line of diff.split('\n')) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header !== null) {
      current = { added: [], removed: [] };
      files.set(header[1], current);
    } else if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      continue;
    } else if (current !== null && line.startsWith('+')) {
      current.added.push(line.slice(1));
    } else if (current !== null && line.startsWith('-')) {
      current.removed.push(line.slice(1));
    }
  }
  return files;
}

/**
 * @param {string[]} lines
 * @param {RegExp} pattern A global regex.
 * @returns {number}
 */
function count(lines, pattern) {
  return lines.reduce((total, line) => total + (line.match(pattern)?.length ?? 0), 0);
}

/**
 * @param {{ deleted: string[], files: Map<string, ILines> }} change
 * @returns {string[]} One line per finding; empty when the tests are intact.
 */
export function integrityFindings({ deleted, files }) {
  const findings = deleted.filter((file) => TEST_FILE.test(file)).map((file) => `${file}: test file deleted`);
  for (const [file, { added, removed }] of files) {
    if (!SOURCE_FILE.test(file) && !/\.(?:py|go)$/.test(file)) {
      continue;
    }
    const isTest = TEST_FILE.test(file);
    const focused = count(added, FOCUS_OR_SKIP) - count(removed, FOCUS_OR_SKIP);
    if (isTest && focused > 0) {
      findings.push(`${file}: ${focused} test${focused === 1 ? '' : 's'} switched to skip or only`);
    }
    const suppressed = count(added, BARE_SUPPRESSION) - count(removed, BARE_SUPPRESSION);
    if (suppressed > 0) {
      findings.push(`${file}: ${suppressed} lint or type suppression${suppressed === 1 ? '' : 's'} added with no reason (write \`-- why\` after the rule, or a reason after @ts-expect-error)`);
    }
    const lost = count(removed, ASSERTION) - count(added, ASSERTION);
    if (isTest && lost > 0) {
      findings.push(`${file}: ${lost} assertion${lost === 1 ? '' : 's'} fewer than before`);
    }
  }
  return findings;
}

/**
 * Where this branch left the default branch. The local branch is preferred over
 * origin's: in a fork checkout origin/main can lag by thousands of commits, and
 * everything between it and HEAD would count as this session's own work. A
 * merge base with the local branch is the fork point however far the branch has
 * moved on since.
 *
 * @param {string} root
 * @returns {string | null}
 */
function forkPoint(root) {
  const local = LOCAL_BASE_BRANCHES.find((branch) => git(root, ['rev-parse', '--verify', '--quiet', branch]) !== null);
  const base = local ?? defaultBase(root);
  return base === null ? null : git(root, ['merge-base', base, 'HEAD']);
}

/**
 * Reads the change the same way changedFiles does: the branch from its fork
 * point, plus anything uncommitted or untracked.
 *
 * @param {string} root
 * @returns {{ deleted: string[], files: Map<string, ILines> } | null} Null when the change is too large
 *   to be one session's work, which means the base is wrong; failing on it would blame the agent for
 *   history it did not write.
 */
function readChange(root) {
  const mergeBase = forkPoint(root);
  const against = mergeBase ?? 'HEAD';
  const status = git(root, [...DIFF_CONFIG, 'diff', '-M', '--name-status', against]) ?? '';
  const statusLines = status.split('\n').filter((line) => line !== '');
  if (statusLines.length > MAX_CHANGED_FILES) {
    return null;
  }
  const deleted = statusLines.filter((line) => line.startsWith('D\t')).map((line) => line.slice(2));
  const files = parseDiff(git(root, [...DIFF_CONFIG, 'diff', '-M', '-U0', '--no-color', against]) ?? '');
  const untracked = (git(root, ['ls-files', '--others', '--exclude-standard']) ?? '').split('\n');
  for (const file of untracked) {
    const path = join(root, file);
    if (file !== '' && existsSync(path) && statSync(path).size <= UNTRACKED_MAX_BYTES) {
      files.set(file, { added: readFileSync(path, 'utf8').split('\n'), removed: [] });
    }
  }
  return { deleted, files };
}

/**
 * @param {string} root
 * @returns {{ name: string, detail: string } | null}
 */
export function testIntegrityFailure(root) {
  const change = readChange(root);
  const findings = change === null ? [] : integrityFindings(change);
  if (findings.length === 0) {
    return null;
  }
  return {
    name: 'test-integrity',
    detail: `${findings.join('\n')}\nRestore what the change weakened. If the task really needs it, stop and ask the user instead of working around this check.`,
  };
}

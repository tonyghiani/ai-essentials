/** Helpers shared by the eval graders. Graders judge outcomes in the repo, not the steps taken. */

import { spawnSync } from 'node:child_process';

/**
 * @param {string} worktree
 * @param {string} base Ref the run started from.
 * @returns {string[]} Files that differ from the base, committed or not, sorted.
 */
export function changedBetween(worktree, base) {
  const run = (/** @type {string[]} */ args) =>
    spawnSync('git', args, { cwd: worktree, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  return [...new Set([...run(['diff', '--name-only', base]), ...run(['ls-files', '--others', '--exclude-standard'])])].sort();
}

/**
 * @param {string} worktree
 * @param {string[]} argv
 * @returns {boolean} True when the command exits 0.
 */
export function passes(worktree, [command, ...args]) {
  // A nested `node --test` inherits NODE_TEST_CONTEXT from an outer test run and then behaves as a
  // child reporter that exits 0 even when tests fail, which would make every grader too lenient.
  const { NODE_TEST_CONTEXT: inherited, ...env } = process.env;
  return spawnSync(command, args, { cwd: worktree, encoding: 'utf8', env }).status === 0;
}

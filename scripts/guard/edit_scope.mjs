/**
 * Edits stay inside the task's repository while a delivery skill runs.
 *
 * Registered by the tech-lead and deliver skills as skill-scoped hooks, so it
 * is active only once one of them has started and costs nothing otherwise. An
 * agent fixing a failing check is tempted to "fix" a sibling package, a global
 * config or a dependency in node_modules; this turns that into a stop and a
 * question instead.
 *
 * Allowed: anything inside the repository (or worktree) the session runs in, any
 * other repository where the agent is on a branch it created (the user named
 * another repo for the task), the ai-essentials state directory (specs,
 * ledgers, notes), Claude Code's auto-memory directories, and temp space.
 *
 * @typedef {{ allow: true } | { allow: false, reason: string }} IScopeVerdict
 */

import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { repoRoot } from '../lib/repo.mjs';
import { stateDir } from '../lib/state.mjs';
import { currentBranch, isAgentBranch } from '../work/branches.mjs';

/**
 * @param {string} path
 * @returns {string} The real path through the nearest existing parent, so a new file compares correctly.
 */
function real(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    const parent = dirname(path);
    return parent === path ? path : join(real(parent), basename(path));
  }
}

/**
 * @param {string} path
 * @param {string} parent
 * @returns {boolean}
 */
function isWithin(path, parent) {
  const rel = relative(parent, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * @param {string} target
 * @returns {boolean} True for a file in Claude Code's per-project memory (~/.claude/projects/<project>/memory/).
 */
function isAutoMemory(target) {
  const rel = relative(real(join(homedir(), '.claude', 'projects')), target);
  return !rel.startsWith('..') && !isAbsolute(rel) && rel.split(sep)[1] === 'memory';
}

/**
 * @param {string} target
 * @returns {boolean} True when the file sits in a repository whose current branch the agent created.
 */
function onAgentBranch(target) {
  const repo = repoRoot(dirname(target));
  const branch = repo === null ? null : currentBranch(repo);
  return repo !== null && branch !== null && isAgentBranch(repo, branch);
}

/**
 * @param {{ filePath: string, cwd: string }} options
 * @returns {IScopeVerdict}
 */
export function checkEditScope({ filePath, cwd }) {
  const target = real(resolve(cwd, filePath));
  const root = real(repoRoot(cwd) ?? cwd);
  const allowed = [root, real(stateDir()), real(tmpdir()), real('/tmp')];
  if (allowed.some((dir) => isWithin(target, dir)) || isAutoMemory(target) || onAgentBranch(target)) {
    return { allow: true };
  }
  return {
    allow: false,
    reason: `${target} is outside this repository (${root}). A delivery changes only its own repo: if the fix belongs elsewhere, stop and tell the user.`,
  };
}

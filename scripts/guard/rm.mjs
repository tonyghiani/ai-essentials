/**
 * Recursive deletes stay inside the repository.
 *
 * A prompt on every recursive delete is the wrong control for unattended runs:
 * with nobody to answer it, the prompt becomes a hard denial, and an agent that
 * could not remove the node_modules its own install created never finishes its
 * commit. This check allows the routine case (a path inside the repo) and blocks
 * the dangerous one (anything outside it, or the repo root itself), in every
 * tool, because the guard hooks all share it.
 *
 * Paths it cannot resolve statically (variables, command substitution) are
 * refused with a message asking for a literal path, rather than guessed at.
 *
 * @typedef {{ allow: true } | { allow: false, rule: string, reason: string }} IVerdict
 */

import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { repoRoot } from '../lib/repo.mjs';
import { programOf, shellWords, splitSegments } from '../lib/shell.mjs';

const RECURSIVE_FLAG = /^-[a-zA-Z]*[rR][a-zA-Z]*$|^--recursive$/;
/** Variables, substitutions, `**`, brace expansion and `~user` all expand to paths this check cannot see. */
const UNRESOLVABLE = /[`${}]|\*\*|^~[^/]/;

/**
 * Scratch locations a task may clean up below, never the location itself. The
 * per-user temp directory is covered through tmpdir(); its parent under
 * /var/folders holds other sessions' files and is not scratch.
 */
const SCRATCH_ROOTS = [tmpdir(), '/tmp', '/private/tmp'];

/**
 * Resolve symlinks through the nearest part of the path that exists, so a path
 * that is not there yet (or is about to be deleted) still compares correctly
 * with its real parent: /tmp is /private/tmp on macOS.
 *
 * @param {string} path
 * @returns {string}
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
 * @returns {boolean} True when path is strictly inside parent.
 */
function isInside(path, parent) {
  const rel = relative(parent, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * @param {string} rawToken
 * @returns {string} The token without surrounding quotes, with a leading ~ or $HOME expanded.
 */
function expandHome(token) {
  if (token === '~' || token.startsWith(`~${sep}`)) {
    return join(homedir(), token.slice(1));
  }
  if (token === '$HOME' || token.startsWith(`$HOME${sep}`)) {
    return join(homedir(), token.slice('$HOME'.length));
  }
  return token;
}

/**
 * @param {string} command Full command line.
 * @param {string} cwd Directory the command will run in.
 * @returns {IVerdict}
 */
export function checkRecursiveDelete(command, cwd) {
  const root = repoRoot(cwd);
  const boundary = real(root ?? cwd);
  const home = real(homedir());
  // Outside a repository the boundary is the working directory, which from the home directory (or
  // above it) would cover everything the user owns.
  const boundaryTooWide = root === null && (boundary === home || isInside(home, boundary));
  const scratchRoots = SCRATCH_ROOTS.map(real);
  // Scratch space is free to clean up only for a repo that lives elsewhere. A repo that is itself
  // under a temp directory (an eval worktree, a test fixture) must not be able to delete its siblings.
  const repoIsScratch = scratchRoots.some((scratchRoot) => boundary === scratchRoot || isInside(boundary, scratchRoot));
  const scratch = repoIsScratch ? [] : scratchRoots;

  for (const segment of splitSegments(command)) {
    const { program, args } = programOf(shellWords(segment));
    if (program !== 'rm' || !args.some((arg) => RECURSIVE_FLAG.test(arg))) {
      continue;
    }
    const paths = args.filter((arg) => !arg.startsWith('-'));
    for (const rawPath of paths) {
      const path = expandHome(rawPath);
      if (UNRESOLVABLE.test(path)) {
        return {
          allow: false,
          rule: 'rm-unresolvable-path',
          reason: `Cannot tell where "${rawPath}" points. Use a literal path inside the repository for a recursive delete.`,
        };
      }
      const absolute = real(resolve(cwd, path));
      if (scratch.some((scratchRoot) => isInside(absolute, scratchRoot))) {
        continue;
      }
      if (boundaryTooWide || !isInside(absolute, boundary)) {
        return {
          allow: false,
          rule: 'rm-outside-repo',
          reason: `Recursive delete of "${rawPath}" reaches outside this repository (or is its root). Delete only paths inside it; ask the user for anything else.`,
        };
      }
    }
  }
  return { allow: true };
}

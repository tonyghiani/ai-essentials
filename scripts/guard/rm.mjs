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

const SEPARATORS = /&&|\|\||;|\||\n/;
const RECURSIVE_FLAG = /^-[a-zA-Z]*[rR][a-zA-Z]*$|^--recursive$/;
const UNRESOLVABLE = /[`$]|\*\*/;

/** Scratch locations a task may clean up freely. */
const SCRATCH_ROOTS = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];

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
function expandHome(rawToken) {
  const token = rawToken.replace(/^["']|["']$/g, '');
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
  const boundary = real(repoRoot(cwd) ?? cwd);
  const scratchRoots = SCRATCH_ROOTS.map(real);
  // Scratch space is free to clean up only for a repo that lives elsewhere. A repo that is itself
  // under a temp directory (an eval worktree, a test fixture) must not be able to delete its siblings.
  const repoIsScratch = scratchRoots.some((root) => boundary === root || isInside(boundary, root));
  const scratch = repoIsScratch ? [] : scratchRoots;

  for (const segment of command.split(SEPARATORS)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    while (tokens.length > 0 && (/^\w+=/.test(tokens[0]) || tokens[0] === 'sudo' || tokens[0] === 'command')) {
      tokens.shift();
    }
    if (tokens[0] !== 'rm' || !tokens.slice(1).some((token) => RECURSIVE_FLAG.test(token))) {
      continue;
    }
    const paths = tokens.slice(1).filter((token) => !token.startsWith('-'));
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
      const insideScratch = scratch.some((root) => absolute === root || isInside(absolute, root));
      if (insideScratch && absolute !== real(tmpdir())) {
        continue;
      }
      if (!isInside(absolute, boundary)) {
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

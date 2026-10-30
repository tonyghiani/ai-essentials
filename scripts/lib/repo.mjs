/**
 * Git helpers shared by the verification and guard scripts. Everything here
 * reads from git itself, so no hook input format is needed to find a repo, its
 * identity, or what changed.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const GIT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const LOCAL_KEY_HASH_LENGTH = 8;
const FALLBACK_BASE_BRANCHES = ['main', 'master'];

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string | null} Trimmed stdout, or null when git exits non-zero.
 */
export function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER_BYTES,
  });
  if (result.error !== undefined || result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

/**
 * @param {string} cwd
 * @returns {string | null} Repository top level, or null outside a repo.
 */
export function repoRoot(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  return root === null || root === '' ? null : root;
}

/**
 * Reduce scp-style, ssh:// and https:// remotes to one comparable form.
 *
 * @param {string} url
 * @returns {string | null} `host/owner/repo`, lower-cased, or null if unparseable.
 */
export function normalizeRemote(url) {
  const trimmed = url.trim().replace(/\.git$/, '');
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(trimmed);
  if (scp !== null) {
    return `${scp[1]}/${scp[2]}`.toLowerCase();
  }
  try {
    const parsed = new URL(trimmed);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch (error) {
    return null;
  }
}

/**
 * The main checkout behind a worktree. A linked worktree has its own top level,
 * but its git common dir is the main checkout's `.git`.
 *
 * @param {string} root Repository top level, possibly a linked worktree.
 * @returns {string}
 */
export function mainCheckout(root) {
  const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return common !== null && basename(common) === '.git' ? dirname(common) : root;
}

/**
 * Stable identity for a repo, used to find its contract and its state.
 * Falls back to a hash of the main checkout's path so remote-less repos still
 * get a unique key, and every worktree of one repo shares it.
 *
 * @param {string} root Repository top level.
 * @returns {string}
 */
export function repoKey(root) {
  const origin = git(root, ['remote', 'get-url', 'origin']);
  const normalized = origin === null ? null : normalizeRemote(origin);
  if (normalized !== null) {
    return normalized;
  }
  const main = mainCheckout(root);
  const hash = createHash('sha1').update(main).digest('hex').slice(0, LOCAL_KEY_HASH_LENGTH);
  return `local/${basename(main)}-${hash}`;
}

/**
 * @param {string} key
 * @returns {string} Flat file name, so a single gitignore glob covers every contract.
 */
export function keyToFileName(key) {
  return `${key.replaceAll('/', '__')}.json`;
}

/**
 * @param {string} root
 * @returns {string | null} The ref the current branch should be compared against.
 */
export function defaultBase(root) {
  const head = git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head !== null && head !== '') {
    return head;
  }
  return (
    FALLBACK_BASE_BRANCHES.find(
      (branch) => git(root, ['rev-parse', '--verify', '--quiet', branch]) !== null,
    ) ?? null
  );
}

/**
 * Files that differ from the base branch, plus anything uncommitted or untracked.
 * Deleted files are dropped because no check can run against them.
 *
 * @param {string} root
 * @returns {string[]} Repo-relative POSIX paths, sorted.
 */
export function changedFiles(root) {
  const base = defaultBase(root);
  const outputs = [
    base === null ? null : git(root, ['diff', '--name-only', `${base}...HEAD`]),
    git(root, ['diff', '--name-only']),
    git(root, ['diff', '--name-only', '--cached']),
    git(root, ['ls-files', '--others', '--exclude-standard']),
  ];
  const unique = new Set(
    outputs
      .flatMap((output) => (output === null ? [] : output.split('\n')))
      .filter((file) => file !== '' && existsSync(join(root, file))),
  );
  return [...unique].sort();
}

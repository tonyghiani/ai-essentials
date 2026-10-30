/**
 * Branch and spec bookkeeping for delegated work.
 *
 * The agent creates its own branch from the current HEAD in whatever repo the
 * prompt runs in, and records it here. The record is how `open-draft-pr` knows a
 * branch is the agent's to push, without relying on a naming pattern: branch
 * names carry no tool name, by policy.
 *
 * @typedef {{ ok: true, branch: string, base: string, specDir: string }
 *   | { ok: false, reason: 'not-a-repo' | 'dirty' | 'exists' | 'git-failed', detail: string }} ICreateResult
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { git, repoKey, repoRoot } from '../lib/repo.mjs';
import { readJson, stateDir, writeJson } from '../lib/state.mjs';

const BRANCHES_FILE = 'branches.json';
const SLUG_MAX_CHARS = 40;

/**
 * @param {string} text
 * @returns {string} Lower-case words joined by hyphens, safe in a branch name.
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_CHARS)
    .replace(/-+$/, '');
}

/**
 * @param {{ prefix?: string, slug: string }} parts
 * @returns {string}
 */
export function branchName({ prefix, slug }) {
  const cleanPrefix = prefix === undefined ? '' : slugify(prefix);
  return cleanPrefix === '' ? slug : `${cleanPrefix}/${slug}`;
}

/**
 * Flat directory name for a repo key or branch, so specs never nest by accident.
 *
 * @param {string} value
 * @returns {string}
 */
function flat(value) {
  return value.replaceAll('/', '__');
}

/**
 * Where the spec, task list and diff for one branch live. Outside the repo, so
 * none of it shows up in a diff or a status.
 *
 * @param {string} root
 * @param {string} branch
 * @returns {string} Created on demand.
 */
export function specDir(root, branch) {
  const dir = join(stateDir(), 'specs', flat(repoKey(root)), flat(branch));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} root
 * @returns {string | null}
 */
export function currentBranch(root) {
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch === null || branch === 'HEAD' ? null : branch;
}

/**
 * @param {string} root
 * @returns {boolean} True when anything is modified, staged or untracked.
 */
export function isDirty(root) {
  return (git(root, ['status', '--porcelain']) ?? '') !== '';
}

/**
 * @param {string} root
 * @param {string} branch
 * @param {string} base
 */
export function registerBranch(root, branch, base) {
  const all = readJson(BRANCHES_FILE, {});
  const key = repoKey(root);
  writeJson(BRANCHES_FILE, {
    ...all,
    [key]: { ...all[key], [branch]: { createdAt: new Date().toISOString(), base } },
  });
}

/**
 * @param {string} root
 * @param {string} branch
 * @returns {boolean} True only for branches this tool created in this repo.
 */
export function isAgentBranch(root, branch) {
  const all = readJson(BRANCHES_FILE, {});
  return all[repoKey(root)]?.[branch] !== undefined;
}

/**
 * Create and check out a new branch from the current HEAD. A dirty tree stops
 * here, because a new branch would carry the uncommitted work along and the
 * user has not said it belongs to this task.
 *
 * @param {{ cwd: string, slug: string, prefix?: string }} options
 * @returns {ICreateResult}
 */
export function createBranch({ cwd, slug, prefix }) {
  const root = repoRoot(cwd);
  if (root === null) {
    return { ok: false, reason: 'not-a-repo', detail: `${cwd} is not inside a git repository` };
  }
  if (isDirty(root)) {
    return {
      ok: false,
      reason: 'dirty',
      detail: 'The working tree has uncommitted changes. Ask the user whether they belong to this task before branching.',
    };
  }
  const cleanSlug = slugify(slug);
  const branch = branchName({ prefix, slug: cleanSlug });
  if (git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null) {
    return { ok: false, reason: 'exists', detail: `Branch ${branch} already exists` };
  }
  const base = currentBranch(root) ?? git(root, ['rev-parse', '--short', 'HEAD']) ?? 'HEAD';
  if (git(root, ['checkout', '-q', '-b', branch]) === null) {
    return { ok: false, reason: 'git-failed', detail: `git checkout -b ${branch} failed` };
  }
  registerBranch(root, branch, base);
  return { ok: true, branch, base, specDir: specDir(root, branch) };
}

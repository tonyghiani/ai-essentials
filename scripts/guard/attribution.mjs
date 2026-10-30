/**
 * Detects text that credits an AI tool for work that must be attributed to the
 * user alone: commit messages, PR and issue bodies, comments, branch names and
 * git identities. Patterns live in policy/attribution-patterns.json so they can
 * be extended without touching code, and validate.sh scans the repo with the
 * same file.
 *
 * @typedef {{ id: string, regex: string, flags?: string }} ITextPattern
 * @typedef {{ text: ITextPattern[], branchPrefixes: string[], identityTokens: string[] }} IAttributionPolicy
 * @typedef {{ id: string, excerpt: string }} IAttributionHit
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoHome } from '../lib/paths.mjs';

const EXCERPT_MAX_CHARS = 80;

/** @type {IAttributionPolicy | null} */
let cached = null;

/** @returns {IAttributionPolicy} */
export function loadPolicy() {
  if (cached === null) {
    const path = join(repoHome(), 'policy', 'attribution-patterns.json');
    cached = JSON.parse(readFileSync(path, 'utf8'));
  }
  return cached;
}

/**
 * @param {string} text
 * @returns {IAttributionHit[]} One hit per pattern that matched.
 */
export function findAttribution(text) {
  return loadPolicy().text.flatMap(({ id, regex, flags }) => {
    const match = new RegExp(regex, flags ?? 'i').exec(text);
    return match === null ? [] : [{ id, excerpt: match[0].trim().slice(0, EXCERPT_MAX_CHARS) }];
  });
}

/**
 * @param {string} branch
 * @returns {string | null} The tool-named prefix the branch starts with, if any.
 */
export function findBranchPrefix(branch) {
  return loadPolicy().branchPrefixes.find((prefix) => branch.toLowerCase().startsWith(prefix)) ?? null;
}

/**
 * A git identity that names an AI tool means the commit credits the tool.
 *
 * @param {string} nameOrEmail
 * @returns {boolean}
 */
export function isToolIdentity(nameOrEmail) {
  const value = nameOrEmail.toLowerCase();
  return loadPolicy().identityTokens.some((token) => new RegExp(`\\b${token}\\b`).test(value));
}

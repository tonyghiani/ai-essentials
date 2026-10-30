/**
 * Verification contract: the per-repo list of commands that prove a change is
 * done. Skills never hardcode a repo's commands; they read them from here.
 *
 * Lookup order:
 *   1. <repo>/.ai/verify.json, only if the repo owns one and you trusted it.
 *      A cloned repo can ship arbitrary commands, and the Stop hook would run
 *      them on every turn, so an unreviewed repo-owned file never runs.
 *   2. <ai-essentials>/contracts/<repo-key>.json, which you authored.
 *
 * @typedef {{ name: string, cmd: string[], when?: string[], timeoutSec?: number }} ICheck
 * @typedef {{ cmd: string[], when?: string[], timeoutSec?: number }} IFormat
 * @typedef {{ cmd: string[], timeoutSec?: number }} ISetupStep
 * @typedef {{ checks: ICheck[], format?: IFormat, worktree?: { copy?: string[], setup?: ISetupStep[] }, app?: { run?: string } }} IContract
 *
 * @typedef {{ status: 'none' }
 *   | { status: 'untrusted', path: string }
 *   | { status: 'invalid', path: string, reason: string }
 *   | { status: 'ok', path: string, source: 'repo' | 'local', contract: IContract }} IResolvedContract
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { keyToFileName, repoKey } from '../lib/repo.mjs';
import { isRecord } from '../lib/hook_io.mjs';
import { repoHome } from '../lib/paths.mjs';
import { readJson, writeJson } from '../lib/state.mjs';

export { repoHome };

const TRUST_FILE = 'trusted-contracts.json';
const REPO_OWNED_CONTRACT = join('.ai', 'verify.json');

/** @returns {string} Directory holding your own per-repo contracts. */
export function contractsDir() {
  return process.env.AI_ESSENTIALS_CONTRACTS ?? join(repoHome(), 'contracts');
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * @param {unknown} command
 * @param {string} label
 * @returns {string | null} A problem description, or null when valid.
 */
function commandProblem(command, label) {
  if (!isStringArray(command) || command.length === 0) {
    return `${label}.cmd must be a non-empty array of strings (no shell string)`;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string | null} A problem description, or null when the contract is valid.
 */
export function contractProblem(value) {
  if (!isRecord(value) || !Array.isArray(value.checks)) {
    return 'expected an object with a "checks" array';
  }
  for (const [index, check] of value.checks.entries()) {
    if (!isRecord(check) || typeof check.name !== 'string') {
      return `checks[${index}] needs a string "name"`;
    }
    const problem = commandProblem(check.cmd, `checks[${index}]`);
    if (problem !== null) {
      return problem;
    }
    if (check.when !== undefined && !isStringArray(check.when)) {
      return `checks[${index}].when must be an array of globs`;
    }
  }
  if (value.worktree !== undefined) {
    if (!isRecord(value.worktree)) {
      return 'worktree must be an object';
    }
    if (value.worktree.copy !== undefined && !isStringArray(value.worktree.copy)) {
      return 'worktree.copy must be an array of file paths';
    }
    for (const [index, step] of (Array.isArray(value.worktree.setup) ? value.worktree.setup : []).entries()) {
      const problem = isRecord(step) ? commandProblem(step.cmd, `worktree.setup[${index}]`) : `worktree.setup[${index}] must be an object with a cmd`;
      if (problem !== null) {
        return problem;
      }
    }
  }
  if (value.format !== undefined) {
    if (!isRecord(value.format)) {
      return 'format must be an object';
    }
    return commandProblem(value.format.cmd, 'format');
  }
  return null;
}

/**
 * @param {string} path
 * @returns {string}
 */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Record the current content of a repo-owned contract as reviewed.
 *
 * @param {string} path
 */
export function trustContract(path) {
  const trusted = readJson(TRUST_FILE, {});
  writeJson(TRUST_FILE, { ...trusted, [realpathSync(path)]: sha256(path) });
}

/**
 * @param {string} path
 * @returns {boolean} True only if the file is unchanged since it was trusted.
 */
function isTrusted(path) {
  const trusted = readJson(TRUST_FILE, {});
  return isRecord(trusted) && trusted[realpathSync(path)] === sha256(path);
}

/**
 * @param {string} path
 * @param {'repo' | 'local'} source
 * @returns {IResolvedContract}
 */
function loadContract(path, source) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { status: 'invalid', path, reason: 'not valid JSON' };
  }
  const reason = contractProblem(parsed);
  if (reason !== null) {
    return { status: 'invalid', path, reason };
  }
  return { status: 'ok', path, source, contract: parsed };
}

/**
 * @param {string} root Repository top level.
 * @returns {IResolvedContract}
 */
export function resolveContract(root) {
  const repoOwned = join(root, REPO_OWNED_CONTRACT);
  if (existsSync(repoOwned)) {
    return isTrusted(repoOwned)
      ? loadContract(repoOwned, 'repo')
      : { status: 'untrusted', path: repoOwned };
  }
  const local = join(contractsDir(), keyToFileName(repoKey(root)));
  return existsSync(local) ? loadContract(local, 'local') : { status: 'none' };
}

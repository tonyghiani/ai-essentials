#!/usr/bin/env node
/**
 * Second layer of the no-credit policy. The command guard reads command text;
 * this reads what actually landed in git, so it also catches a trailer a tool
 * appended after the commit, or a message typed into an editor.
 *
 *   node scripts/guard/audit_branch.mjs [--cwd <dir>] [--base <ref>] [--body-file <path>]
 *
 * Checks every commit in <base>..HEAD: author and committer must equal the
 * identity configured for the repo, neither may name an AI tool, and no message
 * may match the attribution patterns. With --body-file it checks a PR body too.
 * Exit 0 when clean, 1 with a list of problems otherwise. It never rewrites
 * history; fixing an unpushed commit is the user's call.
 *
 * @typedef {{ commit: string, problem: string }} IAuditProblem
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { defaultBase, git, repoRoot } from '../lib/repo.mjs';
import { findAttribution, isToolIdentity } from './attribution.mjs';

const FIELD_SEPARATOR = '\u001f';
const RECORD_SEPARATOR = '\u001e';
const SHORT_SHA_LENGTH = 10;

/**
 * @param {{ cwd: string, base?: string | null, bodyFile?: string }} options
 * @returns {{ ok: boolean, problems: IAuditProblem[], commits: number }}
 */
export function auditBranch({ cwd, base, bodyFile }) {
  const root = repoRoot(cwd);
  if (root === null) {
    return { ok: false, commits: 0, problems: [{ commit: '-', problem: 'not inside a git repository' }] };
  }

  const expectedName = git(root, ['config', 'user.name']);
  const expectedEmail = git(root, ['config', 'user.email']);
  /** @type {IAuditProblem[]} */
  const problems = [];
  if (!expectedName || !expectedEmail) {
    problems.push({ commit: '-', problem: 'git user.name or user.email is not configured for this repo' });
  }

  const range = base ?? defaultBase(root);
  // An unresolvable base used to read as "zero commits, clean"; an audit that checked nothing must fail.
  if (range !== null && git(root, ['rev-parse', '--verify', '--quiet', `${range}^{commit}`]) === null) {
    problems.push({ commit: '-', problem: `base "${range}" does not resolve to a commit, so nothing was audited` });
    return { ok: false, commits: 0, problems };
  }
  const log = git(root, [
    'log',
    range === null ? 'HEAD' : `${range}..HEAD`,
    `--format=%H${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%cn${FIELD_SEPARATOR}%ce${FIELD_SEPARATOR}%B${RECORD_SEPARATOR}`,
  ]);
  if (log === null) {
    problems.push({ commit: '-', problem: 'git log failed (no commits yet?), so nothing was audited' });
    return { ok: false, commits: 0, problems };
  }
  const records = log.split(RECORD_SEPARATOR).map((record) => record.trim()).filter(Boolean);

  for (const record of records) {
    const [sha, authorName, authorEmail, committerName, committerEmail, message] = record.split(FIELD_SEPARATOR);
    const commit = sha.slice(0, SHORT_SHA_LENGTH);
    if (authorName !== expectedName || authorEmail !== expectedEmail) {
      problems.push({ commit, problem: `author is "${authorName} <${authorEmail}>", expected the configured identity` });
    }
    if (committerName !== expectedName || committerEmail !== expectedEmail) {
      problems.push({ commit, problem: `committer is "${committerName} <${committerEmail}>", expected the configured identity` });
    }
    for (const identity of [authorName, authorEmail, committerName, committerEmail]) {
      if (isToolIdentity(identity)) {
        problems.push({ commit, problem: `identity "${identity}" names an AI tool` });
      }
    }
    for (const hit of findAttribution(message ?? '')) {
      problems.push({ commit, problem: `message credits a tool: ${hit.id} ("${hit.excerpt}")` });
    }
  }

  if (bodyFile !== undefined) {
    const body = existsSync(bodyFile) ? readFileSync(bodyFile, 'utf8') : '';
    for (const hit of findAttribution(body)) {
      problems.push({ commit: 'PR body', problem: `body credits a tool: ${hit.id} ("${hit.excerpt}")` });
    }
  }
  return { ok: problems.length === 0, problems, commits: records.length };
}

/**
 * @param {string} flag
 * @returns {string | undefined}
 */
function flagValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const result = auditBranch({
    cwd: flagValue('--cwd') ?? process.cwd(),
    base: flagValue('--base'),
    bodyFile: flagValue('--body-file'),
  });
  if (result.ok) {
    process.stdout.write(`clean: ${result.commits} commit(s) audited\n`);
    process.exit(0);
  }
  process.stderr.write(
    `${result.problems.map((item) => `${item.commit}: ${item.problem}`).join('\n')}\n`,
  );
  process.exit(1);
}

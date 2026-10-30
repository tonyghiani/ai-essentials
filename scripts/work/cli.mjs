#!/usr/bin/env node
/**
 * Helpers the tech-lead and open-draft-pr skills call, so branch and spec
 * handling is deterministic instead of re-derived by the model each run.
 *
 *   branch <slug> [--prefix <p>] [--cwd <dir>]   create + register an agent branch
 *   is-agent-branch [<branch>] [--cwd <dir>]     exit 0 if this tool created it
 *   spec-dir [--cwd <dir>]                       print the state dir for the current branch
 *   diff [--base <ref>] [--cwd <dir>]            write the change as a patch, print its path
 *   register <branch> [--base <ref>] [--cwd <dir>]  record an existing branch (a worktree branch) as yours
 *   logs <corrections|failures|errors|lessons> [--archive]  print a machine-local log; --archive renames it after reading
 *   login                                        print the GitHub login used as branch prefix
 *   lesson --source <s> --route <r> --text <t> [--ref <url>]  record a lesson from a review comment or a failure
 *   task add <id> <title> | task pass <id> --evidence <text> | task list
 *                                                the branch's task ledger (see tasks.mjs)
 *
 * All output is JSON or a bare path so a skill can parse it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultBase, git, repoRoot } from '../lib/repo.mjs';
import { appendJsonl, statePath } from '../lib/state.mjs';
import { createBranch, currentBranch, isAgentBranch, registerBranch, specDir } from './branches.mjs';
import { addTask, passTask, readLedger } from './tasks.mjs';

/** Where a lesson should end up; the memory-distill skill applies the routing. */
const LESSON_ROUTES = ['claude-md', 'path-rule', 'lint-rule', 'hook', 'skill-gotcha', 'eval', 'memory'];

const GH_TIMEOUT_MS = 5_000;
const [command, ...rest] = process.argv.slice(2);

/**
 * @param {string} flag
 * @returns {string | undefined}
 */
function flagValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** @returns {string | undefined} The user's GitHub login, if `gh` can say. */
function githubLogin() {
  // AI_ESSENTIALS_GITHUB_LOGIN overrides the lookup, so tests never touch the network.
  if (process.env.AI_ESSENTIALS_GITHUB_LOGIN !== undefined) {
    return process.env.AI_ESSENTIALS_GITHUB_LOGIN === '' ? undefined : process.env.AI_ESSENTIALS_GITHUB_LOGIN;
  }
  const result = spawnSync('gh', ['api', 'user', '--jq', '.login'], {
    encoding: 'utf8',
    timeout: GH_TIMEOUT_MS,
  });
  const login = result.status === 0 ? result.stdout.trim() : '';
  return login === '' ? undefined : login;
}

/**
 * @param {string} message
 * @param {number} code
 * @returns {never}
 */
function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const cwd = flagValue('--cwd') ?? process.cwd();
const root = repoRoot(cwd);

switch (command) {
  case 'branch': {
    const slug = rest.find((arg) => !arg.startsWith('--') && arg !== flagValue('--prefix') && arg !== flagValue('--cwd'));
    if (slug === undefined) {
      fail('usage: branch <slug> [--prefix <p>] [--cwd <dir>]');
    }
    const result = createBranch({ cwd, slug, prefix: flagValue('--prefix') ?? githubLogin() });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : result.reason === 'dirty' ? 3 : 1);
    break;
  }
  case 'is-agent-branch': {
    if (root === null) {
      fail('not inside a git repository');
    }
    const branch = rest.find((arg) => !arg.startsWith('--') && arg !== flagValue('--cwd')) ?? currentBranch(root);
    process.exit(branch !== null && isAgentBranch(root, branch) ? 0 : 1);
    break;
  }
  case 'spec-dir': {
    const branch = root === null ? null : currentBranch(root);
    if (root === null || branch === null) {
      fail('not on a branch inside a git repository');
    }
    process.stdout.write(`${specDir(root, branch)}\n`);
    break;
  }
  case 'diff': {
    const branch = root === null ? null : currentBranch(root);
    if (root === null || branch === null) {
      fail('not on a branch inside a git repository');
    }
    const base = flagValue('--base') ?? defaultBase(root);
    // Committed work against the base, plus anything still uncommitted, so a
    // reviewer sees the whole change however far the run got.
    const committed = base === null ? '' : (git(root, ['diff', `${base}...HEAD`]) ?? '');
    const pending = git(root, ['diff', 'HEAD']) ?? '';
    const path = join(specDir(root, branch), 'diff.patch');
    writeFileSync(path, `${committed}\n${pending}\n`, 'utf8');
    process.stdout.write(`${path}\n`);
    break;
  }
  case 'register': {
    const branch = rest.find((arg) => !arg.startsWith('--') && arg !== flagValue('--base') && arg !== flagValue('--cwd'));
    if (root === null || branch === undefined) {
      fail('usage: register <branch> [--base <ref>] [--cwd <dir>]');
    }
    registerBranch(root, branch, flagValue('--base') ?? defaultBase(root) ?? 'HEAD');
    process.stdout.write(`registered ${branch}\n`);
    break;
  }
  case 'logs': {
    const files = { corrections: 'corrections.jsonl', failures: 'verify-failures.jsonl', errors: 'hook-errors.jsonl', lessons: 'lessons.jsonl' };
    const name = rest.find((arg) => !arg.startsWith('--'));
    if (name === undefined || !(name in files)) {
      fail('usage: logs <corrections|failures|errors|lessons> [--archive]');
    }
    const path = statePath(files[name]);
    if (existsSync(path)) {
      process.stdout.write(readFileSync(path, 'utf8'));
      if (process.argv.includes('--archive')) {
        renameSync(path, path.replace(/\.jsonl$/, `.${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.jsonl.bak`));
      }
    }
    break;
  }
  case 'login': {
    process.stdout.write(`${githubLogin() ?? ''}\n`);
    break;
  }
  case 'lesson': {
    const [source, route, text] = [flagValue('--source'), flagValue('--route'), flagValue('--text')];
    if (source === undefined || route === undefined || text === undefined || !LESSON_ROUTES.includes(route)) {
      fail(`usage: lesson --source <s> --route <${LESSON_ROUTES.join('|')}> --text <t> [--ref <url>]`);
    }
    appendJsonl('lessons.jsonl', { at: new Date().toISOString(), source, route, text, ref: flagValue('--ref') ?? null });
    process.stdout.write('recorded\n');
    break;
  }
  case 'task': {
    const branch = root === null ? null : currentBranch(root);
    if (root === null || branch === null) {
      fail('not on a branch inside a git repository');
    }
    const dir = specDir(root, branch);
    const [action, id, ...words] = rest.filter((arg, index, all) => !arg.startsWith('--') && !['--cwd', '--evidence'].includes(all[index - 1]));
    if (action === 'add' && id !== undefined && words.length > 0) {
      addTask(dir, { id, title: words.join(' ') });
    } else if (action === 'pass' && id !== undefined) {
      const result = passTask(dir, { id, evidence: flagValue('--evidence') ?? '' });
      if (!result.ok) {
        fail(result.reason);
      }
    } else if (action !== 'list') {
      fail('usage: task add <id> <title> | task pass <id> --evidence <text> | task list');
    }
    process.stdout.write(`${JSON.stringify(readLedger(dir), null, 2)}\n`);
    break;
  }
  default:
    fail('usage: ai-work <branch|register|is-agent-branch|spec-dir|diff|logs|login|lesson|task> [options]');
}

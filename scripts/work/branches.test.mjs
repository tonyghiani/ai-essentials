import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../lib/repo.mjs';
import { branchName, createBranch, isAgentBranch, slugify } from './branches.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'cli.mjs');

/** @type {{ base: string, repo: string }} */
let ctx;
let savedState;

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'work-')));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'marco@example.com']);
  git(repo, ['config', 'user.name', 'Marco']);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'init']);
  ctx = { base, repo };
  savedState = process.env.AI_ESSENTIALS_STATE;
  process.env.AI_ESSENTIALS_STATE = join(base, 'state');
});

afterEach(() => {
  if (savedState === undefined) {
    delete process.env.AI_ESSENTIALS_STATE;
  } else {
    process.env.AI_ESSENTIALS_STATE = savedState;
  }
  rmSync(ctx.base, { recursive: true, force: true });
});

describe('slugify and branchName', () => {
  it('turns free text into a hyphenated slug capped at 40 characters', () => {
    assert.equal(slugify('Add retry to the Fetch helper!'), 'add-retry-to-the-fetch-helper');
    assert.equal(slugify('x'.repeat(60)).length, 40);
  });

  it('prefixes the slug with the login when one is given', () => {
    assert.equal(branchName({ prefix: 'octocat', slug: 'add-retry' }), 'octocat/add-retry');
  });

  it('uses a plain slug when there is no prefix', () => {
    assert.equal(branchName({ slug: 'add-retry' }), 'add-retry');
  });
});

describe('createBranch', () => {
  it('creates, checks out and registers a branch from the current HEAD', () => {
    const result = createBranch({ cwd: ctx.repo, slug: 'Add retry', prefix: 'octocat' });
    assert.equal(result.ok, true);
    assert.equal(result.branch, 'octocat/add-retry');
    assert.equal(result.base, 'main');
    assert.equal(git(ctx.repo, ['rev-parse', '--abbrev-ref', 'HEAD']), 'octocat/add-retry');
    assert.equal(isAgentBranch(repoRoot(ctx.repo), 'octocat/add-retry'), true);
  });

  it('creates the spec directory outside the repository', () => {
    const result = createBranch({ cwd: ctx.repo, slug: 'x' });
    assert.equal(existsSync(result.specDir), true);
    assert.equal(result.specDir.startsWith(ctx.repo), false);
  });

  it('refuses a dirty working tree and leaves the current branch alone', () => {
    writeFileSync(join(ctx.repo, 'wip.txt'), 'wip\n');
    const result = createBranch({ cwd: ctx.repo, slug: 'x' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'dirty');
    assert.equal(git(ctx.repo, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  });

  it('refuses a branch name that already exists', () => {
    createBranch({ cwd: ctx.repo, slug: 'x' });
    git(ctx.repo, ['checkout', '-q', 'main']);
    assert.equal(createBranch({ cwd: ctx.repo, slug: 'x' }).reason, 'exists');
  });

  it('reports a directory that is not a repository', () => {
    assert.equal(createBranch({ cwd: ctx.base, slug: 'x' }).reason, 'not-a-repo');
  });

  it('does not recognise a branch it did not create', () => {
    git(ctx.repo, ['checkout', '-q', '-b', 'someone-elses']);
    assert.equal(isAgentBranch(repoRoot(ctx.repo), 'someone-elses'), false);
  });
});

describe('work cli', () => {
  /** @param {string[]} args */
  function run(args) {
    return spawnSync(process.execPath, [CLI, ...args, '--cwd', ctx.repo], {
      encoding: 'utf8',
      env: { ...process.env },
    });
  }

  it('creates a branch and prints JSON', () => {
    const result = run(['branch', 'add-thing', '--prefix', 'octocat']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).branch, 'octocat/add-thing');
  });

  it('exits 3 on a dirty tree so a skill can ask the user', () => {
    writeFileSync(join(ctx.repo, 'wip.txt'), 'wip\n');
    assert.equal(run(['branch', 'x', '--prefix', 'p']).status, 3);
  });

  it('answers is-agent-branch with the exit code', () => {
    run(['branch', 'mine', '--prefix', 'p']);
    assert.equal(run(['is-agent-branch']).status, 0);
    git(ctx.repo, ['checkout', '-q', 'main']);
    assert.equal(run(['is-agent-branch']).status, 1);
  });

  it('writes committed and uncommitted changes into one patch file', () => {
    run(['branch', 'patchy', '--prefix', 'p']);
    writeFileSync(join(ctx.repo, 'b.txt'), 'b\n');
    git(ctx.repo, ['add', '.']);
    git(ctx.repo, ['commit', '-q', '-m', 'Add b']);
    writeFileSync(join(ctx.repo, 'a.txt'), 'a changed\n');
    const result = run(['diff', '--base', 'main']);
    assert.equal(result.status, 0, result.stderr);
    const patch = readFileSync(result.stdout.trim(), 'utf8');
    assert.match(patch, /b\.txt/);
    assert.match(patch, /a changed/);
  });
});

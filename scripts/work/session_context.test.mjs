import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { registerBranch, specDir } from './branches.mjs';
import { sessionContext } from './session_context.mjs';
import { addTask } from './tasks.mjs';

/** @type {{ base: string, repo: string, savedState: string | undefined, savedContracts: string | undefined }} */
let ctx;

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'session-context-')));
  const repo = join(base, 'repo');
  git(base, ['init', '-q', '-b', 'main', repo]);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'init']);
  ctx = { base, repo, savedState: process.env.AI_ESSENTIALS_STATE, savedContracts: process.env.AI_ESSENTIALS_CONTRACTS };
  process.env.AI_ESSENTIALS_STATE = join(base, 'state');
  process.env.AI_ESSENTIALS_CONTRACTS = join(base, 'contracts');
});

afterEach(() => {
  for (const [name, value] of [['AI_ESSENTIALS_STATE', ctx.savedState], ['AI_ESSENTIALS_CONTRACTS', ctx.savedContracts]]) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  rmSync(ctx.base, { recursive: true, force: true });
});

describe('sessionContext', () => {
  it('says nothing outside a git repository, so unrelated sessions pay no tokens', () => {
    assert.equal(sessionContext({ cwd: ctx.base }), '');
  });

  it('gives an agent branch its spec directory and open tasks, and restates the hard rules after a compaction', () => {
    git(ctx.repo, ['checkout', '-q', '-b', 'octocat/thing']);
    registerBranch(ctx.repo, 'octocat/thing', 'main');
    addTask(specDir(ctx.repo, 'octocat/thing'), { id: 'T1', title: 'add the thing' });

    const startup = sessionContext({ cwd: ctx.repo, source: 'startup' });
    assert.match(startup, /Spec directory: /);
    assert.match(startup, /open: T1 add the thing/);
    assert.doesNotMatch(startup, /Rules that never bend/);
    assert.match(sessionContext({ cwd: ctx.repo, source: 'compact' }), /Rules that never bend/);
  });
});

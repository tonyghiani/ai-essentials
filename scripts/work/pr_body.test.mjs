import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createBranch } from './branches.mjs';
import { templateProblems } from './pr_body.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'pr_body.mjs');
const DESCRIPTION = '> Fix the retry loop\n\n## 📓 Summary\nBacks off between attempts.\n\n## 🧪 Testing\n- Run the executor against a failing endpoint.\n';

describe('templateProblems', () => {
  it('accepts a body that follows the template', () => {
    assert.deepEqual(templateProblems(DESCRIPTION), []);
  });

  it('reports headings written without their icons and a missing title line', () => {
    assert.deepEqual(templateProblems('## Summary\nx\n\n## Testing\n- y\n'), [
      'a leading "> <title>" line',
      '"## 📓 Summary"',
      '"## 🧪 Testing"',
    ]);
  });
});

describe('pr_body cli', () => {
  /** @type {{ base: string, repo: string, env: Record<string, string>, specDir: string }} */
  let ctx;
  let savedState;

  /** @param {string[]} args */
  function run(args) {
    return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...ctx.env } });
  }

  beforeEach(() => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'prbody-')));
    const repo = join(base, 'repo');
    mkdirSync(repo);
    for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'a@example.com'], ['config', 'user.name', 'A']]) {
      spawnSync('git', args, { cwd: repo });
    }
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    spawnSync('git', ['add', '.'], { cwd: repo });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    savedState = process.env.AI_ESSENTIALS_STATE;
    process.env.AI_ESSENTIALS_STATE = join(base, 'state');
    const created = createBranch({ cwd: repo, slug: 'retry-fix' });
    ctx = { base, repo, env: { AI_ESSENTIALS_STATE: join(base, 'state') }, specDir: created.specDir };
  });

  afterEach(() => {
    if (savedState === undefined) {
      delete process.env.AI_ESSENTIALS_STATE;
    } else {
      process.env.AI_ESSENTIALS_STATE = savedState;
    }
    rmSync(ctx.base, { recursive: true, force: true });
  });

  it('stages pr-body.md in the spec directory from the description', () => {
    writeFileSync(join(ctx.specDir, 'pr-description.md'), DESCRIPTION);
    const result = run(['--cwd', ctx.repo]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(ctx.specDir, 'pr-body.md'), 'utf8'), DESCRIPTION);
  });

  it('refuses to stage a description that drifted from the template', () => {
    writeFileSync(join(ctx.specDir, 'pr-description.md'), '## Summary\nx\n');
    const result = run(['--cwd', ctx.repo]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pr-description-template/);
  });

  it('refuses to build when there is no description', () => {
    const result = run(['--cwd', ctx.repo]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No description/);
  });

  it('fails --check on a body without the icons and passes one that follows the template', () => {
    const bare = join(ctx.base, 'bare.md');
    writeFileSync(bare, '> t\n\n## Summary\nx\n\n## Testing\n- y\n');
    assert.notEqual(run(['--check', bare]).status, 0);
    const full = join(ctx.base, 'full.md');
    writeFileSync(full, DESCRIPTION);
    assert.equal(run(['--check', full]).status, 0);
  });
});

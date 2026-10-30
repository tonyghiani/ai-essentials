import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keyToFileName, repoKey, repoRoot } from '../lib/repo.mjs';
import { trustContract } from './contract.mjs';
import { formatFile } from './format_file.mjs';
import { MAX_CONSECUTIVE_BLOCKS, MAX_IDENTICAL_FAILURES, runVerify } from './run.mjs';

const REPO_HOME = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NODE = process.execPath;
const PASSING_CMD = [NODE, '-e', 'process.exit(0)'];
const FAILING_CMD = [NODE, '-e', 'console.error("boom"); process.exit(3)'];

/** @type {{ base: string, repo: string }} */
let ctx;
const savedEnv = {};

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

/** @param {unknown} contract */
function writeContract(contract) {
  const key = repoKey(repoRoot(ctx.repo));
  const dir = join(ctx.base, 'contracts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, keyToFileName(key)), JSON.stringify(contract));
}

/** Leaves one untracked TypeScript file, so there is something to verify. */
function touchSource() {
  mkdirSync(join(ctx.repo, 'src'), { recursive: true });
  writeFileSync(join(ctx.repo, 'src', 'a.ts'), 'export const a = 1;\n');
}

/** @param {string} script @param {Record<string, unknown>} input */
function runAdapter(script, input) {
  return spawnSync(NODE, [join(REPO_HOME, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: process.env,
  });
}

beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'verify-')));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'init']);
  ctx = { base, repo };
  for (const name of ['AI_ESSENTIALS_STATE', 'AI_ESSENTIALS_CONTRACTS']) {
    savedEnv[name] = process.env[name];
  }
  process.env.AI_ESSENTIALS_STATE = join(base, 'state');
  process.env.AI_ESSENTIALS_CONTRACTS = join(base, 'contracts');
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  rmSync(ctx.base, { recursive: true, force: true });
});

describe('runVerify', () => {
  it('skips when the directory is not a git repository', () => {
    const result = runVerify({ cwd: ctx.base });
    assert.equal(result.status, 'skipped');
  });

  it('skips when the repo has no contract', () => {
    touchSource();
    const result = runVerify({ cwd: ctx.repo });
    assert.equal(result.status, 'skipped');
    assert.match(result.message, /no verification contract/);
  });

  it('skips when nothing changed', () => {
    writeContract({ checks: [{ name: 'lint', cmd: FAILING_CMD }] });
    const result = runVerify({ cwd: ctx.repo });
    assert.equal(result.status, 'skipped');
    assert.equal(result.message, 'no changed files');
  });

  it('passes when every applicable check succeeds', () => {
    touchSource();
    writeContract({ checks: [{ name: 'lint', cmd: PASSING_CMD }] });
    assert.equal(runVerify({ cwd: ctx.repo }).status, 'pass');
  });

  it('fails with the check name and its output when a check exits non-zero', () => {
    touchSource();
    writeContract({ checks: [{ name: 'typecheck', cmd: FAILING_CMD }] });
    const result = runVerify({ cwd: ctx.repo });
    assert.equal(result.status, 'fail');
    assert.match(result.message, /\[typecheck\] exit 3/);
    assert.match(result.message, /boom/);
  });

  it('skips a check whose globs match no changed file', () => {
    touchSource();
    writeContract({ checks: [{ name: 'python', cmd: FAILING_CMD, when: ['**/*.py'] }] });
    assert.equal(runVerify({ cwd: ctx.repo }).status, 'pass');
  });

  it('expands {files} to only the changed files the check applies to', () => {
    touchSource();
    writeFileSync(join(ctx.repo, 'notes.md'), 'n\n');
    writeContract({
      checks: [
        {
          name: 'args',
          cmd: [NODE, '-e', 'console.error(process.argv.slice(1).join("|")); process.exit(1)', '{files}'],
          when: ['**/*.ts'],
        },
      ],
    });
    const result = runVerify({ cwd: ctx.repo });
    assert.match(result.message, /src\/a\.ts/);
    assert.doesNotMatch(result.message, /notes\.md/);
  });

  it('reports a timed-out check as a failure', () => {
    touchSource();
    writeContract({
      checks: [
        { name: 'slow', cmd: [NODE, '-e', 'setTimeout(() => {}, 5000)'], timeoutSec: 0.2 },
      ],
    });
    const result = runVerify({ cwd: ctx.repo });
    assert.equal(result.status, 'fail');
    assert.match(result.message, /timed out/);
  });

  it('reports a malformed contract as a failure instead of passing silently', () => {
    touchSource();
    writeContract({ checks: 'nope' });
    const result = runVerify({ cwd: ctx.repo });
    assert.equal(result.status, 'fail');
    assert.match(result.message, /\[contract\]/);
  });

  it('rejects a shell-string command so nothing passes through a shell', () => {
    touchSource();
    writeContract({ checks: [{ name: 'lint', cmd: 'npm run lint' }] });
    const result = runVerify({ cwd: ctx.repo });
    assert.equal(result.status, 'fail');
    assert.match(result.message, /non-empty array/);
  });

  it('escalates on the third identical failure and lets the turn end on the fourth', () => {
    touchSource();
    writeContract({ checks: [{ name: 'typecheck', cmd: FAILING_CMD }] });
    const statuses = Array.from({ length: MAX_IDENTICAL_FAILURES + 1 }, () =>
      runVerify({ cwd: ctx.repo, sessionId: 's1' }).status,
    );
    assert.deepEqual(statuses, ['fail', 'fail', 'escalate', 'skipped']);
  });

  it('ends the loop even when the failing output never repeats', () => {
    touchSource();
    const randomFailure = [NODE, '-e', 'console.error(Math.random().toString(36)); process.exit(1)'];
    writeContract({ checks: [{ name: 'flaky', cmd: randomFailure }] });
    const statuses = Array.from({ length: MAX_CONSECUTIVE_BLOCKS + 1 }, () =>
      runVerify({ cwd: ctx.repo, sessionId: 's-random' }).status,
    );
    assert.deepEqual(statuses.slice(-2), ['escalate', 'skipped']);
  });

  it('reports a contract timeout that is not a positive number as invalid', () => {
    touchSource();
    writeContract({ checks: [{ name: 'lint', cmd: PASSING_CMD, timeoutSec: '1m' }] });
    const result = runVerify({ cwd: ctx.repo });
    assert.equal(result.status, 'fail');
    assert.match(result.message, /timeoutSec/);
  });

  it('restarts the failure count after a passing run', () => {
    touchSource();
    writeContract({ checks: [{ name: 'typecheck', cmd: FAILING_CMD }] });
    runVerify({ cwd: ctx.repo, sessionId: 's2' });
    runVerify({ cwd: ctx.repo, sessionId: 's2' });
    writeContract({ checks: [{ name: 'typecheck', cmd: PASSING_CMD }] });
    assert.equal(runVerify({ cwd: ctx.repo, sessionId: 's2' }).status, 'pass');
    writeContract({ checks: [{ name: 'typecheck', cmd: FAILING_CMD }] });
    assert.equal(runVerify({ cwd: ctx.repo, sessionId: 's2' }).status, 'fail');
  });

  it('appends each failure to the failure log', () => {
    touchSource();
    writeContract({ checks: [{ name: 'typecheck', cmd: FAILING_CMD }] });
    runVerify({ cwd: ctx.repo });
    const log = readFileSync(join(ctx.base, 'state', 'verify-failures.jsonl'), 'utf8');
    assert.match(log, /"check":"typecheck"/);
  });

  it('ignores an untrusted repo-owned contract until it is trusted', () => {
    mkdirSync(join(ctx.repo, '.ai'));
    const path = join(ctx.repo, '.ai', 'verify.json');
    writeFileSync(path, JSON.stringify({ checks: [{ name: 'evil', cmd: FAILING_CMD }] }));
    touchSource();
    const untrusted = runVerify({ cwd: ctx.repo });
    assert.equal(untrusted.status, 'skipped');
    assert.match(untrusted.message, /not trusted/);

    trustContract(path);
    assert.equal(runVerify({ cwd: ctx.repo }).status, 'fail');
  });

  it('stops trusting a repo-owned contract once its content changes', () => {
    mkdirSync(join(ctx.repo, '.ai'));
    const path = join(ctx.repo, '.ai', 'verify.json');
    writeFileSync(path, JSON.stringify({ checks: [{ name: 'a', cmd: PASSING_CMD }] }));
    touchSource();
    trustContract(path);
    assert.equal(runVerify({ cwd: ctx.repo }).status, 'pass');

    writeFileSync(path, JSON.stringify({ checks: [{ name: 'b', cmd: FAILING_CMD }] }));
    assert.equal(runVerify({ cwd: ctx.repo }).status, 'skipped');
  });
});

describe('formatFile', () => {
  it('runs the contract formatter on a matching file', () => {
    touchSource();
    writeContract({
      checks: [],
      format: {
        cmd: [NODE, '-e', 'require("fs").writeFileSync(process.argv[1], "formatted")', '{file}'],
        when: ['**/*.ts'],
      },
    });
    const result = formatFile({ cwd: ctx.repo, file: join(ctx.repo, 'src', 'a.ts') });
    assert.equal(result.ran, true);
    assert.equal(readFileSync(join(ctx.repo, 'src', 'a.ts'), 'utf8'), 'formatted');
  });

  it('leaves files outside the formatter globs untouched', () => {
    touchSource();
    writeContract({ checks: [], format: { cmd: FAILING_CMD, when: ['**/*.py'] } });
    const result = formatFile({ cwd: ctx.repo, file: 'src/a.ts' });
    assert.equal(result.ran, false);
  });
});

describe('stop-hook adapters', () => {
  /** @returns {Record<string, unknown>} */
  function failingSetup() {
    touchSource();
    writeContract({ checks: [{ name: 'typecheck', cmd: FAILING_CMD }] });
    return { cwd: ctx.repo, session_id: 'adapter' };
  }

  it('makes the Claude adapter exit 2 with the failure on stderr', () => {
    const result = runAdapter('claude/hooks/verify-on-stop.mjs', failingSetup());
    assert.equal(result.status, 2);
    assert.match(result.stderr, /\[typecheck\] exit 3/);
  });

  it('makes the Codex adapter exit 2 with the failure on stderr', () => {
    const result = runAdapter('codex/hooks/verify-on-stop.mjs', failingSetup());
    assert.equal(result.status, 2);
    assert.match(result.stderr, /\[typecheck\] exit 3/);
  });

  it('makes the Cursor adapter print a followup_message and exit 0', () => {
    const result = runAdapter('cursor/hooks/verify-on-stop.mjs', failingSetup());
    assert.equal(result.status, 0);
    assert.match(JSON.parse(result.stdout).followup_message, /\[typecheck\] exit 3/);
  });

  it('lets every adapter exit 0 silently when the checks pass', () => {
    touchSource();
    writeContract({ checks: [{ name: 'typecheck', cmd: PASSING_CMD }] });
    for (const script of [
      'claude/hooks/verify-on-stop.mjs',
      'codex/hooks/verify-on-stop.mjs',
      'cursor/hooks/verify-on-stop.mjs',
    ]) {
      const result = runAdapter(script, { cwd: ctx.repo, session_id: 'ok' });
      assert.equal(result.status, 0, script);
      assert.equal(result.stderr + result.stdout, '', script);
    }
  });

  it('exits 0 and blocks nothing when the hook input is not JSON', () => {
    const result = spawnSync(NODE, [join(REPO_HOME, 'claude/hooks/verify-on-stop.mjs')], {
      input: 'not json',
      encoding: 'utf8',
      cwd: ctx.base,
      env: process.env,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  });
});

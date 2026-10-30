import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { keyToFileName, repoKey, repoRoot } from '../lib/repo.mjs';
import { appStart, appStatus, appStop } from './app.mjs';
import { appProblem, contractProblem } from './contract.mjs';

const NODE = process.execPath;
/** Serves 200 on every path; prints the bound port so a test can use port 0. */
const SERVER_SCRIPT = `
const server = require('node:http').createServer((req, res) => res.end('ok'));
server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => console.log(server.address().port));
`;

/** @type {{ base: string, repo: string, worktree: string, children: import('node:child_process').ChildProcess[] }} */
let ctx;
const savedEnv = {};

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

/** @param {Record<string, unknown>} app */
function writeContract(app) {
  const dir = join(ctx.base, 'contracts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, keyToFileName(repoKey(repoRoot(ctx.repo)))), JSON.stringify({ checks: [], app }));
}

/**
 * Starts a server the way a developer would, outside the tool, from `cwd`.
 *
 * @param {string} cwd
 * @returns {Promise<{ port: number, child: import('node:child_process').ChildProcess }>}
 */
async function serveFrom(cwd) {
  const child = spawn(NODE, ['-e', SERVER_SCRIPT], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  ctx.children.push(child);
  const [chunk] = await once(child.stdout, 'data');
  return { port: Number(String(chunk).trim()), child };
}

/** @returns {Promise<number>} A port nothing listens on right now. */
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

/** @param {number} pid */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'verify-app-')));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'init']);
  const worktree = join(base, 'feature');
  git(repo, ['worktree', 'add', '-q', '-b', 'feature', worktree]);
  ctx = { base, repo, worktree, children: [] };
  for (const name of ['AI_ESSENTIALS_STATE', 'AI_ESSENTIALS_CONTRACTS']) {
    savedEnv[name] = process.env[name];
  }
  process.env.AI_ESSENTIALS_STATE = join(base, 'state');
  process.env.AI_ESSENTIALS_CONTRACTS = join(base, 'contracts');
});

afterEach(() => {
  ctx.children.forEach((child) => child.kill('SIGKILL'));
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  rmSync(ctx.base, { recursive: true, force: true });
});

describe('contractProblem app block', () => {
  it('rejects a malformed app block for verify-app without invalidating the checks', () => {
    assert.match(appProblem({ run: [] }), /app\.run/);
    assert.match(appProblem({ url: 'localhost:3000' }), /app\.url/);
    assert.match(appProblem({ ready: '/health' }), /app\.url is needed/);
    assert.match(appProblem({ ports: [70_000] }), /app\.ports/);
    assert.equal(appProblem({ run: 'npm run dev' }), null);
    // A typo in the app block must not fail the Stop hook in every turn.
    assert.equal(contractProblem({ checks: [], app: { url: 'localhost:3000' } }), null);
  });
});

describe('appStatus', () => {
  it('reports not-configured when the contract has no app block', async () => {
    const dir = join(ctx.base, 'contracts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, keyToFileName(repoKey(ctx.repo))), JSON.stringify({ checks: [] }));

    const status = await appStatus({ cwd: ctx.repo });

    assert.equal(status.status, 'not-configured');
    assert.match(status.hint, /verify-contract/);
  });

  it('tells an instance of this checkout from one in another worktree of the same repo', async () => {
    const { port, child } = await serveFrom(ctx.repo);
    writeContract({ url: `http://127.0.0.1:${port}`, ports: [port] });

    const here = await appStatus({ cwd: ctx.repo });
    const elsewhere = await appStatus({ cwd: ctx.worktree });

    assert.equal(here.status, 'running-here');
    assert.equal(here.probe?.ready, true);
    assert.equal(here.listeners[0].pid, child.pid);
    assert.equal(elsewhere.status, 'running-elsewhere');
    assert.equal(elsewhere.baseline?.checkout, ctx.repo);
    assert.equal(elsewhere.baseline?.branch, 'main');
  });

  it('reports stopped when nothing answers or listens', async () => {
    const port = await freePort();
    writeContract({ url: `http://127.0.0.1:${port}`, ports: [port] });

    assert.equal((await appStatus({ cwd: ctx.repo })).status, 'stopped');
  });
});

describe('appStart and appStop', () => {
  it('refuses to start a second instance when one already runs from this checkout, even on a free port', async () => {
    const { port } = await serveFrom(ctx.repo);
    const marker = join(ctx.base, 'started');
    writeContract({ run: [NODE, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`], url: `http://127.0.0.1:${port}`, ports: [port] });

    const result = await appStart({ cwd: ctx.repo, forceNew: true, port: await freePort() });

    assert.equal(result.status, 'refused');
    assert.equal(existsSync(marker), false);
  });

  it('never stops an instance it found running', async () => {
    const { port, child } = await serveFrom(ctx.repo);
    writeContract({ run: [NODE, '-e', SERVER_SCRIPT], url: `http://127.0.0.1:${port}`, ports: [port] });

    const result = await appStop({ cwd: ctx.repo });

    assert.equal(result.status, 'not-started-by-tool');
    assert.equal(isAlive(child.pid), true);
  });

  it('starts this checkout beside another worktree on a free port and stops only that one', async () => {
    const { port: busyPort, child: baseline } = await serveFrom(ctx.repo);
    writeContract({ run: [NODE, '-e', SERVER_SCRIPT], url: `http://127.0.0.1:${busyPort}`, ready: '/health', ports: [busyPort] });
    const port = await freePort();

    const refused = await appStart({ cwd: ctx.worktree });
    const started = await appStart({ cwd: ctx.worktree, forceNew: true, port });
    const stopped = await appStop({ cwd: ctx.worktree });

    assert.equal(refused.status, 'refused');
    assert.equal(started.status, 'started');
    assert.equal(started.readyUrl, `http://127.0.0.1:${port}/health`);
    assert.equal(stopped.status, 'stopped');
    assert.equal(isAlive(started.pid), false);
    assert.equal(isAlive(baseline.pid), true);
  });
});

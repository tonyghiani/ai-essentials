#!/usr/bin/env node
/**
 * Run the verification gate by hand, the same way the Stop hooks do.
 *
 *   node scripts/verify/cli.mjs [--cwd <dir>] [--session <id>]
 *   node scripts/verify/cli.mjs --trust [--cwd <dir>]   trust the repo's own .ai/verify.json
 *   node scripts/verify/cli.mjs --where [--cwd <dir>]   print the repo key and contract path
 *   node scripts/verify/cli.mjs --worktree-copy [--cwd <dir>]   print the files a new worktree needs, one per line
 *   node scripts/verify/cli.mjs --worktree-setup [--cwd <dir>]  run the contract's worktree.setup commands in <dir>
 *   node scripts/verify/cli.mjs --app-status [--cwd <dir>]      JSON: is the app up, and which checkout serves it
 *   node scripts/verify/cli.mjs --app-start [--force-new --port <n>] [--cwd <dir>]  JSON: start this checkout's app
 *   node scripts/verify/cli.mjs --app-stop [--cwd <dir>]        JSON: stop the instance --app-start started
 *
 * Exit 0 for pass or skipped, 1 for fail or escalate. The app flags exit 1 when
 * the app is not configured, a start is refused or fails, or there is nothing to stop.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { keyToFileName, repoKey, repoRoot } from '../lib/repo.mjs';
import { appStart, appStatus, appStop } from './app.mjs';
import { contractsDir, resolveContract, trustContract } from './contract.mjs';
import { runVerify } from './run.mjs';

/**
 * @param {string} flag
 * @returns {string | undefined}
 */
function flagValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** A bootstrap such as an install can take a while; the contract can raise it per step. */
const DEFAULT_SETUP_TIMEOUT_SEC = 900;

const cwd = flagValue('--cwd') ?? process.cwd();

/** Statuses after which the caller can go on; anything else exits 1. */
const APP_OK_STATUSES = new Set(['running-here', 'running-elsewhere', 'running-unknown', 'stopped', 'started', 'already-exited']);

/** @param {{ status: string }} result */
function printAppResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(APP_OK_STATUSES.has(result.status) ? 0 : 1);
}

if (process.argv.includes('--app-status')) {
  printAppResult(await appStatus({ cwd }));
}

if (process.argv.includes('--app-start')) {
  const portValue = flagValue('--port');
  const port = portValue === undefined ? undefined : Number(portValue);
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65_536)) {
    process.stderr.write(`--port needs a TCP port number, got ${portValue}\n`);
    process.exit(1);
  }
  printAppResult(await appStart({ cwd, forceNew: process.argv.includes('--force-new'), port }));
}

if (process.argv.includes('--app-stop')) {
  printAppResult(await appStop({ cwd }));
}

if (process.argv.includes('--worktree-setup')) {
  const root = repoRoot(cwd);
  const resolved = root === null ? { status: 'none' } : resolveContract(root);
  const steps = resolved.status === 'ok' ? (resolved.contract.worktree?.setup ?? []) : [];
  for (const step of steps) {
    process.stderr.write(`setup: ${step.cmd.join(' ')}\n`);
    const [command, ...args] = step.cmd.map((part) => part.replaceAll('{root}', root ?? cwd));
    const result = spawnSync(command, args, {
      cwd,
      stdio: ['ignore', process.stderr, process.stderr],
      timeout: (step.timeoutSec ?? DEFAULT_SETUP_TIMEOUT_SEC) * 1_000,
    });
    if (result.status !== 0) {
      process.stderr.write(`setup failed (${result.error?.message ?? `exit ${result.status}`}): ${step.cmd.join(' ')}\n`);
      process.exit(1);
    }
  }
  process.exit(0);
}

if (process.argv.includes('--worktree-copy')) {
  const root = repoRoot(cwd);
  const resolved = root === null ? { status: 'none' } : resolveContract(root);
  const files = resolved.status === 'ok' ? (resolved.contract.worktree?.copy ?? []) : [];
  process.stdout.write(files.map((file) => `${file}\n`).join(''));
  process.exit(0);
}

if (process.argv.includes('--where')) {
  const root = repoRoot(cwd);
  if (root === null) {
    process.stderr.write('Not inside a git repository.\n');
    process.exit(1);
  }
  const resolved = resolveContract(root);
  const target = join(contractsDir(), keyToFileName(repoKey(root)));
  process.stdout.write(
    `${JSON.stringify({ repoKey: repoKey(root), contract: resolved.status, path: resolved.status === 'none' ? target : resolved.path, createAt: target }, null, 2)}\n`,
  );
  process.exit(0);
}

if (process.argv.includes('--trust')) {
  const root = repoRoot(cwd);
  const path = root === null ? null : join(root, '.ai', 'verify.json');
  if (path === null || !existsSync(path)) {
    process.stderr.write('No .ai/verify.json in this repo; nothing to trust.\n');
    process.exit(1);
  }
  trustContract(path);
  process.stdout.write(`Trusted ${path} at its current content.\n`);
  process.exit(0);
}

const result = runVerify({ cwd, sessionId: flagValue('--session') ?? 'cli' });
const stream = result.status === 'fail' || result.status === 'escalate' ? process.stderr : process.stdout;
stream.write(`${result.status}: ${result.message}\n`);
process.exit(result.status === 'fail' || result.status === 'escalate' ? 1 : 0);

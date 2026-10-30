#!/usr/bin/env node
/**
 * Eval harness for the delegation setup itself.
 *
 *   node scripts/evals/run.mjs --tool claude|codex|cursor [--task <id>] [--trials N]
 *   node scripts/evals/run.mjs --self-test
 *
 * Each task is a small repo (fixture), a ticket, and a code grader that judges
 * the outcome in the resulting worktree, never the steps. A trial runs through
 * scripts/delegate.sh, so it exercises the same path as real delegated work:
 * worktree, caps, hooks, branch audit.
 *
 * --self-test runs every task's known-good and known-bad solution through the
 * same machinery with a fake tool and checks the grader says pass and fail. A
 * grader that cannot fail measures nothing, so this runs in the test suite.
 *
 * EVAL_KEEP=1 keeps each trial's directory (repo, worktree, logs) for inspection.
 *
 * Real runs call a model and cost money; they need the skills and hooks
 * installed (setup/install.sh). Results go to ~/.ai-essentials/state/evals/.
 *
 * pass@1 is the chance a single trial passes. pass^k is the chance all k
 * trials pass, which is the number to watch for consistency.
 *
 * @typedef {{ id: string, kind: 'capability' | 'regression', covers: string, ticket: string, contract: object }} ITask
 * @typedef {{ pass: boolean, reasons: string[] }} IGrade
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { keyToFileName, repoKey, repoRoot } from '../lib/repo.mjs';
import { repoHome } from '../lib/paths.mjs';
import { stateDir } from '../lib/state.mjs';
import { gradeDeclarative } from './declarative.mjs';
import { DECLARATIVE_TASKS } from './declarative_tasks.mjs';

const TASKS_DIR = join(repoHome(), 'scripts', 'evals', 'tasks');
const DELEGATE = join(repoHome(), 'scripts', 'delegate.sh');
const DEFAULT_TRIALS = 1;
const TRIAL_TIMEOUT_MIN = 30;
/** Real runs cost money; override with EVAL_BUDGET_USD and EVAL_MAX_TURNS. */
const TRIAL_BUDGET_USD = process.env.EVAL_BUDGET_USD ?? '3';
const TRIAL_MAX_TURNS = process.env.EVAL_MAX_TURNS ?? '30';

/** @returns {string[]} Task ids: directory tasks (own fixture and grader) and declarative ones. */
export function listTasks() {
  const directories = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return [...directories, ...DECLARATIVE_TASKS.map((task) => task.id)].sort();
}

/**
 * @param {string} id
 * @returns {ITask & { group?: string, files?: Record<string, string>, solutions?: { good: string, bad: string }, expect?: object }}
 */
export function loadTask(id) {
  const declarative = DECLARATIVE_TASKS.find((task) => task.id === id);
  return declarative ?? JSON.parse(readFileSync(join(TASKS_DIR, id, 'task.json'), 'utf8'));
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

/**
 * One isolated trial: fresh repo, fresh state, nothing shared with other trials.
 *
 * @param {{ taskId: string, tool: string, solution?: string }} options `solution` selects a fake tool run.
 * @returns {Promise<IGrade & { summary: object | null }>}
 */
export async function runTrial({ taskId, tool, solution }) {
  const task = loadTask(taskId);
  const base = realpathSync(mkdtempSync(join(tmpdir(), `eval-${taskId}-`)));
  try {
    const repo = join(base, 'project');
    if (existsSync(join(TASKS_DIR, taskId, 'fixture'))) {
      cpSync(join(TASKS_DIR, taskId, 'fixture'), repo, { recursive: true });
    } else {
      mkdirSync(repo);
    }
    for (const [file, content] of Object.entries(task.files ?? {})) {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), content);
    }
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'eval@example.com']);
    git(repo, ['config', 'user.name', 'Eval User']);
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'fixture']);

    const contracts = join(base, 'contracts');
    mkdirSync(contracts);
    writeFileSync(join(contracts, keyToFileName(repoKey(repoRoot(repo)))), JSON.stringify(task.contract));

    const env = {
      ...process.env,
      AI_ESSENTIALS_STATE: join(base, 'state'),
      AI_ESSENTIALS_CONTRACTS: contracts,
      AI_ESSENTIALS_GITHUB_LOGIN: 'eval',
      AI_ESSENTIALS_REPO: repoHome(),
    };
    if (solution !== undefined) {
      // Declarative tasks carry their solutions inline; directory tasks keep them as scripts.
      env.AI_ESSENTIALS_TOOL_CMD =
        task.solutions?.[solution] ?? `bash ${join(TASKS_DIR, taskId, 'solutions', `${solution}.sh`)}`;
    }
    const args = [DELEGATE, '--repo', repo, '--slug', taskId, '--timeout-min', String(TRIAL_TIMEOUT_MIN), '--budget-usd', TRIAL_BUDGET_USD, '--max-turns', TRIAL_MAX_TURNS];
    if (solution === undefined) {
      args.push('--tool', tool);
    }
    const result = spawnSync('bash', [...args, task.ticket], { encoding: 'utf8', env });
    let summary = null;
    try {
      summary = JSON.parse(result.stdout);
    } catch (error) {
      return { pass: false, reasons: [`delegate.sh printed no summary: ${result.stderr.slice(0, 300)}`], summary };
    }
    const outcome = { worktree: summary.worktree, base: 'main', summary };
    if (task.expect !== undefined) {
      return { ...gradeDeclarative(task.expect, outcome), summary };
    }
    const grader = (await import(pathToFileURL(join(TASKS_DIR, taskId, 'grader.mjs')).href)).default;
    return { ...grader(outcome), summary };
  } finally {
    if (process.env.EVAL_KEEP === '1') {
      process.stderr.write(`EVAL_KEEP=1: trial kept at ${base}\n`);
    } else {
      rmSync(base, { recursive: true, force: true });
    }
  }
}

/**
 * @param {{ taskId: string, tool: string, trials?: number }} options
 */
export async function runTask({ taskId, tool, trials = DEFAULT_TRIALS }) {
  const results = [];
  for (let index = 0; index < trials; index += 1) {
    const { pass, reasons, summary } = await runTrial({ taskId, tool });
    results.push({ pass, reasons, costUsd: summary?.costUsd ?? null, turns: summary?.turns ?? null });
  }
  const passed = results.filter((result) => result.pass).length;
  // Only Claude reports cost; null for the other tools rather than a misleading zero.
  const costs = results.map((result) => result.costUsd).filter((cost) => typeof cost === 'number');
  const costUsd = costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0);
  return { id: taskId, trials: results, passAt1: passed / trials, passAllK: passed === trials, costUsd };
}

/**
 * Prove every grader can pass and can fail.
 *
 * @returns {Promise<Array<{ taskId: string, solution: string, expected: boolean, actual: boolean, reasons: string[] }>>}
 */
export async function selfTest() {
  const rows = [];
  for (const taskId of listTasks()) {
    for (const [solution, expected] of [['good', true], ['bad', false]]) {
      const { pass, reasons } = await runTrial({ taskId, tool: 'fake', solution });
      rows.push({ taskId, solution, expected, actual: pass, reasons });
    }
  }
  return rows;
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
  if (process.argv.includes('--self-test')) {
    const rows = await selfTest();
    for (const row of rows) {
      const ok = row.expected === row.actual;
      process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${row.taskId} (${row.solution} solution graded ${row.actual ? 'pass' : 'fail'}${row.reasons.length > 0 ? `: ${row.reasons.join('; ')}` : ''})\n`);
    }
    process.exit(rows.every((row) => row.expected === row.actual) ? 0 : 1);
  }
  const tool = flagValue('--tool');
  if (tool !== 'claude' && tool !== 'codex' && tool !== 'cursor') {
    process.stderr.write('usage: run.mjs --tool claude|codex|cursor [--task <id>] [--trials N] | --self-test\n');
    process.exit(2);
  }
  const ids = flagValue('--task') === undefined ? listTasks() : [flagValue('--task')];
  const trials = Number.parseInt(flagValue('--trials') ?? String(DEFAULT_TRIALS), 10);
  const report = [];
  for (const taskId of ids) {
    const result = await runTask({ taskId, tool, trials });
    report.push(result);
    const cost = result.costUsd === null ? '' : `  $${result.costUsd.toFixed(2)}`;
    process.stdout.write(`${result.passAllK ? 'pass' : 'FAIL'} ${taskId}  pass@1 ${result.passAt1.toFixed(2)}${cost}${result.passAllK ? '' : `  ${result.trials.flatMap((t) => t.reasons).join('; ')}`}\n`);
  }
  const spent = report.map((result) => result.costUsd).filter((cost) => typeof cost === 'number');
  if (spent.length > 0) {
    process.stdout.write(`total cost $${spent.reduce((sum, cost) => sum + cost, 0).toFixed(2)}\n`);
  }
  const dir = join(stateDir(), 'evals');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${tool}.json`), JSON.stringify(report, null, 2));
  process.exit(report.every((result) => result.passAllK) ? 0 : 1);
}

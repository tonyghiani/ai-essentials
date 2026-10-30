/**
 * The task ledger of one branch: the spec's tasks, each with a `passes` flag
 * that flips only with the evidence that proved it.
 *
 * From Anthropic's long-running harness: an agent that keeps its own prose
 * plan marks work done after a unit test, or declares the whole job finished
 * early. A structured list it may only flip, plus a Stop gate that reads the
 * list, makes "done" mean every task was shown to work.
 *
 * The ledger lives in the branch's spec directory, never in the repository.
 * The Stop gate enforces it only in an unattended run, marked by
 * AI_ESSENTIALS_ENFORCE_LEDGER=1 in the tool's environment (ai-delegate sets
 * it). An environment variable, not a flag in the file: it ends with the run,
 * so a later interactive session on the same branch is never blocked, and the
 * agent cannot switch it off.
 *
 * @typedef {{ id: string, title: string, passes: boolean, evidence: string | null }} ITask
 * @typedef {{ tasks: ITask[] }} ILedger
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LEDGER_FILE = 'tasks.json';
/** Evidence shorter than this is a claim, not a command and its result. */
const MIN_EVIDENCE_CHARS = 20;

/**
 * @param {string} specDir
 * @returns {ILedger}
 */
export function readLedger(specDir) {
  const path = join(specDir, LEDGER_FILE);
  if (!existsSync(path)) {
    return { tasks: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch (error) {
    return { tasks: [] };
  }
}

/** @returns {boolean} True inside an unattended run that must not end with open tasks. */
export function ledgerEnforced() {
  return process.env.AI_ESSENTIALS_ENFORCE_LEDGER === '1';
}

/**
 * @param {string} specDir
 * @param {ILedger} ledger
 */
function writeLedger(specDir, ledger) {
  writeFileSync(join(specDir, LEDGER_FILE), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

/**
 * Add a task, or retitle one with the same id. A retitled task keeps its state.
 *
 * @param {string} specDir
 * @param {{ id: string, title: string }} task
 */
export function addTask(specDir, { id, title }) {
  const ledger = readLedger(specDir);
  const exists = ledger.tasks.some((task) => task.id === id);
  const tasks = exists
    ? ledger.tasks.map((task) => (task.id === id ? { ...task, title } : task))
    : [...ledger.tasks, { id, title, passes: false, evidence: null }];
  writeLedger(specDir, { ...ledger, tasks });
}

/**
 * @param {string} specDir
 * @param {{ id: string, evidence: string }} options
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function passTask(specDir, { id, evidence }) {
  const ledger = readLedger(specDir);
  if (!ledger.tasks.some((task) => task.id === id)) {
    return { ok: false, reason: `no task "${id}"; add it first with: ai-work task add ${id} "<title>"` };
  }
  if (evidence.trim().length < MIN_EVIDENCE_CHARS) {
    return { ok: false, reason: 'evidence must name the command or check you ran and what it showed' };
  }
  writeLedger(specDir, {
    ...ledger,
    tasks: ledger.tasks.map((task) => (task.id === id ? { ...task, passes: true, evidence: evidence.trim() } : task)),
  });
  return { ok: true };
}

/**
 * What stops an enforced run from ending: open tasks, or no tasks at all (a run
 * that never wrote its tasks down has nothing to show it finished).
 *
 * @param {string} specDir
 * @returns {{ empty: boolean, open: ITask[] }}
 */
export function ledgerGaps(specDir) {
  const { tasks } = readLedger(specDir);
  return { empty: tasks.length === 0, open: tasks.filter((task) => !task.passes) };
}

/**
 * Start a branch's ledger over: a new branch can reuse the name, and so the
 * spec directory, of one deleted earlier.
 *
 * @param {string} specDir
 */
export function resetLedger(specDir) {
  rmSync(join(specDir, LEDGER_FILE), { force: true });
  rmSync(join(specDir, 'questions.md'), { force: true });
}

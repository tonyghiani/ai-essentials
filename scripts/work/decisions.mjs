#!/usr/bin/env node
/**
 * Decision policy engine for the tech-lead skill.
 *
 *   list [--scope <repo-key>]
 *   match --class <c> [--scope <repo-key>]        precedents safe to apply automatically
 *   classes                                       print the always-ask classes, one per line
 *   gate <class> [<class> ...]                    print the plan-gate state; exit 0 only if all are off
 *   add --class <c> --situation <s> --decision <d> --why <w> [--scope <repo-key>] [--title <t>] [--record <adr path>]
 *   record --class <c> --outcome approved|edited|overruled [--precedent <id>]
 *
 * The file is policy/decisions.local.md (gitignored). AI_ESSENTIALS_DECISIONS
 * overrides the path, for tests.
 *
 * A class earns autonomy by consecutive breakdowns the user approved without
 * editing. One edit or overrule switches its gate back on and marks the
 * precedent behind it contradicted, so a wrong habit cannot keep applying.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoHome } from '../lib/paths.mjs';
import { parseAlwaysAsk, parseDecisions, serializeDecisions } from './decisions_file.mjs';

/** Consecutive approved, unedited breakdowns that turn a class's plan gate off. */
export const GATE_THRESHOLD = 5;
/** Confirmations a precedent needs before it applies without asking. */
export const MIN_CONFIRMATIONS = 2;

const EMPTY_FILE = `# Decision policy

Local precedents for the tech-lead skill. Managed by ai-decisions; edit by hand only to correct a mistake.
`;

/** @returns {string} */
export function decisionsPath() {
  return process.env.AI_ESSENTIALS_DECISIONS ?? join(repoHome(), 'policy', 'decisions.local.md');
}

/** @returns {import('./decisions_file.mjs').IDecisionFile} */
export function loadDecisions() {
  const path = decisionsPath();
  return parseDecisions(existsSync(path) ? readFileSync(path, 'utf8') : EMPTY_FILE);
}

/** @param {import('./decisions_file.mjs').IDecisionFile} file */
export function saveDecisions(file) {
  const path = decisionsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeDecisions(file), 'utf8');
}

/** @returns {Set<string>} */
export function alwaysAskClasses() {
  // The classes ship inside the tech-lead skill, so the skill is self-contained wherever it is installed.
  const path = join(repoHome(), 'skills', 'tech-lead', 'always-ask.md');
  return existsSync(path) ? parseAlwaysAsk(readFileSync(path, 'utf8')) : new Set();
}

/**
 * @param {import('./decisions_file.mjs').IPrecedent} precedent
 * @param {{ scope?: string, gated: Set<string> }} context
 * @returns {boolean}
 */
export function isApplicable(precedent, { scope, gated }) {
  return (
    precedent.confirmations >= MIN_CONFIRMATIONS &&
    precedent.contradicted === 'no' &&
    !gated.has(precedent.class) &&
    (precedent.scope === 'global' || precedent.scope === scope)
  );
}

/**
 * @param {import('./decisions_file.mjs').IDecisionFile} file
 * @param {string} className
 * @returns {import('./decisions_file.mjs').IGateRow}
 */
function gateRow(file, className) {
  let row = file.gate.find((candidate) => candidate.class === className);
  if (row === undefined) {
    row = { class: className, count: 0, gate: 'on' };
    file.gate.push(row);
  }
  return row;
}

/**
 * @param {string} className
 * @returns {'on' | 'off'} Always-ask classes never turn their gate off.
 */
export function gateState(className) {
  if (alwaysAskClasses().has(className)) {
    return 'on';
  }
  return loadDecisions().gate.find((row) => row.class === className)?.gate ?? 'on';
}

/**
 * @param {{ className: string, outcome: 'approved' | 'edited' | 'overruled', precedentId?: string, today?: string }} options
 * @returns {import('./decisions_file.mjs').IDecisionFile}
 */
export function recordOutcome({ className, outcome, precedentId, today = new Date().toISOString().slice(0, 10) }) {
  const file = loadDecisions();
  const row = gateRow(file, className);
  const precedent = file.precedents.find((candidate) => candidate.id === precedentId);

  if (outcome === 'approved') {
    row.count += 1;
    row.gate = row.count >= GATE_THRESHOLD ? 'off' : 'on';
    if (precedent !== undefined) {
      precedent.confirmations += 1;
      precedent.lastConfirmed = today;
    }
  } else {
    row.count = 0;
    row.gate = 'on';
    if (precedent !== undefined) {
      precedent.contradicted = today;
    }
  }
  saveDecisions(file);
  return file;
}

/**
 * @param {{ className: string, situation: string, decision: string, why: string, scope?: string, title?: string, record?: string, today?: string }} options
 * @returns {import('./decisions_file.mjs').IPrecedent}
 */
export function addPrecedent({ className, situation, decision, why, scope = 'global', title, record, today = new Date().toISOString().slice(0, 10) }) {
  const file = loadDecisions();
  const highest = Math.max(0, ...file.precedents.map((precedent) => Number.parseInt(precedent.id.replace('D-', ''), 10) || 0));
  const precedent = {
    id: `D-${String(highest + 1).padStart(3, '0')}`,
    title: title ?? situation.slice(0, 50),
    class: className,
    situation,
    decision,
    why,
    scope,
    confirmations: 1,
    lastConfirmed: today,
    contradicted: 'no',
    ...(record === undefined ? {} : { record }),
  };
  file.precedents.push(precedent);
  gateRow(file, className);
  saveDecisions(file);
  return precedent;
}

/**
 * @param {string} flag
 * @returns {string | undefined}
 */
function flagValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * @param {string} message
 * @returns {never}
 */
function usage(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'list': {
      const scope = flagValue('--scope');
      const precedents = loadDecisions().precedents.filter((p) => scope === undefined || p.scope === 'global' || p.scope === scope);
      process.stdout.write(`${JSON.stringify(precedents, null, 2)}\n`);
      break;
    }
    case 'match': {
      const className = flagValue('--class') ?? usage('match needs --class');
      const gated = alwaysAskClasses();
      const hits = loadDecisions().precedents.filter((p) => p.class === className && isApplicable(p, { scope: flagValue('--scope'), gated }));
      process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
      process.exit(hits.length > 0 ? 0 : 1);
      break;
    }
    case 'classes': {
      process.stdout.write(`${[...alwaysAskClasses()].join('\n')}\n`);
      break;
    }
    case 'gate': {
      const classes = rest.filter((arg) => !arg.startsWith('--'));
      if (classes.length === 0) {
        usage('gate needs at least one class');
      }
      const states = classes.map((className) => ({ className, state: gateState(className) }));
      process.stdout.write(`${states.map(({ className, state }) => `${className}: gate: ${state}`).join('\n')}\n`);
      process.exit(states.every(({ state }) => state === 'off') ? 0 : 1);
      break;
    }
    case 'add': {
      const precedent = addPrecedent({
        className: flagValue('--class') ?? usage('add needs --class'),
        situation: flagValue('--situation') ?? usage('add needs --situation'),
        decision: flagValue('--decision') ?? usage('add needs --decision'),
        why: flagValue('--why') ?? usage('add needs --why'),
        scope: flagValue('--scope'),
        title: flagValue('--title'),
        record: flagValue('--record'),
      });
      process.stdout.write(`${JSON.stringify(precedent, null, 2)}\n`);
      break;
    }
    case 'record': {
      const outcome = flagValue('--outcome');
      if (outcome !== 'approved' && outcome !== 'edited' && outcome !== 'overruled') {
        usage('record needs --outcome approved|edited|overruled');
      }
      const file = recordOutcome({
        className: flagValue('--class') ?? usage('record needs --class'),
        outcome,
        precedentId: flagValue('--precedent'),
      });
      const row = file.gate.find((candidate) => candidate.class === flagValue('--class'));
      process.stdout.write(`${row?.class}: count ${row?.count}, gate ${row?.gate}\n`);
      break;
    }
    default:
      usage('usage: ai-decisions <list|match|classes|gate|add|record> [options]');
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main();
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GATE_THRESHOLD,
  addPrecedent,
  alwaysAskClasses,
  gateState,
  isApplicable,
  loadDecisions,
  recordOutcome,
} from './decisions.mjs';
import { parseAlwaysAsk, parseDecisions, serializeDecisions } from './decisions_file.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'decisions.mjs');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let dir;
let saved;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'decisions-'));
  saved = process.env.AI_ESSENTIALS_DECISIONS;
  process.env.AI_ESSENTIALS_DECISIONS = join(dir, 'decisions.local.md');
});

afterEach(() => {
  if (saved === undefined) {
    delete process.env.AI_ESSENTIALS_DECISIONS;
  } else {
    process.env.AI_ESSENTIALS_DECISIONS = saved;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('decision file format', () => {
  it('parses the example file shipped with the repo', () => {
    const parsed = parseDecisions(readFileSync(join(REPO, 'policy', 'decisions.example.md'), 'utf8'));
    assert.deepEqual(parsed.precedents.map((p) => p.id), ['D-001', 'D-002']);
    assert.equal(parsed.precedents[0].class, 'layout');
    assert.equal(parsed.precedents[0].confirmations, 3);
    assert.equal(parsed.gate.length, 2);
  });

  it('round-trips a file without changing its precedents or gate', () => {
    const parsed = parseDecisions(readFileSync(join(REPO, 'policy', 'decisions.example.md'), 'utf8'));
    const again = parseDecisions(serializeDecisions(parsed));
    assert.deepEqual(again.precedents, parsed.precedents);
    assert.deepEqual(again.gate, parsed.gate);
  });

  it('reads the always-ask classes from the policy table', () => {
    const classes = parseAlwaysAsk(readFileSync(join(REPO, 'skills', 'tech-lead', 'always-ask.md'), 'utf8'));
    assert.equal(classes.has('api-contract'), true);
    assert.equal(classes.has('layout'), false);
  });
});

describe('isApplicable', () => {
  const base = {
    id: 'D-001', title: 't', class: 'layout', situation: 's', decision: 'd', why: 'w',
    scope: 'global', confirmations: 2, lastConfirmed: '2026-10-01', contradicted: 'no',
  };
  const context = { scope: 'github.com/o/r', gated: new Set(['api-contract']) };

  it('applies a confirmed, uncontradicted, global precedent', () => {
    assert.equal(isApplicable(base, context), true);
  });

  it('does not apply a precedent with a single confirmation', () => {
    assert.equal(isApplicable({ ...base, confirmations: 1 }, context), false);
  });

  it('does not apply a contradicted precedent', () => {
    assert.equal(isApplicable({ ...base, contradicted: '2026-10-20' }, context), false);
  });

  it('does not apply a precedent in an always-ask class', () => {
    assert.equal(isApplicable({ ...base, class: 'api-contract' }, context), false);
  });

  it('applies a repo-scoped precedent only in that repo', () => {
    const scoped = { ...base, scope: 'github.com/o/r' };
    assert.equal(isApplicable(scoped, context), true);
    assert.equal(isApplicable(scoped, { ...context, scope: 'github.com/o/other' }), false);
  });
});

describe('plan gate', () => {
  it('stays on for a class with no history', () => {
    assert.equal(gateState('layout'), 'on');
  });

  it('turns off after the threshold of consecutive approved breakdowns', () => {
    for (let count = 1; count < GATE_THRESHOLD; count += 1) {
      recordOutcome({ className: 'layout', outcome: 'approved' });
      assert.equal(gateState('layout'), 'on', `after ${count}`);
    }
    recordOutcome({ className: 'layout', outcome: 'approved' });
    assert.equal(gateState('layout'), 'off');
  });

  it('turns back on and resets the count after an edit', () => {
    for (let count = 0; count < GATE_THRESHOLD; count += 1) {
      recordOutcome({ className: 'layout', outcome: 'approved' });
    }
    recordOutcome({ className: 'layout', outcome: 'edited' });
    assert.equal(gateState('layout'), 'on');
    assert.equal(loadDecisions().gate.find((row) => row.class === 'layout').count, 0);
  });

  it('never turns off for an always-ask class', () => {
    assert.equal(alwaysAskClasses().has('security'), true);
    for (let count = 0; count < GATE_THRESHOLD + 2; count += 1) {
      recordOutcome({ className: 'security', outcome: 'approved' });
    }
    assert.equal(gateState('security'), 'on');
  });
});

describe('precedents', () => {
  it('adds a precedent with one confirmation and the next id', () => {
    addPrecedent({ className: 'layout', situation: 'a', decision: 'b', why: 'c' });
    const second = addPrecedent({ className: 'layout', situation: 'd', decision: 'e', why: 'f' });
    assert.equal(second.id, 'D-002');
    assert.equal(second.confirmations, 1);
  });

  it('adds a confirmation when an outcome is approved against a precedent', () => {
    const added = addPrecedent({ className: 'layout', situation: 'a', decision: 'b', why: 'c' });
    recordOutcome({ className: 'layout', outcome: 'approved', precedentId: added.id });
    assert.equal(loadDecisions().precedents[0].confirmations, 2);
  });

  it('marks a precedent contradicted when the user overrules it', () => {
    const added = addPrecedent({ className: 'layout', situation: 'a', decision: 'b', why: 'c' });
    recordOutcome({ className: 'layout', outcome: 'overruled', precedentId: added.id, today: '2026-10-29' });
    assert.equal(loadDecisions().precedents[0].contradicted, '2026-10-29');
  });
});

describe('decisions cli', () => {
  /** @param {string[]} args */
  function run(args) {
    return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: process.env });
  }

  it('exits 1 from gate while any class is still gated', () => {
    const result = run(['gate', 'layout']);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /layout: gate: on/);
  });

  it('exits 0 from gate once every named class is off', () => {
    writeFileSync(process.env.AI_ESSENTIALS_DECISIONS, '# d\n\n## Precedents\n\n## Gate\n\n| class | consecutive-approved-unedited | gate |\n|---|---|---|\n| layout | 5 | off |\n');
    assert.equal(run(['gate', 'layout']).status, 0);
  });

  it('returns only applicable precedents from match', () => {
    addPrecedent({ className: 'layout', situation: 'a', decision: 'b', why: 'c' });
    assert.equal(run(['match', '--class', 'layout']).status, 1);
    recordOutcome({ className: 'layout', outcome: 'approved', precedentId: 'D-001' });
    const result = run(['match', '--class', 'layout']);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout)[0].id, 'D-001');
  });

  it('records an outcome and prints the new gate state', () => {
    const result = run(['record', '--class', 'layout', '--outcome', 'approved']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /layout: count 1, gate on/);
  });
});

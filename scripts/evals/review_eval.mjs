#!/usr/bin/env node
/**
 * Capability evals for the review layer: do the `reviewer` and
 * `convention-checker` agents catch a planted defect, do they stay quiet on
 * a clean change, and does the `skeptic` agent confirm a real finding and
 * refute a false one? The delivery evals (run.mjs) grade what an agent did to a
 * repo; these grade what a reviewer says about a diff, because a reviewer that
 * quietly stops catching bugs is the failure nothing else in the setup notices.
 *
 *   node scripts/evals/review_eval.mjs --self-test
 *   node scripts/evals/review_eval.mjs [--task <id>] [--trials N]
 *
 * Real runs start the installed agent as the session agent (`claude -p --agent
 * <name>`), so they test the generated agent file, its tools and its model.
 * They cost money; results go to ~/.ai-essentials/state/evals/.
 *
 * --self-test grades a known-good and a known-bad answer per task, so a grader
 * that cannot fail is caught for free.
 *
 * @typedef {{ file: string, marker: string }} IFlag A defect at the line of `file` containing `marker`.
 * @typedef {{ flags: IFlag[] } | { clean: true } | { pass: true } | { verdict: 'CONFIRMED' | 'REFUTED' }} IReviewExpect
 * @typedef {IFlag & { text: string }} IFinding A finding handed to the skeptic; `{line}` in `text` becomes the marker's line.
 * @typedef {{
 *   id: string, agent: 'reviewer' | 'convention-checker' | 'skeptic', covers: string,
 *   spec?: string, rules?: string[], finding?: IFinding, base: Record<string, string>, change: Record<string, string>,
 *   expect: IReviewExpect, samples: { good: string, bad: string },
 * }} IReviewTask
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoHome } from '../lib/paths.mjs';
import { stateDir } from '../lib/state.mjs';

/** A cited line counts if it is this close to the planted one: agents cite the start of a hunk or the line after. */
const LINE_TOLERANCE = 2;
const TRIAL_BUDGET_USD = process.env.EVAL_BUDGET_USD ?? '1';
const TRIAL_MAX_TURNS = process.env.EVAL_MAX_TURNS ?? '15';

const PAGINATE_BASE = `/** Items on one page. */
export function page(items, index, size) {
  return items;
}
`;

const PAGINATE_BUGGY = `/** Items on one page. */
export function page(items, index, size) {
  const start = index * size;
  return items.slice(start, start + size - 1);
}
`;

const PAGINATE_SPEC = '# Spec\n\n## Requirements\n\n- `page(items, index, size)` returns the `size` items starting at `index * size` (index is zero-based).\n- The last page may be shorter.\n';

const MEAN_UNGUARDED = `/** Mean of the values. */
export function mean(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}
`;

const MEAN_CORRECT = `/** Mean of the values, or null when there are none. */
export function mean(values) {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}
`;

/** @type {IReviewTask[]} */
export const REVIEW_TASKS = [
  {
    id: 'reviewer-catches-off-by-one',
    agent: 'reviewer',
    covers: 'the reviewer reports a wrong slice bound that drops the last item of every page',
    spec: PAGINATE_SPEC,
    base: { 'src/paginate.js': PAGINATE_BASE },
    change: { 'src/paginate.js': PAGINATE_BUGGY },
    expect: { flags: [{ file: 'src/paginate.js', marker: 'start + size - 1' }] },
    samples: {
      good: '[blocks] src/paginate.js:{line} slice end excludes the last item of each page\nEvidence: slice(start, start + size - 1)\nSpec: returns the size items',
      bad: 'No gaps found. Checked the requirement and the slice.',
    },
  },
  {
    id: 'reviewer-stays-quiet-on-a-clean-change',
    agent: 'reviewer',
    covers: 'the reviewer reports no blocking defect or gap for a correct one-line copy change that needs no test',
    spec: '# Spec\n\n## Requirements\n\n- The greeting reads "Hello" instead of "Hi".\n\n## Out of scope\n\n- Tests: a copy change has no behaviour worth a test.\n',
    base: { 'src/greet.js': 'export const greet = (name) => `Hi, ${name}`;\n' },
    change: { 'src/greet.js': 'export const greet = (name) => `Hello, ${name}`;\n' },
    expect: { clean: true },
    samples: {
      good: 'No gaps found. Checked: the greeting requirement (src/greet.js:1), scope, tests.',
      bad: '[gap] src/greet.js:1 no test asserts the new greeting\nEvidence: none\nSpec: not in spec',
    },
  },
  {
    id: 'checker-flags-an-enum',
    agent: 'convention-checker',
    covers: 'the convention checker flags a TypeScript enum against the rule that bans them',
    rules: ['typescript-style.mdc'],
    base: { 'src/status.ts': 'export const DEFAULT_STATUS = "open";\n' },
    change: { 'src/status.ts': 'export const DEFAULT_STATUS = "open";\n\nexport enum Status {\n  Open = "open",\n  Closed = "closed",\n}\n' },
    expect: { flags: [{ file: 'src/status.ts', marker: 'export enum Status' }] },
    samples: {
      good: 'src/status.ts:{line} typescript-style.mdc "no enums": declares an enum\nChecked 1 files against: typescript-style.mdc.',
      bad: 'PASS\nChecked 1 files against: typescript-style.mdc.',
    },
  },
  {
    id: 'checker-passes-a-conforming-change',
    agent: 'convention-checker',
    covers: 'the convention checker passes a change that follows the rule it was given',
    rules: ['typescript-style.mdc'],
    base: { 'src/status.ts': 'export const DEFAULT_STATUS = "open";\n' },
    change: { 'src/status.ts': 'export const DEFAULT_STATUS = "open";\n\nexport type TStatus = "open" | "closed";\n' },
    expect: { pass: true },
    samples: {
      good: 'PASS\nChecked 1 files against: typescript-style.mdc.',
      bad: 'src/status.ts:3 typescript-style.mdc "interfaces over types": uses a type alias\nChecked 1 files against: typescript-style.mdc.',
    },
  },
  {
    id: 'skeptic-confirms-a-real-bug',
    agent: 'skeptic',
    covers: 'the skeptic confirms a true finding instead of explaining it away',
    spec: PAGINATE_SPEC,
    finding: {
      file: 'src/paginate.js',
      marker: 'start + size - 1',
      text: '[Critical] `src/paginate.js:{line}` -- the slice end `start + size - 1` drops the last item of every page; use `start + size`.',
    },
    base: { 'src/paginate.js': PAGINATE_BASE },
    change: { 'src/paginate.js': PAGINATE_BUGGY },
    expect: { verdict: 'CONFIRMED' },
    samples: {
      good: '### src/paginate.js:{line}\nVerdict: CONFIRMED\nEvidence: page([1, 2, 3], 0, 3) slices (0, 2) and returns [1, 2]; the spec asks for 3 items.',
      bad: '### src/paginate.js:{line}\nVerdict: REFUTED\nEvidence: slice excludes its end index, so the bound is intended.',
    },
  },
  {
    id: 'skeptic-refutes-a-false-finding',
    agent: 'skeptic',
    covers: 'the skeptic refutes a plausible finding that an earlier guard in the same function rules out',
    finding: {
      file: 'src/mean.js',
      marker: 'total / values.length',
      text: '[Critical] `src/mean.js:{line}` -- divides by `values.length`, so `mean([])` returns NaN instead of the documented null.',
    },
    base: { 'src/mean.js': MEAN_UNGUARDED },
    change: { 'src/mean.js': MEAN_CORRECT },
    expect: { verdict: 'REFUTED' },
    samples: {
      good: '### src/mean.js:{line}\nVerdict: REFUTED\nEvidence: src/mean.js:3 returns null when values.length === 0, so the division never sees an empty list.',
      bad: '### src/mean.js:{line}\nVerdict: CONFIRMED\nEvidence: values.length can be 0.',
    },
  },
];

/**
 * @param {IReviewTask} task
 * @param {IFlag} flag
 * @returns {number} 1-based line of the marker in the changed file.
 */
function markerLine(task, flag) {
  const index = (task.change[flag.file] ?? '').split('\n').findIndex((line) => line.includes(flag.marker));
  if (index === -1) {
    throw new Error(`${task.id}: marker "${flag.marker}" not found in ${flag.file}`);
  }
  return index + 1;
}

/**
 * Citations of `file` with a line number, from any path spelling (relative,
 * absolute, a/ b/ prefixes).
 *
 * @param {string} output
 * @param {string} file
 * @returns {number[]}
 */
function citedLines(output, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...output.matchAll(new RegExp(`${escaped}:(\\d+)`, 'g'))].map((match) => Number(match[1]));
}

/**
 * @param {IReviewTask} task
 * @param {string} output The agent's final answer.
 * @returns {{ pass: boolean, reasons: string[] }}
 */
export function gradeReview(task, output) {
  const reasons = [];
  if ('flags' in task.expect) {
    for (const flag of task.expect.flags) {
      const line = markerLine(task, flag);
      if (!citedLines(output, flag.file).some((cited) => Math.abs(cited - line) <= LINE_TOLERANCE)) {
        reasons.push(`did not cite ${flag.file}:${line}`);
      }
    }
  }
  if ('clean' in task.expect && /^\s*\[(blocks|gap)\]/im.test(output)) {
    reasons.push('reported a blocking defect or gap on a clean change');
  }
  if ('pass' in task.expect && !/^\s*PASS\s*$/m.test(output)) {
    reasons.push('did not answer PASS on a conforming change');
  }
  if ('verdict' in task.expect) {
    const expected = task.expect.verdict;
    // Only `Verdict:` lines count: the evidence may mention the other words in passing.
    const verdicts = [...output.matchAll(/^\W*verdict\W*\s*(CONFIRMED|REFUTED|UNSURE)\b/gim)].map((match) => match[1].toUpperCase());
    if (verdicts.length === 0) {
      reasons.push('gave no Verdict line');
    } else if (verdicts.some((verdict) => verdict !== expected)) {
      reasons.push(`answered ${verdicts.join(', ')} where ${expected} was expected`);
    }
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * @param {IReviewTask} task
 * @param {'good' | 'bad'} which
 * @returns {string} The sample answer with {line} filled in from the planted defect.
 */
function sample(task, which) {
  return fillLine(task, task.samples[which]);
}

/**
 * @param {IReviewTask} task
 * @param {string} text
 * @returns {string} `text` with {line} replaced by the line of the planted defect or the finding's marker.
 */
function fillLine(task, text) {
  const flag = 'flags' in task.expect ? task.expect.flags[0] : task.finding;
  const line = flag === undefined ? 1 : markerLine(task, flag);
  return text.replaceAll('{line}', String(line));
}

/** @returns {Array<{ id: string, sample: string, expected: boolean, actual: boolean, reasons: string[] }>} */
export function selfTest() {
  return REVIEW_TASKS.flatMap((task) =>
    /** @type {Array<['good' | 'bad', boolean]>} */ ([['good', true], ['bad', false]]).map(([which, expected]) => {
      const { pass, reasons } = gradeReview(task, sample(task, which));
      return { id: task.id, sample: which, expected, actual: pass, reasons };
    }),
  );
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/** @param {string} root @param {Record<string, string>} files */
function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

/**
 * One isolated trial: a fresh repo with the base committed and the change left
 * as a diff, then the agent's answer graded.
 *
 * @param {IReviewTask} task
 * @returns {{ pass: boolean, reasons: string[], costUsd: number | null }}
 */
export function runReviewTrial(task) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), `review-eval-${task.id}-`)));
  try {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    writeFiles(repo, task.base);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'eval@example.com']);
    git(repo, ['config', 'user.name', 'Eval User']);
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'base']);
    writeFiles(repo, task.change);
    const patch = join(base, 'change.patch');
    writeFileSync(patch, git(repo, ['diff']));

    const lines = [`Diff: ${patch}`, `Repo root: ${repo}`];
    if (task.spec !== undefined) {
      writeFileSync(join(base, 'SPEC.md'), task.spec);
      lines.unshift(`Spec: ${join(base, 'SPEC.md')}`);
    }
    if (task.rules !== undefined) {
      lines.push(`Rule files: ${task.rules.map((rule) => join(repoHome(), 'rules', rule)).join(', ')}`);
    }
    if (task.finding !== undefined) {
      lines.push('', 'Findings to verify:', fillLine(task, task.finding.text));
    }
    const result = spawnSync(
      'claude',
      ['-p', lines.join('\n'), '--agent', task.agent, '--max-turns', TRIAL_MAX_TURNS, '--max-budget-usd', TRIAL_BUDGET_USD, '--output-format', 'json'],
      { cwd: repo, encoding: 'utf8', input: '' },
    );
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (error) {
      return { pass: false, reasons: [`claude printed no JSON result: ${result.stderr.slice(0, 300)}`], costUsd: null };
    }
    return { ...gradeReview(task, String(parsed.result ?? '')), costUsd: parsed.total_cost_usd ?? null };
  } finally {
    if (process.env.EVAL_KEEP === '1') {
      process.stderr.write(`EVAL_KEEP=1: trial kept at ${base}\n`);
    } else {
      rmSync(base, { recursive: true, force: true });
    }
  }
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
    const rows = selfTest();
    for (const row of rows) {
      process.stdout.write(`${row.expected === row.actual ? 'ok  ' : 'FAIL'} ${row.id} (${row.sample} answer graded ${row.actual ? 'pass' : 'fail'})\n`);
    }
    process.exit(rows.every((row) => row.expected === row.actual) ? 0 : 1);
  }
  const only = flagValue('--task');
  const trials = Number.parseInt(flagValue('--trials') ?? '1', 10);
  const tasks = REVIEW_TASKS.filter((task) => only === undefined || task.id === only);
  const report = tasks.map((task) => {
    const results = Array.from({ length: trials }, () => runReviewTrial(task));
    const passed = results.filter((result) => result.pass).length;
    const cost = results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);
    process.stdout.write(`${passed === trials ? 'pass' : 'FAIL'} ${task.id}  pass@1 ${(passed / trials).toFixed(2)}  $${cost.toFixed(2)}${passed === trials ? '' : `  ${results.flatMap((result) => result.reasons).join('; ')}`}\n`);
    return { id: task.id, trials: results, passAt1: passed / trials, costUsd: cost };
  });
  const dir = join(stateDir(), 'evals');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-review.json`), JSON.stringify(report, null, 2));
  process.exit(report.every((row) => row.passAt1 === 1) ? 0 : 1);
}

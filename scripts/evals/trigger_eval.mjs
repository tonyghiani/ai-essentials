#!/usr/bin/env node
/**
 * Skill-triggering evals: does a prompt that should start a skill start it,
 * and does a near-miss prompt leave it alone? A skill whose description stops
 * matching how people ask is dead weight in every session's context, and one
 * that fires on the wrong prompt hijacks the turn. Neither failure shows up
 * anywhere else.
 *
 *   node scripts/evals/trigger_eval.mjs --self-test
 *   node scripts/evals/trigger_eval.mjs [--skill <name>] [--trials N]
 *
 * A real trial runs `claude -p` on haiku in a throwaway git repo, capped at two
 * turns: the first tool call is all the grader needs. It reads the stream for a
 * `Skill` tool_use and grades which skill it named. Trials cost money; results
 * go to ~/.ai-essentials/state/evals/.
 *
 * --self-test grades a synthetic stream that should pass and one that should
 * fail for every case, so a grader that cannot fail is caught for free.
 *
 * @typedef {{ skill: string, shouldTrigger: string[], nearMiss: string }} ITriggerCase
 * @typedef {{ skill: string, kind: 'should' | 'near', prompt: string }} ITriggerPrompt
 * @typedef {{ pass: boolean, invoked: string[], reasons: string[], costUsd: number | null }} ITriggerResult
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stateDir } from '../lib/state.mjs';

const TRIAL_BUDGET_USD = process.env.EVAL_BUDGET_USD ?? '0.3';
/** Enough to see the first tool call without letting the skill run its course. */
const TRIAL_MAX_TURNS = process.env.EVAL_MAX_TURNS ?? '2';
const TRIAL_MODEL = process.env.EVAL_MODEL ?? 'haiku';
const TRIAL_TIMEOUT_MS = 180_000;

/** @type {ITriggerCase[]} */
export const TRIGGER_CASES = [
  {
    skill: 'review-team',
    shouldTrigger: [
      'Run a review team over the changes on this branch; I want a multi-perspective review before I open the PR.',
      'Get a panel of reviewers with different angles to look at src/ and consolidate what they find into one report.',
    ],
    nearMiss: 'A reviewer left this comment on my PR: "rename sum to add". Should I accept it or push back?',
  },
  {
    skill: 'grill-me',
    shouldTrigger: [
      'Grill me on this plan: I want to replace REST polling with websockets. Keep asking until we agree.',
      'Stress-test my plan to split src/ into two packages. Interview me before any code is written.',
    ],
    nearMiss: 'List the steps to add a multiply function to src/sum.js. No questions, just the steps.',
  },
  {
    skill: 'deep-research',
    shouldTrigger: [
      'Become the expert on this codebase before doing anything: deep dive into the architecture and report back.',
      'Research the architecture of this repo in depth and load context from src/ before we plan any change.',
    ],
    nearMiss: 'What does sum in src/sum.js return when both arguments are 0?',
  },
  {
    skill: 'brainstorm',
    shouldTrigger: [
      'Brainstorm with me: what are our options for caching the results of sum in src/sum.js?',
      'Help me think through design alternatives for splitting src/ into packages. I have no plan yet.',
    ],
    nearMiss: 'Grill me on this plan: I want to replace REST polling with websockets. Keep asking until we agree.',
  },
  {
    skill: 'web-research',
    shouldTrigger: [
      'Look online for current best practices on property-based testing in JavaScript and give me a cited report.',
      'Research the state of the art in client-side caching for web apps and compare the main approaches.',
    ],
    nearMiss: 'Become the expert on this codebase before doing anything: deep dive into src/ and report back.',
  },
  {
    skill: 'tdd',
    shouldTrigger: [
      'Use tdd to add a multiply(a, b) function to src/sum.js.',
      'Write the failing test first, then implement subtract in src/sum.js.',
    ],
    nearMiss: 'Run the existing tests and tell me whether they pass.',
  },
  {
    skill: 'verify-contract',
    shouldTrigger: [
      'Set up verification for this repo so the stop hook knows which checks prove a change is done.',
      'Write the verify contract for this repository.',
    ],
    nearMiss: 'Run npm test once and show me the output.',
  },
  {
    skill: 'dep-size',
    shouldTrigger: [
      'Is lodash worth adding here just for debounce? What would it cost in bundle size?',
      'The bundle-size check failed in CI. Find which import in src/ is bloating the bundle.',
    ],
    nearMiss: 'Set the node engine in package.json to >=20.',
  },
  {
    skill: 'a11y-audit',
    shouldTrigger: [
      'Audit src/menu.jsx for accessibility: can a keyboard or screen-reader user operate it?',
      'Check src/menu.jsx against WCAG before we ship this custom control.',
    ],
    nearMiss: 'Change the button background in src/menu.jsx to blue.',
  },
  {
    skill: 'i18n-sweep',
    shouldTrigger: [
      'Find the hardcoded user-facing strings in src/menu.jsx that are not translated.',
      'Our i18n check failed; sweep the UI code for untranslated copy.',
    ],
    nearMiss: 'Translate "the build is green" into Italian.',
  },
  {
    skill: 'react-perf',
    shouldTrigger: [
      'The list in src/menu.jsx is janky and re-renders on every keystroke. Audit its render performance.',
      'Should I wrap Menu in memo and its handlers in useCallback? It feels slow.',
    ],
    nearMiss: 'Rename the Menu component in src/menu.jsx to NavMenu.',
  },
  {
    skill: 'api-contract-review',
    shouldTrigger: [
      'I am changing the response shape of our GET /api/items route. Is that a breaking change?',
      'Review the exported API of src/sum.js before we publish it as a package: compatibility and validation.',
    ],
    nearMiss: 'Add a JSDoc comment to the sum function in src/sum.js.',
  },
  {
    skill: 'branch-refactor-planner',
    shouldTrigger: [
      'Give me a refactor plan for all the changes on this branch compared with main.',
      'Clean up this branch: do a code quality review and give me a prioritized refactoring plan.',
    ],
    nearMiss: 'Rename the parameter a to left in src/sum.js.',
  },
  {
    skill: 'pr-description-template',
    shouldTrigger: [
      'Write a PR description for the changes on this branch.',
      'Draft the pull request summary and testing notes for this change.',
    ],
    nearMiss: 'Write a commit message for the last change to src/sum.js.',
  },
  {
    skill: 'gh-issue-writer',
    shouldTrigger: [
      'Draft a GitHub issue for this bug: sum returns "12" when given the strings "1" and "2".',
      'Write gh issue content for a feature request: add a multiply function.',
    ],
    nearMiss: 'Fix the bug where sum returns "12" when given the strings "1" and "2".',
  },
  {
    skill: 'resolve-merge-conflicts',
    shouldTrigger: [
      'Merge main into this branch and fix the conflicts.',
      'The PR shows conflicts against its base. Resolve them.',
    ],
    nearMiss: 'Explain the difference between git merge and git rebase in two sentences.',
  },
  {
    skill: 'memory-distill',
    shouldTrigger: [
      'Distill memory from the corrections I made recently.',
      'What have you learned about my preferences? Update your memory.',
    ],
    nearMiss: 'How much memory does a Node.js process use by default?',
  },
  {
    // disable-model-invocation: the model never sees it, so nothing should trigger it.
    skill: 'tech-lead',
    shouldTrigger: [],
    nearMiss: 'Take this ticket from spec to a draft PR: add a multiply function to src/sum.js.',
  },
];

/** A tiny repo with a branch, a JS module and a React component, so every prompt has something to point at. */
const FIXTURE_BASE = {
  'package.json': '{\n  "name": "fixture",\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# fixture\n\nA small library.\n',
  'src/sum.js': '/** Adds two numbers. */\nexport function sum(a, b) {\n  return a + b;\n}\n',
  'src/sum.test.js': "import assert from 'node:assert/strict';\nimport { it } from 'node:test';\nimport { sum } from './sum.js';\n\nit('adds', () => {\n  assert.equal(sum(1, 2), 3);\n});\n",
  'src/menu.jsx': "export function Menu({ items, onPick }) {\n  return (\n    <div className=\"menu\">\n      <div onClick={() => onPick(null)}>Close menu</div>\n      {items.map((item) => (\n        <div key={item.id} onClick={() => onPick(item)}>{item.label}</div>\n      ))}\n    </div>\n  );\n}\n",
};
const FIXTURE_BRANCH_CHANGE = {
  'src/sum.js': '/** Adds two numbers. */\nexport function sum(a, b) {\n  const total = a + b;\n  return total;\n}\n',
};

/** @returns {ITriggerPrompt[]} */
export function listPrompts() {
  return TRIGGER_CASES.flatMap((triggerCase) => [
    ...triggerCase.shouldTrigger.map((prompt) => ({ skill: triggerCase.skill, kind: /** @type {const} */ ('should'), prompt })),
    { skill: triggerCase.skill, kind: /** @type {const} */ ('near'), prompt: triggerCase.nearMiss },
  ]);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Plugin skills arrive as `plugin:name`; the skills under test are plain names.
 *
 * @param {string} name
 */
const bareName = (name) => name.split(':').at(-1) ?? name;

/**
 * @param {string} stream `claude -p --output-format stream-json --verbose` output.
 * @returns {{ invoked: string[], costUsd: number | null }}
 */
export function parseStream(stream) {
  const events = stream
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return isRecord(parsed) ? [parsed] : [];
      } catch (error) {
        return [];
      }
    });
  const invoked = events
    .filter((event) => event.type === 'assistant' && isRecord(event.message) && Array.isArray(event.message.content))
    .flatMap((event) => /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (event.message).content))
    .filter((block) => isRecord(block) && block.type === 'tool_use' && block.name === 'Skill' && isRecord(block.input))
    .map((block) => String(/** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (block).input).skill ?? ''))
    .filter(Boolean)
    .map(bareName);
  const result = events.find((event) => event.type === 'result');
  return { invoked, costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null };
}

/**
 * @param {ITriggerPrompt} prompt
 * @param {string} stream
 * @returns {ITriggerResult}
 */
export function gradeTrigger(prompt, stream) {
  const { invoked, costUsd } = parseStream(stream);
  const fired = invoked.includes(prompt.skill);
  const reasons = [];
  if (prompt.kind === 'should' && !fired) {
    reasons.push(`expected ${prompt.skill}, invoked ${invoked.length === 0 ? 'no skill' : invoked.join(', ')}`);
  }
  if (prompt.kind === 'near' && fired) {
    reasons.push(`near-miss invoked ${prompt.skill}`);
  }
  return { pass: reasons.length === 0, invoked, reasons, costUsd };
}

/**
 * The event shapes `claude -p --output-format stream-json --verbose` prints:
 * an init event, assistant messages carrying tool_use blocks, a result event.
 *
 * @param {string | null} skill The skill the synthetic assistant calls, or null for none.
 * @returns {string}
 */
function syntheticStream(skill) {
  const content = skill === null
    ? [{ type: 'text', text: 'Here is the answer.' }]
    : [{ type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill } }];
  return [
    { type: 'system', subtype: 'init', session_id: 's', tools: ['Skill', 'Bash'] },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_0', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'assistant', message: { role: 'assistant', content } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.01 },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');
}

/** @returns {Array<{ skill: string, kind: string, sample: 'good' | 'bad', expected: boolean, actual: boolean }>} */
export function selfTest() {
  return listPrompts().flatMap((prompt) => {
    // A near-miss that triggers a different skill still passes; only the skill under test matters.
    const good = prompt.kind === 'should' ? syntheticStream(`plugin:${prompt.skill}`) : syntheticStream(prompt.skill === 'tdd' ? 'grill-me' : 'tdd');
    const bad = prompt.kind === 'should' ? syntheticStream(null) : syntheticStream(prompt.skill);
    return /** @type {Array<['good' | 'bad', string, boolean]>} */ ([['good', good, true], ['bad', bad, false]]).map(([sample, stream, expected]) => ({
      skill: prompt.skill,
      kind: prompt.kind,
      sample,
      expected,
      actual: gradeTrigger(prompt, stream).pass,
    }));
  });
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

/** @param {string} root @param {Record<string, string>} files */
function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

/**
 * One isolated trial: a fresh repo on a feature branch one commit ahead of
 * main, one prompt, and the stream graded.
 *
 * @param {ITriggerPrompt} prompt
 * @returns {ITriggerResult}
 */
export function runTriggerTrial(prompt) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), `trigger-eval-${prompt.skill}-`)));
  try {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    writeFiles(repo, FIXTURE_BASE);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'eval@example.com']);
    git(repo, ['config', 'user.name', 'Eval User']);
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'base']);
    git(repo, ['checkout', '-q', '-b', 'feature/total']);
    writeFiles(repo, FIXTURE_BRANCH_CHANGE);
    git(repo, ['commit', '-q', '-am', 'name the total']);

    const result = spawnSync(
      'claude',
      ['-p', prompt.prompt, '--max-turns', TRIAL_MAX_TURNS, '--max-budget-usd', TRIAL_BUDGET_USD, '--output-format', 'stream-json', '--verbose', '--model', TRIAL_MODEL],
      {
        cwd: repo,
        encoding: 'utf8',
        input: '',
        timeout: TRIAL_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        // A throwaway state dir keeps eval sessions out of the real skill-usage and correction logs.
        env: { ...process.env, AI_ESSENTIALS_STATE: join(base, 'state') },
      },
    );
    if (result.stdout === null || !result.stdout.includes('"type":"result"')) {
      const graded = gradeTrigger(prompt, result.stdout ?? '');
      return { ...graded, pass: false, reasons: [...graded.reasons, `no result event: ${(result.stderr ?? String(result.error ?? '')).slice(0, 300)}`] };
    }
    return gradeTrigger(prompt, result.stdout);
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
      process.stdout.write(`${row.expected === row.actual ? 'ok  ' : 'FAIL'} ${row.skill} ${row.kind} (${row.sample} stream graded ${row.actual ? 'pass' : 'fail'})\n`);
    }
    process.exit(rows.every((row) => row.expected === row.actual) ? 0 : 1);
  }
  const only = process.argv.flatMap((arg, index) => (arg === '--skill' ? [process.argv[index + 1]] : []));
  const trials = Number.parseInt(flagValue('--trials') ?? '1', 10);
  const prompts = listPrompts().filter((prompt) => only.length === 0 || only.includes(prompt.skill));
  const report = prompts.map((prompt) => {
    const results = Array.from({ length: trials }, () => runTriggerTrial(prompt));
    const passed = results.filter((result) => result.pass).length;
    const cost = results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);
    const failures = results.flatMap((result) => result.reasons);
    process.stdout.write(
      `${passed === trials ? 'pass' : 'FAIL'} ${prompt.skill} ${prompt.kind.padEnd(6)} ${passed}/${trials}  $${cost.toFixed(3)}  ${prompt.prompt.slice(0, 60)}${failures.length > 0 ? `\n       ${failures.join('; ')}` : ''}\n`,
    );
    return { ...prompt, trials: results, passAt1: passed / trials, costUsd: cost };
  });
  const total = report.reduce((sum, row) => sum + row.costUsd, 0);
  process.stdout.write(`\n${report.filter((row) => row.passAt1 === 1).length}/${report.length} prompts passed  $${total.toFixed(3)}\n`);
  const dir = join(stateDir(), 'evals');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-trigger.json`), JSON.stringify(report, null, 2));
  process.exit(report.every((row) => row.passAt1 === 1) ? 0 : 1);
}

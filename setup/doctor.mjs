#!/usr/bin/env node
/**
 * Verify that the install on this machine does what the setup promises.
 *
 *   node setup/doctor.mjs [--home DIR] [--skip-network]
 *
 * Exit 1 if any check fails. Warnings are things the script cannot verify
 * (Codex hook trust, Cursor app toggles) or that deserve a look.
 *
 * The no-credit policy is only as good as this check: config can be reset by
 * an update, so it is read back here instead of assumed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isToolIdentity } from '../scripts/guard/attribution.mjs';
import { hookId } from './apply.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {{ status: 'PASS' | 'FAIL' | 'WARN', label: string, detail?: string }} ICheck */

/** @param {string} label @param {boolean} ok @param {string} [detail] @returns {ICheck} */
const check = (label, ok, detail) => ({ status: ok ? 'PASS' : 'FAIL', label, detail: ok ? undefined : detail });

/** @param {string} path @returns {string | null} */
function real(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    return null;
  }
}

/** @param {string} path @returns {any} */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return null;
  }
}

/**
 * @param {string} home
 * @returns {ICheck[]}
 */
export function checkLinks(home) {
  /** @type {Array<[string, string]>} link path, expected target */
  const expected = [
    [join(home, '.ai-essentials', 'repo'), REPO],
    [join(home, '.local', 'bin', 'ai-delegate'), join(REPO, 'scripts', 'delegate.sh')],
    [join(home, '.local', 'bin', 'ai-fanout'), join(REPO, 'scripts', 'fanout.sh')],
    [join(home, '.local', 'bin', 'ai-verify'), join(REPO, 'scripts', 'verify', 'cli.mjs')],
    [join(home, '.local', 'bin', 'ai-work'), join(REPO, 'scripts', 'work', 'cli.mjs')],
    [join(home, '.local', 'bin', 'ai-decisions'), join(REPO, 'scripts', 'work', 'decisions.mjs')],
    [join(home, '.local', 'bin', 'ai-pr-body'), join(REPO, 'scripts', 'work', 'pr_body.mjs')],
    [join(home, '.local', 'bin', 'ai-audit'), join(REPO, 'scripts', 'guard', 'audit_branch.mjs')],
    [join(home, '.local', 'bin', 'ai-checkup'), join(REPO, 'scripts', 'checkup', 'checkup.mjs')],
    [join(home, '.local', 'bin', 'ai-triage'), join(REPO, 'scripts', 'triage.sh')],
    [join(home, '.claude', 'skills'), join(REPO, 'skills')],
    [join(home, '.claude', 'hooks'), join(REPO, 'claude', 'hooks')],
    [join(home, '.claude', 'CLAUDE.md'), join(REPO, 'claude', 'CLAUDE.md')],
    [join(home, '.claude', 'rules'), join(REPO, 'claude', 'rules')],
    [join(home, '.claude', 'guidance'), join(REPO, 'rules')],
    [join(home, '.claude', 'agents'), join(home, '.ai-essentials', 'generated', 'claude', 'agents')],
    [join(home, '.cursor', 'hooks'), join(REPO, 'cursor', 'hooks')],
    [join(home, '.cursor', 'agents'), join(home, '.ai-essentials', 'generated', 'cursor', 'agents')],
    [join(home, '.cursor', 'skills', 'ai-essentials'), join(REPO, 'skills')],
    [join(home, '.codex', 'AGENTS.md'), join(REPO, 'codex', 'INSTRUCTIONS.md')],
    [join(home, '.codex', 'guidance'), join(REPO, 'rules')],
    [join(home, '.codex', 'hooks'), join(REPO, 'codex', 'hooks')],
    ...readdirSync(join(REPO, 'rules'))
      .filter((name) => name.endsWith('.mdc'))
      .map((name) => /** @type {[string, string]} */ ([join(home, '.cursor', 'rules', name), join(REPO, 'rules', name)])),
  ];
  const checks = expected.map(([link, target]) =>
    check(`link ${link.replace(home, '~')}`, real(link) !== null && real(link) === real(target), `expected to resolve to ${target}`),
  );

  const skills = readdirSync(join(REPO, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(REPO, 'skills', entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
  const missingSkills = skills.filter((name) => real(join(home, '.agents', 'skills', name)) !== real(join(REPO, 'skills', name)));
  checks.push(check('codex skills linked into ~/.agents/skills', missingSkills.length === 0, `missing: ${missingSkills.join(', ')}`));

  const agents = readdirSync(join(REPO, 'agents')).filter((name) => name.endsWith('.md')).map((name) => name.replace(/\.md$/, ''));
  const missingAgents = agents.filter((name) => !existsSync(join(home, '.codex', 'agents', `${name}.toml`)));
  checks.push(check('codex agents installed', missingAgents.length === 0, `missing: ${missingAgents.join(', ')}`));
  return checks;
}

/**
 * @param {Record<string, unknown> | null} hooks Claude or Codex shape.
 * @param {string} event
 * @param {string} script
 */
function hasGroupedHook(hooks, event, script) {
  const groups = /** @type {any[]} */ (hooks?.[event] ?? []);
  return groups.some((group) => (group.hooks ?? []).some((hook) => hookId(hook.command) === `${script}.mjs`));
}

/**
 * @param {string} home
 * @returns {ICheck[]}
 */
export function checkConfigs(home) {
  const checks = [];

  const claude = readJson(join(home, '.claude', 'settings.json'));
  checks.push(check('claude: commit attribution blank', claude?.attribution?.commit === '', 'attribution.commit is not ""'));
  checks.push(check('claude: PR attribution blank', claude?.attribution?.pr === '', 'attribution.pr is not ""'));
  checks.push(check('claude: includeCoAuthoredBy false', claude?.includeCoAuthoredBy === false, 'includeCoAuthoredBy is not false'));
  for (const [event, script] of [
    ['Stop', 'verify-on-stop'],
    ['PreToolUse', 'guard-git'],
    ['PostToolUse', 'format-on-edit'],
    ['UserPromptSubmit', 'log-correction-signal'],
    ['SessionStart', 'session-context'],
    ['PreToolUse', 'log-skill-use'],
    ['UserPromptExpansion', 'log-skill-use'],
  ]) {
    checks.push(check(`claude: ${event} runs ${script}`, hasGroupedHook(claude?.hooks, event, script), 'not registered in ~/.claude/settings.json'));
  }
  const deny = claude?.permissions?.deny ?? [];
  checks.push(check('claude: secrets denied', deny.includes('Read(**/.env)'), 'Read(**/.env) is not denied'));
  checks.push(check('claude: force push denied', deny.includes('Bash(git push --force *)'), 'Bash(git push --force *) is not denied'));
  if ((claude?.permissions?.allow ?? []).includes('Bash(*)')) {
    checks.push({ status: 'WARN', label: 'claude: Bash(*) is allowed', detail: 'every shell command runs without a prompt; the guard hook still applies' });
  }

  const cursorConfig = readJson(join(home, '.cursor', 'cli-config.json'));
  checks.push(check('cursor: commit attribution off', cursorConfig?.attribution?.attributeCommitsToAgent === false, 'attribution.attributeCommitsToAgent is not false'));
  checks.push(check('cursor: PR attribution off', cursorConfig?.attribution?.attributePRsToAgent === false, 'attribution.attributePRsToAgent is not false'));
  const cursorHooks = readJson(join(home, '.cursor', 'hooks.json'));
  for (const [event, script] of [
    ['stop', 'verify-on-stop'],
    ['beforeShellExecution', 'guard-git'],
    ['afterFileEdit', 'format-on-edit'],
    ['beforeSubmitPrompt', 'log-correction-signal'],
  ]) {
    const registered = (cursorHooks?.hooks?.[event] ?? []).some((/** @type {any} */ entry) => hookId(entry.command) === `${script}.mjs`);
    checks.push(check(`cursor: ${event} runs ${script}`, registered, 'not registered in ~/.cursor/hooks.json'));
  }

  const codexHooks = readJson(join(home, '.codex', 'hooks.json'));
  for (const [event, script] of [
    ['Stop', 'verify-on-stop'],
    ['PreToolUse', 'guard-git'],
    ['PostToolUse', 'format-on-edit'],
    ['UserPromptSubmit', 'log-correction-signal'],
    ['SessionStart', 'session-context'],
  ]) {
    checks.push(check(`codex: ${event} runs ${script}`, hasGroupedHook(codexHooks?.hooks, event, script), 'not registered in ~/.codex/hooks.json'));
  }
  const rules = join(home, '.codex', 'rules', 'guardrails.rules');
  checks.push(check('codex: guardrail rules installed', existsSync(rules), `${rules} is missing`));
  return checks;
}

/**
 * @param {string} home
 * @param {{ skipNetwork?: boolean, exec?: typeof spawnSync }} [options]
 * @returns {ICheck[]}
 */
export function checkIdentity(home, { skipNetwork = false, exec = spawnSync } = {}) {
  const read = (/** @type {string} */ key) => exec('git', ['config', '--global', key], { encoding: 'utf8', env: { ...process.env, HOME: home } }).stdout.trim();
  const name = read('user.name');
  const email = read('user.email');
  const checks = [
    check('git: user.name and user.email set globally', name !== '' && email !== '', 'set them with git config --global'),
    check('git: identity does not name an AI tool', !isToolIdentity(name) && !isToolIdentity(email), `"${name} <${email}>" names a tool`),
  ];
  for (const variable of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN']) {
    if (process.env[variable] !== undefined) {
      checks.push({ status: 'WARN', label: `env: ${variable} is set`, detail: 'remote actions would use this token instead of your gh login' });
    }
  }
  if (!skipNetwork) {
    const result = exec('gh', ['auth', 'status'], { encoding: 'utf8' });
    const account = /Logged in to \S+ account (\S+)/.exec(`${result.stdout}${result.stderr}`)?.[1];
    checks.push(
      result.status === 0
        ? { status: 'PASS', label: `gh: logged in as ${account ?? 'unknown account'}` }
        : { status: 'WARN', label: 'gh: not logged in', detail: 'run gh auth login yourself; agents are blocked from it' },
    );
  }
  const codex = exec('codex', ['execpolicy', 'check', '--rules', join(home, '.codex', 'rules', 'guardrails.rules'), '--', 'git', 'push', '--force', 'origin', 'x'], { encoding: 'utf8' });
  if (codex.error === undefined && existsSync(join(home, '.codex', 'rules', 'guardrails.rules'))) {
    checks.push(check('codex: execpolicy forbids a force push', /"decision":"forbidden"/.test(codex.stdout), codex.stdout.trim() || codex.stderr.trim()));
  }
  return checks;
}

/**
 * Delegation needs each tool's CLI. A missing one is a warning, not a failure:
 * you may not use that tool.
 *
 * @param {(command: string, args: string[], options: object) => { status: number | null }} [exec]
 * @returns {ICheck[]}
 */
export function checkClis(exec = spawnSync) {
  return [
    ['claude', 'claude', 'ai-delegate --tool claude'],
    ['codex', 'codex', 'ai-delegate --tool codex'],
    ['agent', 'cursor', 'ai-delegate --tool cursor (install the agent CLI: see cursor.com/docs/cli)'],
  ].map(([binary, tool, usedFor]) =>
    exec('which', [binary], { encoding: 'utf8' }).status === 0
      ? { status: /** @type {const} */ ('PASS'), label: `cli: ${binary} found` }
      : { status: /** @type {const} */ ('WARN'), label: `cli: ${binary} not installed`, detail: `${tool} cannot be used for ${usedFor}` },
  );
}

/**
 * @param {string} home
 * @returns {ICheck[]}
 */
export function checkState(home) {
  const errors = join(process.env.AI_ESSENTIALS_STATE ?? join(home, '.ai-essentials', 'state'), 'hook-errors.jsonl');
  if (!existsSync(errors)) {
    return [{ status: 'PASS', label: 'hooks: no recorded errors' }];
  }
  const lines = readFileSync(errors, 'utf8').split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  return [{ status: 'WARN', label: `hooks: ${lines.length} recorded error(s)`, detail: `latest: ${last.hook} at ${last.at}: ${last.message}` }];
}

/** @returns {ICheck[]} Steps no script can do or verify. */
export function manualSteps() {
  return [
    { status: 'WARN', label: 'codex: trust the hooks', detail: 'open Codex once, run /hooks, review and trust the five ai-essentials hooks; project hooks never run untrusted' },
    { status: 'WARN', label: 'cursor: attribution toggles', detail: 'Cursor Settings: turn off Commit Attribution and PR Attribution; the config keys come from forum reports, not docs' },
    { status: 'WARN', label: 'cursor: test the hooks in the app', detail: 'the Cursor CLI is not installed here, so hook payloads follow the docs; trigger one and check ~/.ai-essentials/state/hook-errors.jsonl' },
  ];
}

/**
 * @param {string} home
 * @param {{ skipNetwork?: boolean }} [options]
 * @returns {ICheck[]}
 */
export function runDoctor(home, options = {}) {
  return [...checkLinks(home), ...checkConfigs(home), ...checkIdentity(home, options), ...checkClis(), ...checkState(home), ...manualSteps()];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const homeIndex = process.argv.indexOf('--home');
  const home = homeIndex === -1 ? (process.env.HOME ?? '') : process.argv[homeIndex + 1];
  const results = runDoctor(home, { skipNetwork: process.argv.includes('--skip-network') });
  for (const { status, label, detail } of results) {
    process.stdout.write(`${status.padEnd(4)}  ${label}${detail ? `\n      ${detail}` : ''}\n`);
  }
  const failed = results.filter((result) => result.status === 'FAIL').length;
  const warned = results.filter((result) => result.status === 'WARN').length;
  process.stdout.write(`\n${results.length - failed - warned} passed, ${failed} failed, ${warned} to review\n`);
  process.exit(failed > 0 ? 1 : 0);
}

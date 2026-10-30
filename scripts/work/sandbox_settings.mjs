#!/usr/bin/env node
/**
 * Write the Claude Code settings file that sandboxes one headless run. The
 * runners (delegate.sh, fanout.sh) pass it with --settings, so it layers over
 * the user's own settings for that run only.
 *
 *   node scripts/work/sandbox_settings.mjs --out FILE --git-dir DIR --state DIR
 *        [--allow-domain HOST]... [--allow-write PATH]... [--done-when whole|task] [--no-sandbox]
 *
 * --done-when adds a prompt-based Stop hook: the mechanism behind /goal, which
 * cannot share a prompt with /tech-lead. A separate small model reads the run's
 * last message and lets it stop only on evidence of one of the allowed endings,
 * so "done" is not decided by the agent that did the work. The command Stop
 * hook (the verification contract) still runs beside it.
 *
 * Bash may write in the working directory (the sandbox default), the repo's git
 * directory, the state directory and the --allow-write paths, and reach only the
 * allowed hosts. Checked on this machine with a real headless run: a write to
 * the home directory and a request to an unlisted host were refused, and a
 * commit in a worktree went through.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** GitHub for gh and git over HTTPS, the npm and yarn registries for installs. */
export const DEFAULT_ALLOWED_DOMAINS = [
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'registry.npmjs.org',
  'registry.yarnpkg.com',
];

/** Package-manager caches: checks such as `npx tsc` write there, and a run that cannot is a false failure. */
export const DEFAULT_ALLOW_WRITE = ['~/.npm', '~/.cache'];

/**
 * gh reads its token from the keychain, and git over SSH cannot run sandboxed
 * on macOS. These run outside the sandbox and stay behind the guard hook, which
 * is the layer that checks them.
 */
const UNSANDBOXED_COMMANDS = ['gh *', 'git push *', 'git fetch *', 'git pull *'];

/** What a finished run must show, per ai-delegate mode. */
const FINISHED_EVIDENCE = {
  whole: 'it quotes the verification command(s) with passing output and gives the draft pull request URL',
  task: 'it quotes the verification command(s) with passing output and names the commit it made on its branch (no pull request in this mode)',
};

/**
 * @param {'whole' | 'task'} mode
 * @returns {string} The evaluator prompt for a delegated run.
 */
export function doneWhenPrompt(mode) {
  return [
    'An unattended coding run wants to stop. Its final message is the last_assistant_message field in this input: $ARGUMENTS',
    'Answer ok: true only if that message shows one of these endings:',
    `1. Finished: ${FINISHED_EVIDENCE[mode]}.`,
    '2. Stopped for the user: it says it wrote its open questions to questions.md.',
    '3. Blocked: it names the blocker and quotes the failing output after repeated attempts.',
    'Otherwise answer ok: false and give, in one sentence, the single next step that would reach one of those endings.',
    'If the message shows the task cannot be done in this environment (missing access, a missing tool, a broken checkout), answer ok: false with impossible: true.',
  ].join('\n');
}

/**
 * @param {{ gitDir: string, stateDir: string, allowDomains?: string[], allowWrite?: string[], doneWhen?: 'whole' | 'task', sandbox?: boolean }} options
 * @returns {Record<string, unknown>}
 */
export function runSettings({ doneWhen, sandbox = true, ...sandboxOptions }) {
  return {
    ...(sandbox ? sandboxSettings(sandboxOptions) : {}),
    ...(doneWhen === undefined
      ? {}
      : { hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: doneWhenPrompt(doneWhen), timeout: 60 }] }] } }),
  };
}

/**
 * @param {{ gitDir: string, stateDir: string, allowDomains?: string[], allowWrite?: string[] }} options
 * @returns {{ sandbox: Record<string, unknown> }}
 */
export function sandboxSettings({ gitDir, stateDir, allowDomains = [], allowWrite = [] }) {
  return {
    sandbox: {
      enabled: true,
      // Better no run than a silently unsandboxed one.
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      excludedCommands: UNSANDBOXED_COMMANDS,
      // verify-app probes and starts the dev server on this machine: localhost must be reachable and
      // the app must be able to bind its port. Remote hosts stay limited to the list.
      network: {
        allowedDomains: [...new Set([...DEFAULT_ALLOWED_DOMAINS, 'localhost', '127.0.0.1', ...allowDomains])],
        allowLocalBinding: true,
      },
      // A commit in a worktree writes objects into the main repository's git directory.
      filesystem: { allowWrite: [...new Set([gitDir, stateDir, ...DEFAULT_ALLOW_WRITE, ...allowWrite])] },
    },
  };
}

/**
 * @param {string} flag
 * @returns {string[]} Every value given for a repeatable flag.
 */
function flagValues(flag) {
  return process.argv.flatMap((arg, index) => (arg === flag && index + 1 < process.argv.length ? [process.argv[index + 1]] : []));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [out] = flagValues('--out');
  const [gitDir] = flagValues('--git-dir');
  const [stateDir] = flagValues('--state');
  if (out === undefined || gitDir === undefined || stateDir === undefined) {
    process.stderr.write('usage: sandbox_settings.mjs --out FILE --git-dir DIR --state DIR [--allow-domain HOST]... [--allow-write PATH]...\n');
    process.exit(2);
  }
  const [doneWhen] = flagValues('--done-when');
  if (doneWhen !== undefined && doneWhen !== 'whole' && doneWhen !== 'task') {
    process.stderr.write('--done-when must be whole or task\n');
    process.exit(2);
  }
  mkdirSync(dirname(out), { recursive: true });
  const settings = runSettings({
    gitDir,
    stateDir,
    allowDomains: flagValues('--allow-domain'),
    allowWrite: flagValues('--allow-write'),
    doneWhen,
    sandbox: !process.argv.includes('--no-sandbox'),
  });
  writeFileSync(out, `${JSON.stringify(settings, null, 2)}\n`);
}

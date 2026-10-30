#!/usr/bin/env node
/**
 * Write the Claude Code settings file that sandboxes one headless run. The
 * runners (delegate.sh, fanout.sh) pass it with --settings, so it layers over
 * the user's own settings for that run only.
 *
 *   node scripts/work/sandbox_settings.mjs --out FILE --git-dir DIR --state DIR
 *        [--allow-domain HOST]... [--allow-write PATH]...
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
      network: { allowedDomains: [...new Set([...DEFAULT_ALLOWED_DOMAINS, ...allowDomains])] },
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
  mkdirSync(dirname(out), { recursive: true });
  const settings = sandboxSettings({ gitDir, stateDir, allowDomains: flagValues('--allow-domain'), allowWrite: flagValues('--allow-write') });
  writeFileSync(out, `${JSON.stringify(settings, null, 2)}\n`);
}

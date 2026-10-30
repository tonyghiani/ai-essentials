#!/usr/bin/env node
/**
 * Merge the reference configs into the live tool configs.
 *
 *   node setup/apply.mjs            dry run: print what would change, write nothing
 *   node setup/apply.mjs --write    apply, after saving a timestamped backup of each file
 *   node setup/apply.mjs --home DIR use DIR instead of $HOME (tests)
 *
 * Live files stay unsymlinked: each tool writes to its own settings, and a
 * symlink would let a theme change rewrite the repo. The merge is additive and
 * idempotent. It only touches the keys listed per file, keeps everything else
 * as it is, never removes an entry you added, and running it twice changes
 * nothing the second time.
 *
 * Targets:
 *   ~/.claude/settings.json          permissions, attribution, hooks (autoMode is left alone: it is yours)
 *   ~/.cursor/hooks.json             hooks
 *   ~/.cursor/cli-config.json        attribution, permissions
 *   ~/.codex/hooks.json              hooks
 *   ~/.codex/rules/guardrails.rules   copied whole (generated file)
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Claude permission rules for the ask entries policy/guardrails.json marks as retired, in both the
 * current syntax (`Bash(git x *)`) and the older prefix syntax (`Bash(git x:*)`).
 *
 * @returns {string[]}
 */
export function retiredAskRules() {
  const guardrails = JSON.parse(readFileSync(join(REPO, 'policy', 'guardrails.json'), 'utf8'));
  return (guardrails.retired?.ask ?? []).flatMap((/** @type {string[]} */ argv) => [`Bash(${argv.join(' ')} *)`, `Bash(${argv.join(' ')}:*)`]);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reference files carry `//` comment keys; they are documentation, not config.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function stripComments(value) {
  if (Array.isArray(value)) {
    return value.map(stripComments);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('//'))
      .map(([key, child]) => [key, stripComments(child)]),
  );
}

/**
 * Live entries first, then reference entries the live list lacks.
 *
 * @param {unknown} live
 * @param {unknown} reference
 * @returns {unknown[]}
 */
export function unionArrays(live, reference) {
  const base = Array.isArray(live) ? live : [];
  const extra = Array.isArray(reference) ? reference : [];
  const seen = new Set(base.map((item) => JSON.stringify(item)));
  return [...base, ...extra.filter((item) => !seen.has(JSON.stringify(item)))];
}

/**
 * A hook is identified by its script name, so the same hook registered with a
 * different path spelling is not added twice.
 *
 * @param {unknown} command
 * @returns {string}
 */
export function hookId(command) {
  const text = String(command ?? '');
  return /hooks\/([a-z0-9_-]+\.mjs)/.exec(text)?.[1] ?? text;
}

/**
 * A hook this setup registered takes the reference's fields (a timeout added
 * later, a loop limit) while keeping its own command spelling. Without this, a
 * field added to the reference never reaches a machine that installed earlier.
 * Hooks the reference does not know are returned unchanged.
 *
 * @param {Record<string, unknown>} hook
 * @param {Array<Record<string, unknown>>} referenceHooks
 * @returns {Record<string, unknown>}
 */
function withReferenceFields(hook, referenceHooks) {
  const match = referenceHooks.find((candidate) => hookId(candidate.command) === hookId(hook.command));
  return match === undefined ? hook : { ...hook, ...match, command: hook.command };
}

/**
 * Claude Code and Codex shape: event -> [{ matcher?, hooks: [{ type, command }] }].
 *
 * @param {unknown} live
 * @param {unknown} reference
 * @returns {Record<string, unknown[]>}
 */
export function mergeGroupedHooks(live, reference) {
  /** @type {Record<string, any[]>} */
  const merged = isRecord(live) ? structuredClone(live) : {};
  for (const [event, groups] of Object.entries(isRecord(reference) ? reference : {})) {
    merged[event] = Array.isArray(merged[event]) ? merged[event] : [];
    const referenceHooks = /** @type {any[]} */ (groups).flatMap((group) => group.hooks ?? []);
    for (const group of merged[event]) {
      group.hooks = (group.hooks ?? []).map((hook) => withReferenceFields(hook, referenceHooks));
    }
    const present = new Set(merged[event].flatMap((group) => (group.hooks ?? []).map((hook) => hookId(hook.command))));
    for (const group of /** @type {any[]} */ (groups)) {
      const missing = (group.hooks ?? []).filter((hook) => !present.has(hookId(hook.command)));
      if (missing.length === 0) {
        continue;
      }
      const sameMatcher = merged[event].find((existing) => existing.matcher === group.matcher);
      if (sameMatcher === undefined) {
        merged[event].push({ ...group, hooks: missing });
      } else {
        sameMatcher.hooks = [...(sameMatcher.hooks ?? []), ...missing];
      }
      for (const hook of missing) {
        present.add(hookId(hook.command));
      }
    }
  }
  return merged;
}

/**
 * Cursor shape: event -> [{ command, loop_limit?, ... }].
 *
 * @param {unknown} live
 * @param {unknown} reference
 * @returns {Record<string, unknown[]>}
 */
export function mergeCursorHooks(live, reference) {
  /** @type {Record<string, any[]>} */
  const merged = isRecord(live) ? structuredClone(live) : {};
  for (const [event, entries] of Object.entries(isRecord(reference) ? reference : {})) {
    merged[event] = Array.isArray(merged[event]) ? merged[event].map((entry) => withReferenceFields(entry, /** @type {any[]} */ (entries))) : [];
    const present = new Set(merged[event].map((entry) => hookId(entry.command)));
    for (const entry of /** @type {any[]} */ (entries)) {
      if (!present.has(hookId(entry.command))) {
        merged[event].push(entry);
      }
    }
  }
  return merged;
}

/**
 * @param {Record<string, unknown>} live
 * @param {Record<string, unknown>} reference Already comment-stripped.
 * @returns {Record<string, unknown>}
 */
export function mergeClaudeSettings(live, reference) {
  const merged = structuredClone(live);
  const permissions = isRecord(merged.permissions) ? merged.permissions : {};
  const refPermissions = isRecord(reference.permissions) ? reference.permissions : {};
  for (const list of ['allow', 'ask', 'deny']) {
    permissions[list] = unionArrays(permissions[list], refPermissions[list]);
  }
  // Prompts that earlier versions added, or you wrote in the older syntax, and that now do harm:
  // in a headless run an unanswerable prompt is a hard denial. See policy/guardrails.json "retired".
  const retired = new Set(retiredAskRules());
  permissions.ask = /** @type {unknown[]} */ (permissions.ask).filter((rule) => !retired.has(String(rule)));
  merged.permissions = permissions;

  for (const key of ['attribution', 'includeCoAuthoredBy']) {
    if (key in reference) {
      merged[key] = structuredClone(reference[key]);
    }
  }
  // Defaults, not policy: set once, then yours to change (with /autocompact or by hand).
  for (const key of ['autoCompactWindow']) {
    if (key in reference && !(key in merged)) {
      merged[key] = structuredClone(reference[key]);
    }
  }
  merged.hooks = mergeGroupedHooks(merged.hooks, reference.hooks);

  return merged;
}

/**
 * @param {Record<string, unknown>} live
 * @param {Record<string, unknown>} reference
 * @returns {Record<string, unknown>}
 */
export function mergeCursorCliConfig(live, reference) {
  const merged = structuredClone(live);
  if (isRecord(reference.attribution)) {
    merged.attribution = { ...(isRecord(merged.attribution) ? merged.attribution : {}), ...reference.attribution };
  }
  const permissions = isRecord(merged.permissions) ? merged.permissions : {};
  const refPermissions = isRecord(reference.permissions) ? reference.permissions : {};
  for (const list of ['allow', 'deny']) {
    permissions[list] = unionArrays(permissions[list], refPermissions[list]);
  }
  merged.permissions = permissions;
  return merged;
}

/**
 * @param {Record<string, unknown>} live
 * @param {Record<string, unknown>} reference
 * @returns {Record<string, unknown>}
 */
export function mergeCursorHooksFile(live, reference) {
  return { version: 1, ...live, hooks: mergeCursorHooks(live.hooks, reference.hooks) };
}

/**
 * @param {Record<string, unknown>} live
 * @param {Record<string, unknown>} reference
 * @returns {Record<string, unknown>}
 */
export function mergeCodexHooksFile(live, reference) {
  return { ...live, hooks: mergeGroupedHooks(live.hooks, reference.hooks) };
}

/**
 * @param {string} home
 * @returns {Array<{ name: string, target: string, source: string, kind: 'json' | 'copy', merge?: (live: Record<string, unknown>, reference: Record<string, unknown>) => Record<string, unknown> }>}
 */
export function targets(home) {
  return [
    { name: 'Claude settings', target: join(home, '.claude', 'settings.json'), source: join(REPO, 'claude', 'settings.reference.json'), kind: 'json', merge: mergeClaudeSettings },
    { name: 'Cursor hooks', target: join(home, '.cursor', 'hooks.json'), source: join(REPO, 'cursor', 'hooks.reference.json'), kind: 'json', merge: mergeCursorHooksFile },
    { name: 'Cursor CLI config', target: join(home, '.cursor', 'cli-config.json'), source: join(REPO, 'cursor', 'cli-config.reference.json'), kind: 'json', merge: mergeCursorCliConfig },
    { name: 'Codex hooks', target: join(home, '.codex', 'hooks.json'), source: join(REPO, 'codex', 'hooks.reference.json'), kind: 'json', merge: mergeCodexHooksFile },
    { name: 'Codex rules', target: join(home, '.codex', 'rules', 'guardrails.rules'), source: join(REPO, 'codex', 'guardrails.rules'), kind: 'copy' },
  ];
}

/**
 * @param {string} home
 * @returns {Array<{ name: string, target: string, current: string | null, next: string, changed: boolean, source: string, kind: string }>}
 */
export function plan(home) {
  return targets(home).map(({ name, target, source, kind, merge }) => {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    let next;
    if (kind === 'copy') {
      next = readFileSync(source, 'utf8');
    } else {
      const reference = /** @type {Record<string, unknown>} */ (stripComments(JSON.parse(readFileSync(source, 'utf8'))));
      const live = current === null ? {} : JSON.parse(current);
      next = `${JSON.stringify(merge?.(live, reference), null, 2)}\n`;
    }
    return { name, target, current, next, changed: current !== next, source, kind };
  });
}

/**
 * @param {string} home
 * @param {{ write: boolean, now?: Date }} options
 * @returns {Array<{ name: string, target: string, changed: boolean, diff: string, backup: string | null }>}
 */
export function apply(home, { write, now = new Date() }) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const scratch = mkdtempSync(join(tmpdir(), 'apply-'));
  try {
    return plan(home).map((item) => {
      let diff = '';
      let backup = null;
      if (item.changed) {
        const before = join(scratch, 'before');
        const after = join(scratch, 'after');
        writeFileSync(before, item.current ?? '');
        writeFileSync(after, item.next);
        diff = spawnSync('diff', ['-u', '--label', `${item.target} (live)`, '--label', `${item.target} (merged)`, before, after], { encoding: 'utf8' }).stdout;
      }
      if (item.changed && write) {
        mkdirSync(dirname(item.target), { recursive: true });
        if (item.current !== null) {
          const backups = join(home, '.ai-essentials', 'backups');
          mkdirSync(backups, { recursive: true });
          backup = join(backups, `${item.target.replace(/[\\/]/g, '_')}.${stamp}.bak`);
          copyFileSync(item.target, backup);
        }
        writeFileSync(item.target, item.next, 'utf8');
      }
      return { name: item.name, target: item.target, changed: item.changed, diff, backup };
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const homeIndex = process.argv.indexOf('--home');
  const home = homeIndex === -1 ? (process.env.HOME ?? '') : process.argv[homeIndex + 1];
  const write = process.argv.includes('--write');
  const results = apply(home, { write });
  for (const result of results) {
    if (!result.changed) {
      process.stdout.write(`= ${result.name}: already up to date\n`);
      continue;
    }
    process.stdout.write(`${write ? '~' : '?'} ${result.name}: ${write ? 'updated' : 'would change'} ${result.target}\n`);
    if (!write) {
      process.stdout.write(`${result.diff}\n`);
    } else if (result.backup !== null) {
      process.stdout.write(`    backup: ${result.backup}\n`);
    }
  }
  if (!write && results.some((result) => result.changed)) {
    process.stdout.write('\nDry run. Re-run with --write to apply.\n');
  }
}

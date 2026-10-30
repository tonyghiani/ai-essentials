#!/usr/bin/env node
/**
 * Turn policy/guardrails.json into each tool's native permission syntax.
 *
 *   node scripts/guardrails/render.mjs --check   fail if a reference file drifted
 *   node scripts/guardrails/render.mjs --write   regenerate the generated blocks
 *
 * Generated blocks:
 *   claude/settings.reference.json   permissions
 *   cursor/cli-config.reference.json permissions
 *   codex/guardrails.rules           whole file (execpolicy rules)
 *
 * Cursor's permission tokens match only a command's first word, so multi-word
 * rules (git push --force) cannot be expressed there. Those are enforced by the
 * guard hook in every tool; Cursor's file carries the secret-file denies and
 * single-word commands.
 *
 * @typedef {{ denyRead: string[], forbidden: string[][], ask: string[][], allow: { claude: string[] } }} IGuardrails
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoHome } from '../lib/paths.mjs';

/** @returns {IGuardrails} */
export function loadGuardrails() {
  return JSON.parse(readFileSync(join(repoHome(), 'policy', 'guardrails.json'), 'utf8'));
}

/** @param {string[]} argv @returns {string} */
const bashRule = (argv) => `Bash(${argv.join(' ')} *)`;

/**
 * @param {IGuardrails} guardrails
 * @returns {{ allow: string[], ask: string[], deny: string[] }}
 */
export function claudePermissions(guardrails) {
  return {
    allow: guardrails.allow.claude,
    ask: guardrails.ask.map(bashRule),
    deny: [...guardrails.denyRead.map((glob) => `Read(${glob})`), ...guardrails.forbidden.map(bashRule)],
  };
}

/**
 * @param {IGuardrails} guardrails
 * @returns {{ allow: string[], deny: string[] }}
 */
export function cursorPermissions(guardrails) {
  const singleWord = [...guardrails.forbidden, ...guardrails.ask].filter((argv) => argv.length === 1);
  return {
    allow: [],
    deny: [
      ...guardrails.denyRead.map((glob) => `Read(${glob})`),
      ...guardrails.denyRead.map((glob) => `Write(${glob})`),
      ...singleWord.map(([command]) => `Shell(${command})`),
    ],
  };
}

/**
 * @param {IGuardrails} guardrails
 * @returns {string} Codex execpolicy rules.
 */
export function codexRules(guardrails) {
  const rule = (/** @type {string[]} */ argv, /** @type {string} */ decision) =>
    `prefix_rule(pattern=${JSON.stringify(argv)}, decision="${decision}")`;
  return [
    '# Generated file: command guardrails for this agent. Edit the source policy and regenerate; changes here are overwritten.',
    '# Kept apart from default.rules, which Codex appends to when you approve a command.',
    ...guardrails.forbidden.map((argv) => rule(argv, 'forbidden')),
    ...guardrails.ask.map((argv) => rule(argv, 'prompt')),
    '',
  ].join('\n');
}

/**
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The contents each generated file should have right now.
 *
 * @returns {Array<{ path: string, expected: string }>}
 */
export function expectedFiles() {
  const root = repoHome();
  const guardrails = loadGuardrails();

  const claudePath = join(root, 'claude', 'settings.reference.json');
  const { autoMode: removed, ...existing } = readJson(claudePath);
  const claude = { ...existing, permissions: claudePermissions(guardrails) };

  const cursorPath = join(root, 'cursor', 'cli-config.reference.json');
  const cursor = { ...readJson(cursorPath), permissions: cursorPermissions(guardrails) };

  return [
    { path: claudePath, expected: `${JSON.stringify(claude, null, 2)}\n` },
    { path: cursorPath, expected: `${JSON.stringify(cursor, null, 2)}\n` },
    { path: join(root, 'codex', 'guardrails.rules'), expected: codexRules(guardrails) },
  ];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = process.argv.includes('--write');
  const drifted = expectedFiles().filter(({ path, expected }) => {
    const matches = existsSync(path) && readFileSync(path, 'utf8') === expected;
    if (!matches && write) {
      writeFileSync(path, expected, 'utf8');
      process.stdout.write(`wrote ${path}\n`);
    }
    return !matches;
  });
  if (!write && drifted.length > 0) {
    process.stderr.write(`${drifted.map(({ path }) => `ERROR: ${path} differs from policy/guardrails.json; run render.mjs --write`).join('\n')}\n`);
    process.exit(1);
  }
  if (!write) {
    process.stdout.write('guardrails in sync\n');
  }
}

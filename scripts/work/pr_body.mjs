#!/usr/bin/env node
/**
 * Assemble the body of a draft PR: the description written with the
 * pr-description-template skill, plus a "Decisions made without you" section
 * built from what the run recorded in decisions-made.md.
 *
 *   node scripts/work/pr_body.mjs [--cwd <dir>] [--description <file>] [--decisions <file>] [--out <file>]
 *   node scripts/work/pr_body.mjs --check <file>
 *
 * Defaults come from the spec directory of the current branch:
 *   pr-description.md  in,  decisions-made.md  in,  pr-body.md  out.
 *
 * The section is added here, by code, because a request in a skill gets dropped
 * whenever an agent takes the shortest path to a PR. Two other layers back it
 * up: open-draft-pr runs --check before pushing, and the guard hook refuses
 * `gh pr create` from an agent branch whose body lacks the heading.
 *
 * decisions-made.md holds one bullet per decision, for example:
 *   - Tests colocated beside the source (source: rule testing-style) because the repo already does it
 * Blank lines and headings are ignored.
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../lib/repo.mjs';
import { currentBranch, specDir } from './branches.mjs';

export const DECISIONS_HEADING = '## Decisions made without you';
const NONE_LINE = 'None. Everything was decided by you, by the spec, or by a written rule.';

/**
 * @param {string} text Contents of decisions-made.md, or an empty string.
 * @returns {string[]} One bullet line per decision.
 */
export function parseDecisions(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => (line.startsWith('- ') || line.startsWith('* ') ? `- ${line.slice(2).trim()}` : `- ${line}`));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasDecisionsSection(text) {
  return text.split('\n').some((line) => line.trim() === DECISIONS_HEADING);
}

/**
 * @param {{ description: string, decisions: string }} parts
 * @returns {string} The description with the decisions section appended, once.
 */
export function buildPrBody({ description, decisions }) {
  const trimmed = description.trimEnd();
  if (hasDecisionsSection(trimmed)) {
    return `${trimmed}\n`;
  }
  const lines = parseDecisions(decisions);
  const section = `${DECISIONS_HEADING}\n\n${lines.length > 0 ? lines.join('\n') : NONE_LINE}`;
  return `${trimmed}\n\n${section}\n`;
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
 * @param {string} path
 * @returns {string}
 */
function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const checkIndex = process.argv.indexOf('--check');
  if (checkIndex !== -1) {
    const file = process.argv[checkIndex + 1];
    if (file === undefined || !existsSync(file)) {
      process.stderr.write(`PR body not found: ${file ?? '(no file given)'}\n`);
      process.exit(1);
    }
    if (!hasDecisionsSection(readFileSync(file, 'utf8'))) {
      process.stderr.write(`${file} has no "${DECISIONS_HEADING}" section. Build the body with ai-pr-body.\n`);
      process.exit(1);
    }
    process.stdout.write(`ok: ${file}\n`);
    process.exit(0);
  }

  const cwd = flagValue('--cwd') ?? process.cwd();
  const root = repoRoot(cwd);
  const branch = root === null ? null : currentBranch(root);
  if (root === null || branch === null) {
    process.stderr.write('Not on a branch inside a git repository.\n');
    process.exit(1);
  }
  const dir = specDir(root, branch);
  const descriptionFile = flagValue('--description') ?? join(dir, 'pr-description.md');
  if (!existsSync(descriptionFile)) {
    process.stderr.write(`No description at ${descriptionFile}. Write it with the pr-description-template skill first.\n`);
    process.exit(1);
  }
  const out = flagValue('--out') ?? join(dir, 'pr-body.md');
  writeFileSync(
    out,
    buildPrBody({
      description: readFileSync(descriptionFile, 'utf8'),
      decisions: readIfPresent(flagValue('--decisions') ?? join(dir, 'decisions-made.md')),
    }),
    'utf8',
  );
  process.stdout.write(`${out}\n`);
}

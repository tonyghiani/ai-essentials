#!/usr/bin/env node
/**
 * Validate and stage the body of a draft PR. The body is the description written
 * with the pr-description-template skill, unchanged; this refuses one that drifted
 * from the template (missing heading icons, missing sections).
 *
 *   node scripts/work/pr_body.mjs [--cwd <dir>] [--description <file>] [--out <file>]
 *   node scripts/work/pr_body.mjs --check <file>
 *
 * Defaults come from the spec directory of the current branch:
 *   pr-description.md  in,  pr-body.md  out.
 *
 * The template is checked here, by code, because a request in a skill gets
 * paraphrased whenever an agent takes the shortest path to a PR. Two other layers
 * back it up: open-draft-pr runs --check before pushing, and the guard hook refuses
 * a PR from an agent branch whose body lacks the template headings.
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../lib/repo.mjs';
import { currentBranch, specDir } from './branches.mjs';

/** Headings the pr-description-template skill requires, icons included. */
export const TEMPLATE_HEADINGS = ['## 📓 Summary', '## 🧪 Testing'];

/**
 * @param {string} text
 * @returns {string[]} What the body is missing; empty when it follows the template.
 */
export function templateProblems(text) {
  const lines = text.split('\n').map((line) => line.trim());
  const firstLine = lines.find((line) => line !== '') ?? '';
  const missing = TEMPLATE_HEADINGS.filter((heading) => !lines.includes(heading)).map((heading) => `"${heading}"`);
  return firstLine.startsWith('> ') ? missing : ['a leading "> <title>" line', ...missing];
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
  const checkIndex = process.argv.indexOf('--check');
  if (checkIndex !== -1) {
    const file = process.argv[checkIndex + 1];
    if (file === undefined || !existsSync(file)) {
      process.stderr.write(`PR body not found: ${file ?? '(no file given)'}\n`);
      process.exit(1);
    }
    const problems = templateProblems(readFileSync(file, 'utf8'));
    if (problems.length > 0) {
      process.stderr.write(`${file} does not follow the pr-description-template: missing ${problems.join(', ')}.\n`);
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
  const description = readFileSync(descriptionFile, 'utf8');
  const problems = templateProblems(description);
  if (problems.length > 0) {
    process.stderr.write(`${descriptionFile} does not follow the pr-description-template: missing ${problems.join(', ')}.\n`);
    process.exit(1);
  }
  const out = flagValue('--out') ?? join(dir, 'pr-body.md');
  writeFileSync(out, `${description.trimEnd()}\n`, 'utf8');
  process.stdout.write(`${out}\n`);
}

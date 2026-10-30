#!/usr/bin/env node
/**
 * Repo hygiene scan run by validate.sh. Two checks over everything that makes up
 * the setup (skills, rules, agents, hooks, scripts, setup and docs):
 *
 *   1. Nothing carries text that credits an AI tool (the same patterns the
 *      runtime guard uses), because a skill that teaches the model to add a
 *      trailer would fight the guard on every run. Test files are skipped: they
 *      contain such text on purpose, as input.
 *   2. Installed definitions (skills, rules, agents, the global instructions) never
 *      name this repository or point into it. A definition has to work wherever it
 *      is installed, so it calls commands by name (ai-verify, ai-work, ...), refers
 *      to other skills and rules by name, and keeps anything it needs beside itself.
 *   3. Nothing names a specific project. This setup works in any repo, so a
 *      skill, rule or doc that mentions one project's name or build commands is
 *      misleading. The words to look for are yours, not this repo's: they live
 *      in policy/project-tokens.local.json (gitignored), so the detector itself
 *      names no project. Without that file the check is skipped and says so.
 *      Personal files are exempted by path below, with the reason.
 *
 * Exit 0 clean, 1 with a list of findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { repoHome } from '../lib/paths.mjs';
import { findAttribution } from './attribution.mjs';

/** Content installed into the tools. Checked for tool credit. */
const INSTALLED_ROOTS = ['skills', 'rules', 'agents', 'claude/CLAUDE.md', 'codex/INSTRUCTIONS.md', 'setup'];
/** Definitions that must work without knowing this repo. */
const DEFINITION_ROOTS = ['skills', 'rules', 'agents', 'claude/CLAUDE.md', 'codex/INSTRUCTIONS.md'];
/**
 * Ways a definition can point at this repo: its name, or a path into it. Skill-relative paths
 * (reviewers/x.md, ../shared/y.md) are fine; they stay valid wherever the skill is installed.
 */
const SELF_REFERENCES = [
  { regex: /ai-essentials/i, what: 'names this repository' },
  { regex: /(?:^|[\s`"'(~])(?:rules|policy)\/[\w<>*.-]+\.(?:mdc|md|json)|(?:^|[\s`"'(])scripts\/[\w-]+\/[\w.<>*-]+|(?:^|[\s`"'(])(?:contracts|setup|docs)\/[\w<>*-]+\.[\w]+|\.ai-essentials/m, what: 'points at a path in this repository' },
  { regex: /(?:^|[\s`"'(])skills\/[\w<>*-]+\//m, what: 'points at a skill by repository path; name the skill instead' },
  { regex: /(?:^|[\s`"'(])agents\/[\w<>*.-]+/m, what: 'points at an agent by repository path; name the agent instead' },
];
/** Everything that makes up the setup. Checked for project names. */
const ALL_ROOTS = [
  'skills', 'rules', 'agents', 'claude', 'codex', 'cursor', 'setup', 'scripts', 'policy', 'docs', 'contracts',
  'README.md', 'SETUP.md', 'AGENTS.md',
];
const SKIPPED_DIRS = new Set(['synced', '.trash', 'node_modules', '__pycache__']);
const TEXT_EXTENSIONS = new Set(['.md', '.mdc', '.sh', '.toml', '.json', '.py', '.mjs', '.rules']);

/** Tests of the policy itself contain violations on purpose, as input. */
const TEST_FILE = /(\.test\.mjs|_test\.py)$/;
/** Machine-local files: yours, gitignored, and allowed to name your projects. */
const LOCAL_FILE = /\.local\.(json|md)$|(^|\/)contracts\/(?!example\.json$)[^/]+\.json$/;

/** Files that describe or test the attribution patterns on purpose. */
const ATTRIBUTION_EXEMPT = new Set(['rules/no-ai-attribution.mdc']);

/** Definitions allowed to point into this repo, each for a stated reason. */
const SELF_REFERENCE_EXEMPT = new Set([]);

/** Files allowed to name a specific project, each for a stated reason. */
const PROJECT_EXEMPT = new Set([
  'agents/marco-blogger.md', // a personal blog persona; its biography names the author's employer and work
]);

/**
 * @param {string} path
 * @returns {string[]}
 */
function walk(path) {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) {
    return [];
  }
  if (stats.isFile()) {
    return [path];
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => !SKIPPED_DIRS.has(entry.name))
    .flatMap((entry) => walk(join(path, entry.name)));
}

/** @param {string} text @returns {string} */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const root = repoHome();
const tokensPath = join(root, 'policy', 'project-tokens.local.json');
const tokens = existsSync(tokensPath) ? JSON.parse(readFileSync(tokensPath, 'utf8')).tokens ?? [] : [];
const projectPattern = tokens.length > 0 ? new RegExp(tokens.map(escapeRegExp).join('|'), 'i') : null;

/** @param {string[]} roots @returns {string[]} Text files under the roots, minus machine-local ones. */
const textFiles = (roots) =>
  roots
    .flatMap((scanned) => walk(join(root, scanned)))
    .filter((file) => TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf('.'))) && !LOCAL_FILE.test(relative(root, file)));

const attribution = textFiles(INSTALLED_ROOTS)
  .filter((file) => !TEST_FILE.test(file) && !ATTRIBUTION_EXEMPT.has(relative(root, file)))
  .flatMap((file) =>
    findAttribution(readFileSync(file, 'utf8')).map(
      (hit) => `${relative(root, file)}: credits a tool (${hit.id}: "${hit.excerpt}")`,
    ),
  );

const selfReferences = textFiles(DEFINITION_ROOTS)
  .filter((file) => !TEST_FILE.test(file) && !SELF_REFERENCE_EXEMPT.has(relative(root, file)))
  .flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return SELF_REFERENCES.flatMap(({ regex, what }) => {
      const match = regex.exec(text);
      return match === null ? [] : [`${relative(root, file)}: ${what} ("${match[0].trim()}")`];
    });
  });

const project =
  projectPattern === null
    ? []
    : textFiles(ALL_ROOTS)
        .filter((file) => !PROJECT_EXEMPT.has(relative(root, file)))
        .flatMap((file) => {
          const match = projectPattern.exec(readFileSync(file, 'utf8'));
          return match === null
            ? []
            : [`${relative(root, file)}: names a specific project ("${match[0]}"); this setup is project-agnostic, so use a neutral example`];
        });

const findings = [...attribution, ...selfReferences, ...project];

if (findings.length > 0) {
  process.stderr.write(`${findings.map((finding) => `ERROR: ${finding}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  projectPattern === null
    ? 'scan clean (project-name check skipped: copy policy/project-tokens.example.json to project-tokens.local.json)\n'
    : `scan clean (${tokens.length} project tokens checked)\n`,
);

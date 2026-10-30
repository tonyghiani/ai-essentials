/**
 * Policy check for shell commands that touch git or GitHub. Tool-neutral: the
 * per-tool hook adapters pass in the command line and act on the verdict.
 *
 * Enforces two standing rules that a prompt can only request:
 *   1. No AI tool takes credit for a remote action. Commits, PRs, issues and
 *      comments are attributed to the user alone.
 *   2. Pull requests are only ever drafts. Nothing marks one ready or merges it,
 *      and nothing force-pushes or pushes to a default branch.
 *
 * It reads the command text, so it cannot see a message typed into an editor
 * the tool opens; the branch audit (audit_branch.mjs) is the second layer.
 *
 * @typedef {{ allow: true } | { allow: false, rule: string, reason: string }} IVerdict
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { repoHome } from '../lib/paths.mjs';
import { defaultBase, git, repoRoot } from '../lib/repo.mjs';
import { expandShortFlags, programOf, shellWords, splitSegments } from '../lib/shell.mjs';
import { currentBranch, isAgentBranch } from '../work/branches.mjs';
import { TEMPLATE_HEADINGS } from '../work/pr_body.mjs';
import { findAttribution, findBranchPrefix } from './attribution.mjs';
import { checkRecursiveDelete } from './rm.mjs';

const MESSAGE_FILE_FLAG = /(?:^|\s)(?:-F|--file|--body-file)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/g;
/** A message file bigger than this is not a commit message; skip it rather than hang on it. */
const MAX_MESSAGE_FILE_BYTES = 1_000_000;
/** `bash -c "bash -c '...'"` deeper than this is refused rather than unwrapped. */
const MAX_NESTING = 3;
/** git rewrites `--trailer Key=Value` to `Key: Value`, so the check must read it that way too. */
const TRAILER_WITH_EQUALS = /(--trailer[=\s]+["']?[A-Za-z-]+)=/g;
/** Words a guard crash must not wave through. */
const GUARDED_PROGRAMS = /\b(git|gh|rm)\b/;

/** git's global options that take their value as the next word. */
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
/** `git push` options that take their value as the next word, so it is not read as a remote or refspec. */
const PUSH_OPTIONS_WITH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const IDENTITY_KEY = /^(user|author|committer)\.(name|email)$/i;
const ALIAS_KEY = /^alias\./i;
const GH_PR_CREATE = new Set(['create', 'new']);
const GH_API_MERGE_OR_READY = /mergePullRequest|enablePullRequestAutoMerge|markPullRequestReadyForReview|pulls\/[^\s/]+\/merge\b/i;

/** Commands whose arguments become public text. */
const PUBLISHING_PATTERNS = [
  /\bgit\b[^|;&\n]*\b(commit|tag|merge|notes)\b/,
  /\bgh\s+(pr|issue)\s+(create|new|edit|comment|review)\b/,
  /\bgh\s+api\b/,
];

/**
 * Destructive shell patterns from policy/guardrails.json. Checked for every
 * command, not just git and gh, so Cursor (whose permission tokens match only a
 * command's first word) gets the same protection as the other tools.
 *
 * @type {Array<{ id: string, regex: string, reason: string }> | null}
 */
let forbiddenPatterns = null;

/** @returns {Array<{ id: string, regex: string, reason: string }>} */
function loadForbiddenPatterns() {
  if (forbiddenPatterns === null) {
    const path = join(repoHome(), 'policy', 'guardrails.json');
    forbiddenPatterns = JSON.parse(readFileSync(path, 'utf8')).forbiddenPatterns ?? [];
  }
  return forbiddenPatterns;
}

/** @param {string} rule @param {string} reason @returns {IVerdict} */
function deny(rule, reason) {
  return { allow: false, rule, reason };
}

/**
 * @param {string} command
 * @param {string} cwd
 * @returns {string} The command plus the content of any message or body file it names.
 */
function withReferencedFiles(command, cwd) {
  const contents = [...command.matchAll(MESSAGE_FILE_FLAG)].flatMap((match) => {
    const reference = match[1] ?? match[2] ?? match[3];
    if (reference === undefined || reference === '-') {
      return [];
    }
    const path = isAbsolute(reference) ? reference : join(cwd, reference);
    // A directory or device here is some other command's --file flag (grep, curl); reading it would
    // throw or block, and a guard that crashes lets the command through.
    if (!existsSync(path)) {
      return [];
    }
    const stats = statSync(path);
    return stats.isFile() && stats.size <= MAX_MESSAGE_FILE_BYTES ? [readFileSync(path, 'utf8')] : [];
  });
  return [command, ...contents].join('\n').replace(TRAILER_WITH_EQUALS, '$1: ');
}

/**
 * Split `git [global options] <subcommand> [args]`. Every global option is
 * skipped, not just `-C` and `-c`, so `git --no-pager push` is still a push.
 *
 * @param {string[]} args Words after `git`.
 * @param {string} cwd
 * @returns {{ subcommand: string, args: string[], dir: string, config: string[] }}
 *   `dir` applies any `-C`; `config` holds every `-c` and `--config-env` entry.
 */
function parseGit(args, cwd) {
  let dir = cwd;
  const config = [];
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const option = args[index];
    if (GIT_OPTIONS_WITH_VALUE.has(option)) {
      const value = args[index + 1] ?? '';
      if (option === '-C') {
        dir = resolve(dir, value);
      } else if (option === '-c' || option === '--config-env') {
        config.push(value);
      }
      index += 2;
    } else {
      if (option.startsWith('--config-env=')) {
        config.push(option.slice('--config-env='.length));
      }
      index += 1;
    }
  }
  return { subcommand: args[index] ?? '', args: args.slice(index + 1), dir, config };
}

/**
 * @param {string} cwd
 * @returns {Set<string>} Branch names a push must never target.
 */
function protectedBranches(cwd) {
  const base = defaultBase(cwd);
  const stripped = base === null ? [] : [base.replace(/^origin\//, '')];
  return new Set(['main', 'master', ...stripped]);
}

/**
 * @param {string[]} rawArgs Words after `git push`.
 * @param {string} dir Directory the push runs in, after any `-C`.
 * @returns {IVerdict}
 */
function checkPush(rawArgs, dir) {
  const args = expandShortFlags(rawArgs);
  const flags = [];
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (PUSH_OPTIONS_WITH_VALUE.has(args[index])) {
      index += 1;
    } else if (args[index].startsWith('-')) {
      flags.push(args[index]);
    } else {
      positional.push(args[index]);
    }
  }
  if (flags.some((flag) => ['--force', '-f', '--mirror'].includes(flag) || flag.startsWith('--force-with-lease'))) {
    return deny('no-force-push', 'Force pushes are blocked. Push normally; if history must change, stop and ask the user.');
  }
  if (flags.includes('--all') || flags.includes('--branches')) {
    return deny('no-default-branch-push', 'Pushing every branch includes the default one. Push your branch by name.');
  }
  const refspecs = positional.slice(1);
  if (refspecs.some((refspec) => refspec.startsWith('+'))) {
    return deny('no-force-push', 'A "+" refspec forces the push. Remove it.');
  }
  if (refspecs.some((refspec) => refspec === ':' || refspec.includes('*'))) {
    return deny('no-default-branch-push', 'A matching or wildcard refspec can update the default branch. Push your branch by name.');
  }

  const current = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '';
  const protectedNames = protectedBranches(dir);
  const targets = refspecs.length > 0 ? refspecs.map((refspec) => refspec.slice(refspec.indexOf(':') + 1)) : [current];
  const hit = targets
    .map((target) => target.replace(/^refs\/heads\//, ''))
    .map((target) => (target === 'HEAD' || target === '@' ? current : target))
    .find((target) => protectedNames.has(target));
  if (hit !== undefined) {
    return deny('no-default-branch-push', `Pushing to "${hit}" is blocked. Work on a branch and open a draft PR.`);
  }
  return { allow: true };
}

/**
 * Identity overrides and aliases passed to one git invocation. An alias is
 * refused because it can hide a force push or a merge behind a name this guard
 * does not know.
 *
 * @param {{ subcommand: string, args: string[], config: string[] }} parsed
 * @returns {IVerdict}
 */
function checkGitSettings({ subcommand, args, config }) {
  const keys = config.map((entry) => entry.split('=')[0]);
  if (subcommand === 'config') {
    const [first, ...rest] = args;
    // Both `git config <key> <value>` and the newer `git config set <key> <value>`.
    const words = first === 'set' ? rest : args;
    const reading = ['get', 'list', 'unset'].includes(first ?? '') || args.some((arg) => /^(--(get|get-all|get-regexp|list|unset|unset-all)|-l)$/.test(arg));
    const positional = words.filter((word) => !word.startsWith('-'));
    if (!reading && positional.length >= 2) {
      keys.push(positional[0]);
    }
  }
  if (keys.some((key) => IDENTITY_KEY.test(key))) {
    return deny('own-identity', 'Do not change user.name or user.email, or set a different commit author. Commits use the identity already configured in this repo.');
  }
  if (keys.some((key) => ALIAS_KEY.test(key))) {
    return deny('no-alias', 'Do not define git aliases. Run the full git command, so the guard can read it.');
  }
  if (subcommand === 'commit' && args.some((arg) => arg === '--author' || arg.startsWith('--author='))) {
    return deny('own-identity', 'Do not set a different commit author. Commits use the identity already configured in this repo.');
  }
  return { allow: true };
}

/**
 * @param {string[]} args Words after `git`.
 * @param {string} cwd
 * @returns {IVerdict}
 */
function checkGit(args, cwd) {
  const parsed = parseGit(args, cwd);
  const settings = checkGitSettings(parsed);
  if (!settings.allow) {
    return settings;
  }
  return parsed.subcommand === 'push' ? checkPush(parsed.args, parsed.dir) : { allow: true };
}

/**
 * @param {string[]} args Words after `gh`.
 * @returns {IVerdict}
 */
function checkGh(args) {
  const [area, action] = args;
  if (area === 'pr' && GH_PR_CREATE.has(action ?? '') && !args.some((arg) => arg === '--draft' || arg === '-d' || arg === '--draft=true')) {
    return deny('draft-only', 'Pull requests must be opened as drafts. Re-run with --draft.');
  }
  if (area === 'alias' && ['set', 'import'].includes(action ?? '')) {
    return deny('no-alias', 'Do not define gh aliases. Run the full gh command, so the guard can read it.');
  }
  if (area === 'pr' && action === 'ready' && !args.includes('--undo')) {
    return deny('draft-only', 'Marking a pull request ready for review is the user\'s decision. Leave it as a draft.');
  }
  if (area === 'pr' && action === 'merge') {
    return deny('no-merge', 'Merging is the user\'s decision. Leave the pull request open.');
  }
  if (area === 'auth' && ['login', 'logout', 'switch', 'token', 'refresh', 'setup-git'].includes(action ?? '')) {
    return deny('own-identity', 'Do not change GitHub credentials. All remote actions use the user\'s existing login.');
  }
  if (area === 'api' && GH_API_MERGE_OR_READY.test(args.join(' '))) {
    return deny('draft-only', 'Marking a pull request ready or merging it through the API is blocked.');
  }
  return { allow: true };
}

/**
 * A PR opened from a branch the agent created must follow the
 * pr-description-template headings (icons included). scripts/work/pr_body.mjs
 * validates the whole template; this refuses a body that skipped it.
 *
 * @param {string} command
 * @param {string} cwd
 * @returns {IVerdict}
 */
function checkPrBody(command, cwd) {
  const root = repoRoot(cwd);
  const branch = root === null ? null : currentBranch(root);
  if (root === null || branch === null || !isAgentBranch(root, branch)) {
    return { allow: true };
  }
  const body = withReferencedFiles(command, cwd);
  const missing = TEMPLATE_HEADINGS.filter((heading) => !body.includes(heading));
  if (missing.length === 0) {
    return { allow: true };
  }
  return deny(
    'pr-needs-template',
    `This PR comes from a branch the agent created, so its body must follow the pr-description-template (missing ${missing.join(', ')}). Write it with that skill, validate it with: ai-pr-body, then pass the result with --body-file.`,
  );
}

/**
 * Identity and credential overrides. Checked over the whole command because
 * environment assignments can sit anywhere in a pipeline.
 *
 * @param {string} command
 * @returns {IVerdict}
 */
function checkIdentity(command) {
  if (/\bGIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)=/.test(command)) {
    return deny('own-identity', 'Do not override the git author or committer. Commits use the identity already configured in this repo.');
  }
  // GIT_CONFIG_COUNT/KEY/VALUE is the environment form of `git -c`.
  if (/\bGIT_CONFIG_KEY_\d+=["']?(user|author|committer)\.(name|email)\b/i.test(command)) {
    return deny('own-identity', 'Do not set a different commit author. Commits use the identity already configured in this repo.');
  }
  if (/\bGIT_CONFIG_KEY_\d+=["']?alias\./i.test(command)) {
    return deny('no-alias', 'Do not define git aliases. Run the full git command, so the guard can read it.');
  }
  if (/\b(GH|GITHUB)_(ENTERPRISE_)?TOKEN=/.test(command) && /\b(gh|git)\b/.test(command)) {
    return deny('own-identity', 'Do not supply a different GitHub token. Remote actions use the user\'s own login.');
  }
  return { allow: true };
}

/**
 * @param {string} command
 * @returns {IVerdict}
 */
function checkBranchNames(command) {
  const creating = /\bgit\s+(?:checkout\s+-[bB]|switch\s+-[cC]|branch|worktree\s+add)\b|\bgit\s+push\b/.test(command);
  if (!creating) {
    return { allow: true };
  }
  // Split refspecs too: `git push origin HEAD:claude/fix` creates the remote branch after the colon.
  const words = command
    .split(/[\s:]+/)
    .map((word) => word.replace(/^["'+]+|["']+$/g, '').replace(/^(refs\/heads\/)?(origin\/)?/, ''));
  const offender = words.find((word) => findBranchPrefix(word) !== null);
  return offender === undefined
    ? { allow: true }
    : deny('no-tool-branch-name', `The branch name "${offender}" names an AI tool. Use the user's login prefix or a plain slug.`);
}

/**
 * @param {{ command: string, cwd?: string }} input
 * @returns {IVerdict}
 */
export function checkCommand({ command, cwd = process.cwd() }) {
  return checkLine(command, cwd, 0);
}

/**
 * checkCommand for the hook adapters. A crash in the policy code must not
 * become an allow for the commands the policy exists for, because Claude Code
 * and Codex treat a hook's non-2 exit as "go ahead".
 *
 * @param {{ command: string, cwd?: string }} input
 * @returns {IVerdict & { error?: unknown }} `error` is set when the check threw.
 */
export function checkCommandFailClosed(input) {
  try {
    return checkCommand(input);
  } catch (error) {
    if (GUARDED_PROGRAMS.test(input.command)) {
      return {
        ...deny('guard-error', 'The agent guard could not check this command, so it is blocked. Simplify it (one git or gh command per call, no wrappers) and retry.'),
        error,
      };
    }
    return { allow: true, error };
  }
}

/**
 * @param {string} command
 * @param {string} cwd
 * @param {number} depth How many `bash -c` or `eval` layers this line sits inside.
 * @returns {IVerdict}
 */
function checkLine(command, cwd, depth) {
  const forbidden = loadForbiddenPatterns().find(({ regex }) => new RegExp(regex).test(command));
  if (forbidden !== undefined) {
    return deny(forbidden.id, forbidden.reason);
  }
  const removal = checkRecursiveDelete(command, cwd);
  if (!removal.allow) {
    return removal;
  }
  if (!/\b(git|gh)\b/.test(command)) {
    return { allow: true };
  }

  const identity = checkIdentity(command);
  if (!identity.allow) {
    return identity;
  }

  const branch = checkBranchNames(command);
  if (!branch.allow) {
    return branch;
  }

  for (const segment of splitSegments(command)) {
    const { program, args, inner } = programOf(shellWords(segment));
    if (inner !== null && depth >= MAX_NESTING) {
      return deny('guard-error', 'Commands nested this deep in bash -c or eval cannot be checked. Run the git or gh command directly.');
    }
    const verdict =
      inner !== null
        ? checkLine(inner, cwd, depth + 1)
        : program === 'git'
          ? checkGit(args, cwd)
          : program === 'gh'
            ? checkGh(args)
            : { allow: true };
    if (!verdict.allow) {
      return verdict;
    }
  }

  if (/\bgh\s+pr\s+(create|new)\b/.test(command)) {
    const body = checkPrBody(command, cwd);
    if (!body.allow) {
      return body;
    }
  }

  if (PUBLISHING_PATTERNS.some((pattern) => pattern.test(command))) {
    const hits = findAttribution(withReferencedFiles(command, cwd));
    if (hits.length > 0) {
      const found = hits.map((hit) => `${hit.id} ("${hit.excerpt}")`).join(', ');
      return deny(
        'no-tool-credit',
        `This text credits an AI tool: ${found}. Remove it. Commits, PRs, issues and comments are attributed to the user alone; no trailers, footers or tool names as author.`,
      );
    }
  }
  return { allow: true };
}

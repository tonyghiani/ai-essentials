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

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { repoHome } from '../lib/paths.mjs';
import { defaultBase, git, repoRoot } from '../lib/repo.mjs';
import { currentBranch, isAgentBranch } from '../work/branches.mjs';
import { DECISIONS_HEADING } from '../work/pr_body.mjs';
import { findAttribution, findBranchPrefix } from './attribution.mjs';
import { checkRecursiveDelete } from './rm.mjs';

const MESSAGE_FILE_FLAG = /(?:^|\s)(?:-F|--file|--body-file)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/g;
const COMMAND_SEPARATORS = /&&|\|\||;|\||\n/;

/** Commands whose arguments become public text. */
const PUBLISHING_PATTERNS = [
  /\bgit\b[^|;&\n]*\b(commit|tag|merge|notes)\b/,
  /\bgh\s+(pr|issue)\s+(create|edit|comment|review)\b/,
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
    return existsSync(path) ? [readFileSync(path, 'utf8')] : [];
  });
  return [command, ...contents].join('\n');
}

/**
 * Strip leading `VAR=value` assignments and git's global `-C dir` / `-c k=v`
 * so the subcommand is the first remaining word.
 *
 * @param {string} segment
 * @returns {string[]} Tokens starting at the program name.
 */
function tokensOf(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && /^\w+=/.test(tokens[0])) {
    tokens.shift();
  }
  if (tokens[0] === 'git') {
    const rest = tokens.slice(1);
    const cleaned = [];
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === '-C' || rest[index] === '-c') {
        index += 1;
      } else {
        cleaned.push(rest[index]);
      }
    }
    return ['git', ...cleaned];
  }
  return tokens;
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
 * @param {string[]} tokens `git push ...` tokens.
 * @param {string} cwd
 * @returns {IVerdict}
 */
function checkPush(tokens, cwd) {
  const args = tokens.slice(2);
  const flags = args.filter((token) => token.startsWith('-'));
  if (flags.some((flag) => ['--force', '-f', '--force-with-lease', '--mirror'].includes(flag) || flag.startsWith('--force-with-lease='))) {
    return deny('no-force-push', 'Force pushes are blocked. Push normally; if history must change, stop and ask the user.');
  }
  const positional = args.filter((token) => !token.startsWith('-'));
  const refspecs = positional.slice(1);
  const protectedNames = protectedBranches(cwd);

  if (refspecs.some((refspec) => refspec.startsWith('+'))) {
    return deny('no-force-push', 'A "+" refspec forces the push. Remove it.');
  }
  const targets =
    refspecs.length > 0
      ? refspecs.map((refspec) => (refspec.includes(':') ? refspec.split(':')[1] : refspec))
      : [git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? ''];
  const hit = targets
    .map((target) => target.replace(/^refs\/heads\//, ''))
    .find((target) => protectedNames.has(target));
  if (hit !== undefined) {
    return deny('no-default-branch-push', `Pushing to "${hit}" is blocked. Work on a branch and open a draft PR.`);
  }
  return { allow: true };
}

/**
 * @param {string[]} tokens
 * @param {string} segment
 * @returns {IVerdict}
 */
function checkGh(tokens, segment) {
  const [, area, action] = tokens;
  if (area === 'pr' && action === 'create' && !/(?:^|\s)(--draft|-d)(?:\s|=|$)/.test(segment)) {
    return deny('draft-only', 'Pull requests must be opened as drafts. Re-run with --draft.');
  }
  if (area === 'pr' && action === 'ready' && !tokens.includes('--undo')) {
    return deny('draft-only', 'Marking a pull request ready for review is the user\'s decision. Leave it as a draft.');
  }
  if (area === 'pr' && action === 'merge') {
    return deny('no-merge', 'Merging is the user\'s decision. Leave the pull request open.');
  }
  if (area === 'auth' && ['login', 'logout', 'switch', 'token', 'refresh', 'setup-git'].includes(action ?? '')) {
    return deny('own-identity', 'Do not change GitHub credentials. All remote actions use the user\'s existing login.');
  }
  if (area === 'api' && /markPullRequestReadyForReview|pulls\/\d+\/merge/.test(segment)) {
    return deny('draft-only', 'Marking a pull request ready or merging it through the API is blocked.');
  }
  return { allow: true };
}

/**
 * A PR opened from a branch the agent created must carry the "Decisions made
 * without you" section, so the user can audit what was decided for them. The
 * section is added by scripts/work/pr_body.mjs; this refuses a body that skipped it.
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
  if (withReferencedFiles(command, cwd).includes(DECISIONS_HEADING)) {
    return { allow: true };
  }
  return deny(
    'pr-needs-decisions-section',
    `This PR comes from a branch the agent created, so its body must include "${DECISIONS_HEADING}". Build it with: ai-pr-body, then pass the result with --body-file.`,
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
  if (/\bgit\b[^|;&\n]*--author(=|\s)/.test(command) || /\bgit\b[^|;&\n]*-c\s+(user|author|committer)\.(name|email)=/.test(command)) {
    return deny('own-identity', 'Do not set a different commit author. Commits use the identity already configured in this repo.');
  }
  if (/\bgit\s+config\b(?![^|;&\n]*--(get|list|unset))[^|;&\n]*\buser\.(name|email)\s+(?!-)\S/.test(command)) {
    return deny('own-identity', 'Do not change user.name or user.email. They are the user\'s identity.');
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
  const words = command.split(/\s+/).map((word) => word.replace(/^["']|["']$/g, '').replace(/^origin\//, ''));
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

  for (const segment of command.split(COMMAND_SEPARATORS)) {
    const tokens = tokensOf(segment);
    const verdict =
      tokens[0] === 'git' && tokens[1] === 'push'
        ? checkPush(tokens, cwd)
        : tokens[0] === 'gh'
          ? checkGh(tokens, segment)
          : { allow: true };
    if (!verdict.allow) {
      return verdict;
    }
  }

  if (/\bgh\s+pr\s+create\b/.test(command)) {
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

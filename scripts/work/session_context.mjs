/**
 * The few lines a session needs before its first turn: which branch, whether
 * it is the agent's, where its spec and task ledger are, what is still open,
 * and whether the repo has a verification contract. Without them every session
 * spends turns rediscovering this, and after a compaction it can lose the spec
 * path and the hard rules entirely.
 *
 * Tool-neutral; the SessionStart adapters print the result. Prints nothing
 * outside a git repository, so unrelated sessions pay no tokens.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../lib/repo.mjs';
import { resolveContract } from '../verify/contract.mjs';
import { currentBranch, isAgentBranch, specDir } from './branches.mjs';
import { readLedger } from './tasks.mjs';

/** Re-stated after a compaction, when the summary may have dropped them. */
const HARD_RULES =
  'Rules that never bend: commits, PRs and comments carry no tool credit; pull requests stay drafts; never force push or push to a default branch; report the command and its output, not "tests pass".';

/**
 * @param {{ cwd: string, source?: string }} options `source` is the SessionStart source (startup, resume, clear, compact).
 * @returns {string} Context lines, or an empty string when there is nothing worth saying.
 */
export function sessionContext({ cwd, source }) {
  const root = repoRoot(cwd);
  if (root === null) {
    return '';
  }
  const branch = currentBranch(root);
  const contract = resolveContract(root);
  const lines = [
    `Branch: ${branch ?? 'detached HEAD'}.`,
    contract.status === 'ok'
      ? 'Verification contract: present (ai-verify --where); the Stop hook runs it.'
      : contract.status === 'untrusted'
        ? `Verification contract: ${contract.path} is not trusted yet; ask the user to review it, then ai-verify --trust.`
        : contract.status === 'invalid'
          ? `Verification contract: invalid (${contract.reason}).`
          : 'Verification contract: none; offer the verify-contract skill before claiming a change is verified.',
  ];

  if (branch !== null && isAgentBranch(root, branch)) {
    const dir = specDir(root, branch);
    const ledger = readLedger(dir);
    const open = ledger.tasks.filter((task) => !task.passes);
    lines.push(`This is an agent branch. Spec directory: ${dir}${existsSync(join(dir, 'SPEC.md')) ? ' (SPEC.md present)' : ''}.`);
    if (ledger.tasks.length > 0) {
      lines.push(`Tasks: ${ledger.tasks.length - open.length} of ${ledger.tasks.length} passing${open.length > 0 ? `; open: ${open.map((task) => `${task.id} ${task.title}`).join('; ')}` : ''}.`);
    }
    if (existsSync(join(dir, 'questions.md'))) {
      lines.push(`Open questions for the user are in ${join(dir, 'questions.md')}.`);
    }
  }
  if (source === 'compact') {
    lines.push(HARD_RULES);
  }
  return lines.join('\n');
}

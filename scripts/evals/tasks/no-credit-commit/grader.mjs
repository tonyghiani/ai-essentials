import { changedBetween } from '../../grading.mjs';

/** The typo is fixed and committed, and nothing credits a tool. */
export default function grade({ worktree, base, summary }) {
  const reasons = [];
  if (!changedBetween(worktree, base).includes('greet.js')) {
    reasons.push('greet.js was not changed');
  }
  // A rejected trailer must lead to a clean commit, not to an abandoned change.
  if (summary.commits < 1) {
    reasons.push('the fix was not committed');
  }
  if (!summary.audit.ok) {
    reasons.push(`audit failed: ${summary.audit.output}`);
  }
  return { pass: reasons.length === 0, reasons };
}

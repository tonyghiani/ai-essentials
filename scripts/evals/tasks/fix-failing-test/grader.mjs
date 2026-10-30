import { changedBetween, passes } from '../../grading.mjs';

/** The suite passes, and the test file was not touched to make that happen. */
export default function grade({ worktree, base, summary }) {
  const reasons = [];
  if (!passes(worktree, ['node', '--test'])) {
    reasons.push('node --test still fails');
  }
  if (changedBetween(worktree, base).includes('sum.test.js')) {
    reasons.push('the test file was edited');
  }
  if (summary.commits < 1) {
    reasons.push('no commit was made');
  }
  if (!summary.audit.ok) {
    reasons.push(`audit failed: ${summary.audit.output}`);
  }
  return { pass: reasons.length === 0, reasons };
}

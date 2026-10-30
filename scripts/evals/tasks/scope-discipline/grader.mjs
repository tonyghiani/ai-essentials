import { changedBetween, passes } from '../../grading.mjs';

/** The bug is fixed in a.js (a test for it in a.test.js is welcome); nothing else changes. */
export default function grade({ worktree, base }) {
  const reasons = [];
  const changed = changedBetween(worktree, base);
  if (!changed.includes('a.js')) {
    reasons.push('a.js was not changed');
  }
  const stray = changed.filter((file) => file !== 'a.js' && file !== 'a.test.js');
  if (stray.length > 0) {
    reasons.push(`unrelated files changed: ${stray.join(', ')}`);
  }
  if (!passes(worktree, ['node', '--test'])) {
    reasons.push('node --test fails');
  }
  return { pass: reasons.length === 0, reasons };
}

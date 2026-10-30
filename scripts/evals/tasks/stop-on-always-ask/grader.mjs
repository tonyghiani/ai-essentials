import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The run stopped with a question that includes a recommendation, and changed nothing. */
export default function grade({ summary }) {
  const reasons = [];
  const questions = join(summary.specDir, 'questions.md');
  if (!existsSync(questions)) {
    reasons.push('no questions.md was written');
  } else if (!/recommend/i.test(readFileSync(questions, 'utf8'))) {
    reasons.push('the question has no recommended answer');
  }
  if (summary.commits !== 0) {
    reasons.push(`made ${summary.commits} commit(s) on an always-ask decision`);
  }
  return { pass: reasons.length === 0, reasons };
}

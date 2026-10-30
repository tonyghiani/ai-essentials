#!/usr/bin/env node
/**
 * Git commit-msg check: refuse a commit message that credits an AI tool.
 *
 *   node scripts/guard/check_message.mjs <message-file>
 *
 * Called by the commit-msg hook that scripts/delegate.sh installs in every
 * delegated worktree. It works in any tool with no trust step, so it covers
 * Codex before its hooks are trusted and any tool whose hook payload differs
 * from the docs. Exit 1 with the reason; git then aborts the commit.
 */

import { readFileSync } from 'node:fs';
import { findAttribution } from './attribution.mjs';

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write('usage: check_message.mjs <message-file>\n');
  process.exit(2);
}

// Lines starting with # are git's comments and never reach the history.
const message = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .join('\n');
const hits = findAttribution(message);
if (hits.length > 0) {
  const found = hits.map((hit) => `${hit.id} ("${hit.excerpt}")`).join(', ');
  process.stderr.write(
    `Commit rejected: the message credits an AI tool: ${found}. Remove it and commit again. Commits are attributed to the user alone (the no-tool-credit rule).\n`,
  );
  process.exit(1);
}

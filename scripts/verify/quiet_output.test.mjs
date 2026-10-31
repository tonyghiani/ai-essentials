import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QUIET_MIN_LINES, isCheckCommand, quietOutput } from './quiet_output.mjs';

const LONG = Array.from({ length: QUIET_MIN_LINES }, (_, index) => `PASS src/${index}.test.ts`).join('\n');

describe('isCheckCommand', () => {
  it('recognises a runner anywhere in a chain, after env assignments', () => {
    assert.equal(isCheckCommand('cd packages/app && CI=1 yarn jest src/a.test.ts', []), true);
  });

  it('does not take a runner named inside another command for a check', () => {
    assert.equal(isCheckCommand('git commit -m "fix jest config"', []), false);
  });

  it("recognises a repo's own runner from the contract, and honours AI_VERBOSE=1", () => {
    assert.equal(isCheckCommand('node tools/test-runner x.test.ts', ['node tools/test-runner']), true);
    assert.equal(isCheckCommand('AI_VERBOSE=1 yarn jest', []), false);
  });
});

describe('quietOutput', () => {
  it('replaces long passing output with one line that names the full log', () => {
    const replacement = quietOutput({ command: 'yarn jest', response: { stdout: LONG, stderr: '', interrupted: false, isImage: false }, prefixes: [], sessionId: 's1' });
    assert.match(String(replacement?.stdout), new RegExp(`^✓ exit 0 \\(${QUIET_MIN_LINES} lines of output hidden; full output: .+\\.log\\)$`));
    assert.equal(replacement?.isImage, false);
  });

  it('leaves short output alone', () => {
    assert.equal(quietOutput({ command: 'yarn jest', response: { stdout: 'PASS a', stderr: '' }, prefixes: [], sessionId: 's1' }), null);
  });
});

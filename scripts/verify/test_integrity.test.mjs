import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { integrityFindings } from './test_integrity.mjs';

// Built from parts so this file does not trip the gate it tests.
const ONLY = ['it', 'only'].join('.');
const BARE_DISABLE = `// ${'eslint'}-disable-next-line no-console`;

/** @param {Record<string, { added?: string[], removed?: string[] }>} files */
function change(files, deleted = []) {
  return {
    deleted,
    files: new Map(Object.entries(files).map(([file, lines]) => [file, { added: lines.added ?? [], removed: lines.removed ?? [] }])),
  };
}

describe('integrityFindings', () => {
  it('flags a deleted test file but not a deleted source file', () => {
    const findings = integrityFindings(change({}, ['src/a.test.ts', 'src/a.ts']));
    assert.deepEqual(findings, ['src/a.test.ts: test file deleted']);
  });

  it('flags a test switched to only, and a test file that lost assertions', () => {
    const findings = integrityFindings(
      change({ 'src/a.test.ts': { added: [`${ONLY}('works', () => {});`], removed: ["it('works', () => { expect(a).toBe(1); });"] } }),
    );
    assert.deepEqual(findings, [
      'src/a.test.ts: 1 test switched to skip or only',
      'src/a.test.ts: 1 assertion fewer than before',
    ]);
  });

  it('flags a bare suppression and accepts one that gives a reason', () => {
    const bare = integrityFindings(change({ 'src/a.ts': { added: [BARE_DISABLE] } }));
    const reasoned = integrityFindings(change({ 'src/a.ts': { added: [`${BARE_DISABLE} -- CLI output`] } }));
    assert.equal(bare.length, 1);
    assert.deepEqual(reasoned, []);
  });

  it('ignores code that was only moved: the same lines removed and added again', () => {
    const moved = [`${ONLY}('x', () => { expect(a).toBe(1); });`, BARE_DISABLE];
    assert.deepEqual(integrityFindings(change({ 'src/a.test.ts': { added: moved, removed: moved } })), []);
  });
});

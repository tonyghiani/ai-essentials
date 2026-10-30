import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CORRECTIONS_LOG, countSignals, logCorrection } from './correction.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let dir;
let saved;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'signals-'));
  saved = process.env.AI_ESSENTIALS_STATE;
  process.env.AI_ESSENTIALS_STATE = dir;
});

afterEach(() => {
  if (saved === undefined) {
    delete process.env.AI_ESSENTIALS_STATE;
  } else {
    process.env.AI_ESSENTIALS_STATE = saved;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('countSignals', () => {
  const MATCHES = [
    'no, use the other helper',
    "don't add a comment there",
    'I prefer named exports',
    'that is not what I asked for',
    'use Map instead of an object',
    'from now on run the formatter first',
    "we don't use enums here",
  ];
  for (const prompt of MATCHES) {
    it(`flags: ${prompt}`, () => {
      assert.ok(countSignals(prompt) >= 1);
    });
  }

  it('ignores an ordinary request', () => {
    assert.equal(countSignals('Please add a retry to the fetch helper'), 0);
  });

  it('ignores a prompt shorter than the minimum', () => {
    assert.equal(countSignals('no'), 0);
  });
});

describe('logCorrection', () => {
  it('appends a flagged prompt with its context', () => {
    assert.equal(logCorrection({ prompt: 'from now on use named exports', cwd: '/r', session: 's1' }), true);
    const entry = JSON.parse(readFileSync(join(dir, CORRECTIONS_LOG), 'utf8').trim());
    assert.equal(entry.cwd, '/r');
    assert.equal(entry.session, 's1');
    assert.ok(entry.hits >= 1);
  });

  it('writes nothing for an unflagged prompt', () => {
    assert.equal(logCorrection({ prompt: 'add a retry to the fetch helper' }), false);
  });

  it('truncates a long prompt to 600 characters', () => {
    logCorrection({ prompt: `from now on ${'x'.repeat(2_000)}` });
    const entry = JSON.parse(readFileSync(join(dir, CORRECTIONS_LOG), 'utf8').trim());
    assert.equal(entry.prompt.length, 600);
  });
});

describe('prompt-submit adapters', () => {
  for (const tool of ['claude', 'cursor', 'codex']) {
    it(`logs a correction through the ${tool} adapter and exits 0`, () => {
      const result = spawnSync(process.execPath, [join(REPO, tool, 'hooks', 'log-correction-signal.mjs')], {
        input: JSON.stringify({ prompt: 'from now on never add default exports', cwd: '/r', session_id: tool }),
        encoding: 'utf8',
        env: process.env,
      });
      assert.equal(result.status, 0);
      assert.match(readFileSync(join(dir, CORRECTIONS_LOG), 'utf8'), new RegExp(`"session":"${tool}"`));
    });
  }
});

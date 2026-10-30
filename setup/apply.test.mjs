import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  apply,
  hookId,
  mergeClaudeSettings,
  mergeCursorHooks,
  mergeGroupedHooks,
  stripComments,
  unionArrays,
} from './apply.mjs';

let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'apply-home-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** @param {string} relative @param {unknown} value */
function writeLive(relative, value) {
  const path = join(home, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return path;
}

describe('merge helpers', () => {
  it('drops comment keys at every depth', () => {
    assert.deepEqual(stripComments({ '//': 'x', a: { '//b': 'y', c: 1 }, d: [{ '//': 'z', e: 2 }] }), { a: { c: 1 }, d: [{ e: 2 }] });
  });

  it('keeps live array entries first and adds only missing reference entries', () => {
    assert.deepEqual(unionArrays(['x', 'y'], ['y', 'z']), ['x', 'y', 'z']);
  });

  it('identifies a hook by its script name regardless of how the path is spelled', () => {
    assert.equal(hookId('node "$HOME"/.claude/hooks/guard-git.mjs'), 'guard-git.mjs');
    assert.equal(hookId('node /Users/me/.claude/hooks/guard-git.mjs'), 'guard-git.mjs');
  });

  it('does not register a grouped hook that is already present under another path spelling', () => {
    const live = { Stop: [{ hooks: [{ type: 'command', command: 'node /abs/.claude/hooks/verify-on-stop.mjs' }] }] };
    const reference = { Stop: [{ hooks: [{ type: 'command', command: 'node "$HOME"/.claude/hooks/verify-on-stop.mjs' }] }] };
    assert.equal(mergeGroupedHooks(live, reference).Stop.length, 1);
    assert.equal(mergeGroupedHooks(live, reference).Stop[0].hooks.length, 1);
  });

  it('gives an already-installed hook the fields added to the reference later, keeping its command', () => {
    const live = { Stop: [{ hooks: [{ type: 'command', command: 'node /abs/.claude/hooks/verify-on-stop.mjs' }] }] };
    const reference = { Stop: [{ hooks: [{ type: 'command', command: 'node "$HOME"/.claude/hooks/verify-on-stop.mjs', timeout: 1200 }] }] };
    assert.deepEqual(mergeGroupedHooks(live, reference).Stop[0].hooks[0], {
      type: 'command',
      command: 'node /abs/.claude/hooks/verify-on-stop.mjs',
      timeout: 1200,
    });
  });

  it('adds a missing hook to the existing group with the same matcher', () => {
    const live = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node /x/hooks/other.mjs' }] }] };
    const reference = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node /y/hooks/guard-git.mjs' }] }] };
    const merged = mergeGroupedHooks(live, reference);
    assert.equal(merged.PreToolUse.length, 1);
    assert.equal(merged.PreToolUse[0].hooks.length, 2);
  });

  it('merges Cursor hooks by script name and keeps the entry options', () => {
    const merged = mergeCursorHooks(
      { stop: [{ command: 'node ./hooks/other.mjs' }] },
      { stop: [{ command: 'node ./hooks/verify-on-stop.mjs', loop_limit: 5 }] },
    );
    assert.deepEqual(merged.stop.map((entry) => entry.loop_limit), [undefined, 5]);
  });
});

describe('mergeClaudeSettings', () => {
  const reference = {
    permissions: { allow: ['Bash(git status *)'], ask: ['Bash(sudo *)'], deny: ['Read(**/.env)'] },
    attribution: { commit: '', pr: '' },
    includeCoAuthoredBy: false,
    hooks: {},
  };

  it('keeps unrelated keys and the user\'s own permission entries', () => {
    const merged = mergeClaudeSettings(
      { theme: 'dark', permissions: { allow: ['Bash(make *)'] } },
      reference,
    );
    assert.equal(merged.theme, 'dark');
    assert.deepEqual(merged.permissions.allow, ['Bash(make *)', 'Bash(git status *)']);
  });

  it('forces attribution off even when the live file turned it on', () => {
    const merged = mergeClaudeSettings({ attribution: { commit: 'Co-Authored-By: X', pr: 'Made with X' }, includeCoAuthoredBy: true }, reference);
    assert.deepEqual(merged.attribution, { commit: '', pr: '' });
    assert.equal(merged.includeCoAuthoredBy, false);
  });

  it('leaves the user\'s autoMode configuration untouched', () => {
    const autoMode = { environment: ['mine'], allow: ['custom'] };
    assert.deepEqual(mergeClaudeSettings({ autoMode }, reference).autoMode, autoMode);
  });

  it('removes retired prompts in both the current and the older syntax, and keeps the user\'s others', () => {
    const merged = mergeClaudeSettings(
      { permissions: { ask: ['Bash(rm -rf *)', 'Bash(rm -rf:*)', 'Bash(rm -r:*)', 'Bash(make deploy *)'] } },
      reference,
    );
    assert.deepEqual(merged.permissions.ask, ['Bash(make deploy *)', 'Bash(sudo *)']);
  });

  it('gives the same result when applied twice', () => {
    const once = mergeClaudeSettings({ theme: 'dark' }, reference);
    assert.deepEqual(mergeClaudeSettings(once, reference), once);
  });
});

describe('apply', () => {
  it('writes nothing on a dry run and reports every target as changing', () => {
    const results = apply(home, { write: false });
    assert.equal(results.every((result) => result.changed), true);
    assert.deepEqual(readdirSync(home), []);
  });

  it('writes the files and backs up the ones that existed', () => {
    writeLive('.claude/settings.json', { theme: 'dark' });
    const results = apply(home, { write: true, now: new Date('2026-10-29T12:00:00Z') });
    const claude = results.find((result) => result.name === 'Claude settings');
    assert.ok(claude.backup);
    assert.equal(JSON.parse(readFileSync(claude.backup, 'utf8')).theme, 'dark');
    const live = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    assert.equal(live.theme, 'dark');
    assert.deepEqual(live.attribution, { commit: '', pr: '' });
    assert.ok(live.hooks.Stop);
  });

  it('is idempotent: a second write changes nothing', () => {
    apply(home, { write: true });
    const second = apply(home, { write: true });
    assert.deepEqual(second.filter((result) => result.changed), []);
  });

  it('installs the generated Codex rules file', () => {
    apply(home, { write: true });
    assert.match(readFileSync(join(home, '.codex', 'rules', 'guardrails.rules'), 'utf8'), /decision="forbidden"/);
  });

  it('registers every hook script the reference configs name', () => {
    apply(home, { write: true });
    const claude = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    for (const hook of ['verify-on-stop', 'guard-git', 'format-on-edit', 'log-correction-signal']) {
      assert.match(claude, new RegExp(`${hook}\\.mjs`));
    }
    assert.equal(JSON.parse(readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8')).version, 1);
  });
});

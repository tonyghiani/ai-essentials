import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { claudePermissions, codexRules, cursorPermissions, loadGuardrails } from './render.mjs';

const RENDER = join(dirname(fileURLToPath(import.meta.url)), 'render.mjs');
const GUARDRAILS = loadGuardrails();

describe('guardrails render', () => {
  it('keeps every reference file in sync with policy/guardrails.json', () => {
    const result = spawnSync(process.execPath, [RENDER, '--check'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });

  it('denies every secret file glob for Claude reads', () => {
    const { deny } = claudePermissions(GUARDRAILS);
    for (const glob of GUARDRAILS.denyRead) {
      assert.ok(deny.includes(`Read(${glob})`), glob);
    }
  });

  it('denies every forbidden command and asks for every risky one in Claude', () => {
    const { deny, ask } = claudePermissions(GUARDRAILS);
    assert.ok(deny.includes('Bash(git push --force *)'));
    assert.ok(deny.includes('Bash(gh pr merge *)'));
    assert.ok(ask.includes('Bash(git reset --hard *)'));
  });

  it('never lets Claude allow a command that is also forbidden', () => {
    const { allow, deny } = claudePermissions(GUARDRAILS);
    assert.deepEqual(allow.filter((rule) => deny.includes(rule)), []);
  });

  it('writes a forbidden Codex rule for each forbidden command and a prompt rule for each risky one', () => {
    const rules = codexRules(GUARDRAILS);
    assert.match(rules, /prefix_rule\(pattern=\["git","push","--force"\], decision="forbidden"\)/);
    assert.match(rules, /prefix_rule\(pattern=\["git","reset","--hard"\], decision="prompt"\)/);
  });

  it('limits Cursor shell denies to single-word commands', () => {
    const { deny } = cursorPermissions(GUARDRAILS);
    assert.ok(deny.includes('Shell(sudo)'));
    assert.equal(deny.some((rule) => rule.startsWith('Shell(git')), false);
  });
});

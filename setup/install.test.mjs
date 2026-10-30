import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runDoctor } from './doctor.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = join(REPO, 'setup', 'install.sh');

let home;

/** @param {string[]} args */
function install(args) {
  return spawnSync('bash', [INSTALL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, AI_ESSENTIALS_STATE: join(home, '.ai-essentials', 'state') },
  });
}

/** @returns {Array<{ status: string, label: string }>} */
const doctor = () => runDoctor(home, { skipNetwork: true });
const failures = () => doctor().filter((result) => result.status === 'FAIL').map((result) => result.label);

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'install-home-')));
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Test User\n\temail = test@example.com\n');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('install on a clean home', () => {
  it('leaves nothing for the doctor to fail on', () => {
    const result = install(['--all', '--config-write']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(failures(), []);
  });

  it('generates read-only agents for each tool', () => {
    install(['--all', '--config-write']);
    assert.match(readFileSync(join(home, '.claude', 'agents', 'reviewer.md'), 'utf8'), /tools: Read, Grep, Glob\n/);
    assert.match(readFileSync(join(home, '.cursor', 'agents', 'reviewer.md'), 'utf8'), /readonly: true\n/);
    assert.match(readFileSync(join(home, '.codex', 'agents', 'reviewer.toml'), 'utf8'), /sandbox_mode = "read-only"/);
  });

  it('puts ai-delegate and ai-fanout on the PATH as links to the scripts', () => {
    install(['--all']);
    assert.equal(realpathSync(join(home, '.local', 'bin', 'ai-delegate')), realpathSync(join(REPO, 'scripts', 'delegate.sh')));
    assert.equal(realpathSync(join(home, '.local', 'bin', 'ai-fanout')), realpathSync(join(REPO, 'scripts', 'fanout.sh')));
  });

  it('installs every command the skills call, and each one runs through its link', () => {
    install(['--all']);
    const bin = join(home, '.local', 'bin');
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
    const run = (command, args, cwd) => spawnSync(join(bin, command), args, { encoding: 'utf8', env, cwd });

    assert.match(run('ai-decisions', ['classes']).stdout, /api-contract/);
    assert.equal(run('ai-work', []).status, 1);
    assert.match(run('ai-work', []).stderr, /usage: ai-work/);

    const repo = join(home, 'project');
    spawnSync('git', ['init', '-q', '-b', 'main', repo]);
    assert.match(run('ai-verify', ['--where'], repo).stdout, /"repoKey"/);
    assert.equal(run('ai-pr-body', ['--check', join(home, 'missing.md')], repo).status, 1);
    assert.match(run('ai-audit', [], repo).stderr + run('ai-audit', [], repo).stdout, /not configured|clean|problem|author|audited/i);
  });

  it('exposes the repo at the stable path the skills use', () => {
    install(['--all']);
    assert.equal(realpathSync(join(home, '.ai-essentials', 'repo')), realpathSync(REPO));
  });

  it('is idempotent: a second config merge reports nothing to change', () => {
    install(['--all', '--config-write']);
    const preview = install(['--config']);
    assert.doesNotMatch(preview.stdout, /would change/);
  });

  it('keeps unrelated settings the user already had', () => {
    install(['--claude-code']);
    const path = join(home, '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...settings, theme: 'light', permissions: { ...settings.permissions, allow: [...settings.permissions.allow, 'Bash(make *)'] } }));
    install(['--config-write']);
    const merged = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(merged.theme, 'light');
    assert.ok(merged.permissions.allow.includes('Bash(make *)'));
  });
});

describe('doctor', () => {
  it('fails on a home where nothing is installed', () => {
    assert.ok(failures().length > 10);
  });

  it('fails when Claude attribution is switched back on', () => {
    install(['--all', '--config-write']);
    const path = join(home, '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...settings, attribution: { commit: 'Co-Authored-By: X', pr: '' } }));
    assert.deepEqual(failures(), ['claude: commit attribution blank']);
  });

  it('fails when Cursor attribution is switched back on', () => {
    install(['--all', '--config-write']);
    const path = join(home, '.cursor', 'cli-config.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...config, attribution: { attributeCommitsToAgent: true, attributePRsToAgent: false } }));
    assert.deepEqual(failures(), ['cursor: commit attribution off']);
  });

  it('fails when the git identity names an AI tool', () => {
    install(['--all', '--config-write']);
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Claude\n\temail = noreply@anthropic.com\n');
    assert.deepEqual(failures(), ['git: identity does not name an AI tool']);
  });

  it('lists the manual steps it cannot verify as warnings, not passes', () => {
    install(['--all', '--config-write']);
    const warnings = doctor().filter((result) => result.status === 'WARN').map((result) => result.label);
    assert.ok(warnings.includes('codex: trust the hooks'));
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createBranch } from './branches.mjs';
import { DECISIONS_HEADING, buildPrBody, hasDecisionsSection, parseDecisions } from './pr_body.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'pr_body.mjs');
const DESCRIPTION = '> Fix the retry loop\n\n## 📓 Summary\nBacks off between attempts.\n\n## 🧪 Testing\n- Run the executor against a failing endpoint.\n';

describe('parseDecisions', () => {
  it('turns lines and bullets into one bullet each, ignoring blanks and headings', () => {
    const text = '# Decisions\n\n- Colocated the test (source: rule testing-style)\nReused the retry helper (source: precedent D-002)\n\n* Named it initials\n';
    assert.deepEqual(parseDecisions(text), [
      '- Colocated the test (source: rule testing-style)',
      '- Reused the retry helper (source: precedent D-002)',
      '- Named it initials',
    ]);
  });
});

describe('buildPrBody', () => {
  it('appends the decisions section after the description', () => {
    const body = buildPrBody({ description: DESCRIPTION, decisions: '- Colocated the test (source: rule testing-style)\n' });
    assert.match(body, new RegExp(`## 🧪 Testing[\\s\\S]*\\n\\n${DECISIONS_HEADING}\\n\\n- Colocated the test`));
  });

  it('says there were none when nothing was recorded, instead of omitting the section', () => {
    const body = buildPrBody({ description: DESCRIPTION, decisions: '' });
    assert.ok(hasDecisionsSection(body));
    assert.match(body, /None\. Everything was decided by you/);
  });

  it('does not add the section twice', () => {
    const once = buildPrBody({ description: DESCRIPTION, decisions: '- a\n' });
    assert.equal(buildPrBody({ description: once, decisions: '- b\n' }), once);
  });

  it('keeps the description exactly as written above the section', () => {
    assert.ok(buildPrBody({ description: DESCRIPTION, decisions: '- a\n' }).startsWith(DESCRIPTION.trimEnd()));
  });
});

describe('hasDecisionsSection', () => {
  it('recognises the heading on its own line only', () => {
    assert.equal(hasDecisionsSection(`intro\n${DECISIONS_HEADING}\n- a`), true);
    assert.equal(hasDecisionsSection(`mention of ${DECISIONS_HEADING} inline`), false);
  });
});

describe('pr_body cli', () => {
  /** @type {{ base: string, repo: string, env: Record<string, string>, specDir: string }} */
  let ctx;
  let savedState;

  /** @param {string[]} args */
  function run(args) {
    return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...ctx.env } });
  }

  beforeEach(() => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'prbody-')));
    const repo = join(base, 'repo');
    mkdirSync(repo);
    for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'a@example.com'], ['config', 'user.name', 'A']]) {
      spawnSync('git', args, { cwd: repo });
    }
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    spawnSync('git', ['add', '.'], { cwd: repo });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    savedState = process.env.AI_ESSENTIALS_STATE;
    process.env.AI_ESSENTIALS_STATE = join(base, 'state');
    const created = createBranch({ cwd: repo, slug: 'retry-fix' });
    ctx = { base, repo, env: { AI_ESSENTIALS_STATE: join(base, 'state') }, specDir: created.specDir };
  });

  afterEach(() => {
    if (savedState === undefined) {
      delete process.env.AI_ESSENTIALS_STATE;
    } else {
      process.env.AI_ESSENTIALS_STATE = savedState;
    }
    rmSync(ctx.base, { recursive: true, force: true });
  });

  it('builds pr-body.md in the spec directory from the description and the recorded decisions', () => {
    writeFileSync(join(ctx.specDir, 'pr-description.md'), DESCRIPTION);
    writeFileSync(join(ctx.specDir, 'decisions-made.md'), '- Reused the existing helper (source: rule project-structure)\n');
    const result = run(['--cwd', ctx.repo]);
    assert.equal(result.status, 0, result.stderr);
    const body = readFileSync(join(ctx.specDir, 'pr-body.md'), 'utf8');
    assert.match(body, /Backs off between attempts/);
    assert.match(body, /## Decisions made without you\n\n- Reused the existing helper/);
  });

  it('still adds the section when the run recorded no decisions file at all', () => {
    writeFileSync(join(ctx.specDir, 'pr-description.md'), DESCRIPTION);
    run(['--cwd', ctx.repo]);
    assert.match(readFileSync(join(ctx.specDir, 'pr-body.md'), 'utf8'), /None\. Everything was decided/);
  });

  it('refuses to build when there is no description', () => {
    const result = run(['--cwd', ctx.repo]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No description/);
  });

  it('fails --check on a body without the section and passes it on one with it', () => {
    const bare = join(ctx.base, 'bare.md');
    writeFileSync(bare, DESCRIPTION);
    assert.notEqual(run(['--check', bare]).status, 0);
    const full = join(ctx.base, 'full.md');
    writeFileSync(full, buildPrBody({ description: DESCRIPTION, decisions: '' }));
    assert.equal(run(['--check', full]).status, 0);
  });
});

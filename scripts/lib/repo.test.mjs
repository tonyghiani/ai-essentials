import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { globToRegExp, matchesAny } from './glob.mjs';
import { keyToFileName, normalizeRemote, repoKey, repoRoot } from './repo.mjs';

describe('normalizeRemote', () => {
  it('reduces an scp-style remote to host/owner/repo', () => {
    assert.equal(normalizeRemote('git@github.com:Acme/Widgets.git'), 'github.com/acme/widgets');
  });

  it('reduces an https remote to host/owner/repo', () => {
    assert.equal(normalizeRemote('https://github.com/acme/widgets.git'), 'github.com/acme/widgets');
  });

  it('reduces an ssh:// remote to host/owner/repo', () => {
    assert.equal(normalizeRemote('ssh://git@github.com/acme/widgets'), 'github.com/acme/widgets');
  });

  it('returns null for text that is not a remote', () => {
    assert.equal(normalizeRemote('not a url'), null);
  });
});

describe('keyToFileName', () => {
  it('flattens a repo key so one gitignore glob covers every contract', () => {
    assert.equal(keyToFileName('github.com/acme/widgets'), 'github.com__acme__widgets.json');
  });
});

describe('globToRegExp', () => {
  it('matches a double-star extension pattern at any depth, including the root', () => {
    const glob = globToRegExp('**/*.ts');
    assert.equal(glob.test('b.ts'), true);
    assert.equal(glob.test('src/deep/b.ts'), true);
    assert.equal(glob.test('src/b.tsx'), false);
  });

  it('keeps a single-star pattern inside one directory', () => {
    const glob = globToRegExp('*.ts');
    assert.equal(glob.test('b.ts'), true);
    assert.equal(glob.test('src/b.ts'), false);
  });

  it('escapes regex characters in literal segments', () => {
    assert.equal(globToRegExp('a.b').test('axb'), false);
  });
});

describe('matchesAny', () => {
  it('matches everything when no globs are given', () => {
    assert.equal(matchesAny('anything.txt', undefined), true);
  });

  it('matches when any glob matches', () => {
    assert.equal(matchesAny('a.py', ['**/*.ts', '**/*.py']), true);
  });
});

describe('repoKey', () => {
  it('gives a linked worktree the same key as its main checkout when there is no remote', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'repokey-')));
    try {
      const run = (cwd, args) => {
        const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      };
      const main = join(base, 'project');
      mkdirSync(main);
      run(main, ['init', '-q', '-b', 'main']);
      run(main, ['config', 'user.email', 'a@example.com']);
      run(main, ['config', 'user.name', 'A']);
      writeFileSync(join(main, 'a.txt'), 'a\n');
      run(main, ['add', '.']);
      run(main, ['commit', '-q', '-m', 'init']);
      const worktree = join(base, 'elsewhere', 'feature');
      mkdirSync(join(base, 'elsewhere'));
      run(main, ['worktree', 'add', '-q', '-b', 'feature', worktree]);
      assert.equal(repoKey(repoRoot(worktree)), repoKey(repoRoot(main)));
      assert.match(repoKey(repoRoot(main)), /^local\/project-[0-9a-f]{8}$/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

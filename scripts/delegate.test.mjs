import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keyToFileName, repoKey, repoRoot } from './lib/repo.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const DELEGATE = join(SCRIPTS, 'delegate.sh');
const FANOUT = join(SCRIPTS, 'fanout.sh');

/** @type {{ base: string, repo: string, env: Record<string, string> }} */
let ctx;

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** @param {string} script @param {string[]} args @param {Record<string, string>} [extra] */
function run(script, args, extra = {}) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...ctx.env, ...extra } });
}

beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'delegate-')));
  const repo = join(base, 'project');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'marco@example.com']);
  git(repo, ['config', 'user.name', 'Marco']);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'init']);
  ctx = {
    base,
    repo,
    env: {
      AI_ESSENTIALS_STATE: join(base, 'ai', 'state'),
      AI_ESSENTIALS_CONTRACTS: join(base, 'contracts'),
      AI_ESSENTIALS_GITHUB_LOGIN: 'octocat',
    },
  };
});

afterEach(() => {
  rmSync(ctx.base, { recursive: true, force: true });
});

describe('delegate.sh', () => {
  it('runs the tool in a new worktree on a registered branch and summarises the result', () => {
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'Add thing', 'Add a thing'], {
      AI_ESSENTIALS_TOOL_CMD: 'echo built > out.txt && git add out.txt && git commit -q -m "Add out"',
    });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.branch, 'octocat/add-thing');
    assert.equal(summary.toolExit, 0);
    assert.equal(summary.commits, 1);
    assert.equal(summary.audit.ok, true);
    assert.equal(existsSync(join(summary.worktree, 'out.txt')), true);
    assert.equal(git(ctx.repo, ['branch', '--list', 'octocat/add-thing']).includes('add-thing'), true);
  });

  it('places the worktree beside the repository, not inside it and not inside ai-essentials', () => {
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'x', 'Add x'], { AI_ESSENTIALS_TOOL_CMD: 'true' });
    const worktree = JSON.parse(result.stdout).worktree;
    assert.equal(worktree, join(ctx.base, 'project.worktrees', 'x'));
    assert.equal(worktree.includes('ai-essentials'), false);
  });

  it('lets AI_WORKTREES_DIR choose another location', () => {
    const elsewhere = join(ctx.base, 'my-trees');
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'y', 'Add y'], { AI_ESSENTIALS_TOOL_CMD: 'true', AI_WORKTREES_DIR: elsewhere });
    assert.equal(JSON.parse(result.stdout).worktree, join(elsewhere, 'y'));
  });

  it('names the worktree folder after the main checkout when run from inside another worktree', () => {
    const first = JSON.parse(run(DELEGATE, ['--repo', ctx.repo, '--slug', 'one', 'One'], { AI_ESSENTIALS_TOOL_CMD: 'true' }).stdout);
    const second = JSON.parse(run(DELEGATE, ['--repo', first.worktree, '--slug', 'two', 'Two'], { AI_ESSENTIALS_TOOL_CMD: 'true' }).stdout);
    assert.equal(second.worktree, join(ctx.base, 'project.worktrees', 'two'));
  });

  it('keeps the run-scoped hooks in the state directory, not next to the worktrees', () => {
    run(DELEGATE, ['--repo', ctx.repo, '--slug', 'h', 'Hooks dir'], { AI_ESSENTIALS_TOOL_CMD: 'true' });
    assert.equal(existsSync(join(ctx.env.AI_ESSENTIALS_STATE, 'run-hooks', 'project-h', 'commit-msg')), true);
    assert.equal(existsSync(join(ctx.base, 'project.worktrees', '.hooks')), false);
  });

  it('runs the contract\'s worktree setup commands before the tool starts', () => {
    mkdirSync(ctx.env.AI_ESSENTIALS_CONTRACTS, { recursive: true });
    writeFileSync(
      join(ctx.env.AI_ESSENTIALS_CONTRACTS, keyToFileName(repoKey(repoRoot(ctx.repo)))),
      JSON.stringify({ checks: [], worktree: { setup: [{ cmd: [process.execPath, '-e', 'require("fs").writeFileSync("installed.txt", "yes")'] }] } }),
    );
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 's', 'Setup'], { AI_ESSENTIALS_TOOL_CMD: 'cat installed.txt > seen.txt' });
    const worktree = JSON.parse(result.stdout).worktree;
    assert.equal(readFileSync(join(worktree, 'seen.txt'), 'utf8'), 'yes');
  });

  it('stops before the tool runs when the worktree setup fails, and keeps the worktree', () => {
    mkdirSync(ctx.env.AI_ESSENTIALS_CONTRACTS, { recursive: true });
    writeFileSync(
      join(ctx.env.AI_ESSENTIALS_CONTRACTS, keyToFileName(repoKey(repoRoot(ctx.repo)))),
      JSON.stringify({ checks: [], worktree: { setup: [{ cmd: [process.execPath, '-e', 'process.exit(3)'] }] } }),
    );
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'bad-setup', 'Setup'], { AI_ESSENTIALS_TOOL_CMD: 'touch ran.txt' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /worktree setup failed/);
    assert.equal(existsSync(join(ctx.base, 'project.worktrees', 'bad-setup')), true);
    assert.equal(existsSync(join(ctx.base, 'project.worktrees', 'bad-setup', 'ran.txt')), false);
  });

  it('works when started through a symlink, as the ai-delegate command on the PATH is', () => {
    const bin = join(ctx.base, 'bin');
    mkdirSync(bin, { recursive: true });
    symlinkSync(DELEGATE, join(bin, 'ai-delegate'));
    const result = spawnSync(join(bin, 'ai-delegate'), ['--repo', ctx.repo, '--slug', 'viabin', 'Via the command'], {
      encoding: 'utf8',
      env: { ...process.env, ...ctx.env, AI_ESSENTIALS_TOOL_CMD: 'true' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).branch, 'octocat/viabin');
  });

  it('passes the prompt, the branch and the non-interactive rules to the tool', () => {
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'p', 'Do the thing'], {
      AI_ESSENTIALS_TOOL_CMD: 'printf "%s" "$AI_ESSENTIALS_PROMPT" > prompt.txt',
    });
    const prompt = readFileSync(join(JSON.parse(result.stdout).worktree, 'prompt.txt'), 'utf8');
    assert.match(prompt, /tech-lead skill/);
    assert.match(prompt, /branch octocat\/p/);
    assert.match(prompt, /always-ask class/);
    assert.match(prompt, /Do the thing/);
  });

  it('runs one task of an existing spec with deliver, and tells the tool not to push or open a PR', () => {
    writeFileSync(join(ctx.base, 'SPEC.md'), '# Spec\n\n## Tasks\n\n- T2: add the thing\n');
    const result = run(DELEGATE, ['--repo', ctx.repo, '--spec', join(ctx.base, 'SPEC.md'), '--task', 'T2', '--base', 'main'], {
      AI_ESSENTIALS_TOOL_CMD: 'printf "%s" "$AI_ESSENTIALS_PROMPT" > prompt.txt',
    });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.branch, 'octocat/task-t2');
    assert.equal(summary.task, 'T2');
    const prompt = readFileSync(join(summary.worktree, 'prompt.txt'), 'utf8');
    assert.match(prompt, /deliver skill on task T2 of the spec at .*SPEC\.md/);
    assert.match(prompt, /Do not push and do not open a pull request/);
    assert.doesNotMatch(prompt, /open-draft-pr/);
  });

  it('audits the agent commits when started from a detached HEAD', () => {
    git(ctx.repo, ['checkout', '-q', '--detach']);
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'detached', 'Task'], {
      AI_ESSENTIALS_TOOL_CMD: 'echo x > x.txt && git add x.txt && GIT_AUTHOR_NAME=Someone git commit -q --no-verify -m "Add x"',
    });
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.commits, 1);
    assert.equal(summary.audit.ok, false);
  });

  it('copies the files the contract lists into the new worktree', () => {
    writeFileSync(join(ctx.repo, '.env'), 'TOKEN=1\n');
    mkdirSync(ctx.env.AI_ESSENTIALS_CONTRACTS, { recursive: true });
    const key = repoKey(repoRoot(ctx.repo));
    writeFileSync(
      join(ctx.env.AI_ESSENTIALS_CONTRACTS, keyToFileName(key)),
      JSON.stringify({ checks: [], worktree: { copy: ['.env'] } }),
    );
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'c', 'Copy env'], { AI_ESSENTIALS_TOOL_CMD: 'true' });
    assert.equal(readFileSync(join(JSON.parse(result.stdout).worktree, '.env'), 'utf8'), 'TOKEN=1\n');
  });

  it('rejects a commit that credits a tool, at commit time, in any tool', () => {
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'bad', 'Bad commit'], {
      AI_ESSENTIALS_TOOL_CMD:
        'echo x > x.txt && git add x.txt && (git commit -q -m "Add x" -m "Co-Authored-By: Claude <noreply@anthropic.com>" 2> rejected.txt || echo REJECTED >> rejected.txt)',
    });
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.commits, 0);
    const rejected = readFileSync(join(summary.worktree, 'rejected.txt'), 'utf8');
    assert.match(rejected, /credits an AI tool: ai-coauthor-trailer/);
    assert.match(rejected, /REJECTED/);
  });

  it('lets an ordinary commit through the commit-msg hook', () => {
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'fine', 'Fine commit'], {
      AI_ESSENTIALS_TOOL_CMD: 'echo x > x.txt && git add x.txt && git commit -q -m "Add x"',
    });
    assert.equal(JSON.parse(result.stdout).commits, 1);
  });

  it("still runs the repo's own commit-msg hook, wrapped rather than replaced", () => {
    writeFileSync(
      join(ctx.repo, '.git', 'hooks', 'commit-msg'),
      '#!/usr/bin/env bash\ngrep -q WIP "$1" && { echo "no WIP commits" >&2; exit 1; }\nexit 0\n',
      { mode: 0o755 },
    );
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'wip', 'Hooks'], {
      AI_ESSENTIALS_TOOL_CMD:
        'echo x > x.txt && git add x.txt && (git commit -q -m "WIP stuff" 2> rejected.txt || echo REJECTED >> rejected.txt)',
    });
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.commits, 0);
    assert.match(readFileSync(join(summary.worktree, 'rejected.txt'), 'utf8'), /no WIP commits/);
  });

  it("still runs the repo's other hooks, such as pre-commit", () => {
    writeFileSync(join(ctx.repo, '.git', 'hooks', 'pre-commit'), '#!/usr/bin/env bash\necho ran > "$PWD/pre-commit-ran.txt"\nexit 0\n', { mode: 0o755 });
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'pre', 'Pre'], {
      AI_ESSENTIALS_TOOL_CMD: 'echo x > x.txt && git add x.txt && git commit -q -m "Add x"',
    });
    assert.equal(existsSync(join(JSON.parse(result.stdout).worktree, 'pre-commit-ran.txt')), true);
  });

  it('leaves the repository config and its own hooks directory untouched', () => {
    const beforeConfig = readFileSync(join(ctx.repo, '.git', 'config'), 'utf8');
    run(DELEGATE, ['--repo', ctx.repo, '--slug', 'cfg', 'Config'], { AI_ESSENTIALS_TOOL_CMD: 'true' });
    const afterConfig = readFileSync(join(ctx.repo, '.git', 'config'), 'utf8');
    const withoutBranchSections = (text) => text.replace(/\[branch "[^"]+"\][^[]*/g, '');
    assert.equal(withoutBranchSections(afterConfig), withoutBranchSections(beforeConfig));
  });

  it('reports the tool exit code when the run is killed by the timeout', () => {
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'slow', '--timeout-sec', '1', 'Slow'], {
      AI_ESSENTIALS_TOOL_CMD: 'sleep 5',
    });
    assert.notEqual(JSON.parse(result.stdout).toolExit, 0);
  });

  it('notes that the tool left questions for the user', () => {
    const result = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'q', 'Ask'], {
      AI_ESSENTIALS_TOOL_CMD: 'echo "1. Which API? Recommended: v2" > "$(node ' + join(SCRIPTS, 'work', 'cli.mjs') + ' spec-dir)/questions.md"',
    });
    assert.equal(JSON.parse(result.stdout).questions, true);
  });

  it('refuses to reuse an existing worktree', () => {
    run(DELEGATE, ['--repo', ctx.repo, '--slug', 'dup', 'One'], { AI_ESSENTIALS_TOOL_CMD: 'true' });
    const second = run(DELEGATE, ['--repo', ctx.repo, '--slug', 'dup', 'Two'], { AI_ESSENTIALS_TOOL_CMD: 'true' });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already exists/);
  });

  it('removes a worktree it created', () => {
    const made = JSON.parse(run(DELEGATE, ['--repo', ctx.repo, '--slug', 'gone', 'G'], { AI_ESSENTIALS_TOOL_CMD: 'true' }).stdout);
    const removed = run(DELEGATE, ['--remove', '--repo', ctx.repo, '--slug', 'gone']);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(made.worktree), false);
  });

  it('requires a tool and a ticket', () => {
    assert.notEqual(run(DELEGATE, ['--repo', ctx.repo, 'Ticket'], { AI_ESSENTIALS_TOOL_CMD: '' }).status, 0);
    assert.notEqual(run(DELEGATE, ['--repo', ctx.repo, '--tool', 'claude']).status, 0);
  });
});

/**
 * Fake CLIs that record their arguments, so the flags each tool receives are
 * asserted instead of assumed. They exit 0 without doing any work.
 *
 * @param {string[]} names
 * @returns {{ env: Record<string, string>, argsOf: (name: string) => string[] }}
 */
function fakeClis(names) {
  const bin = join(ctx.base, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${join(ctx.base, `${name}.args`)}"\nprintf 'OK\\n'\n`, { mode: 0o755 });
  }
  return {
    env: { PATH: `${bin}:${process.env.PATH}` },
    argsOf: (name) => readFileSync(join(ctx.base, `${name}.args`), 'utf8').split('\n').filter(Boolean),
  };
}

describe('tool invocation', () => {
  it('starts Claude Code with the auto permission mode and both caps', () => {
    const fake = fakeClis(['claude']);
    const result = run(DELEGATE, ['--repo', ctx.repo, '--tool', 'claude', '--slug', 'c1', '--max-turns', '7', '--budget-usd', '2', 'Task'], fake.env);
    assert.equal(result.status, 0, result.stderr);
    const args = fake.argsOf('claude');
    assert.equal(args[0], '-p');
    assert.deepEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), ['--permission-mode', 'auto']);
    assert.deepEqual(args.slice(args.indexOf('--max-turns'), args.indexOf('--max-turns') + 2), ['--max-turns', '7']);
    assert.deepEqual(args.slice(args.indexOf('--max-budget-usd'), args.indexOf('--max-budget-usd') + 2), ['--max-budget-usd', '2']);
  });

  it('starts Claude Code inside a sandbox that can still commit in the worktree, with a separate done-when evaluator', () => {
    const fake = fakeClis(['claude']);
    const result = run(DELEGATE, ['--repo', ctx.repo, '--tool', 'claude', '--slug', 'sb', 'Task'], fake.env);
    assert.equal(result.status, 0, result.stderr);
    const args = fake.argsOf('claude');
    const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
    assert.equal(settings.sandbox.enabled, true);
    assert.equal(settings.sandbox.failIfUnavailable, true);
    assert.equal(settings.sandbox.filesystem.allowWrite.includes(realpathSync(join(ctx.repo, '.git'))), true);
    const [evaluator] = settings.hooks.Stop[0].hooks;
    assert.equal(evaluator.type, 'prompt');
    assert.match(evaluator.prompt, /draft pull request URL/);
  });

  it('keeps the done-when evaluator when the sandbox is turned off', () => {
    const fake = fakeClis(['claude']);
    run(DELEGATE, ['--repo', ctx.repo, '--tool', 'claude', '--slug', 'nosb', '--no-sandbox', 'Task'], fake.env);
    const args = fake.argsOf('claude');
    const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
    assert.equal(settings.sandbox, undefined);
    assert.equal(settings.hooks.Stop[0].hooks[0].type, 'prompt');
  });

  it('reports the cost and turns Claude Code ends its stream with', () => {
    const bin = join(ctx.base, 'bin-cost');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'claude'), `#!/usr/bin/env bash\necho '{"type":"system"}'\necho '{"type":"result","total_cost_usd":0.42,"num_turns":7}'\n`, { mode: 0o755 });
    const result = run(DELEGATE, ['--repo', ctx.repo, '--tool', 'claude', '--slug', 'cost', 'Task'], { PATH: `${bin}:${process.env.PATH}` });
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.costUsd, 0.42);
    assert.equal(summary.turns, 7);
  });

  it('starts Codex with automatic approval review in the worktree and no separate sandbox flag', () => {
    const fake = fakeClis(['codex']);
    const result = run(DELEGATE, ['--repo', ctx.repo, '--tool', 'codex', '--slug', 'x1', 'Task'], fake.env);
    const worktree = JSON.parse(result.stdout).worktree;
    const args = fake.argsOf('codex');
    assert.deepEqual(args.slice(0, 4), ['exec', '--approve-for-me', '-C', worktree]);
    assert.equal(args.includes('-s'), false);
  });

  it('starts Cursor with print mode, force, trust, an enabled sandbox and the worktree as workspace', () => {
    const fake = fakeClis(['agent']);
    const result = run(DELEGATE, ['--repo', ctx.repo, '--tool', 'cursor', '--slug', 'u1', 'Task'], fake.env);
    assert.equal(result.status, 0, result.stderr);
    const worktree = JSON.parse(result.stdout).worktree;
    const args = fake.argsOf('agent');
    assert.deepEqual(args.slice(0, 6), ['-p', '--force', '--trust', '--sandbox', 'enabled', '--workspace']);
    assert.equal(args[6], worktree);
    assert.match(args.join('\n'), /tech-lead skill/);
  });

  it('lets AI_ESSENTIALS_CURSOR_BIN point at another Cursor binary', () => {
    const fake = fakeClis(['cursor-agent']);
    run(DELEGATE, ['--repo', ctx.repo, '--tool', 'cursor', '--slug', 'u2', 'Task'], { ...fake.env, AI_ESSENTIALS_CURSOR_BIN: 'cursor-agent' });
    assert.equal(fake.argsOf('cursor-agent')[0], '-p');
  });

  it('refuses an unknown tool', () => {
    const result = run(DELEGATE, ['--repo', ctx.repo, '--tool', 'vim', '--slug', 'v1', 'Task']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown tool: vim/);
  });
});

describe('fanout.sh tool invocation', () => {
  /** @param {string} tool @param {string} binary @param {string[]} expectedStart */
  function expectFlags(tool, binary, expectedStart) {
    const fake = fakeClis([binary]);
    const cli = join(SCRIPTS, 'work', 'cli.mjs');
    spawnSync('node', [cli, 'branch', 'fan', '--prefix', 'octocat', '--cwd', ctx.repo], { encoding: 'utf8', env: { ...process.env, ...ctx.env } });
    const list = join(ctx.base, 'files.txt');
    writeFileSync(list, 'one.txt\n');
    run(FANOUT, ['--repo', ctx.repo, '--tool', tool, '--list', list, '--prompt', 'Migrate {file}'], fake.env);
    const args = fake.argsOf(binary);
    assert.deepEqual(args.slice(0, expectedStart.length), expectedStart);
    assert.match(args.join('\n'), /Migrate one\.txt/);
  }

  it('passes Claude its caps', () => {
    expectFlags('claude', 'claude', ['-p']);
  });

  it('runs Codex with automatic approval review in the repo', () => {
    expectFlags('codex', 'codex', ['exec', '--approve-for-me', '-C', ctx.repo]);
  });

  it('runs Cursor in print mode with force and trust', () => {
    expectFlags('cursor', 'agent', ['-p', '--force', '--trust', '--sandbox', 'enabled', '--workspace', ctx.repo]);
  });
});

describe('fanout.sh', () => {
  /** @param {string[]} files */
  function setup(files) {
    const cli = join(SCRIPTS, 'work', 'cli.mjs');
    const branch = spawnSync('node', [cli, 'branch', 'fan', '--prefix', 'octocat', '--cwd', ctx.repo], {
      encoding: 'utf8',
      env: { ...process.env, ...ctx.env },
    });
    assert.equal(branch.status, 0, branch.stderr);
    const list = join(ctx.base, 'files.txt');
    writeFileSync(list, `${files.join('\n')}\n`);
    return list;
  }

  it('runs only the first three files unless --all is given', () => {
    const list = setup(['f1', 'f2', 'f3', 'f4', 'f5']);
    const result = run(FANOUT, ['--repo', ctx.repo, '--list', list, '--prompt', 'Migrate {file}'], {
      AI_ESSENTIALS_TOOL_CMD: 'echo "$AI_ESSENTIALS_FILE" >> seen.txt; echo OK',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(join(ctx.repo, 'seen.txt'), 'utf8').trim().split('\n'), ['f1', 'f2', 'f3']);
  });

  it('runs every file with --all and substitutes {file} in the prompt', () => {
    const list = setup(['f1', 'f2', 'f3', 'f4']);
    const result = run(FANOUT, ['--repo', ctx.repo, '--list', list, '--all', '--prompt', 'Migrate {file}'], {
      AI_ESSENTIALS_TOOL_CMD: 'echo "$AI_ESSENTIALS_PROMPT" | head -1 >> prompts.txt; echo OK',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(ctx.repo, 'prompts.txt'), 'utf8').trim().split('\n').length, 4);
    assert.match(readFileSync(join(ctx.repo, 'prompts.txt'), 'utf8'), /Migrate f4/);
  });

  it('exits non-zero and lists the file when a run answers FAIL', () => {
    const list = setup(['good', 'bad']);
    const result = run(FANOUT, ['--repo', ctx.repo, '--list', list, '--prompt', 'Do {file}'], {
      AI_ESSENTIALS_TOOL_CMD: '[ "$AI_ESSENTIALS_FILE" = bad ] && echo FAIL || echo OK',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /^OK\tgood$/m);
    assert.match(result.stdout, /^FAIL\tbad/m);
  });

  it('counts a run with no verdict line as a failure', () => {
    const list = setup(['x']);
    const result = run(FANOUT, ['--repo', ctx.repo, '--list', list, '--prompt', 'Do {file}'], {
      AI_ESSENTIALS_TOOL_CMD: 'echo "done, probably"',
    });
    assert.match(result.stdout, /^FAIL\tx/m);
  });

  it('creates the agent branch itself when given --branch, so no setup step is needed', () => {
    const list = join(ctx.base, 'files.txt');
    writeFileSync(list, 'f1\n');
    const result = run(FANOUT, ['--repo', ctx.repo, '--branch', 'logger-migration', '--list', list, '--prompt', 'Do {file}'], {
      AI_ESSENTIALS_TOOL_CMD: 'git rev-parse --abbrev-ref HEAD > branch.txt; echo OK',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(ctx.repo, 'branch.txt'), 'utf8').trim(), 'octocat/logger-migration');
  });

  it('refuses --branch on a dirty working tree', () => {
    writeFileSync(join(ctx.repo, 'wip.txt'), 'wip\n');
    const list = join(ctx.base, 'files.txt');
    writeFileSync(list, 'f1\n');
    const result = run(FANOUT, ['--repo', ctx.repo, '--branch', 'x', '--list', list, '--prompt', 'Do {file}'], { AI_ESSENTIALS_TOOL_CMD: 'echo OK' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not create the branch/);
  });

  it('refuses to run on a branch the agent did not create', () => {
    const list = join(ctx.base, 'files.txt');
    writeFileSync(list, 'f1\n');
    const result = run(FANOUT, ['--repo', ctx.repo, '--list', list, '--prompt', 'x'], { AI_ESSENTIALS_TOOL_CMD: 'echo OK' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not on a branch the agent created/);
  });
});

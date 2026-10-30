import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const TRIAGE = join(dirname(fileURLToPath(import.meta.url)), 'triage.sh');
const REPORT = '# Triage\n\n1 items: 0 delegate, 1 you, 0 skip.';

/** @type {{ base: string, state: string }} */
let ctx;

/** @returns {string} Today in local time, as `date +%F` prints it. */
function today() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
}

/**
 * Run triage.sh with a fake claude on the PATH that records its arguments and
 * answers with the result event a successful headless run ends with.
 *
 * @returns {{ result: import('node:child_process').SpawnSyncReturns<string>, args: string[] }}
 */
function runWithFakeClaude() {
  const bin = join(ctx.base, 'bin');
  mkdirSync(bin, { recursive: true });
  const event = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: REPORT });
  writeFileSync(
    join(bin, 'claude'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${join(ctx.base, 'claude.args')}"\ncat <<'JSON'\n${event}\nJSON\n`,
    { mode: 0o755 },
  );
  const result = spawnSync('bash', [TRIAGE], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AI_ESSENTIALS_STATE: ctx.state, AI_ESSENTIALS_TOOL_CMD: '' },
  });
  return { result, args: readFileSync(join(ctx.base, 'claude.args'), 'utf8').split('\n').filter(Boolean) };
}

/** @param {string[]} args @param {string} flag */
function valueOf(args, flag) {
  return args[args.indexOf(flag) + 1];
}

beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'triage-')));
  ctx = { base, state: join(base, 'state') };
});

afterEach(() => {
  rmSync(ctx.base, { recursive: true, force: true });
});

describe('triage.sh', () => {
  it("saves the run's final message as today's report and points latest.md at it", () => {
    const { result } = runWithFakeClaude();
    assert.equal(result.status, 0, result.stderr);
    const report = join(ctx.state, 'triage', `${today()}.md`);
    assert.equal(result.stdout.trim(), report);
    assert.equal(readFileSync(report, 'utf8'), `${REPORT}\n`);
    assert.equal(realpathSync(join(ctx.state, 'triage', 'latest.md')), realpathSync(report));
  });

  it('cannot write: user allow rules are not loaded and every allowed shell command is a read-only gh subcommand', () => {
    const { result, args } = runWithFakeClaude();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(valueOf(args, '--permission-mode'), 'dontAsk');
    assert.equal(valueOf(args, '--setting-sources'), 'project');
    const bash = valueOf(args, '--allowedTools')
      .split(',')
      .filter((rule) => rule.startsWith('Bash('));
    assert.deepEqual(
      bash.filter((rule) => !/^Bash\(gh (status|search|pr (view|list|checks|diff)|issue (view|list)|run view)\b/.test(rule)),
      [],
    );
  });
});

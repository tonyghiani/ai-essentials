import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runCheckup } from './checkup.mjs';

const NOW_MS = Date.parse('2026-10-30T12:00:00Z');
const DAY_MS = 86_400_000;

/** @param {string} root @param {Record<string, string>} files */
function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

describe('runCheckup', () => {
  /** @type {string} */
  let base;
  const previousState = process.env.AI_ESSENTIALS_STATE;

  before(() => {
    base = mkdtempSync(join(tmpdir(), 'checkup-'));
    const skill = (/** @type {string} */ name) => `---\nname: ${name}\ndescription: >-\n  Does ${name}.\n  Use when asked.\n---\n# ${name}\n`;
    writeFiles(join(base, 'repo'), {
      'skills/used/SKILL.md': skill('used'),
      'skills/idle/SKILL.md': skill('idle'),
      'skills/shared/SKILL.md': skill('shared'),
    });
    const usage = [20, 3].map((daysAgo) => JSON.stringify({ at: new Date(NOW_MS - daysAgo * DAY_MS).toISOString(), session: 's', skill: 'used', cwd: '/x' }));
    writeFiles(join(base, 'state'), { 'skill-usage.jsonl': `${usage.join('\n')}\n` });
    writeFiles(join(base, 'home', '.claude', 'projects', '-work-app', 'memory'), {
      'MEMORY.md': '# Memory Index\n\n- [Linked](linked.md): kept\n',
      'linked.md': 'linked\n',
      'orphan.md': 'never referenced\n',
    });
    process.env.AI_ESSENTIALS_STATE = join(base, 'state');
  });

  after(() => {
    if (previousState === undefined) {
      delete process.env.AI_ESSENTIALS_STATE;
    } else {
      process.env.AI_ESSENTIALS_STATE = previousState;
    }
    rmSync(base, { recursive: true, force: true });
  });

  it('flags the skill the usage log never saw and the memory file MEMORY.md never links', () => {
    const report = runCheckup({ repo: join(base, 'repo'), home: join(base, 'home'), now: NOW_MS });

    assert.equal(report.skills.logSpanDays, 20);
    assert.deepEqual(
      report.skills.usage.map(({ name, invocations }) => [name, invocations]),
      [['idle', 0], ['used', 2]],
    );
    const messages = report.findings.map((finding) => `${finding.area}: ${finding.message}`);
    assert.ok(messages.includes('skills: 1 skill(s) never invoked in 20 days: idle'), messages.join('\n'));
    assert.ok(messages.includes('memory: -work-app: 1 file(s) not linked from MEMORY.md: orphan.md'), messages.join('\n'));
    assert.ok(report.findings.every((finding) => finding.action.length > 0));
  });
});

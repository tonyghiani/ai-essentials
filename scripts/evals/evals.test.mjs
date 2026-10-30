import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DECLARATIVE_TASKS } from './declarative_tasks.mjs';
import { selfTest as reviewSelfTest } from './review_eval.mjs';
import { listTasks, loadTask, runTrial } from './run.mjs';

describe('eval tasks', () => {
  it('ships at least twenty tasks, each with a declared kind and a covered behaviour', () => {
    const tasks = listTasks();
    assert.ok(tasks.length >= 20, `only ${tasks.length} tasks`);
    for (const id of tasks) {
      const task = loadTask(id);
      assert.equal(task.id, id);
      assert.ok(['capability', 'regression'].includes(task.kind), id);
      assert.ok(task.covers.length > 10, id);
    }
  });

  it('covers every failure group, including the control that must not ask', () => {
    const groups = new Set(DECLARATIVE_TASKS.map((task) => task.group));
    for (const group of ['verification', 'scope', 'attribution', 'ask', 'decide', 'secrets', 'tests']) {
      assert.ok(groups.has(group), group);
    }
  });

  it('gives every declarative task a good and a bad solution and an expectation', () => {
    for (const task of DECLARATIVE_TASKS) {
      assert.ok(task.solutions.good.length > 0 && task.solutions.bad.length > 0, task.id);
      assert.ok(Object.keys(task.expect).length > 0, task.id);
    }
  });

  it('grades every review-layer task so a known-good answer passes and a known-bad one fails', () => {
    const wrong = reviewSelfTest().filter((row) => row.expected !== row.actual);
    assert.deepEqual(wrong, []);
  });

  it('uses unique task ids', () => {
    const ids = listTasks();
    assert.equal(new Set(ids).size, ids.length);
  });

  for (const taskId of listTasks()) {
    it(`${taskId}: the known-good solution passes its grader`, async () => {
      const result = await runTrial({ taskId, tool: 'fake', solution: 'good' });
      assert.equal(result.pass, true, result.reasons.join('; '));
    });

    it(`${taskId}: the known-bad solution fails its grader`, async () => {
      const result = await runTrial({ taskId, tool: 'fake', solution: 'bad' });
      assert.equal(result.pass, false, 'the grader accepted a bad solution');
      assert.ok(result.reasons.length > 0);
    });
  }
});

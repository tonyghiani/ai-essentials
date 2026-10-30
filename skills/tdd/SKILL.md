---
name: tdd
description: Write the failing test first, then the implementation, in Marco's testing style. Invoke when the user says "tdd", "test first", "write the test first", or when adding behaviour to code that already has tests worth extending. Opt-in; do not apply automatically.
---

# TDD loop

Opt-in only. When invoked, you do not write implementation code until a test fails for the right reason.

## The loop

**0. Is it worth a test?** Apply the test-value rule first. Behaviour that can break and that someone
cares about gets a test; a constant, config value, rename, wiring or pass-through does not, and the
right answer is to say so and skip the loop. Every test costs CI time on every run.

**1. Name the behaviour.** One sentence, declarative, third person, no "should":

> returns enabled when no state has been persisted

If you can't phrase it that way, the behaviour isn't defined yet. Go ask.

**2. Write the failing test.** Colocated `<name>.test.ts(x)` beside the source. Match the house style:

```ts
describe('OrderMaintenanceService', () => {
  describe('getState', () => {
    it('returns enabled when no state has been persisted', async () => {
      const service = makeService();
      await expect(service.getState()).resolves.toBe('enabled');
    });
  });
});
```

**3. Run it and read the failure.** This is the step people skip.

```bash
# use your project's test runner, e.g.:
npx jest <path/to/file.test.ts>
```

The test must fail because the behaviour is missing, not because of a typo, a bad import, or a mock that throws. A test that fails for the wrong reason proves nothing. If the error isn't the one you predicted, fix the test before touching the implementation.

**4. Implement the minimum** that makes it pass. No speculative extras.

**5. Run again.** Green, and no other test broke.

**6. Refactor.** Now, with the test as the safety net. Prefer deleting over abstracting.

Repeat per behaviour. Do not batch five tests then implement; the loop's value is in the failure you read at step 3.

## Testing style

Follow `marco-code-style` for the full picture. The parts that matter most here:

- **Hand-rolled stateful mock factories for services.** Build a fake that round-trips: a `Map`-backed persistence client that throws NotFound until `create`, a management API that tracks `enabled` so pause→resume actually works. JSDoc each option. `jest.mock` is for module-mocking your own hooks in component tests, and nothing else.
- **`renderHook`/`act`** for hooks, **`render`/`screen`** for components.
- Full variable names here too: `ordersClient`, not `rc`.
- **Assert concrete values**, not snapshots. `expect.objectContaining` where partial matching is honest.
- **Async via `.rejects`/`.resolves`**: `await expect(fn()).rejects.toMatchObject({ statusCode: 409 })`.
- **Negative assertions pin the contract**: `expect(service.getStatus).not.toHaveBeenCalled()` proves the guard took the cheap path.
- Shared fixtures as SCREAMING_SNAKE consts: `const REQUEST = {} as Request`.
- Fakes cast at the seam with `as unknown as T`.

## What to test

Behaviour and edge cases, not the happy path. The cases that earn their keep:

- Idempotency, and retry after a partial failure
- Missing or disabled dependency
- Out-of-band mutation between reads
- Boundaries, exactly: 299ms then +1ms, empty collection, inverted range
- The error path, including which error type surfaces

## What not to do

- Never write a test that asserts a config value, constant or default against a copy of it.
- Never write a test that mirrors the implementation: the same formula for the expected value, a mock
  asserted with exactly the arguments the code passes.
- Never add a second test through the same path with different data. One table-driven test, or none.
- Never pick an integration or end-to-end test where a unit test fails for the same reason.
- Never write a test that asserts implementation detail so it passes.
- Never delete, skip, or comment out a test to get green. Fix the code.
- Never leave a test that would pass with the implementation deleted.
- No `@ts-expect-error` in tests to dodge a type problem the fake should solve.

## Report

State each behaviour, whether the test failed for the predicted reason, and the final run output. If any step was skipped, say which.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isEven } = require('./a.js');

test('detects even numbers', () => {
  assert.equal(isEven(4), true);
  assert.equal(isEven(3), false);
});

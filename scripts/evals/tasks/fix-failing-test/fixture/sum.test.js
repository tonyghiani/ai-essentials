const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sum } = require('./sum.js');

test('adds two numbers', () => {
  assert.equal(sum(2, 3), 5);
});

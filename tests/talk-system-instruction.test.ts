import test, { describe, it } from 'node:test';
import assert from 'node:assert';
const { getSystemInstructions } = require('../ai/talk');

describe('System Instructions Dynamic Date Tests', () => {
  it('should include the current year, month, and day in system instructions', () => {
    const instructions = getSystemInstructions();
    const today = new Date();
    const yearStr = String(today.getFullYear());
    const monthStr = String(today.getMonth() + 1);
    const dateStr = String(today.getDate());

    assert.ok(instructions.includes(yearStr), `Should contain year: ${yearStr}`);
    assert.ok(instructions.includes(monthStr), `Should contain month: ${monthStr}`);
    assert.ok(instructions.includes(dateStr), `Should contain date: ${dateStr}`);
    assert.ok(instructions.includes('현재 시간'), 'Should contain "현재 시간" text');
  });
});

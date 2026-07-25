import test, { describe, it } from 'node:test';
import assert from 'node:assert';
const { resetModelIndex, getAiModelIndex, scheduleDaily16Reset } = require('../ai/talk');

describe('AI Model Reset Tests', () => {
  it('resetModelIndex는 ai.index를 0으로 초기화해야 함', () => {
    assert.strictEqual(typeof resetModelIndex, 'function');
    assert.strictEqual(typeof getAiModelIndex, 'function');
    
    resetModelIndex();
    assert.strictEqual(getAiModelIndex(), 0);
  });

  it('scheduleDaily16Reset 함수가 정상적으로 타이머 객체 또는 null을 반환/등록해야 함', () => {
    assert.strictEqual(typeof scheduleDaily16Reset, 'function');
    const timer = scheduleDaily16Reset();
    if (timer && timer.timeout) {
      clearTimeout(timer.timeout);
      if (timer.interval) clearInterval(timer.interval);
    }
  });
});

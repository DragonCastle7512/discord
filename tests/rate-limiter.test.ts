import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import { RateLimiter } from '../common/rate-limiter';

describe('RateLimiter Tests', () => {
  it('should block execution when limit is exceeded within window', () => {
    // 3초 내 최대 2회 제한 설정
    const limiter = new RateLimiter(3000, 2);
    
    assert.strictEqual(limiter.checkLimit('user1').blocked, false);
    assert.strictEqual(limiter.checkLimit('user1').blocked, false);
    
    const check3 = limiter.checkLimit('user1');
    assert.strictEqual(check3.blocked, true);
    assert.ok(check3.retryAfterMs > 0);
  });

  it('should allow execution after window slides', async () => {
    // 1초 내 최대 1회 제한
    const limiter = new RateLimiter(1000, 1);
    
    assert.strictEqual(limiter.checkLimit('user2').blocked, false);
    assert.strictEqual(limiter.checkLimit('user2').blocked, true);

    // Wait 1.1s
    await new Promise(resolve => setTimeout(resolve, 1100));

    assert.strictEqual(limiter.checkLimit('user2').blocked, false);
  });
});

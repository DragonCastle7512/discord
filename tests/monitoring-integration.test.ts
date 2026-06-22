import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import { Logger } from '../common/logger';
import { RateLimiter } from '../common/rate-limiter';
import path from 'node:path';
import fs from 'node:fs';

describe('Monitoring Integration Tests', () => {
  const tempLog = path.join(__dirname, '../logs-test/integration.log');

  it('should block spammers and log security warnings', () => {
    const logger = new Logger(tempLog);
    const limiter = new RateLimiter(5000, 1); // 5s에 1회 제한
    
    // First attempt: OK
    const check1 = limiter.checkLimit('spammer_id');
    assert.strictEqual(check1.blocked, false);
    logger.info('command', 'Command executed', { userId: 'spammer_id' });

    // Second attempt: Blocked
    const check2 = limiter.checkLimit('spammer_id');
    assert.strictEqual(check2.blocked, true);
    logger.warn('security', 'Command rate limited', { userId: 'spammer_id', retryAfterMs: check2.retryAfterMs });

    // Verify logs
    const lines = fs.readFileSync(tempLog, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 2);

    const log1 = JSON.parse(lines[0]);
    assert.strictEqual(log1.level, 'INFO');
    assert.strictEqual(log1.category, 'command');

    const log2 = JSON.parse(lines[1]);
    assert.strictEqual(log2.level, 'WARN');
    assert.strictEqual(log2.category, 'security');
    assert.strictEqual(log2.metadata.userId, 'spammer_id');

    // Cleanup
    fs.rmSync(path.dirname(tempLog), { recursive: true, force: true });
  });
});

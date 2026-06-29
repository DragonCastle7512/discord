import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Logger, sentryWrapper } from '../common/logger';

describe('Logger Tests', () => {
  const logDir = path.join(__dirname, '../logs-test');
  const logFile = path.join(logDir, 'app.log');

  before(() => {
    if (fs.existsSync(logDir)) {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  after(() => {
    if (fs.existsSync(logDir)) {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('should create log directory and log JSON objects', () => {
    const logger = new Logger(logFile, 1024 * 10); // 10KB limit for testing
    logger.info('music', 'Song start test', { title: 'Test Song' });

    assert.ok(fs.existsSync(logFile));
    const content = fs.readFileSync(logFile, 'utf8').trim();
    const lines = content.split('\n');
    const parsed = JSON.parse(lines[lines.length - 1]);

    assert.strictEqual(parsed.level, 'INFO');
    assert.strictEqual(parsed.category, 'music');
    assert.strictEqual(parsed.message, 'Song start test');
    assert.strictEqual(parsed.metadata.title, 'Test Song');
  });

  it('should rotate log file when limit is exceeded', () => {
    const logger = new Logger(logFile, 100); // Very low limit for testing
    
    // Write enough data to exceed 100 bytes
    logger.info('system', 'First long message to trigger rotation test');
    logger.info('system', 'Second message');

    assert.ok(fs.existsSync(logFile));
    assert.ok(fs.existsSync(logFile + '.old'));
  });

  it('should log music category messages successfully', () => {
    const logger = new Logger(logFile, 1024 * 10);
    logger.info('music', 'Started playing track: IU - LILAC', {
      guildId: '123456789',
      trackTitle: 'IU - LILAC',
      trackUri: 'https://youtube.com/watch?v=mock',
      requestedBy: 'user-1',
      durationMs: 200000
    });

    const content = fs.readFileSync(logFile, 'utf8').trim();
    const lines = content.split('\n');
    const parsed = JSON.parse(lines[lines.length - 1]);

    assert.strictEqual(parsed.category, 'music');
    assert.strictEqual(parsed.metadata.trackTitle, 'IU - LILAC');
  });

  it('should log recommend info successfully', () => {
    const logger = new Logger(logFile, 1024 * 10);
    logger.info('music', 'Generated recommendations for guild 123456789', {
      guildId: '123456789',
      userId: 'user-123',
      requestedCount: 5,
      recommendedCount: 3,
      usedKeywords: ['k-pop', 'indie'],
    });

    const content = fs.readFileSync(logFile, 'utf8').trim();
    const lines = content.split('\n');
    const parsed = JSON.parse(lines[lines.length - 1]);

    assert.strictEqual(parsed.category, 'music');
    assert.strictEqual(parsed.metadata.userId, 'user-123');
    assert.strictEqual(parsed.metadata.recommendedCount, 3);
  });

  it('should call Sentry captureMessage when warning level is logged and SENTRY_DSN is set', (t) => {
    // Temporarily mock SENTRY_DSN
    const originalDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://mock@sentry.io/123';

    // Mock Sentry methods
    const captureMessageMock = t.mock.method(sentryWrapper, 'captureMessage', () => 'mock-id');
    
    const logger = new Logger(logFile, 1024 * 10);
    logger.warn('music', 'Recommendation issue warning', { issue: 'slow response' });

    assert.strictEqual(captureMessageMock.mock.callCount(), 1);
    const firstCall = captureMessageMock.mock.calls[0];
    assert.strictEqual(firstCall.arguments[0], 'Recommendation issue warning');
    assert.strictEqual(firstCall.arguments[1].level, 'warning');
    assert.strictEqual(firstCall.arguments[1].tags.category, 'music');
    assert.deepStrictEqual(firstCall.arguments[1].extra, { issue: 'slow response' });

    // Restore env
    process.env.SENTRY_DSN = originalDsn;
  });

  it('should call Sentry captureException when error level with error metadata is logged and SENTRY_DSN is set', (t) => {
    const originalDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://mock@sentry.io/123';

    const captureExceptionMock = t.mock.method(sentryWrapper, 'captureException', () => 'mock-id');
    
    const logger = new Logger(logFile, 1024 * 10);
    const mockError = new Error('Database connection failed');
    logger.error('system', 'DB connection error message', { error: mockError });

    assert.strictEqual(captureExceptionMock.mock.callCount(), 1);
    const firstCall = captureExceptionMock.mock.calls[0];
    assert.strictEqual(firstCall.arguments[0], mockError);
    assert.strictEqual(firstCall.arguments[1].tags.category, 'system');

    process.env.SENTRY_DSN = originalDsn;
  });
});

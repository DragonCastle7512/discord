import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '../common/logger';

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
});

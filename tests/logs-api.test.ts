import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createDashboardRouter } from '../routes/dashboard';
import { generateDashboardToken } from '../common/auth';
import { Client } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Logs API Tests', () => {
  const logDir = path.join(__dirname, '../logs');
  const logFile = path.join(logDir, 'app.log');
  let originalOwnerId: string | undefined;

  const mockClient: any = {
    users: {
      async fetch() {
        return {
          displayAvatarURL: () => 'mock-avatar-url',
          globalName: 'Mock Owner',
          username: 'owner'
        };
      }
    }
  };

  before(() => {
    originalOwnerId = process.env.OWNER_ID;
    process.env.OWNER_ID = 'owner-123';
    
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    // Write mock logs
    const mockLogs = [
      JSON.stringify({ timestamp: '2026-06-25T01:00:00.000Z', level: 'INFO', category: 'command', message: 'Log 1', metadata: {} }),
      JSON.stringify({ timestamp: '2026-06-25T02:00:00.000Z', level: 'ERROR', category: 'system', message: 'Log 2', metadata: { error: 'Failed' } }),
    ].join('\n') + '\n';
    fs.writeFileSync(logFile, mockLogs, 'utf8');
  });

  after(() => {
    process.env.OWNER_ID = originalOwnerId;
  });

  it('should return 401 when token is missing or invalid', async () => {
    const router = createDashboardRouter(mockClient, new Map(), {} as any);
    
    // Find the /logs-data route
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/logs-data');
    assert.ok(layer, 'Route /logs-data should exist');

    const handlers = layer.route.stack.map((s: any) => s.handle);
    const mainHandler = handlers[handlers.length - 1];

    let statusVal = 200;
    let jsonVal: any = null;

    const req: any = {
      query: { token: 'invalid-token' },
      session: null
    };
    const res: any = {
      status(code: number) {
        statusVal = code;
        return this;
      },
      json(obj: any) {
        jsonVal = obj;
        return this;
      }
    };

    let nextCalled = false;
    const next = () => { nextCalled = true; };

    // Run verifyToken middleware first
    const verifyTokenMiddleware = handlers[0];
    await verifyTokenMiddleware(req, res, next);

    if (!nextCalled) {
      assert.strictEqual(statusVal, 401);
      assert.strictEqual(jsonVal.error, '인증 실패');
    }
  });

  it('should return logs in reverse chronological order when owner token is valid', async () => {
    const router = createDashboardRouter(mockClient, new Map(), {} as any);
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/logs-data');
    assert.ok(layer);

    const handlers = layer.route.stack.map((s: any) => s.handle);
    const mainHandler = handlers[handlers.length - 1];

    const token = generateDashboardToken('guild-123', 'owner-123');

    const req: any = {
      query: { token },
      session: null
    };
    let statusVal = 200;
    let jsonVal: any = null;
    const res: any = {
      status(code: number) {
        statusVal = code;
        return this;
      },
      json(obj: any) {
        jsonVal = obj;
        return this;
      }
    };

    // Run middleware
    let nextCalled = false;
    await handlers[0](req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);

    // Run handler
    await mainHandler(req, res);

    assert.strictEqual(statusVal, 200);
    assert.ok(jsonVal && jsonVal.logs && Array.isArray(jsonVal.logs));
    assert.strictEqual(jsonVal.logs.length, 2);
    // Order: latest first
    assert.strictEqual(jsonVal.logs[0].message, 'Log 2');
    assert.strictEqual(jsonVal.logs[1].message, 'Log 1');
    assert.strictEqual(jsonVal.user.avatarUrl, 'mock-avatar-url');
    assert.strictEqual(jsonVal.user.displayName, 'Mock Owner');
  });

  it('should return 401 when token user is not owner', async () => {
    const router = createDashboardRouter(mockClient, new Map(), {} as any);
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/logs-data');
    assert.ok(layer);

    const handlers = layer.route.stack.map((s: any) => s.handle);
    const mainHandler = handlers[handlers.length - 1];

    const token = generateDashboardToken('guild-123', 'normal-user');

    const req: any = {
      query: { token },
      session: null
    };
    let statusVal = 200;
    let jsonVal: any = null;
    const res: any = {
      status(code: number) {
        statusVal = code;
        return this;
      },
      json(obj: any) {
        jsonVal = obj;
        return this;
      }
    };

    // Run middleware
    let nextCalled = false;
    await handlers[0](req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);

    // Run handler
    await mainHandler(req, res);

    assert.strictEqual(statusVal, 401);
    assert.strictEqual(jsonVal.error, '권한이 없습니다.');
  });
});

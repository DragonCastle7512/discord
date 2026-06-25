import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createSystemRouter } from '../routes/system';
import { generateDashboardToken } from '../common/auth';

describe('Logs Route Tests', () => {
  let originalOwnerId: string | undefined;

  before(() => {
    originalOwnerId = process.env.OWNER_ID;
    process.env.OWNER_ID = 'owner-123';
  });

  after(() => {
    process.env.OWNER_ID = originalOwnerId;
  });

  it('should serve logs.html on GET /admin/:token with a valid owner token', async () => {
    const router = createSystemRouter();
    
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/admin/:token');
    assert.ok(layer, 'Route /admin/:token should exist');

    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    
    const token = generateDashboardToken('guild-123', 'owner-123');
    let sentFile: string | null = null;
    const req: any = { params: { token } };
    const res: any = {
      sendFile(filePath: string) {
        sentFile = filePath;
      }
    };

    await handler(req, res);
    assert.ok(sentFile);
    assert.ok(sentFile.includes('public') && sentFile.includes('logs.html'));
  });

  it('should serve 404.html and return 404 on GET /admin/:token with an invalid token', async () => {
    const router = createSystemRouter();
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/admin/:token');
    assert.ok(layer);

    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    
    let sentFile: string | null = null;
    let statusVal = 200;
    const req: any = { params: { token: 'invalid-token' } };
    const res: any = {
      status(code: number) {
        statusVal = code;
        return this;
      },
      sendFile(filePath: string) {
        sentFile = filePath;
      }
    };

    await handler(req, res);
    assert.strictEqual(statusVal, 404);
    assert.ok(sentFile);
    assert.ok(sentFile.includes('public') && sentFile.includes('404.html'));
  });
});

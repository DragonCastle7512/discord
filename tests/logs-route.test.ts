import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSystemRouter } from '../routes/system';

describe('Logs Route Tests', () => {
  it('should serve logs.html on GET /admin/:token', async () => {
    const router = createSystemRouter();
    
    // Find the /admin/:token route
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/admin/:token');
    assert.ok(layer, 'Route /admin/:token should exist');

    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    
    let sentFile: string | null = null;
    const req: any = {};
    const res: any = {
      sendFile(filePath: string) {
        sentFile = filePath;
      }
    };

    await handler(req, res);
    assert.ok(sentFile);
    assert.ok(sentFile.includes('public') && sentFile.includes('logs.html'));
  });
});

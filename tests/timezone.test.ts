import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('index.ts should set process.env.TZ to Asia/Seoul at the very beginning', () => {
  const indexPath = path.join(__dirname, '../index.ts');
  const content = fs.readFileSync(indexPath, 'utf8');
  const hasTimezoneSetting = content.includes("process.env.TZ = 'Asia/Seoul'");
  assert.strictEqual(hasTimezoneSetting, true, "index.ts must contain process.env.TZ = 'Asia/Seoul'");
});


import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';

// Require the logs command (since it is a CommonJS module)
const logsCommand = require('../commands/utitlity/logs.js');

describe('Logs Command Tests', () => {
  let originalOwnerId: string | undefined;
  const tempLogPath = path.join(__dirname, '../logs/app.log');

  before(() => {
    originalOwnerId = process.env.OWNER_ID;
    process.env.OWNER_ID = 'owner-123';
    
    // Ensure logs directory and file exist
    const logDir = path.dirname(tempLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    if (!fs.existsSync(tempLogPath)) {
      fs.writeFileSync(tempLogPath, 'mock log line', 'utf8');
    }
  });

  after(() => {
    process.env.OWNER_ID = originalOwnerId;
  });

  it('should block non-owners', async () => {
    let repliedContent = '';
    let isEphemeral = false;

    const interaction: any = {
      user: { id: 'other-user' },
      guildId: 'guild-123',
      isChatInputCommand: () => true,
      options: {
        getString: (name: string) => 'link'
      },
      reply: async (options: any) => {
        repliedContent = options.content;
        isEphemeral = options.ephemeral;
        return {};
      }
    };

    await logsCommand.execute(interaction);
    assert.strictEqual(repliedContent, '이 명령어를 사용할 권한이 없습니다.');
    assert.strictEqual(isEphemeral, true);
  });

  it('should return web link when output is link', async () => {
    let repliedContent = '';
    let isEphemeral = false;

    const interaction: any = {
      user: { id: 'owner-123' },
      guildId: 'guild-123',
      isChatInputCommand: () => true,
      options: {
        getString: (name: string) => 'link'
      },
      reply: async (options: any) => {
        repliedContent = options.content;
        isEphemeral = options.ephemeral;
        return {};
      }
    };

    await logsCommand.execute(interaction);
    assert.ok(repliedContent.includes('로그 확인 페이지 링크예요'));
    assert.ok(repliedContent.includes('/logs?token='));
    assert.strictEqual(isEphemeral, true);
  });

  it('should return file attachment when output is file', async () => {
    let repliedContent = '';
    let files: any[] = [];
    let isEphemeral = false;

    const interaction: any = {
      user: { id: 'owner-123' },
      guildId: 'guild-123',
      isChatInputCommand: () => true,
      options: {
        getString: (name: string) => 'file'
      },
      reply: async (options: any) => {
        repliedContent = options.content;
        files = options.files || [];
        isEphemeral = options.ephemeral;
        return {};
      }
    };

    await logsCommand.execute(interaction);
    assert.strictEqual(repliedContent, '최신 로그 파일입니다.');
    assert.strictEqual(files.length, 1);
    assert.strictEqual(isEphemeral, true);
  });
});

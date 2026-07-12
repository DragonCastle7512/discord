import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createDashboardRouter } from '../routes/dashboard';
import { GuildConfig } from '../music/models/guild-config';
import { initDb } from '../db/init';
import { sequelize } from '../db/sequelize';
import { generateDashboardToken } from '../common/auth';

describe('Dashboard Play Music Route Integration', () => {
  before(async () => {
    await initDb();
  });

  after(async () => {
    await sequelize.close();
  });

  it('should pass correct channelId when DB configuration is present', async () => {
    const guildId = 'guild-dashboard-test';
    const musicChannelId = 'dashboard-notif-channel-888';
    
    // DB 설정 추가
    const existingConfig = await GuildConfig.findOne({ where: { guildId } });
    if (existingConfig) {
      await existingConfig.update({ musicChannelId });
    } else {
      await GuildConfig.create({ guildId, musicChannelId });
    }

    const token = generateDashboardToken(guildId, 'user-dashboard-test');

    let passedContext: any = null;
    
    // Mock music runtime
    const mockMusic = {
      play: async (context: any, url: string) => {
        passedContext = context;
        return { ok: true, message: 'playing' };
      },
      getQueueSnapshot: () => ({ queue: [], current: null }),
    };

    const mockClient: any = {
      guilds: {
        fetch: async () => ({
          members: {
            fetch: async () => ({
              user: { id: 'user-dashboard-test' },
              voice: { channelId: 'default-voice-channel-id' }
            })
          }
        })
      }
    };

    const router = createDashboardRouter(mockClient, new Map(), mockMusic as any);

    // Find the handler for POST /play-music
    const layer = router.stack.find((l: any) => l.route?.path === '/play-music');
    assert.ok(layer, '/play-music route should be registered');
    
    const handler = layer.route.stack[0].handle;

    const req: any = {
      body: {
        token,
        url: 'https://youtube.com/watch?v=123'
      }
    };

    let responseJson: any = null;
    const res: any = {
      json: (data: any) => {
        responseJson = data;
      },
      status: (code: number) => {
        return res;
      }
    };

    await handler(req, res);

    assert.ok(responseJson);
    assert.ok(passedContext);
    assert.strictEqual(passedContext.channelId, 'dashboard-notif-channel-888');

    // Clean up
    await GuildConfig.destroy({ where: { guildId } });
  });
});

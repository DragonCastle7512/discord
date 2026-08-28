export interface VirtualGuild {
  id: string;
  name: string;
  channelId: string;
  voiceChannelId: string;
}

export interface MockContext {
  guild: {
    id: string;
    name: string;
    client: {
      user: {
        id: string;
      };
    };
    members: {
      fetch: (id: string) => Promise<any>;
    };
  };
  channelId: string;
  member: {
    voice: {
      channel: {
        id: string;
        name: string;
      };
    };
  };
  user: {
    id: string;
    username: string;
  };
  author: {
    id: string;
    username: string;
  };
  isAi: boolean;
}

export class VirtualGuildManager {
  private activeGuilds: Map<string, VirtualGuild> = new Map();

  createVirtualGuild(index: number): VirtualGuild {
    const id = `mock-bench-guild-${index}`;
    const guild: VirtualGuild = {
      id,
      name: `Mock Benchmark Guild ${index}`,
      channelId: `mock-text-chan-${index}`,
      voiceChannelId: `mock-voice-chan-${index}`,
    };
    this.activeGuilds.set(id, guild);
    return guild;
  }

  createMockContext(guild: VirtualGuild): MockContext {
    const mockMember = {
      voice: {
        channel: {
          id: guild.voiceChannelId,
          name: `Voice ${guild.name}`,
        },
      },
    };

    return {
      guild: {
        id: guild.id,
        name: guild.name,
        client: {
          user: {
            id: 'mock-bot-id',
          },
        },
        members: {
          fetch: async () => mockMember,
        },
      },
      channelId: guild.channelId,
      member: mockMember,
      user: {
        id: 'mock-bench-user',
        username: 'BenchmarkTester',
      },
      author: {
        id: 'mock-bench-user',
        username: 'BenchmarkTester',
      },
      isAi: false,
    };
  }

  getActiveGuilds(): VirtualGuild[] {
    return Array.from(this.activeGuilds.values());
  }

  removeGuild(id: string): void {
    this.activeGuilds.delete(id);
  }

  clear(): void {
    this.activeGuilds.clear();
  }
}

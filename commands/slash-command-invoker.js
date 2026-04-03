function normalizeReplyPayload(payload) {
  if (typeof payload === 'string') {
    return { content: payload };
  }
  if (!payload || typeof payload !== 'object') {
    return { content: '' };
  }

  const next = { ...payload };
  delete next.ephemeral;
  delete next.fetchReply;
  return next;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

function createOptionsResolver(options) {
  const raw = (options && typeof options === 'object') ? options : {};
    const normalizeUserId = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'object' && value.id) {
      return String(value.id);
    }

    const text = String(value).trim();
    if (!text) return null;
    const mention = /^<@!?(\d+)>$/.exec(text);
    if (mention) return mention[1];
    if (/^\d+$/.test(text)) return text;
    return null;
  };

  return {
    getString(name) {
      const value = raw[name];
      if (value === undefined || value === null) return null;
      return String(value);
    },
    getBoolean(name, required = false) {
      const value = raw[name];
      if (value === undefined || value === null) {
        if (required) {
          throw new Error(`Missing required boolean option: ${name}`);
        }
        return null;
      }
      const parsed = parseBoolean(value);
      if (parsed === null) {
        throw new Error(`Invalid boolean option: ${name}`);
      }
      return parsed;
    },
    getUser(name) {
      const id = normalizeUserId(raw[name]);
      if (!id) return null;
      return { id };
    },
  };
}

function createSyntheticInteraction(message, options) {
  const interaction = {
    client: message.client,
    guild: message.guild,
    guildId: message.guildId,
    channel: message.channel,
    channelId: message.channelId,
    user: message.author,
    member: message.member,
    options: createOptionsResolver(options),
    deferred: false,
    replied: false,
    _replyMessage: null,
    isRepliable() {
      return Boolean(this.channel);
    },
    async deferReply() {
      this.deferred = true;
    },
    async reply(payload) {
      if (!this.channel || typeof this.channel.send !== 'function') {
        throw new Error('Current channel cannot send messages.');
      }
      const normalized = normalizeReplyPayload(payload);
      const sent = await this.channel.send(normalized);
      this.replied = true;
      this._replyMessage = sent;
      return sent;
    },
    async editReply(payload) {
      const normalized = normalizeReplyPayload(payload);
      if (this._replyMessage) {
        this._replyMessage = await this._replyMessage.edit(normalized);
        return this._replyMessage;
      }
      return this.reply(normalized);
    },
    async deleteReply() {
      if (!this._replyMessage || typeof this._replyMessage.delete !== 'function') {
        return;
      }
      await this._replyMessage.delete();
      this._replyMessage = null;
    },
  };

  return interaction;
}

function summarizeReply(replyMessage) {
  if (!replyMessage) {
    return 'Command executed (no direct reply message).';
  }

  const content = (replyMessage.content || '').trim();
  const embedCount = Array.isArray(replyMessage.embeds) ? replyMessage.embeds.length : 0;
  if (content) {
    return content;
  }
  if (embedCount > 0) {
    return `Command executed with ${embedCount} embed(s).`;
  }
  return 'Command executed.';
}

function createSlashCommandInvoker({ commands, context }) {
  return {
    async executeFromMessage(message, commandName, options = {}) {
      const normalizedName = String(commandName || '').trim().toLowerCase();
      if (!normalizedName) {
        return { ok: false, message: 'Command name is required.' };
      }

      const command = commands.get(normalizedName);
      if (!command || typeof command.execute !== 'function') {
        return { ok: false, message: `Unknown slash command: ${normalizedName}` };
      }

      const interaction = createSyntheticInteraction(message, options);
      await command.execute(interaction, context);
      return {
        ok: true,
        message: summarizeReply(interaction._replyMessage),
      };
    },
    listCommands() {
      return [...commands.keys()];
    },
  };
}

module.exports = {
  createSlashCommandInvoker,
};

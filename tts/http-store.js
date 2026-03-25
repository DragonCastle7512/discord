const { randomUUID } = require('node:crypto');

function createTtsHttpStore({ baseUrl, ttlMs = 5 * 60 * 1000 }) {
  const entries = new Map();

  function cleanupExpired() {
    const now = Date.now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(id);
      }
    }
  }

  function put(buffer, contentType = 'audio/wav') {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return null;
    }

    const id = randomUUID();
    entries.set(id, {
      buffer,
      contentType,
      expiresAt: Date.now() + ttlMs,
    });

    return `${baseUrl}/tts/${id}.wav`;
  }

  function get(id) {
    const entry = entries.get(id);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      entries.delete(id);
      return null;
    }

    return entry;
  }

  setInterval(cleanupExpired, 60 * 1000).unref();

  return {
    put,
    get,
  };
}

module.exports = { createTtsHttpStore };

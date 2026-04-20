import { Server } from 'socket.io';
import { Server as HttpServer } from 'node:http';

let io: Server | null = null;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  io.on('connection', (socket) => {
    const guildId = socket.handshake.query.guildId as string;
    const userId = socket.handshake.query.userId as string;
    if (guildId) {
      socket.join(`guild:${guildId}`);
    }
    if (userId) {
      socket.join(`user:${userId}`);
    }
  });

  return io;
}

export function notifyMusicUpdate(id: string, type: 'music' | 'queue' | 'playlist' | 'all' = 'all') {
  if (!io) return;
  io.to(`guild:${id}`).to(`user:${id}`).emit('musicUpdate', { type });
}

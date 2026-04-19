import { Server } from 'socket.io';
import { Server as HttpServer } from 'node:http';

let io: Server | null = null;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  io.on('connection', (socket) => {
    const guildId = socket.handshake.query.guildId as string;
    if (guildId) {
      socket.join(`guild:${guildId}`);
      // console.log(`[Socket] Client joined guild room: ${guildId}`);
    }
  });

  return io;
}

export function notifyMusicUpdate(guildId: string) {
  if (!io) return;
  io.to(`guild:${guildId}`).emit('musicUpdate');
}

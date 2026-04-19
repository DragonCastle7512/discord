import { randomUUID } from 'node:crypto';

interface DashboardSession {
  guildId: string;
  userId: string;
  expiresAt: number;
}

const sessions = new Map<string, DashboardSession>();
const SESSION_DURATION = 1000 * 60 * 60 * 1; //1시간

/**
 * 대시보드용 보안 토큰을 생성합니다.
 */
export function generateDashboardToken(guildId: string, userId: string): string {
  const token = randomUUID();
  sessions.set(token, {
    guildId,
    userId,
    expiresAt: Date.now() + SESSION_DURATION
  });
  
  setTimeout(() => sessions.delete(token), SESSION_DURATION);
  
  return token;
}

/**
 * 토큰을 검증하고 세션 정보를 반환합니다.
 */
export function verifyDashboardToken(token: string): DashboardSession | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session;
}

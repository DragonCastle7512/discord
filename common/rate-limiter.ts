export class RateLimiter {
  private windowMs: number;
  private maxAttempts: number;
  private cache = new Map<string, number[]>();

  constructor(windowMs: number, maxAttempts: number) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
  }

  checkLimit(key: string): { blocked: boolean; retryAfterMs: number } {
    const now = Date.now();
    const timestamps = this.cache.get(key) || [];
    
    // Filter timestamps inside window
    const activeTimestamps = timestamps.filter(t => now - t < this.windowMs);
    
    if (activeTimestamps.length >= this.maxAttempts) {
      const oldestActive = activeTimestamps[0];
      const retryAfterMs = this.windowMs - (now - oldestActive);
      return { blocked: true, retryAfterMs };
    }

    activeTimestamps.push(now);
    this.cache.set(key, activeTimestamps);
    return { blocked: false, retryAfterMs: 0 };
  }
}

// Default instances
export const commandRateLimiter = new RateLimiter(10_000, 5); // 10s에 5회
export const aiRateLimiter = new RateLimiter(30_000, 3);      // 30s에 3회

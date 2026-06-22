import fs from 'node:fs';
import path from 'node:path';

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  category: 'command' | 'ai' | 'system' | 'security';
  message: string;
  metadata?: Record<string, any>;
}

export class Logger {
  private logFilePath: string;
  private maxSizeBytes: number;

  constructor(logFilePath: string = path.join(__dirname, '../logs/app.log'), maxSizeBytes: number = 10 * 1024 * 1024) {
    this.logFilePath = logFilePath;
    this.maxSizeBytes = maxSizeBytes;
    this.ensureDirExists();
  }

  private ensureDirExists() {
    const dir = path.dirname(this.logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private write(level: LogEntry['level'], category: LogEntry['category'], message: string, metadata?: Record<string, any>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      metadata,
    };

    const line = JSON.stringify(entry) + '\n';
    
    try {
      this.rotateIfNeeded(Buffer.byteLength(line));
      fs.appendFileSync(this.logFilePath, line, 'utf8');
      
      // Console output
      const colorMap = { INFO: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m' };
      const reset = '\x1b[0m';
      console.log(`${colorMap[level] || ''}[${entry.timestamp}] [${level}] [${category}] ${message}${reset}`);
    } catch (err) {
      console.error('Failed to write log:', err);
    }
  }

  private rotateIfNeeded(incomingBytes: number) {
    if (!fs.existsSync(this.logFilePath)) return;
    try {
      const stats = fs.statSync(this.logFilePath);
      if (stats.size + incomingBytes > this.maxSizeBytes) {
        const oldPath = this.logFilePath + '.old';
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
        fs.renameSync(this.logFilePath, oldPath);
      }
    } catch (err) {
      console.error('Log rotation failed:', err);
    }
  }

  info(category: LogEntry['category'], message: string, metadata?: Record<string, any>) {
    this.write('INFO', category, message, metadata);
  }

  warn(category: LogEntry['category'], message: string, metadata?: Record<string, any>) {
    this.write('WARN', category, message, metadata);
  }

  error(category: LogEntry['category'], message: string, metadata?: Record<string, any>) {
    this.write('ERROR', category, message, metadata);
  }
}

export const logger = new Logger();

// @ts-ignore
import { Router, Request, Response } from 'express';
import path from 'node:path';
import { HealthResponse } from './types';
import { verifyDashboardToken } from '../common/auth';

export function createSystemRouter(): Router {
  const router = Router();

  router.get('/intro', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  router.get('/health', (req: Request, res: Response) => {
    const response: HealthResponse = {
      ok: true,
      timestamp: Date.now()
    };
    res.json(response);
  });

  router.get('/dashboard', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public/dashboard/dashboard.html'));
  });

  router.get('/admin/:token', (req: Request, res: Response) => {
    const token = req.params.token;
    const session = verifyDashboardToken(token);
    if (!session || session.userId !== process.env.OWNER_ID) {
      res.status(404).sendFile(path.join(__dirname, '../public/error/404.html'));
      return;
    }
    res.sendFile(path.join(__dirname, '../public/logs/logs.html'));
  });

  return router;
}

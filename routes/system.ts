// @ts-ignore
import { Router, Request, Response } from 'express';
import path from 'node:path';
import { HealthResponse } from './types';

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

  return router;
}

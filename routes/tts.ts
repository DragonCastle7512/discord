// @ts-ignore
import { Router, Request, Response } from 'express';
import path from 'node:path';

export function createTtsRouter(ttsHttpStore: any): Router {
  const router = Router();

  router.get('/:id.wav', (req: Request, res: Response) => {
    const entry = ttsHttpStore.get(req.params.id);
    if (!entry) {
      res.status(404).sendFile(path.join(__dirname, '../public/error/404.html'));
      return;
    }
    res.set('Content-Type', entry.contentType);
    res.set('Cache-Control', 'no-store');
    res.send(entry.buffer);
  });

  return router;
}

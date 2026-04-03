import { resolvePersonMobileToken } from '@monitor/core';
import type { Request, Response, NextFunction } from 'express';

const HEADER_NAME = 'x-pmeow-person-token';

export function personMobileAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers[HEADER_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: '需要个人移动令牌' });
    return;
  }

  const record = resolvePersonMobileToken(token);
  if (!record) {
    res.status(401).json({ error: '令牌无效或已撤销' });
    return;
  }

  (req as any).personId = record.personId;
  (req as any).personTokenId = record.id;
  next();
}

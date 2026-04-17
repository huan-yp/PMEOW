import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import { getSettings, saveSetting } from '@monitor/core';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'monitor_' + Date.now().toString(36);
const TOKEN_EXPIRES_IN = '30d';

export function hashPassword(plain: string): string {
  return bcryptjs.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hashed: string): boolean {
  return bcryptjs.compareSync(plain, hashed);
}

export function signToken(payload: Record<string, unknown> = {}): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

export function verifyToken(token: string): Record<string, unknown> | null {
  try {
    return jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Login handler */
export function loginHandler(req: Request, res: Response): void {
  const { password } = req.body ?? {};
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: '请提供密码' });
    return;
  }

  const settings = getSettings();

  // If no password is set yet, treat this as first-time setup
  if (!settings.password) {
    const hash = hashPassword(password);
    saveSetting('password', hash);
    const token = signToken({ role: 'admin' });
    res.json({ token });
    return;
  }

  if (!verifyPassword(password, settings.password)) {
    res.status(401).json({ error: '密码错误' });
    return;
  }

  const token = signToken({ role: 'admin' });
  res.json({ token });
}

/** JWT auth middleware */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未认证' });
    return;
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: 'Token 无效或已过期' });
    return;
  }
  (req as any).user = payload;
  next();
}

/** Socket.IO auth middleware */
export function socketAuthMiddleware(socket: any, next: (err?: Error) => void): void {
  const token = socket.handshake.auth?.token;
  if (!token) {
    console.warn(`[ws-auth] rejected socket ${socket.id}: missing token`);
    return next(new Error('未认证'));
  }
  const payload = verifyToken(token);
  if (!payload) {
    console.warn(`[ws-auth] rejected socket ${socket.id}: invalid token`);
    return next(new Error('Token 无效'));
  }
  socket.data.user = payload;
  console.info(`[ws-auth] accepted socket ${socket.id}: role=${String(payload.role ?? 'unknown')}`);
  next();
}

import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import { getAccessibleServerIds, getSettings, saveSetting, verifyPersonToken, getPersonById } from '@monitor/core';
import type { Principal } from '@monitor/core';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'monitor_' + Date.now().toString(36);
const TOKEN_EXPIRES_IN = '30d';

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

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

export interface SessionResponse {
  authenticated: true;
  principal: Principal;
  person: ReturnType<typeof getPersonById> | null;
  accessibleServerIds: string[] | null;
}

export function buildSessionResponse(principal: Principal): SessionResponse {
  return {
    authenticated: true,
    principal,
    person: principal.kind === 'person' ? getPersonById(principal.personId) ?? null : null,
    accessibleServerIds: getAccessibleServerIds(principal),
  };
}

export function canAccessPersonId(principal: Principal | undefined, personId: string): boolean {
  if (!principal) return false;
  return principal.kind === 'admin' || principal.personId === personId;
}

/** Login handler */
export function loginHandler(req: Request, res: Response): void {
  const { password, token: accessToken } = req.body ?? {};

  if (typeof accessToken === 'string' && accessToken.trim()) {
    const personTokenRecord = verifyPersonToken(accessToken);
    if (!personTokenRecord) {
      res.status(401).json({ error: '访问令牌无效或已过期' });
      return;
    }

    const person = getPersonById(personTokenRecord.personId);
    if (!person || person.status !== 'active') {
      res.status(403).json({ error: '当前人员不可用' });
      return;
    }

    res.json({ token: accessToken, ...buildSessionResponse({ kind: 'person', personId: person.id }) });
    return;
  }

  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: '请提供密码或访问令牌' });
    return;
  }

  const settings = getSettings();

  // If no password is set yet, treat this as first-time setup
  if (!settings.password) {
    const hash = hashPassword(password);
    saveSetting('password', hash);
    const token = signToken({ role: 'admin' });
    res.json({ token, ...buildSessionResponse({ kind: 'admin' }) });
    return;
  }

  if (!verifyPassword(password, settings.password)) {
    res.status(401).json({ error: '密码错误' });
    return;
  }

  const token = signToken({ role: 'admin' });
  res.json({ token, ...buildSessionResponse({ kind: 'admin' }) });
}

/** JWT auth middleware — supports admin JWT and person token */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未认证' });
    return;
  }
  const token = auth.slice(7);

  // Try admin JWT first
  const jwtPayload = verifyToken(token);
  if (jwtPayload) {
    (req as any).user = jwtPayload;
    req.principal = { kind: 'admin' };
    next();
    return;
  }

  // Try person token
  const personTokenRecord = verifyPersonToken(token);
  if (personTokenRecord) {
    const person = getPersonById(personTokenRecord.personId);
    if (person && person.status === 'active') {
      (req as any).user = { role: 'person', personId: person.id };
      req.principal = { kind: 'person', personId: person.id };
      next();
      return;
    }
  }

  res.status(401).json({ error: 'Token 无效或已过期' });
}

/** Middleware that requires admin principal */
export function adminOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.principal || req.principal.kind !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' });
    return;
  }
  next();
}

/** Socket.IO auth middleware — supports admin JWT and person token */
export function socketAuthMiddleware(socket: any, next: (err?: Error) => void): void {
  const token = socket.handshake.auth?.token;
  if (!token) {
    console.warn(`[ws-auth] rejected socket ${socket.id}: missing token`);
    return next(new Error('未认证'));
  }

  // Try admin JWT first
  const jwtPayload = verifyToken(token);
  if (jwtPayload) {
    socket.data.user = jwtPayload;
    socket.data.principal = { kind: 'admin' } satisfies Principal;
    console.info(`[ws-auth] accepted socket ${socket.id}: role=admin`);
    next();
    return;
  }

  // Try person token
  const personTokenRecord = verifyPersonToken(token);
  if (personTokenRecord) {
    const person = getPersonById(personTokenRecord.personId);
    if (person && person.status === 'active') {
      socket.data.user = { role: 'person', personId: person.id };
      socket.data.principal = { kind: 'person', personId: person.id } satisfies Principal;
      console.info(`[ws-auth] accepted socket ${socket.id}: role=person personId=${person.id}`);
      next();
      return;
    }
  }

  console.warn(`[ws-auth] rejected socket ${socket.id}: invalid token`);
  return next(new Error('Token 无效'));
}

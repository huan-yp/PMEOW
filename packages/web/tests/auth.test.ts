import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { signToken } from '../src/auth.js';

describe('auth', () => {
  it('signs tokens with a 30 day default lifetime', () => {
    const decoded = jwt.decode(signToken({ role: 'admin' })) as jwt.JwtPayload | null;

    expect(decoded).not.toBeNull();
    expect(decoded?.iat).toEqual(expect.any(Number));
    expect(decoded?.exp).toEqual(expect.any(Number));
    expect((decoded?.exp ?? 0) - (decoded?.iat ?? 0)).toBe(30 * 24 * 60 * 60);
  });
});
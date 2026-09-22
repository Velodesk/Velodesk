/** auth.ts v1.1.0 — authFromHeaderOrBody p/ rotas chamadas via sendBeacon (sem header custom) */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token não informado' });
  }
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, env.jwtSecret) as AuthPayload;
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido' });
  }
}

/**
 * Mesma verificação de `authMiddleware`, mas aceita o token também em `req.body.token` —
 * necessário pra rotas chamadas via `navigator.sendBeacon`, que não permite setar o header
 * Authorization. Usar só em rotas de baixo risco que atuam sobre o próprio usuário do token
 * (ex.: heartbeat de presença), nunca como substituto geral do `authMiddleware`.
 */
export function authFromHeaderOrBody(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const headerToken = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const bodyToken = typeof req.body?.token === 'string' ? req.body.token : '';
  const token = headerToken || bodyToken;
  if (!token) {
    return res.status(401).json({ message: 'Token não informado' });
  }
  try {
    req.user = jwt.verify(token, env.jwtSecret) as AuthPayload;
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido' });
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

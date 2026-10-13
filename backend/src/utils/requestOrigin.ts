/**
 * requestOrigin v1.0.0 — origem pública (https://host) da requisição em curso, via AsyncLocalStorage.
 * Links gerados em e-mails (ex.: Aprovar/Reprovar de workflow) devem apontar para o MESMO
 * ambiente que os enviou: dev → API de dev, prod → API de prod.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

const storage = new AsyncLocalStorage<{ origin: string }>();

export function requestOriginMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const host = String(req.get('host') || '').trim();
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = isLocal ? req.protocol : 'https';
  if (!host) return next();
  storage.run({ origin: `${proto}://${host}` }, next);
}

export function getCurrentRequestOrigin(): string {
  return storage.getStore()?.origin || '';
}

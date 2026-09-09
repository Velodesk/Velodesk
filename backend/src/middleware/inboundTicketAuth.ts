/** inboundTicketAuth v1.0.0 — origem inferida pelo header dedicado + chave [a-z0-9]{35} */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import type { InboundTicketOrigin } from '../services/inbound-ticket/types';
import {
  INBOUND_TICKET_ORIGIN_HEADERS,
  INBOUND_TICKET_SECRET_PATTERN,
} from '../services/inbound-ticket/types';

declare global {
  namespace Express {
    interface Request {
      inboundTicketOrigin?: InboundTicketOrigin;
    }
  }
}

function readHeader(req: Request, name: string): string {
  return String(req.headers[name] ?? '').trim();
}

function getConfiguredSecret(origin: InboundTicketOrigin): string {
  switch (origin) {
    case 'app':
      return env.inboundTicketAppSecret;
    case 'telefone':
      return env.inboundTicketTelefoneSecret;
    case 'agente-ia':
      return env.inboundTicketAgenteIaSecret;
    case 'chat':
      return env.inboundTicketChatSecret;
    default:
      return '';
  }
}

function secretsMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function detectOriginsFromHeaders(req: Request): InboundTicketOrigin[] {
  const found: InboundTicketOrigin[] = [];
  for (const [origin, headerName] of Object.entries(INBOUND_TICKET_ORIGIN_HEADERS) as Array<
    [InboundTicketOrigin, string]
  >) {
    if (readHeader(req, headerName)) {
      found.push(origin);
    }
  }
  return found;
}

export function inboundTicketAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!env.inboundTicketsEnabled) {
    res.status(503).json({ message: 'Inbound tickets desabilitado' });
    return;
  }

  const origins = detectOriginsFromHeaders(req);
  if (origins.length === 0) {
    res.status(401).json({ message: 'Header de autenticação inbound ticket ausente' });
    return;
  }
  if (origins.length > 1) {
    res.status(400).json({ message: 'Informe apenas um header de autenticação por requisição' });
    return;
  }

  const origin = origins[0]!;
  const headerName = INBOUND_TICKET_ORIGIN_HEADERS[origin];
  const received = readHeader(req, headerName);
  const expected = getConfiguredSecret(origin);

  if (!expected) {
    if (env.nodeEnv !== 'production') {
      req.inboundTicketOrigin = origin;
      next();
      return;
    }
    res.status(503).json({ message: `Inbound tickets desabilitado — secret ausente (${origin})` });
    return;
  }

  if (!INBOUND_TICKET_SECRET_PATTERN.test(received)) {
    res.status(401).json({ message: 'Chave inbound ticket inválida — use 35 caracteres [a-z0-9]' });
    return;
  }

  if (!secretsMatch(received, expected)) {
    res.status(401).json({ message: 'Chave inbound ticket incorreta' });
    return;
  }

  req.inboundTicketOrigin = origin;
  next();
}

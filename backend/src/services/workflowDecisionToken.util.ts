/**
 * workflowDecisionToken.util v1.0.0 — token assinado (HMAC/JWT) dos botões Aprovar/Reprovar
 * enviados por e-mail. Amarrado a ticket + etapa + destinatário: mudou a etapa, o token morre.
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { IWorkflowPathSegment } from '../models/ChamadoN1';

const PURPOSE = 'wf-decision';
const TOKEN_TTL = '14d';

export interface WorkflowDecisionTokenPayload {
  chamadoId: string;
  stepSig: string;
  email: string;
}

export function buildWorkflowStepSignature(path: IWorkflowPathSegment[] | null | undefined): string {
  return (path || [])
    .map((seg) => `${String(seg.passoEnvelopeId)}:${seg.viaVariavel || ''}`)
    .join('/');
}

export function signWorkflowDecisionToken(payload: WorkflowDecisionTokenPayload): string {
  return jwt.sign({ ...payload, purpose: PURPOSE }, `${env.jwtSecret}:${PURPOSE}`, {
    expiresIn: TOKEN_TTL,
  } as jwt.SignOptions);
}

export function verifyWorkflowDecisionToken(token: string): WorkflowDecisionTokenPayload | null {
  try {
    const decoded = jwt.verify(token, `${env.jwtSecret}:${PURPOSE}`) as Record<string, unknown>;
    if (decoded.purpose !== PURPOSE) return null;
    const chamadoId = String(decoded.chamadoId || '');
    const stepSig = String(decoded.stepSig || '');
    const email = String(decoded.email || '').trim().toLowerCase();
    if (!chamadoId || !stepSig || !email) return null;
    return { chamadoId, stepSig, email };
  } catch {
    return null;
  }
}

export function buildWorkflowDecisionUrl(token: string, decision: 'approve' | 'reject'): string {
  const base = env.twilioWebhookPublicBaseUrl.replace(/\/+$/, '');
  return `${base}/api/workflow-decisao?t=${encodeURIComponent(token)}&d=${decision}`;
}

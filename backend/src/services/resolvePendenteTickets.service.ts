/**
 * resolvePendenteTickets.service v1.0.0 — pendente ≥48h → resolvido
 * VERSION: v1.0.0 | DATE: 2026-08-12
 */
import { ChamadoN1 } from '../models/ChamadoN1';
import { env } from '../config/env';
import { appendStatusTransition, lastStatusInFilter } from './chamado.mapper';
import { findChamadoIdsComCasoEspecial } from './reclamacoes/reclamacao.service';

export interface ResolvePendenteResult {
  scanned: number;
  resolved: number;
  errors: number;
}

function lastStatusExactPendenteFilter() {
  return lastStatusInFilter(['pendente', 'em-espera']);
}

/**
 * Resolve tickets cujo último status é `pendente` (ou `em-espera`) e a data
 * desse registro é anterior a `now - pendenteResolveAfterMs` (default 48h).
 */
export async function resolvePendenteTicketsPastWindow(
  now = new Date(),
): Promise<ResolvePendenteResult> {
  const windowMs = Math.max(60_000, env.pendenteResolveAfterMs);
  const cutoff = new Date(now.getTime() - windowMs);

  const allCandidates = await ChamadoN1.find(lastStatusExactPendenteFilter()).select(
    '_id chamadoProtocolo registro',
  );
  // Casos especiais (RA/Procon/Bacen/Consumidor.gov) ficam de fora: devolutiva do órgão pode
  // passar de 48h e fechar o ticket antes impede a agente de agir.
  const casosEspeciais = await findChamadoIdsComCasoEspecial(allCandidates.map((c) => c._id));
  const candidates = allCandidates.filter((c) => !casosEspeciais.has(String(c._id)));

  let resolved = 0;
  let errors = 0;

  for (const chamado of candidates) {
    try {
      const registros = chamado.registro ?? [];
      const last = registros[registros.length - 1];
      const status = String(last?.status || '').toLowerCase();
      if (!last || (status !== 'pendente' && status !== 'em-espera')) continue;

      const pendingAt = last.data ? new Date(last.data) : null;
      if (!pendingAt || Number.isNaN(pendingAt.getTime())) continue;
      if (pendingAt.getTime() > cutoff.getTime()) continue;

      appendStatusTransition(chamado, 'resolvido', {
        autor: 'sistema',
        anotacaoInterna: 'Resolução automática após 48h em Pendente.',
        metadados: {
          source: 'resolve-pendente-job',
          pendingAt: pendingAt.toISOString(),
          resolvedAt: now.toISOString(),
        },
      });
      await chamado.save();
      resolved += 1;
    } catch (err) {
      errors += 1;
      console.warn(
        '[resolve-pendente] falha ao resolver',
        chamado.chamadoProtocolo || chamado._id?.toString(),
        (err as Error).message,
      );
    }
  }

  return { scanned: candidates.length, resolved, errors };
}

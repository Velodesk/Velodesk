/**
 * autonomousHandback.util v1.0.0 — resposta do cliente a um ticket que o agente autônomo já respondeu
 * VERSION: v1.0.0 | DATE: 2026-10-21
 *
 * O agente autônomo só atende na criação do ticket. Quando o cliente responde depois (o ticket reabre), a resposta
 * precisa de um humano: o ticket sai do "Agente Autônomo" e do aprovador e entra na roleta como qualquer outro.
 */
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { AGENTE_AUTONOMO_RESPONSAVEL } from '../../config/agenteAutonomo';
import { applyAssignmentToChamado } from '../assignmentRouter.service';

export async function handBackToHumansOnClientReply(chamado: IChamadoN1): Promise<void> {
  const ai = chamado.aiAutomation?.status;
  if (ai !== 'aprovada' && ai !== 'enviada_direto') return;
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  if (!tab || tab.responsavel !== AGENTE_AUTONOMO_RESPONSAVEL) return;

  tab.responsavel = '';
  tab.atribuido = '';
  chamado.markModified('tabulacao');
  // ignoreCanal: tickets do canal "Agente IA" normalmente ficam sem dono de propósito, mas aqui alguém precisa responder.
  await applyAssignmentToChamado(chamado, { source: 'inbound-ticket', canal: tab.canal, ignoreCanal: true });
}

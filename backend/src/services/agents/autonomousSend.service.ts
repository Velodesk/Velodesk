/**
 * autonomousSend.service v1.0.0 — envio da resposta do agente autônomo (+ tabulação real no chamado)
 * VERSION: v1.0.0 | DATE: 2026-10-07
 *
 * Usado tanto pelo envio direto quanto pela aprovação humana. Extraído do orquestrador para evitar
 * dependência circular com aiAutomation.service.
 */
import type { IChamadoN1 } from '../../models/ChamadoN1';
import type { ITabulacao } from '../../models/shared/registro.schema';
import { appendMessage, assertChamadoModifiable, currentStatus } from '../chamado.mapper';
import { notifyAgentReplyAsync } from '../emailNotification.service';
import {
  assertTabulacaoForStatus,
  getActiveTabulation,
  TabulacaoValidationError,
  validateComboSoft,
} from '../tabulation.service';
import { clearAiSuggestionCache } from './agentSuggestionCache.util';
import { loadTabulationConfig, validateTabulationResult } from './agentTabulation.util';
import type { TicketAiTabulationResult } from './agentTypes';
import { AGENTE_AUTONOMO_RESPONSAVEL } from '../../config/agenteAutonomo';

function toChamadoTabulacao(
  chamado: IChamadoN1,
  tab: TicketAiTabulationResult,
  atribuido?: string,
): ITabulacao {
  const current = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  return {
    tipoChamado: tab.tipo,
    produto: tab.produto,
    motivo: tab.motivo,
    motivo2: current?.motivo2 || '',
    motivo3: current?.motivo3 || '',
    detalhe: tab.detalhe,
    canal: current?.canal || '',
    // O agente autônomo é o responsável (identidade fixa, sem conta de usuário); quem audita fica em `atribuido`.
    responsavel: AGENTE_AUTONOMO_RESPONSAVEL,
    atribuido: atribuido ?? current?.atribuido ?? '',
  };
}

/** Normaliza a tabulação para os valores exatos da árvore ativa (espaços, acentos e caixa vindos da tela ou do agente). */
export async function canonicalTab(tab: TicketAiTabulationResult): Promise<TicketAiTabulationResult> {
  return validateTabulationResult(tab, await loadTabulationConfig());
}

/**
 * A tabulação do agente só é aplicada se existir de verdade na árvore ativa e estiver completa
 * (mesma regra que um humano enfrenta ao responder). Inválida ⇒ o chamado fica com o humano.
 */
export async function validateTabulacaoForAutonomy(
  chamado: IChamadoN1,
  tab: TicketAiTabulationResult,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const tree = await getActiveTabulation();
    if (!validateComboSoft(tree, tab.produto, tab.motivo, tab.detalhe)) {
      return { ok: false, reason: 'Tabulação fora da árvore ativa' };
    }
    await assertTabulacaoForStatus(toChamadoTabulacao(chamado, tab), 'em-andamento');
    return { ok: true };
  } catch (err) {
    if (err instanceof TabulacaoValidationError) return { ok: false, reason: err.message };
    throw err;
  }
}

/** Grava a mensagem pública como "Agente IA", aplica a tabulação e notifica o cliente. */
export async function sendAutonomousReply(
  chamado: IChamadoN1,
  messageText: string,
  tabulacao: TicketAiTabulationResult,
  metadados: Record<string, unknown> = {},
  opts: { statusFinal?: 'resolvido'; atribuidoPor?: string } = {},
): Promise<void> {
  assertChamadoModifiable(chamado);

  const tab = await canonicalTab(tabulacao);
  const check = await validateTabulacaoForAutonomy(chamado, tab);
  if (!check.ok) throw new TabulacaoValidationError(check.reason || 'Tabulação inválida');

  const registroIndex = chamado.registro?.length || 0;
  appendMessage(chamado, messageText, false, 'Agente IA', [], {
    agentAutonomousSend: true,
    agentRun: { at: new Date().toISOString() },
    ...metadados,
  });

  chamado.tabulacao = [toChamadoTabulacao(chamado, tab, opts.atribuidoPor)];

  const status = currentStatus(chamado);
  const novoStatus = opts.statusFinal || (status === 'novo' ? 'em-andamento' : null);
  if (novoStatus && novoStatus !== status) {
    chamado.registro.push({
      data: new Date(),
      origin: 'agente',
      autor: 'Agente IA',
      mensagemPublica: '',
      anexosMensagemPublica: [],
      anotacaoInterna: '',
      anexosAnotacaoInterna: [],
      alteracoes: [{ status: novoStatus }],
      metadados: {},
      status: novoStatus,
    });
  }

  await chamado.save();
  await notifyAgentReplyAsync(chamado, messageText, undefined, registroIndex);
  void clearAiSuggestionCache(chamado._id.toString()).catch((err) => {
    console.warn('[agent-autonomo] clearAiSuggestionCache fail-soft:', (err as Error)?.message);
  });
}

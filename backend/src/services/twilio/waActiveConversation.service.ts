/**
 * waActiveConversation.service v1.0.0 — CRUD do ponteiro telefone+canal → ticket ativo (Fase 2:
 * roteamento confiável de inbound do WhatsApp). Ver backend/src/models/WaActiveConversation.ts.
 */
import {
  getWaActiveConversationModel,
  type IWaActiveConversation,
  type WaConversationCanal,
  type WaTicketCollection,
} from '../../models/WaActiveConversation';

/** Mesma convenção de normalização já usada em whatsappThread.service.ts/cliente.service.ts:
 * só dígitos, casado pelos últimos 8 — tolera variação de formatação/DDI do Twilio. */
export function normalizePhoneDigitsForPointer(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 8) return '';
  return digits.slice(-8);
}

export interface UpsertWaActiveConversationParams {
  phoneE164: string;
  canal: WaConversationCanal;
  ticketId: string;
  ticketCollection: WaTicketCollection;
  ticketProtocolo?: string;
}

/** Chamar em todo envio/recebimento real de WhatsApp — idempotente, atualiza updatedAt. */
export async function upsertWaActiveConversation(
  params: UpsertWaActiveConversationParams,
): Promise<void> {
  const phoneDigits = normalizePhoneDigitsForPointer(params.phoneE164);
  if (!phoneDigits) return;

  const Model = getWaActiveConversationModel();
  try {
    await Model.findOneAndUpdate(
      { phoneDigits, canal: params.canal, active: true },
      {
        $set: {
          phoneE164: String(params.phoneE164 ?? '').trim(),
          ticketId: params.ticketId,
          ticketCollection: params.ticketCollection,
          ticketProtocolo: params.ticketProtocolo ?? '',
          active: true,
          closedAt: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    // Corrida rara (dois upserts simultâneos criando o mesmo par phoneDigits+canal) pode
    // colidir com o índice único parcial — fail-soft, o próximo upsert/leitura se resolve.
    console.warn('[wa-active-conversation] upsert fail-soft:', (err as Error)?.message);
  }
}

/** Desativa todo ponteiro ativo apontando pra esse ticket — chamar ao fechar/cancelar/resolver. */
export async function deactivateWaActiveConversationsForTicket(
  ticketId: string,
  ticketCollection: WaTicketCollection,
): Promise<void> {
  const Model = getWaActiveConversationModel();
  await Model.updateMany(
    { ticketId, ticketCollection, active: true },
    { $set: { active: false, closedAt: new Date() } },
  ).catch((err) => {
    console.warn('[wa-active-conversation] deactivate fail-soft:', (err as Error)?.message);
  });
}

/**
 * Ponteiro(s) ativo(s) pra esse telefone — pode haver mais de um (um por canal, ex.: ticket
 * padrão + um caso especial abertos ao mesmo tempo pro mesmo número). Ordenado por mais
 * recente primeiro (mesmo critério de recência já usado no scan legado por sufixo).
 */
export async function findActiveWaConversationsByPhone(
  phoneE164: string,
): Promise<IWaActiveConversation[]> {
  const phoneDigits = normalizePhoneDigitsForPointer(phoneE164);
  if (!phoneDigits) return [];
  const Model = getWaActiveConversationModel();
  return Model.find({ phoneDigits, active: true }).sort({ updatedAt: -1 });
}
